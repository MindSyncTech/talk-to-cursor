import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const defaults = {
    ttsEnabled: true,
    pauseMediaDuringSpeech: false,
    spokenResponseDetail: "brief",
    ttsProvider: "elevenlabs",
    apiKey: "sk-secret-value",
    voiceId: "voice-1",
    model: "eleven_flash_v2_5",
    voiceSettings: {
      speed: 1,
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
    },
    voicebox: {
      baseUrl: "http://127.0.0.1:17493",
      profile: "",
      personality: false,
    },
    pronunciation: {
      enabled: true,
      entries: [],
    },
    cloud: {
      apiUrl: "https://cloud.talktocursor.com",
      voiceId: "Kore",
      model: "gemini-2.5-flash-tts",
      settingsRevision: 0,
    },
    autoSubmit: {
      enabled: false,
      mode: "fixed",
      silenceDelay: 3,
      minTextLength: 15,
      targetApp: "Cursor",
      smartCandidateSilence: 0.8,
      smartTurnThreshold: 0.5,
      smartMaxSilence: 3,
      smartTextDelay: 0.2,
      submitCommandEnabled: true,
      submitPhrase: "send it",
    },
    voiceInput: {
      enabled: false,
      provider: "wispr",
      silenceThreshold: 0.005,
      silenceDuration: 2,
      wisprHotkey: "shift+ctrl",
      handyCommand: "",
      manualTriggerHotkey: "ctrl+shift+l",
      wakeWordEnabled: false,
      wakePhrase: "hey cursor",
      wakeSensitivity: 0.5,
      wakeChime: true,
    },
    autoListen: true,
  };
  return {
    defaults,
    config: structuredClone(defaults),
    cloudToken: null as string | null,
    saveCloudToken: vi.fn(),
    deleteCloudToken: vi.fn(),
    runtimeOverlay: null as Record<string, unknown> | null,
    checkForUpdates: vi.fn(),
    startBackgroundService: vi.fn(),
  };
});

vi.mock("../src/config.js", () => ({
  USER_DATA_DIR: "/tmp/talktocursor-tests",
  loadConfig: () => mocks.config,
  saveConfig: (update: Record<string, unknown>) => {
    const nestedKeys = [
      "voiceSettings",
      "voicebox",
      "pronunciation",
      "cloud",
      "autoSubmit",
      "voiceInput",
    ] as const;
    const next = { ...mocks.config, ...update };
    for (const key of nestedKeys) {
      if (update[key]) {
        next[key] = {
          ...mocks.config[key],
          ...(update[key] as Record<string, unknown>),
        };
      }
    }
    mocks.config = next;
    return mocks.config;
  },
  setRuntimeConfigOverlay: (overlay: Record<string, unknown> | null) => {
    mocks.runtimeOverlay = overlay;
  },
  writePrivateJson: vi.fn(),
}));

vi.mock("../src/credentials.js", () => ({
  getCloudToken: () => mocks.cloudToken,
  saveCloudToken: (token: string) => {
    mocks.cloudToken = token;
    mocks.saveCloudToken(token);
    return "keychain";
  },
  deleteCloudToken: () => {
    mocks.cloudToken = null;
    mocks.deleteCloudToken();
  },
}));

vi.mock("../src/update-checker.js", () => ({
  checkForUpdates: mocks.checkForUpdates,
}));

vi.mock("../src/background-service.js", () => ({
  checkBackgroundServicePermissions: vi.fn(),
  getBackgroundServiceLog: vi.fn(() => ""),
  getBackgroundServiceStatus: vi.fn(() => ({
    supported: true,
    installed: true,
    running: true,
  })),
  installBackgroundService: vi.fn(),
  startBackgroundService: mocks.startBackgroundService,
  stopBackgroundService: vi.fn(),
  uninstallBackgroundService: vi.fn(),
}));

vi.mock("@elevenlabs/elevenlabs-js", () => ({
  ElevenLabsClient: class {
    voices = {
      getAll: async () => ({ voices: [] }),
    };
  },
}));

import { app } from "../src/settings-server";

const nativeFetch = globalThis.fetch.bind(globalThis);
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine settings test server address"));
        return;
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.config = structuredClone(mocks.defaults);
  mocks.cloudToken = null;
  mocks.saveCloudToken.mockReset();
  mocks.deleteCloudToken.mockReset();
  mocks.runtimeOverlay = null;
  mocks.checkForUpdates.mockReset();
  mocks.checkForUpdates.mockResolvedValue({
    currentVersion: "1.3.0",
    latestVersion: "1.4.0",
    updateAvailable: true,
    checkedAt: "2026-08-29T12:00:00.000Z",
    checkFailed: false,
    installationMethod: "npx",
    updateCommand: "npx -y --prefer-online talktocursor@latest",
    releasesUrl: "https://github.com/MindSyncTech/talk-to-cursor/releases",
  });
  mocks.startBackgroundService.mockReset();
  mocks.startBackgroundService.mockResolvedValue({
    supported: true,
    installed: true,
    running: true,
    installedVersion: "1.3.0",
    currentVersion: "1.3.0",
    updateAvailable: false,
  });
});

function api(path: string, init?: RequestInit) {
  return nativeFetch(`${baseUrl}${path}`, init);
}

function post(path: string, body: unknown, headers?: Record<string, string>) {
  return api(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("local settings server API", () => {
  it("returns update status and supports a forced registry refresh", async () => {
    const response = await api("/api/update/status?refresh=1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateAvailable).toBe(true);
    expect(mocks.checkForUpdates).toHaveBeenCalledWith(true);
  });

  it("refreshes and restarts the installed Background Helper", async () => {
    const response = await post("/api/background-service/update", {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.installedVersion).toBe("1.3.0");
    expect(mocks.startBackgroundService).toHaveBeenCalledOnce();
  });

  it("returns configuration without exposing the full API key", async () => {
    const response = await api("/api/config");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.apiKey).toBe("sk-s****alue");
    expect(body.apiKeySet).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-secret-value");
    expect(body.cloud.apiUrl).toBe("https://cloud.talktocursor.com");
    expect(body.spokenResponseDetail).toBe("brief");
  });

  it("blocks requests from non-local browser origins", async () => {
    const response = await api("/api/config", {
      headers: { Origin: "https://evil.example" },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Cross-origin request blocked");
  });

  it("allows a localhost browser origin", async () => {
    const response = await api("/api/config", {
      headers: { Origin: "http://localhost:3847" },
    });

    expect(response.status).toBe(200);
  });

  it("validates configuration updates", async () => {
    const response = await post("/api/config", {
      cloud: {
        ...mocks.config.cloud,
        apiUrl: "http://remote.example",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid settings");
  });

  it("keeps the stored API key when the masked field is submitted empty", async () => {
    const response = await post("/api/config", {
      apiKey: "",
      autoListen: false,
      spokenResponseDetail: "detailed",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.config.apiKey).toBe("sk-secret-value");
    expect(body.config.apiKey).toBe("sk-s****alue");
    expect(body.config.autoListen).toBe(false);
    expect(body.config.spokenResponseDetail).toBe("detailed");
  });

  it("starts Cloud pairing against the configured production URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        device_code: "device-code",
        user_code: "ABCD-EFGH",
      }),
    );

    const response = await post("/api/cloud/connect/start", {
      apiUrl: "https://cloud.talktocursor.com/",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user_code).toBe("ABCD-EFGH");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.talktocursor.com/api/v1/device-authorizations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.config.cloud.apiUrl).toBe(
      "https://cloud.talktocursor.com",
    );
  });

  it("maps a pending Cloud token exchange to a local polling response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        { error: { code: "authorization_pending" } },
        { status: 428 },
      ),
    );

    const response = await post("/api/cloud/connect/poll", {
      deviceCode: "device-code",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ pending: true });
    expect(mocks.saveCloudToken).not.toHaveBeenCalled();
  });

  it("stores an approved device token without returning it to the browser", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ access_token: "ttc_live_secret" }),
    );

    const response = await post("/api/cloud/connect/poll", {
      deviceCode: "device-code",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.saveCloudToken).toHaveBeenCalledWith("ttc_live_secret");
    expect(body).toEqual({ success: true, storage: "keychain" });
    expect(JSON.stringify(body)).not.toContain("ttc_live_secret");
  });

  it("reports disconnected status without contacting Cloud", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await api("/api/cloud/status");

    expect(await response.json()).toEqual({ connected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the stored bearer token when checking Cloud usage", async () => {
    mocks.cloudToken = "ttc_live_secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ included: 100_000, remaining: 75_000 }),
    );

    const response = await api("/api/cloud/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connected).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.talktocursor.com/api/v1/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ttc_live_secret",
        }),
      }),
    );
  });

  it("downloads all portable preferences while preserving local-only values", async () => {
    mocks.cloudToken = "ttc_live_secret";
    mocks.config.voicebox.baseUrl = "http://127.0.0.1:9999";
    mocks.config.voiceInput.handyCommand = "/local/path/to/handy";
    mocks.config.pronunciation.entries = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        match: "local",
        speak: "low call",
        matchMode: "word",
        caseSensitive: false,
        enabled: true,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        schema_version: 2,
        revision: 7,
        settings: {
          ttsEnabled: false,
          pauseMediaDuringSpeech: true,
          spokenResponseDetail: "detailed",
          ttsProvider: "voicebox",
          voiceId: "Charon",
          model: "gemini-2.5-flash-tts",
          voiceSettings: {
            speed: 0.9,
            stability: 0.6,
            similarityBoost: 0.8,
            style: 0.7,
          },
          elevenLabs: {
            voiceId: "remote-elevenlabs-voice",
            model: "eleven_multilingual_v2",
          },
          voicebox: {
            profile: "Narrator",
            personality: true,
          },
          pronunciation: {
            enabled: false,
            entries: [],
          },
          autoSubmit: {
            ...mocks.config.autoSubmit,
            enabled: true,
            mode: "smart",
          },
          voiceInput: {
            enabled: true,
            provider: "handy",
            silenceThreshold: 0.01,
            silenceDuration: 2.5,
            wisprHotkey: "shift+ctrl",
            manualTriggerHotkey: "ctrl+shift+v",
            wakeWordEnabled: true,
            wakePhrase: "hey google",
            wakeSensitivity: 0.8,
            wakeChime: false,
          },
          autoListen: false,
        },
      }),
    );

    const response = await post("/api/cloud/settings/download", {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, revision: 7 });
    expect(mocks.config).toMatchObject({
      ttsEnabled: false,
      pauseMediaDuringSpeech: true,
      spokenResponseDetail: "detailed",
      ttsProvider: "voicebox",
      voiceId: "remote-elevenlabs-voice",
      model: "eleven_multilingual_v2",
      voicebox: {
        baseUrl: "http://127.0.0.1:9999",
        profile: "Narrator",
        personality: true,
      },
      autoSubmit: { enabled: true, mode: "smart" },
      voiceInput: {
        handyCommand: "/local/path/to/handy",
        wakePhrase: "hey google",
      },
      cloud: { voiceId: "Charon", settingsRevision: 7 },
      autoListen: false,
    });
    expect(mocks.config.apiKey).toBe("sk-secret-value");
    expect(mocks.config.pronunciation.entries[0]?.match).toBe("local");
  });

  it("uploads portable preferences without secrets or machine-local paths", async () => {
    mocks.cloudToken = "ttc_live_secret";
    mocks.config.voiceInput.handyCommand = "/local/path/to/handy";
    mocks.config.voicebox.baseUrl = "http://127.0.0.1:9999";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ revision: 3 }),
    );

    const response = await post("/api/cloud/settings/upload", {});

    expect(response.status).toBe(200);
    const cloudRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(cloudRequest.body));
    expect(payload.settings).toMatchObject({
      ttsProvider: "elevenlabs",
      elevenLabs: {
        voiceId: "voice-1",
        model: "eleven_flash_v2_5",
      },
      autoSubmit: mocks.defaults.autoSubmit,
      voiceInput: {
        wakePhrase: "hey cursor",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("sk-secret-value");
    expect(JSON.stringify(payload)).not.toContain("/local/path/to/handy");
    expect(JSON.stringify(payload)).not.toContain("127.0.0.1:9999");
    expect(payload.settings).not.toHaveProperty("pronunciation");
  });

  it("applies an assigned profile before establishing its sync baseline", async () => {
    mocks.cloudToken = "ttc_live_secret";
    mocks.config.voiceInput.handyCommand = "/local/path/to/handy";
    const profileSettings = {
      ttsEnabled: false,
      pauseMediaDuringSpeech: true,
      spokenResponseDetail: "detailed",
      ttsProvider: "voicebox",
      voiceId: "Kore",
      model: "gemini-2.5-flash-tts",
      voiceSettings: { ...mocks.defaults.voiceSettings, speed: 0.9 },
      elevenLabs: {
        voiceId: "assigned-voice",
        model: "eleven_multilingual_v2",
      },
      voicebox: { profile: "Assigned", personality: true },
      autoSubmit: mocks.defaults.autoSubmit,
      voiceInput: {
        enabled: true,
        provider: "handy",
        silenceThreshold: 0.005,
        silenceDuration: 2,
        wisprHotkey: "shift+ctrl",
        manualTriggerHotkey: "ctrl+shift+l",
        wakeWordEnabled: true,
        wakePhrase: "hey cursor",
        wakeSensitivity: 0.5,
        wakeChime: true,
      },
      pronunciation: mocks.defaults.pronunciation,
      autoListen: false,
    };
    const assignedProfile = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Assigned",
      is_default: false,
      revision: 4,
      settings: profileSettings,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          entitled: true,
          assignment: {
            profile_id: assignedProfile.id,
            host_id: "cursor",
            project_key: "project-key",
            project_label: "Project",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ entitled: true, profile: assignedProfile }),
      );

    const response = await api("/api/settings/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: assignedProfile.id }),
    });

    expect(response.status).toBe(200);
    expect(mocks.config).toMatchObject({
      ttsEnabled: false,
      pauseMediaDuringSpeech: true,
      voiceId: "assigned-voice",
      voiceSettings: { speed: 0.9 },
      voicebox: { profile: "Assigned" },
      voiceInput: {
        handyCommand: "/local/path/to/handy",
        wakeWordEnabled: true,
      },
      autoListen: false,
    });
    expect(mocks.runtimeOverlay).toMatchObject({
      ttsEnabled: false,
      voicebox: { profile: "Assigned" },
    });
  });
});
