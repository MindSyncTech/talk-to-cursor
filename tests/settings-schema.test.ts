import { describe, expect, it } from "vitest";
import {
  normalizeServiceUrl,
  pronunciationSettingsSchema,
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

describe("pronunciationSettingsSchema", () => {
  const entry = {
    id: "00000000-0000-4000-8000-000000000001",
    match: " API ",
    speak: " A P I ",
  };

  it("trims text and applies entry defaults", () => {
    expect(
      pronunciationSettingsSchema.parse({
        enabled: true,
        entries: [entry],
      }),
    ).toEqual({
      enabled: true,
      entries: [
        {
          id: entry.id,
          match: "API",
          speak: "A P I",
          matchMode: "word",
          caseSensitive: false,
          enabled: true,
        },
      ],
    });
  });

  it("rejects unsafe output, excess entries, and objects over 16KB", () => {
    expect(
      pronunciationSettingsSchema.safeParse({
        enabled: true,
        entries: [{ ...entry, speak: "A & P" }],
      }).success,
    ).toBe(false);

    const oversizedEntries = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      match: "😀".repeat(32),
      speak: "😀".repeat(64),
    }));
    expect(
      pronunciationSettingsSchema.safeParse({
        enabled: true,
        entries: oversizedEntries,
      }).success,
    ).toBe(false);
    expect(
      pronunciationSettingsSchema.safeParse({
        enabled: true,
        entries: [...oversizedEntries, entry],
      }).success,
    ).toBe(false);
  });
});
