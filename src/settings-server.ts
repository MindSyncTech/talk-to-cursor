#!/usr/bin/env node

import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig } from "./config.js";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json());

// Serve static files from /public
app.use(express.static(join(__dirname, "..", "public")));

// GET /api/config - return current config (mask API key)
app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({
    apiKey: config.apiKey ? maskKey(config.apiKey) : "",
    apiKeySet: !!config.apiKey,
    voiceId: config.voiceId,
    model: config.model,
    voiceSettings: config.voiceSettings,
    autoSubmit: config.autoSubmit,
    wisprLoop: config.wisprLoop,
    autoListen: config.autoListen,
  });
});

// POST /api/config - save config
app.post("/api/config", (req, res) => {
  const { apiKey, voiceId, model, voiceSettings, autoSubmit, wisprLoop, autoListen } = req.body;

  const updates: Record<string, unknown> = {};
  if (apiKey !== undefined && apiKey !== "") updates.apiKey = apiKey;
  if (voiceId !== undefined) updates.voiceId = voiceId;
  if (model !== undefined) updates.model = model;
  if (voiceSettings !== undefined) updates.voiceSettings = voiceSettings;
  if (autoSubmit !== undefined) updates.autoSubmit = autoSubmit;
  if (wisprLoop !== undefined) updates.wisprLoop = wisprLoop;
  if (autoListen !== undefined) updates.autoListen = autoListen;

  const saved = saveConfig(updates);
  res.json({
    success: true,
    config: {
      apiKey: saved.apiKey ? maskKey(saved.apiKey) : "",
      apiKeySet: !!saved.apiKey,
      voiceId: saved.voiceId,
      model: saved.model,
      voiceSettings: saved.voiceSettings,
      autoSubmit: saved.autoSubmit,
      wisprLoop: saved.wisprLoop,
      autoListen: saved.autoListen,
    },
  });
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

const PORT = parseInt(process.env.PORT || "3847", 10);

app.listen(PORT, () => {
  console.log(`\n  Cursor TTS Settings UI`);
  console.log(`  ───────────────────────`);
  console.log(`  Open http://localhost:${PORT} in your browser\n`);
});
