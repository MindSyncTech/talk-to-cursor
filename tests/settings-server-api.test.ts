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
  };
});

vi.mock("../src/config.js", () => ({
  USER_DATA_DIR: "/tmp/talktocursor-tests",
  loadConfig: () => mocks.config,
  saveConfig: (update: Record<string, unknown>) => {
    const nestedKeys = [
      "voiceSettings",
      "voicebox",
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
  mocks.config = structuredClone(mocks.defaults);
  mocks.cloudToken = null;
  mocks.saveCloudToken.mockReset();
  mocks.deleteCloudToken.mockReset();
  vi.restoreAllMocks();
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
});
