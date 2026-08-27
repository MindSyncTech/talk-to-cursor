import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";

const { speak } = vi.hoisted(() => ({ speak: vi.fn() }));

vi.mock("../src/providers/elevenlabs.js", () => ({
  elevenLabsProvider: { speak },
}));
vi.mock("../src/providers/voicebox.js", () => ({
  voiceboxProvider: { speak },
}));
vi.mock("../src/providers/cloud.js", () => ({
  cloudProvider: { speak },
}));

import { speakWithProvider } from "../src/providers/index.js";

describe("speakWithProvider", () => {
  beforeEach(() => speak.mockReset());

  it("routes to the selected provider", async () => {
    await speakWithProvider("hello", DEFAULT_CONFIG);
    expect(speak).toHaveBeenCalledWith("hello", DEFAULT_CONFIG);
  });

  it("reports an unsupported provider clearly", async () => {
    const config = { ...DEFAULT_CONFIG, ttsProvider: "invalid" } as never;
    await expect(speakWithProvider("hello", config)).rejects.toThrow(
      /Unsupported TTS provider 'invalid'/,
    );
  });
});
