import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPortableSettings,
  getProjectContext,
  toPortableSettings,
} from "../src/settings-profiles.js";
import {
  applyRuntimeConfigOverlay,
  DEFAULT_CONFIG,
  setRuntimeConfigOverlay,
  type Config,
} from "../src/config.js";

function config(): Config {
  return structuredClone(DEFAULT_CONFIG);
}

describe("settings profiles", () => {
  afterEach(() => {
    setRuntimeConfigOverlay(null);
  });

  it("hashes host and project identity without exposing the project path", () => {
    const projectRoot = "/private/work/Acme Voice";
    const context = getProjectContext(
      {
        TALKTOCURSOR_HOST: "codex",
        TALKTOCURSOR_PROJECT_ROOT: projectRoot,
        TALKTOCURSOR_PROJECT_ALIAS: "acme-voice",
      },
      "/ignored",
    );

    expect(context).toEqual({
      hostId: "codex",
      projectKey: createHash("sha256")
        .update("codex|local:acme-voice")
        .digest("hex"),
      projectLabel: "Acme Voice",
    });
    expect(JSON.stringify(context)).not.toContain("/private/work");
  });

  it("distinguishes same-named local paths without exposing either path", () => {
    const first = getProjectContext(
      { TALKTOCURSOR_HOST: "cursor" },
      "/private/clients/first/app",
    );
    const second = getProjectContext(
      { TALKTOCURSOR_HOST: "cursor" },
      "/private/clients/second/app",
    );

    expect(first.projectLabel).toBe("app");
    expect(second.projectLabel).toBe("app");
    expect(first.projectKey).not.toBe(second.projectKey);
    expect(JSON.stringify([first, second])).not.toContain("/private/clients");
  });

  it("excludes machine-local values from portable settings", () => {
    const local = config();
    local.apiKey = "sk-secret";
    local.cloud.apiUrl = "https://private.example";
    local.voicebox.baseUrl = "http://127.0.0.1:9999";
    local.voiceInput.handyCommand = "/private/bin/handy";

    const portable = toPortableSettings(local);

    expect(JSON.stringify(portable)).not.toContain("sk-secret");
    expect(JSON.stringify(portable)).not.toContain("private.example");
    expect(JSON.stringify(portable)).not.toContain("127.0.0.1");
    expect(JSON.stringify(portable)).not.toContain("/private/bin");
  });

  it("preserves credentials and machine-local settings when applying", () => {
    const local = config();
    local.apiKey = "sk-secret";
    local.cloud.apiUrl = "https://private.example";
    local.cloud.settingsRevision = 12;
    local.voicebox.baseUrl = "http://127.0.0.1:9999";
    local.voiceInput.handyCommand = "/private/bin/handy";
    const portable = toPortableSettings(config());
    portable.ttsEnabled = false;

    const applied = applyPortableSettings(portable, local);

    expect(applied.ttsEnabled).toBe(false);
    expect(applied.apiKey).toBe("sk-secret");
    expect(applied.cloud.apiUrl).toBe("https://private.example");
    expect(applied.cloud.settingsRevision).toBe(12);
    expect(applied.voicebox.baseUrl).toBe("http://127.0.0.1:9999");
    expect(applied.voiceInput.handyCommand).toBe("/private/bin/handy");
  });

  it("includes pronunciation in paid profile conversion and application", () => {
    const source = config();
    source.pronunciation.entries = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        match: "API",
        speak: "A P I",
        matchMode: "word",
        caseSensitive: false,
        enabled: true,
      },
    ];

    const portable = toPortableSettings(source);
    expect(portable.pronunciation).toEqual(source.pronunciation);

    const local = config();
    expect(applyPortableSettings(portable, local).pronunciation).toEqual(
      source.pronunciation,
    );
  });

  it("composes refreshed runtime overlays onto current local-only fields", () => {
    const firstLocal = config();
    firstLocal.apiKey = "first-secret";
    firstLocal.voicebox.baseUrl = "http://127.0.0.1:9001";
    firstLocal.voiceInput.handyCommand = "/first/handy";
    setRuntimeConfigOverlay({
      ttsEnabled: false,
      voicebox: { profile: "Work" },
      voiceInput: { wakeWordEnabled: true },
    });

    const first = applyRuntimeConfigOverlay(firstLocal);
    expect(first).toMatchObject({
      ttsEnabled: false,
      apiKey: "first-secret",
      voicebox: {
        baseUrl: "http://127.0.0.1:9001",
        profile: "Work",
      },
      voiceInput: {
        handyCommand: "/first/handy",
        wakeWordEnabled: true,
      },
    });

    const refreshedLocal = config();
    refreshedLocal.apiKey = "refreshed-secret";
    refreshedLocal.voicebox.baseUrl = "http://127.0.0.1:9002";
    refreshedLocal.voiceInput.handyCommand = "/refreshed/handy";
    setRuntimeConfigOverlay({
      ttsEnabled: true,
      voicebox: { profile: "Review" },
      voiceInput: { wakeWordEnabled: false },
    });

    expect(applyRuntimeConfigOverlay(refreshedLocal)).toMatchObject({
      ttsEnabled: true,
      apiKey: "refreshed-secret",
      voicebox: {
        baseUrl: "http://127.0.0.1:9002",
        profile: "Review",
      },
      voiceInput: {
        handyCommand: "/refreshed/handy",
        wakeWordEnabled: false,
      },
    });
  });
});
