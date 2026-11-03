import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  normalizeServiceUrl,
  parseSettingsLeniently,
  pronunciationSettingsSchema,
  settingsSchema,
  settingsUpdateSchema,
  voiceInputSettingsSchema,
} from "../src/settings-schema.js";

describe("parseSettingsLeniently", () => {
  it("keeps valid settings when a newer version wrote unsupported ones", () => {
    const candidate = {
      ...structuredClone(DEFAULT_CONFIG),
      ttsProvider: "elevenlabs",
      futureSection: { enabled: true },
      voiceInput: {
        ...DEFAULT_CONFIG.voiceInput,
        enabled: true,
        builtinModel: "future-model",
      },
    };
    const result = parseSettingsLeniently(candidate, DEFAULT_CONFIG);
    expect(result?.config.ttsProvider).toBe("elevenlabs");
    expect(result?.config.voiceInput.enabled).toBe(true);
    expect(result?.config.voiceInput.builtinModel).toBe(
      DEFAULT_CONFIG.voiceInput.builtinModel,
    );
    expect(result?.config).not.toHaveProperty("futureSection");
    expect(result?.repaired).toEqual(
      expect.arrayContaining(["voiceInput.builtinModel", "futureSection"]),
    );
  });

  it("drops only the invalid pronunciation entry", () => {
    const entry = {
      id: "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
      match: "TTC",
      speak: "talk to cursor",
    };
    const candidate = {
      ...structuredClone(DEFAULT_CONFIG),
      pronunciation: {
        ...DEFAULT_CONFIG.pronunciation,
        entries: [entry, { ...entry, match: "" }],
      },
    };
    const result = parseSettingsLeniently(candidate, DEFAULT_CONFIG);
    expect(result?.config.pronunciation.entries).toHaveLength(1);
    expect(result?.repaired).toEqual(["pronunciation.entries.1"]);
  });

  it("returns null when there is no default to fall back to", () => {
    expect(
      parseSettingsLeniently({ ...structuredClone(DEFAULT_CONFIG), voiceId: "" }, {
        ...DEFAULT_CONFIG,
        voiceId: undefined as unknown as string,
      }),
    ).toBeNull();
  });
});

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

  it("accepts send and chime sounds, rejecting unknown ones", () => {
    expect(
      settingsUpdateSchema.parse({
        autoSubmit: { sendSoundEnabled: true, sendSound: "Tink" },
        voiceInput: { wakeChimeSound: "Glass" },
      }),
    ).toEqual({
      autoSubmit: { sendSoundEnabled: true, sendSound: "Tink" },
      voiceInput: { wakeChimeSound: "Glass" },
    });
    expect(() =>
      settingsUpdateSchema.parse({ autoSubmit: { sendSound: "../../evil" } }),
    ).toThrow();
  });

  it("defaults Auto-Submit to two words and keeps minTextLength for older versions", () => {
    const parsed = settingsSchema.parse(DEFAULT_CONFIG);
    expect(parsed.autoSubmit.minWords).toBe(2);
    expect(parsed.autoSubmit.minTextLength).toBe(15);
    expect(() => settingsUpdateSchema.parse({ autoSubmit: { minWords: 0 } })).toThrow();
  });

  it("accepts when the send sound plays, rejecting unknown triggers", () => {
    for (const sendSoundTrigger of ["both", "sendIt", "autoSubmit"]) {
      expect(settingsUpdateSchema.parse({ autoSubmit: { sendSoundTrigger } })).toEqual({
        autoSubmit: { sendSoundTrigger },
      });
    }
    expect(() =>
      settingsUpdateSchema.parse({ autoSubmit: { sendSoundTrigger: "always" } }),
    ).toThrow();
  });

  it("accepts Cloud dictation as a built-in speech model", () => {
    expect(
      settingsUpdateSchema.parse({ voiceInput: { builtinModel: "cloud" } }),
    ).toEqual({ voiceInput: { builtinModel: "cloud" } });
    expect(
      settingsUpdateSchema.safeParse({ voiceInput: { builtinModel: "whisper" } })
        .success,
    ).toBe(false);
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
