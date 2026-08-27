import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { homedir, platform } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  MANAGED_TTS_DEFAULT_VOICE,
  MANAGED_TTS_MODEL,
  settingsSchema,
  type Config,
  type ConfigUpdate,
} from "./settings-schema.js";

export type {
  Config,
  ConfigUpdate,
} from "./settings-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getUserDataDir(): string {
  if (process.env.TALKTOCURSOR_DATA_DIR) {
    return process.env.TALKTOCURSOR_DATA_DIR;
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "TalkToCursor");
  }
  if (platform() === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "TalkToCursor",
    );
  }
  return join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "talktocursor",
  );
}

export const USER_DATA_DIR = getUserDataDir();
export const CONFIG_PATH = join(USER_DATA_DIR, "config.json");
export const LISTEN_SIGNAL_PATH = join(USER_DATA_DIR, "listen-signal.json");
export const TTS_COMPLETE_PATH = join(USER_DATA_DIR, "tts-complete.json");
const LEGACY_CONFIG_PATH = join(__dirname, "..", "config.json");

function ensureUserDataDir(): void {
  mkdirSync(USER_DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(USER_DATA_DIR, 0o700);
  } catch {
    // Windows and some mounted filesystems do not support POSIX modes.
  }
}

export function writePrivateJson(path: string, value: unknown): void {
  ensureUserDataDir();
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    chmodSync(temporaryPath, 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
  renameSync(temporaryPath, path);
}

function migrateLegacyConfig(): void {
  ensureUserDataDir();
  if (existsSync(CONFIG_PATH) || !existsSync(LEGACY_CONFIG_PATH)) return;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_CONFIG_PATH, "utf-8"));
    writePrivateJson(CONFIG_PATH, legacy);
    unlinkSync(LEGACY_CONFIG_PATH);
    console.error(`[Config] Migrated settings to ${CONFIG_PATH}`);
  } catch (error) {
    console.error("[Config] Could not migrate legacy config:", error);
  }
}

export const DEFAULT_VOICE_SETTINGS: Config["voiceSettings"] = {
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
};

export const DEFAULT_VOICEBOX: Config["voicebox"] = {
  baseUrl: "http://127.0.0.1:17493",
  profile: "",
  personality: false,
};

export const DEFAULT_CLOUD: Config["cloud"] = {
  apiUrl: "https://cloud.talktocursor.com",
  voiceId: MANAGED_TTS_DEFAULT_VOICE,
  model: MANAGED_TTS_MODEL,
  settingsRevision: 0,
};

export const DEFAULT_AUTO_SUBMIT: Config["autoSubmit"] = {
  enabled: false,
  silenceDelay: 3.0,
  minTextLength: 15,
  targetApp: "Cursor",
};

export const DEFAULT_VOICE_INPUT: Config["voiceInput"] = {
  enabled: false,
  provider: "wispr",
  ttsDelay: 4.0,
  silenceThreshold: 0.02,
  silenceDuration: 2.0,
  wisprHotkey: "shift+ctrl",
  handyCommand: "",
  manualTriggerHotkey: "ctrl+shift+l",
};

export const DEFAULT_CONFIG: Config = {
  ttsProvider: "elevenlabs",
  apiKey: "",
  voiceId: "21m00Tcm4TlvDq8ikWAM",
  model: "eleven_flash_v2_5",
  voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
  voicebox: { ...DEFAULT_VOICEBOX },
  cloud: { ...DEFAULT_CLOUD },
  autoSubmit: { ...DEFAULT_AUTO_SUBMIT },
  voiceInput: { ...DEFAULT_VOICE_INPUT },
  autoListen: true,
};

export function loadConfig(): Config {
  migrateLegacyConfig();
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      // Migrate existing wisprLoop settings without breaking current installs.
      const parsedVoiceInput = parsed.voiceInput || parsed.wisprLoop || {};
      const candidate = {
        ttsProvider: parsed.ttsProvider ?? DEFAULT_CONFIG.ttsProvider,
        apiKey: parsed.apiKey ?? DEFAULT_CONFIG.apiKey,
        voiceId: parsed.voiceId ?? DEFAULT_CONFIG.voiceId,
        model: parsed.model ?? DEFAULT_CONFIG.model,
        voiceSettings: {
          ...DEFAULT_VOICE_SETTINGS,
          ...(parsed.voiceSettings || {}),
        },
        voicebox: {
          ...DEFAULT_VOICEBOX,
          ...(parsed.voicebox || {}),
        },
        cloud: {
          ...DEFAULT_CLOUD,
          ...(parsed.cloud || {}),
        },
        autoSubmit: {
          ...DEFAULT_AUTO_SUBMIT,
          ...(parsed.autoSubmit || {}),
        },
        voiceInput: {
          ...DEFAULT_VOICE_INPUT,
          ...parsedVoiceInput,
        },
        autoListen: parsed.autoListen !== undefined ? parsed.autoListen : DEFAULT_CONFIG.autoListen,
      };
      const result = settingsSchema.safeParse(candidate);
      if (result.success) return result.data;
      console.error(
        "[Config] Invalid settings; using defaults:",
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
  } catch (error) {
    console.error("[Config] Error reading config.json:", error);
  }
  return {
    ...DEFAULT_CONFIG,
    voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
    voicebox: { ...DEFAULT_VOICEBOX },
    cloud: { ...DEFAULT_CLOUD },
    autoSubmit: { ...DEFAULT_AUTO_SUBMIT },
    voiceInput: { ...DEFAULT_VOICE_INPUT },
    autoListen: DEFAULT_CONFIG.autoListen,
  };
}

export function saveConfig(config: ConfigUpdate): Config {
  const current = loadConfig();
  const updated: Config = {
    ...current,
    ...config,
    voiceSettings: { ...current.voiceSettings, ...(config.voiceSettings || {}) },
    voicebox: { ...current.voicebox, ...(config.voicebox || {}) },
    cloud: { ...current.cloud, ...(config.cloud || {}) },
    autoSubmit: { ...current.autoSubmit, ...(config.autoSubmit || {}) },
    voiceInput: { ...current.voiceInput, ...(config.voiceInput || {}) },
  };
  const validated = settingsSchema.parse(updated);
  writePrivateJson(CONFIG_PATH, validated);
  return validated;
}

export function getEffectiveConfig(): Config {
  const fileConfig = loadConfig();
  return {
    ttsProvider: fileConfig.ttsProvider,
    apiKey: process.env.ELEVENLABS_API_KEY || fileConfig.apiKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID || fileConfig.voiceId,
    model: fileConfig.model || DEFAULT_CONFIG.model,
    voiceSettings: fileConfig.voiceSettings,
    voicebox: fileConfig.voicebox,
    cloud: fileConfig.cloud,
    autoSubmit: fileConfig.autoSubmit,
    voiceInput: fileConfig.voiceInput,
    autoListen: fileConfig.autoListen,
  };
}
