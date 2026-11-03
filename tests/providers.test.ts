import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";

const { speak, stream, playPcm } = vi.hoisted(() => ({
  speak: vi.fn(),
  stream: vi.fn(),
  playPcm: vi.fn(),
}));

vi.mock("../src/providers/elevenlabs.js", () => ({
  elevenLabsProvider: { stream },
}));
vi.mock("../src/providers/voicebox.js", () => ({
  voiceboxProvider: { speak },
}));
vi.mock("../src/providers/cloud.js", () => ({
  cloudProvider: { stream },
}));
vi.mock("../src/audio-output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/audio-output.js")>()),
  playPcm,
}));

import { alignSamples, pipelined } from "../src/audio-output.js";
import { speakWithProvider, splitForStreaming } from "../src/providers/index.js";

async function* chunks(...values: number[][]) {
  for (const value of values) yield Uint8Array.from(value);
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("speakWithProvider", () => {
  beforeEach(() => {
    speak.mockReset();
    stream.mockReset();
    playPcm.mockReset();
    stream.mockImplementation((part: string) => chunks([part.length, 0]));
    playPcm.mockImplementation(async (source: AsyncIterable<Uint8Array>) => {
      await collect(source);
      return { interrupted: false };
    });
  });

  it("streams the first sentence separately from the rest", async () => {
    const text = "First sentence here. Second one. Third one.";
    await speakWithProvider(text, DEFAULT_CONFIG);
    expect(stream.mock.calls.map((call) => call[0])).toEqual(
      splitForStreaming(text),
    );
    expect(stream).toHaveBeenCalledTimes(2);
    expect(playPcm).toHaveBeenCalledTimes(1);
  });

  it("uses speak for providers that play audio themselves", async () => {
    const config = { ...DEFAULT_CONFIG, ttsProvider: "voicebox" } as const;
    const result = await speakWithProvider("hello", config);
    expect(speak).toHaveBeenCalledWith("hello", config, expect.any(AbortSignal));
    expect(result).toEqual({ interrupted: false });
    expect(playPcm).not.toHaveBeenCalled();
  });

  it("reports an unsupported provider clearly", async () => {
    const config = { ...DEFAULT_CONFIG, ttsProvider: "invalid" } as never;
    await expect(speakWithProvider("hello", config)).rejects.toThrow(
      /Unsupported TTS provider 'invalid'/,
    );
  });
});

describe("splitForStreaming", () => {
  it("keeps a single sentence whole", () => {
    expect(splitForStreaming("Just one sentence.")).toEqual(["Just one sentence."]);
  });

  it("drops empty text", () => {
    expect(splitForStreaming("   ")).toEqual([]);
  });
});

describe("audio pipeline helpers", () => {
  it("pipelined yields parts in order", async () => {
    const result = await collect(
      pipelined(["a", "bb"], (part) => chunks([part.length])),
    );
    expect(result.map((chunk) => Array.from(chunk))).toEqual([[1], [2]]);
  });

  it("alignSamples carries odd bytes into the next chunk", async () => {
    const result = await collect(alignSamples(chunks([1, 2, 3], [4, 5, 6])));
    expect(result.flatMap((chunk) => Array.from(chunk))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.every((chunk) => chunk.length % 2 === 0)).toBe(true);
  });
});
