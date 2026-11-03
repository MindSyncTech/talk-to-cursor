import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { HelperIpcClient } from "./helper-ipc.js";

/** All streaming providers produce signed 16-bit little-endian mono PCM. */
export const PCM_SAMPLE_RATE = 24_000;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2;
const HELPER_FRAME_BYTES = 32 * 1024;
const PLAYER_IDLE_MS = 30_000;
const PLAYER_STARTUP_MS = 300;

export type PcmChunk = Uint8Array;

export interface PlaybackResult {
  interrupted: boolean;
}

export async function* readWebStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Start consuming a source immediately so it downloads ahead of playback. */
export function prefetch<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const items: T[] = [];
  let done = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    const resolve = wake;
    wake = null;
    resolve?.();
  };
  void (async () => {
    try {
      for await (const item of source) {
        items.push(item);
        notify();
      }
    } catch (error) {
      failure = error ?? new Error("Speech stream failed");
    } finally {
      done = true;
      notify();
    }
  })();
  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (items.length) {
          yield items.shift()!;
          continue;
        }
        if (failure) throw failure;
        if (done) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** Synthesize part N+1 while part N plays. */
export async function* pipelined<T>(
  parts: string[],
  open: (part: string) => AsyncIterable<T>,
): AsyncGenerator<T> {
  let next = parts.length ? prefetch(open(parts[0])) : null;
  for (let index = 0; index < parts.length; index += 1) {
    const current = next!;
    next = index + 1 < parts.length ? prefetch(open(parts[index + 1])) : null;
    yield* current;
  }
}

/** Keep PCM frames aligned to whole 16-bit samples. */
export async function* alignSamples(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  let carry: Uint8Array | null = null;
  for await (const chunk of source) {
    let data = chunk;
    if (carry) {
      data = new Uint8Array(carry.length + chunk.length);
      data.set(carry);
      data.set(chunk, carry.length);
      carry = null;
    }
    if (data.length % 2) {
      carry = data.slice(data.length - 1);
      data = data.subarray(0, data.length - 1);
    }
    if (data.length) yield data;
  }
}

/** Decode compressed audio (legacy MP3 responses) to 24 kHz PCM with ffmpeg. */
export async function* decodeToPcm(
  source: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "s16le",
      "-ac", "1",
      "-ar", String(PCM_SAMPLE_RATE),
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const abort = () => ffmpeg.kill("SIGKILL");
  signal.addEventListener("abort", abort, { once: true });
  const spawnFailure = new Promise<never>((_, reject) => {
    ffmpeg.once("error", (error) =>
      reject(new Error(`ffmpeg is required to decode legacy Cloud audio: ${error.message}`)),
    );
  });
  spawnFailure.catch(() => {});
  void (async () => {
    try {
      for await (const chunk of source) {
        if (!ffmpeg.stdin.write(chunk)) {
          await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
        }
      }
    } catch {
      ffmpeg.kill("SIGKILL");
    } finally {
      ffmpeg.stdin.end();
    }
  })();
  try {
    for await (const chunk of ffmpeg.stdout as AsyncIterable<Buffer>) {
      yield new Uint8Array(chunk);
    }
    await Promise.race([
      new Promise((resolve) => ffmpeg.once("close", resolve)),
      spawnFailure,
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * One long-lived ffplay process fed raw PCM, used when the Background Helper
 * is not running. Completion is derived from the bytes written.
 */
class PersistentPcmPlayer {
  private process: ChildProcess | null = null;
  private playheadEndsAt = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private available: boolean | null = null;

  private ensure(): ChildProcess {
    if (this.available === null) {
      this.available = !spawnSync("ffplay", ["-version"], { stdio: "ignore" }).error;
    }
    if (!this.available) {
      throw new Error(
        "ffplay from ffmpeg was not found. Install ffmpeg (brew install ffmpeg) or start the TalkToCursor Background Helper.",
      );
    }
    if (this.process && this.process.exitCode === null && !this.process.killed) {
      return this.process;
    }
    const player = spawn(
      "ffplay",
      [
        "-nodisp",
        "-loglevel", "error",
        "-fflags", "nobuffer",
        "-probesize", "32",
        "-analyzeduration", "0",
        "-f", "s16le",
        "-sample_rate", String(PCM_SAMPLE_RATE),
        "-i", "-",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    player.on("error", () => {
      if (this.process === player) this.process = null;
    });
    player.on("exit", () => {
      if (this.process === player) this.process = null;
    });
    player.stdin?.on("error", () => {});
    this.process = player;
    this.playheadEndsAt = Date.now() + PLAYER_STARTUP_MS;
    return player;
  }

  write(chunk: Uint8Array): void {
    const player = this.ensure();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    player.stdin?.write(chunk);
    const durationMs = (chunk.byteLength / PCM_BYTES_PER_SECOND) * 1000;
    this.playheadEndsAt = Math.max(Date.now(), this.playheadEndsAt) + durationMs;
  }

  remainingMs(): number {
    return Math.max(0, this.playheadEndsAt - Date.now());
  }

  cancel(): void {
    this.process?.kill("SIGKILL");
    this.process = null;
    this.playheadEndsAt = 0;
  }

  scheduleIdleShutdown(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.process?.stdin?.end();
      this.process = null;
    }, this.remainingMs() + PLAYER_IDLE_MS);
    this.idleTimer.unref();
  }
}

const localPlayer = new PersistentPcmPlayer();

async function playLocally(
  chunks: AsyncIterable<PcmChunk>,
  signal: AbortSignal,
): Promise<PlaybackResult> {
  try {
    for await (const chunk of chunks) {
      if (signal.aborted) break;
      localPlayer.write(chunk);
    }
    if (!signal.aborted) {
      await abortableDelay(localPlayer.remainingMs() + 150, signal);
    }
  } finally {
    if (signal.aborted) localPlayer.cancel();
    else localPlayer.scheduleIdleShutdown();
  }
  return { interrupted: signal.aborted };
}

async function playThroughHelper(
  helper: HelperIpcClient,
  chunks: AsyncIterable<PcmChunk>,
  signal: AbortSignal,
): Promise<PlaybackResult> {
  const id = randomUUID();
  let bytes = 0;
  const finished = new Promise<{ interrupted: boolean } | null>((resolve) => {
    const onMessage = (message: { type: string; id?: unknown; interrupted?: unknown }) => {
      if (message.type === "playback.finished" && message.id === id) {
        cleanup();
        resolve({ interrupted: Boolean(message.interrupted) });
      }
    };
    const onDisconnect = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      helper.off("message", onMessage);
      helper.off("disconnected", onDisconnect);
    };
    helper.on("message", onMessage);
    helper.on("disconnected", onDisconnect);
  });

  helper.send({ type: "tts.start", id, sampleRate: PCM_SAMPLE_RATE });
  for await (const chunk of chunks) {
    if (signal.aborted) break;
    for (let offset = 0; offset < chunk.byteLength; offset += HELPER_FRAME_BYTES) {
      const frame = chunk.subarray(offset, offset + HELPER_FRAME_BYTES);
      bytes += frame.byteLength;
      helper.send({
        type: "tts.audio",
        id,
        data: Buffer.from(frame).toString("base64"),
      });
    }
  }
  if (signal.aborted) {
    helper.send({ type: "tts.cancel", id });
    return { interrupted: true };
  }
  helper.send({ type: "tts.end", id });

  const onAbort = () => helper.send({ type: "tts.cancel", id });
  signal.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = (bytes / PCM_BYTES_PER_SECOND) * 1000 + 10_000;
  const timeout = new Promise<null>((resolve) =>
    setTimeout(resolve, timeoutMs, null).unref(),
  );
  try {
    const result = await Promise.race([finished, timeout]);
    return { interrupted: signal.aborted || Boolean(result?.interrupted) };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export interface PlaybackTarget {
  helper: HelperIpcClient | null;
  helperPlayback: boolean;
}

export async function playPcm(
  chunks: AsyncIterable<PcmChunk>,
  signal: AbortSignal,
  target: PlaybackTarget,
): Promise<PlaybackResult> {
  const aligned = alignSamples(chunks);
  if (target.helper && target.helperPlayback && target.helper.isConnected()) {
    return playThroughHelper(target.helper, aligned, signal);
  }
  return playLocally(aligned, signal);
}

/** Combine a caller signal with a timeout (AbortSignal.any needs Node 20). */
export function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    timeoutMs,
  );
  timer.unref();
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}
