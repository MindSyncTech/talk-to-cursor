import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgementCacheStatus,
  acknowledgementPhrases,
  ackCachePath,
} from "../src/ack-cache.js";
import { DEFAULT_CONFIG, type Config } from "../src/config.js";

const dirs: string[] = [];
function cacheDir() {
  const dir = mkdtempSync(join(tmpdir(), "ttc-ack-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cloudConfig: Config = { ...DEFAULT_CONFIG, ttsProvider: "cloud", ttsEnabled: true };

describe("acknowledgementCacheStatus", () => {
  it("counts the current voice's cached phrases", () => {
    const dir = cacheDir();
    const phrases = acknowledgementPhrases(cloudConfig);
    writeFileSync(ackCachePath(phrases[0], cloudConfig, dir)!, "pcm");

    expect(acknowledgementCacheStatus(cloudConfig, dir)).toEqual({
      active: true,
      total: phrases.length,
      cached: 1,
      preparing: false,
    });
  });

  it("starts over when the voice changes", () => {
    const dir = cacheDir();
    for (const text of acknowledgementPhrases(cloudConfig)) {
      writeFileSync(ackCachePath(text, cloudConfig, dir)!, "pcm");
    }
    const newVoice = { ...cloudConfig, cloud: { ...cloudConfig.cloud, voiceId: "Puck" } };
    expect(acknowledgementCacheStatus(cloudConfig, dir).cached).toBe(
      acknowledgementPhrases(cloudConfig).length,
    );
    expect(acknowledgementCacheStatus(newVoice, dir).cached).toBe(0);
  });

  it("is inactive when Instant Feedback is off or the voice can't be cached", () => {
    const off = { ...cloudConfig, agentSpeech: { ...cloudConfig.agentSpeech, instantFeedback: false } };
    expect(acknowledgementCacheStatus(off, cacheDir()).active).toBe(false);
    const voicebox: Config = { ...cloudConfig, ttsProvider: "voicebox" };
    expect(acknowledgementCacheStatus(voicebox, cacheDir()).active).toBe(false);
  });
});
