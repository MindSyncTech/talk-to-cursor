import { describe, expect, it } from "vitest";
import { completionFeedbackFor } from "../src/completion-sound.js";
import { DEFAULT_CONFIG, type Config } from "../src/config.js";
import { settingsSchema, settingsUpdateSchema } from "../src/settings-schema.js";

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

  it("defaults existing configs to spoken completion", () => {
    const { completionFeedback: _omitted, ...legacy } = DEFAULT_CONFIG;
    expect(settingsSchema.parse(legacy).completionFeedback).toEqual({
      mode: "speech",
      sound: "Hero",
    });
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
