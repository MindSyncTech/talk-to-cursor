import { describe, expect, it } from "vitest";
import {
  normalizeServiceUrl,
  settingsUpdateSchema,
  voiceInputSettingsSchema,
} from "../src/settings-schema.js";

describe("normalizeServiceUrl", () => {
  it("allows HTTPS and removes trailing slashes", () => {
    expect(normalizeServiceUrl("https://example.com///")).toBe(
      "https://example.com",
    );
  });

  it("allows HTTP only for localhost", () => {
    expect(normalizeServiceUrl("http://127.0.0.1:17493/")).toBe(
      "http://127.0.0.1:17493",
    );
    expect(() => normalizeServiceUrl("http://example.com")).toThrow(/HTTPS/);
  });
});

describe("settingsUpdateSchema", () => {
  it("accepts bounded partial settings", () => {
    expect(
      settingsUpdateSchema.parse({
        voiceSettings: { speed: 1.1 },
        autoSubmit: { mode: "smart", minTextLength: 15 },
      }),
    ).toEqual({
      voiceSettings: { speed: 1.1 },
      autoSubmit: { mode: "smart", minTextLength: 15 },
    });
  });

  it("rejects unknown providers and out-of-range values", () => {
    expect(
      settingsUpdateSchema.safeParse({ ttsProvider: "unknown" }).success,
    ).toBe(false);
    expect(
      settingsUpdateSchema.safeParse({ voiceSettings: { speed: 2 } }).success,
    ).toBe(false);
    expect(
      settingsUpdateSchema.safeParse({
        autoSubmit: { smartCandidateSilence: 0.05 },
      }).success,
    ).toBe(false);
    expect(
      settingsUpdateSchema.safeParse({
        autoSubmit: { submitPhrase: "do it" },
      }).success,
    ).toBe(false);
  });

  it("normalizes legacy managed Cloud voice and model values", () => {
    expect(
      settingsUpdateSchema.parse({
        cloud: {
          voiceId: "21m00Tcm4TlvDq8ikWAM",
          model: "eleven_flash_v2_5",
        },
      }),
    ).toEqual({
      cloud: {
        voiceId: "Kore",
        model: "gemini-2.5-flash-tts",
      },
    });
  });
});

describe("voiceInputSettingsSchema", () => {
  it.each(["ok claude", "hey google", "ok google"] as const)(
    "accepts the %s wake phrase",
    (wakePhrase) => {
      expect(
        voiceInputSettingsSchema.parse({
          enabled: true,
          provider: "handy",
          silenceThreshold: 0.005,
          silenceDuration: 2,
          wisprHotkey: "shift+ctrl",
          handyCommand: "",
          manualTriggerHotkey: "ctrl+shift+l",
          wakeWordEnabled: true,
          wakePhrase,
          wakeSensitivity: 0.5,
          wakeChime: true,
        }).wakePhrase,
      ).toBe(wakePhrase);
    },
  );

  it("accepts and discards the retired TTS delay setting", () => {
    expect(
      voiceInputSettingsSchema.parse({
        enabled: true,
        provider: "wispr",
        ttsDelay: 8,
        silenceThreshold: 0.005,
        silenceDuration: 2,
        wisprHotkey: "shift+ctrl",
        handyCommand: "",
        manualTriggerHotkey: "ctrl+shift+l",
        wakeWordEnabled: false,
        wakePhrase: "hey cursor",
        wakeSensitivity: 0.5,
        wakeChime: true,
      }),
    ).not.toHaveProperty("ttsDelay");
  });
});
