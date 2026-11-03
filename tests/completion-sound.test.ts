import { existsSync } from "fs";
import { describe, expect, it } from "vitest";
import { completionFeedbackFor, soundFeedbackFor, soundPath } from "../src/completion-sound.js";
import { DEFAULT_CONFIG, type Config } from "../src/config.js";
import { settingsSchema, settingsUpdateSchema, TTC_SOUNDS } from "../src/settings-schema.js";

describe("sound files", () => {
  it("bundles every TalkToCursor sound and resolves macOS sounds", () => {
    for (const sound of TTC_SOUNDS) expect(existsSync(soundPath(sound))).toBe(true);
    expect(soundPath("Glass")).toBe("/System/Library/Sounds/Glass.aiff");
  });
});

function withMode(mode: Config["completionFeedback"]["mode"]): Config {
  return { ...DEFAULT_CONFIG, completionFeedback: { mode, sound: "Glass" } };
}

describe("completion feedback", () => {
  it("only replaces the speech marked as the completion summary", () => {
    expect(completionFeedbackFor(withMode("sound"), true, "darwin")).toBe("sound");
    expect(completionFeedbackFor(withMode("both"), true, "darwin")).toBe("both");
    expect(completionFeedbackFor(withMode("sound"), false, "darwin")).toBe("speech");
  });

  it("speaks on platforms without macOS system sounds", () => {
    expect(completionFeedbackFor(withMode("sound"), true, "linux")).toBe("speech");
    expect(completionFeedbackFor(withMode("both"), true, "win32")).toBe("speech");
  });

  it("defaults existing configs to spoken completion and a sound before questions", () => {
    const { completionFeedback: _c, questionFeedback: _q, ...legacy } = DEFAULT_CONFIG;
    const parsed = settingsSchema.parse(legacy);
    expect(parsed.completionFeedback).toEqual({
      mode: "speech",
      sound: "ttc-success-jingle-1",
    });
    expect(parsed.questionFeedback).toEqual({
      mode: "both",
      sound: "ttc-pending-review-1",
    });
  });

  it("uses the answers-needed sound only for question speech", () => {
    expect(soundFeedbackFor(DEFAULT_CONFIG, "question", "darwin")).toEqual({
      mode: "both",
      sound: "ttc-pending-review-1",
    });
    expect(soundFeedbackFor(DEFAULT_CONFIG, "update", "darwin").mode).toBe("speech");
    expect(soundFeedbackFor(DEFAULT_CONFIG, "question", "linux").mode).toBe("speech");
  });

  it("rejects sounds outside the bundled macOS list", () => {
    const result = settingsUpdateSchema.safeParse({
      completionFeedback: { sound: "../../../etc/passwd" },
    });
    expect(result.success).toBe(false);
  });
});

describe("FluidVoice voice input", () => {
  it("accepts FluidVoice and defaults its hotkey to Right Option", () => {
    const { fluidVoiceHotkey: _omitted, ...voiceInput } = DEFAULT_CONFIG.voiceInput;
    const parsed = settingsSchema.parse({
      ...DEFAULT_CONFIG,
      voiceInput: { ...voiceInput, provider: "fluidvoice" },
    });
    expect(parsed.voiceInput.provider).toBe("fluidvoice");
    expect(parsed.voiceInput.fluidVoiceHotkey).toBe("right_option");
  });
});
