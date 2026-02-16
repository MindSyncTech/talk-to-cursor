import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface VoiceSettings {
  speed: number;        // 0.7 - 1.2, default 1.0
  stability: number;    // 0.0 - 1.0, default 0.5
  similarityBoost: number; // 0.0 - 1.0, default 0.75
  style: number;        // 0.0 - 1.0, default 0.0 (V2+ models only)
}

export interface AutoSubmitSettings {
  enabled: boolean;
  silenceDelay: number;       // seconds after clipboard change before auto-submit (default 2.0)
  minTextLength: number;      // min chars in clipboard to count as dictation (default 10)
  targetApp: string;          // only auto-submit in this app (default "Cursor")
}

export interface WisprLoopSettings {
  enabled: boolean;
  ttsDelay: number;           // seconds to wait for TTS to finish before starting Wispr (default 4.0)
  silenceThreshold: number;   // RMS amplitude threshold for speech detection (default 0.02)
  silenceDuration: number;    // seconds of silence to confirm user stopped (default 2.0)
  wisprHotkey: string;        // hotkey combo to toggle Wispr (default "shift+ctrl")
  manualTriggerHotkey: string; // hotkey to manually start the loop (default "ctrl+shift+l")
}

export interface Config {
  apiKey: string;
  voiceId: string;
  model: string;
  voiceSettings: VoiceSettings;
  autoSubmit: AutoSubmitSettings;
  wisprLoop: WisprLoopSettings;
  autoListen: boolean; // automatically call listen() after task completion
}

const CONFIG_PATH = join(__dirname, "..", "config.json");

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
};

const DEFAULT_AUTO_SUBMIT: AutoSubmitSettings = {
  enabled: false,
  silenceDelay: 3.0,
  minTextLength: 15,
  targetApp: "Cursor",
};

const DEFAULT_WISPR_LOOP: WisprLoopSettings = {
  enabled: false,
  ttsDelay: 8.0,
  silenceThreshold: 0.02,
  silenceDuration: 2.0,
  wisprHotkey: "shift+ctrl",
  manualTriggerHotkey: "ctrl+shift+l",
};

const DEFAULT_CONFIG: Config = {
  apiKey: "",
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  model: "eleven_flash_v2_5",
  voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
  autoSubmit: { ...DEFAULT_AUTO_SUBMIT },
  wisprLoop: { ...DEFAULT_WISPR_LOOP },
  autoListen: true,
};

export function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        voiceSettings: {
          ...DEFAULT_VOICE_SETTINGS,
          ...(parsed.voiceSettings || {}),
        },
        autoSubmit: {
          ...DEFAULT_AUTO_SUBMIT,
          ...(parsed.autoSubmit || {}),
        },
        wisprLoop: {
          ...DEFAULT_WISPR_LOOP,
          ...(parsed.wisprLoop || {}),
        },
        autoListen: parsed.autoListen !== undefined ? parsed.autoListen : DEFAULT_CONFIG.autoListen,
      };
    }
  } catch (error) {
    console.error("[Config] Error reading config.json:", error);
  }
  return { ...DEFAULT_CONFIG, voiceSettings: { ...DEFAULT_VOICE_SETTINGS }, autoSubmit: { ...DEFAULT_AUTO_SUBMIT }, wisprLoop: { ...DEFAULT_WISPR_LOOP }, autoListen: DEFAULT_CONFIG.autoListen };
}

export function saveConfig(config: Partial<Config>): Config {
  const current = loadConfig();
  const updated = { ...current, ...config };
  writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export function getEffectiveConfig(): Config {
  const fileConfig = loadConfig();
  return {
    apiKey: process.env.ELEVENLABS_API_KEY || fileConfig.apiKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID || fileConfig.voiceId,
    model: fileConfig.model || DEFAULT_CONFIG.model,
    voiceSettings: fileConfig.voiceSettings,
    autoSubmit: fileConfig.autoSubmit,
    wisprLoop: fileConfig.wisprLoop,
    autoListen: fileConfig.autoListen,
  };
}
