import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { USER_DATA_DIR, type Config } from "./config.js";
import type { PcmChunk } from "./audio-output.js";
import { streamWithProvider } from "./providers/index.js";

export const ACK_CACHE_DIR = join(USER_DATA_DIR, "ack-cache");
const MAX_CACHED_PHRASES = 300;
const PREWARM_LOCK_MS = 10 * 60_000;

/** Everything that changes how a phrase sounds; null when audio can't be cached. */
export function voiceFingerprint(config: Config): string | null {
  const { voiceSettings } = config;
  if (config.ttsProvider === "elevenlabs") {
    return JSON.stringify([
      "elevenlabs",
      config.voiceId,
      config.model,
      voiceSettings.speed,
      voiceSettings.stability,
      voiceSettings.similarityBoost,
      voiceSettings.style,
    ]);
  }
  if (config.ttsProvider === "cloud") {
    return JSON.stringify([
      "cloud",
      config.cloud.apiUrl,
      config.cloud.voiceId,
      config.cloud.model,
      voiceSettings.cloudSpeed,
      voiceSettings.style,
    ]);
  }
  return null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function ackCachePath(text: string, config: Config, dir = ACK_CACHE_DIR): string | null {
  const fingerprint = voiceFingerprint(config);
  return fingerprint ? join(dir, `${hash(`${fingerprint}|${text}`)}.pcm`) : null;
}

function writeCache(path: string, chunks: PcmChunk[], dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, Buffer.concat(chunks), { mode: 0o600 });
  renameSync(temporary, path);
  pruneCache(dir);
}

function pruneCache(dir: string): void {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".pcm"))
    .map((name) => ({ path: join(dir, name), used: statSync(join(dir, name)).mtimeMs }));
  if (files.length <= MAX_CACHED_PHRASES) return;
  files.sort((a, b) => a.used - b.used);
  for (const file of files.slice(0, files.length - MAX_CACHED_PHRASES)) {
    try {
      unlinkSync(file.path);
    } catch {
      // Another process may have pruned it already.
    }
  }
}

/**
 * Audio for an acknowledgement phrase: from the cache when available,
 * otherwise streamed from the provider and cached. Null for Voicebox.
 */
export function acknowledgementAudio(
  text: string,
  config: Config,
  signal: AbortSignal,
  dir = ACK_CACHE_DIR,
): AsyncIterable<PcmChunk> | null {
  const path = ackCachePath(text, config, dir);
  if (!path) return null;
  return (async function* () {
    if (existsSync(path)) {
      const now = new Date();
      utimesSync(path, now, now);
      yield new Uint8Array(readFileSync(path));
      return;
    }
    const source = streamWithProvider(text, config, signal);
    if (!source) return;
    const chunks: PcmChunk[] = [];
    for await (const chunk of source) {
      chunks.push(chunk);
      yield chunk;
    }
    if (!signal.aborted && chunks.length) writeCache(path, chunks, dir);
  })();
}

/** Cache every phrase for the current voice; one process at a time does the work. */
export async function prewarmAcknowledgements(
  phrases: readonly string[],
  config: Config,
  signal: AbortSignal,
  dir = ACK_CACHE_DIR,
): Promise<number> {
  const fingerprint = voiceFingerprint(config);
  if (!fingerprint) return 0;
  const missing = phrases.filter((text) => !existsSync(ackCachePath(text, config, dir)!));
  if (!missing.length) return 0;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, `.prewarm-${hash(fingerprint)}`);
  try {
    if (Date.now() - statSync(lock).mtimeMs < PREWARM_LOCK_MS) return 0;
    unlinkSync(lock);
  } catch {
    // No lock yet.
  }
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch {
    return 0;
  }
  let cached = 0;
  try {
    for (const text of missing) {
      if (signal.aborted) break;
      const source = streamWithProvider(text, config, signal);
      if (!source) break;
      const chunks: PcmChunk[] = [];
      for await (const chunk of source) chunks.push(chunk);
      if (signal.aborted || !chunks.length) break;
      writeCache(ackCachePath(text, config, dir)!, chunks, dir);
      cached += 1;
    }
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // Already removed.
    }
  }
  return cached;
}
