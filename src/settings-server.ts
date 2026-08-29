#!/usr/bin/env node

import express from "express";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig } from "./config.js";
import {
  normalizeManagedModel,
  normalizeManagedVoice,
  normalizeServiceUrl,
  settingsUpdateSchema,
} from "./settings-schema.js";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  deleteCloudToken,
  getCloudToken,
  saveCloudToken,
} from "./credentials.js";
import {
  checkBackgroundServicePermissions,
  getBackgroundServiceLog,
  getBackgroundServiceStatus,
  installBackgroundService,
  startBackgroundService,
  stopBackgroundService,
  uninstallBackgroundService,
} from "./background-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const app = express();
const PORT = parseInt(process.env.PORT || "3847", 10);
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    try {
      const hostname = new URL(origin).hostname;
      if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
        res.status(403).json({ error: "Cross-origin request blocked" });
        return;
      }
    } catch {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
  }
  next();
});

// Serve static files from /public
app.use(express.static(join(__dirname, "..", "public")));

// GET /api/config - return current config (mask API key)
app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({
    ttsEnabled: config.ttsEnabled,
    pauseMediaDuringSpeech: config.pauseMediaDuringSpeech,
    spokenResponseDetail: config.spokenResponseDetail,
    ttsProvider: config.ttsProvider,
    apiKey: config.apiKey ? maskKey(config.apiKey) : "",
    apiKeySet: !!config.apiKey,
    voiceId: config.voiceId,
    model: config.model,
    voiceSettings: config.voiceSettings,
    voicebox: config.voicebox,
    cloud: config.cloud,
    cloudConnected: !!getCloudToken(),
    autoSubmit: config.autoSubmit,
    voiceInput: config.voiceInput,
    autoListen: config.autoListen,
  });
});

// POST /api/config - save config
app.post("/api/config", (req, res) => {
  const body =
    req.body && typeof req.body === "object" ? { ...req.body } : req.body;
  if (body && body.apiKey === "") delete body.apiKey;
  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid settings",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  const saved = saveConfig(parsed.data);
  res.json({
    success: true,
    config: {
      ttsEnabled: saved.ttsEnabled,
      pauseMediaDuringSpeech: saved.pauseMediaDuringSpeech,
      spokenResponseDetail: saved.spokenResponseDetail,
      ttsProvider: saved.ttsProvider,
      apiKey: saved.apiKey ? maskKey(saved.apiKey) : "",
      apiKeySet: !!saved.apiKey,
      voiceId: saved.voiceId,
      model: saved.model,
      voiceSettings: saved.voiceSettings,
      voicebox: saved.voicebox,
      cloud: saved.cloud,
      cloudConnected: !!getCloudToken(),
      autoSubmit: saved.autoSubmit,
      voiceInput: saved.voiceInput,
      autoListen: saved.autoListen,
    },
  });
});

app.get("/api/background-service/status", (_req, res) => {
  res.json(getBackgroundServiceStatus());
});

app.get("/api/background-service/log", (_req, res) => {
  res.type("text/plain").send(getBackgroundServiceLog());
});

app.post("/api/background-service/permissions", async (_req, res) => {
  try {
    res.json(await checkBackgroundServicePermissions(true));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/background-service/install", async (_req, res) => {
  try {
    res.json(await installBackgroundService());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/background-service/start", async (_req, res) => {
  try {
    res.json(await startBackgroundService());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/background-service/stop", (_req, res) => {
  try {
    res.json(stopBackgroundService());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post("/api/background-service/uninstall", (_req, res) => {
  try {
    res.json(uninstallBackgroundService());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

function normalizeCloudApiUrl(value: unknown): string {
  return normalizeServiceUrl(
    String(value || loadConfig().cloud.apiUrl),
    "Cloud URL",
  );
}

function cloudHeaders(): Record<string, string> {
  const token = getCloudToken();
  return token
    ? {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }
    : { "Content-Type": "application/json" };
}

app.post("/api/cloud/connect/start", async (req, res) => {
  try {
    const apiUrl = normalizeCloudApiUrl(req.body.apiUrl);
    const response = await fetch(`${apiUrl}/api/v1/device-authorizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: "TalkToCursor" }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }
    saveConfig({ cloud: { ...loadConfig().cloud, apiUrl } });
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

app.post("/api/cloud/connect/poll", async (req, res) => {
  const config = loadConfig();
  try {
    const response = await fetch(
      `${normalizeCloudApiUrl(config.cloud.apiUrl)}/api/v1/device-authorizations/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: req.body.deviceCode }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = await response.json();
    if (response.status === 428) {
      res.status(202).json({ pending: true });
      return;
    }
    if (!response.ok || !data.access_token) {
      res.status(response.status).json(data);
      return;
    }
    const storage = saveCloudToken(data.access_token);
    res.json({ success: true, storage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
  }
});

app.post("/api/cloud/disconnect", (_req, res) => {
  deleteCloudToken();
  res.json({ success: true });
});

app.get("/api/cloud/status", async (_req, res) => {
  const config = loadConfig();
  if (!getCloudToken()) {
    res.json({ connected: false });
    return;
  }
  try {
    const response = await fetch(
      `${normalizeCloudApiUrl(config.cloud.apiUrl)}/api/v1/usage`,
      {
        headers: cloudHeaders(),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ connected: true, ...data });
      return;
    }
    res.json({ connected: true, usage: data });
  } catch {
    res.status(503).json({
      connected: true,
      error: "TalkToCursor Cloud is currently unreachable.",
    });
  }
});

app.post("/api/cloud/settings/download", async (_req, res) => {
  const config = loadConfig();
  if (!getCloudToken()) {
    res.status(401).json({ error: "Connect TalkToCursor Cloud first." });
    return;
  }
  try {
    const response = await fetch(
      `${normalizeCloudApiUrl(config.cloud.apiUrl)}/api/v1/settings`,
      {
        headers: cloudHeaders(),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }
    const settings = data.settings || {};
    const cloudVoiceId = normalizeManagedVoice(settings.voiceId);
    const cloudModel = normalizeManagedModel(settings.model);
    const saved = saveConfig({
      ttsEnabled:
        settings.ttsEnabled === undefined
          ? config.ttsEnabled
          : settings.ttsEnabled,
      pauseMediaDuringSpeech:
        settings.pauseMediaDuringSpeech === undefined
          ? config.pauseMediaDuringSpeech
          : settings.pauseMediaDuringSpeech,
      spokenResponseDetail:
        settings.spokenResponseDetail ?? config.spokenResponseDetail,
      voiceSettings: settings.voiceSettings,
      autoListen: settings.autoListen,
      cloud: {
        ...config.cloud,
        voiceId: cloudVoiceId,
        model: cloudModel,
        settingsRevision: data.revision,
      },
    });
    res.json({ success: true, revision: data.revision, config: saved });
  } catch {
    res.status(503).json({ error: "Could not download Cloud settings." });
  }
});

app.post("/api/cloud/settings/upload", async (_req, res) => {
  const config = loadConfig();
  if (!getCloudToken()) {
    res.status(401).json({ error: "Connect TalkToCursor Cloud first." });
    return;
  }
  try {
    const response = await fetch(
      `${normalizeCloudApiUrl(config.cloud.apiUrl)}/api/v1/settings`,
      {
        method: "PUT",
        headers: cloudHeaders(),
        body: JSON.stringify({
          revision: config.cloud.settingsRevision,
          settings: {
            ttsEnabled: config.ttsEnabled,
            pauseMediaDuringSpeech: config.pauseMediaDuringSpeech,
            spokenResponseDetail: config.spokenResponseDetail,
            voiceId: config.cloud.voiceId,
            model: config.cloud.model,
            voiceSettings: config.voiceSettings,
            autoListen: config.autoListen,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }
    saveConfig({
      cloud: { ...config.cloud, settingsRevision: data.revision },
    });
    res.json({ success: true, revision: data.revision });
  } catch {
    res.status(503).json({ error: "Could not upload Cloud settings." });
  }
});

// POST /api/test-voicebox - verify the local Voicebox service
app.post("/api/test-voicebox", async (req, res) => {
  const config = loadConfig();

  try {
    const baseUrl = normalizeServiceUrl(
      String(req.body.baseUrl || config.voicebox.baseUrl),
      "Voicebox URL",
    );
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    res.json({ success: true, message: "Connected to Voicebox successfully." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({
      error: `Could not connect to Voicebox: ${msg}`,
    });
  }
});

// POST /api/test - test TTS with current config
app.post("/api/test", async (req, res) => {
  const config = loadConfig();
  const apiKey = req.body.apiKey || config.apiKey;

  if (!apiKey) {
    res.status(400).json({ error: "No API key configured" });
    return;
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    // Verify the key works by fetching voices
    const voices = await client.voices.getAll();
    res.json({
      success: true,
      message: `API key is valid! Found ${voices.voices.length} voices.`,
      voices: voices.voices.map((v) => ({
        id: v.voiceId,
        name: v.name,
        category: v.category,
        preview_url: v.previewUrl,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: `API key test failed: ${msg}` });
  }
});

// POST /api/voices - list available voices
app.post("/api/voices", async (req, res) => {
  const config = loadConfig();
  const apiKey = req.body.apiKey || config.apiKey;

  if (!apiKey) {
    res.status(400).json({ error: "No API key configured" });
    return;
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const voices = await client.voices.getAll();
    res.json({
      voices: voices.voices.map((v) => ({
        id: v.voiceId,
        name: v.name,
        category: v.category,
        preview_url: v.previewUrl,
        labels: v.labels,
      })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: msg });
  }
});

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

const isMainModule =
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  TalkToCursor Settings`);
    console.log(`  ───────────────────────`);
    console.log(`  Open http://localhost:${PORT} in your browser\n`);
  });
}
