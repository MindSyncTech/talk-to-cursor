import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ streamWithProvider: vi.fn() }));
vi.mock("../src/providers/index.js", () => providers);

import {
  acknowledgementCacheStatus,
  acknowledgementPhrases,
  ackCachePath,
  prewarmAcknowledgements,
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

describe("prewarmAcknowledgements", () => {
  async function* audio() {
    yield Buffer.from("pcm") as never;
  }
  async function* failure(): AsyncGenerator<never> {
    throw new Error("Managed TTS provider returned HTTP 429");
  }

  it("retries a phrase after a provider failure instead of stopping", async () => {
    providers.streamWithProvider.mockReset();
    providers.streamWithProvider
      .mockReturnValueOnce(audio())
      .mockReturnValueOnce(failure())
      .mockImplementation(() => audio());
    const dir = cacheDir();
    const phrases = ["Got it.", "On it.", "Sure."];
    const cached = await prewarmAcknowledgements(phrases, cloudConfig, new AbortController().signal, dir, 0, 0);
    expect(cached).toBe(3);
    expect(providers.streamWithProvider).toHaveBeenCalledTimes(4);
  });

  it("gives up after repeated failures", async () => {
    providers.streamWithProvider.mockReset();
    providers.streamWithProvider.mockImplementation(() => failure());
    await expect(
      prewarmAcknowledgements(["Got it."], cloudConfig, new AbortController().signal, cacheDir(), 0, 0),
    ).rejects.toThrow("429");
    expect(providers.streamWithProvider).toHaveBeenCalledTimes(3);
  });
});
