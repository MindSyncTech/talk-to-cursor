import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const MANAGED_TTS_MODEL = "gemini-2.5-flash-tts" as const;
export const MANAGED_TTS_DEFAULT_VOICE = "Kore" as const;
export const MANAGED_TTS_VOICES = [
  "Alnilam",
  "Charon",
  "Puck",
  "Sadaltager",
  "Umbriel",
  "Sadachbia",
  "Achird",
  "Algenib",
  "Enceladus",
  "Iapetus",
  "Achernar",
  "Despina",
  "Kore",
  "Leda",
  "Sulafat",
  "Zephyr",
  "Aoede",
  "Callirrhoe",
  "Laomedeia",
  "Vindemiatrix",
] as const;

const managedVoiceSet = new Set<string>(MANAGED_TTS_VOICES);

export function normalizeManagedVoice(
  value: unknown,
): (typeof MANAGED_TTS_VOICES)[number] {
  return typeof value === "string" && managedVoiceSet.has(value)
    ? (value as (typeof MANAGED_TTS_VOICES)[number])
    : MANAGED_TTS_DEFAULT_VOICE;
}

export function normalizeManagedModel(value: unknown): typeof MANAGED_TTS_MODEL {
  return value === MANAGED_TTS_MODEL ? value : MANAGED_TTS_MODEL;
}

export function normalizeServiceUrl(value: string, label = "URL"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  const isLocalhost = LOCAL_HOSTS.has(url.hostname);
  const validProtocol =
    url.protocol === "https:" || (isLocalhost && url.protocol === "http:");
  if (!validProtocol) {
    throw new Error(`${label} must use HTTPS (HTTP is allowed only for localhost)`);
  }

  return url.toString().replace(/\/+$/, "");
}

function serviceUrlSchema(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((value, context) => {
      try {
        return normalizeServiceUrl(value, label);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
        });
        return z.NEVER;
      }
    });
}

export const voiceSettingsSchema = z.object({
  speed: z.number().finite().min(0.7).max(1.2),
  cloudSpeed: z.number().finite().min(0.7).max(2).default(1.2),
  stability: z.number().finite().min(0).max(1),
  similarityBoost: z.number().finite().min(0).max(1),
  style: z.number().finite().min(0).max(1),
});

export const voiceboxSettingsSchema = z.object({
  baseUrl: serviceUrlSchema("Voicebox URL"),
  profile: z.string().trim().max(200),
  personality: z.boolean(),
});

export const pronunciationEntrySchema = z.object({
  id: z.string().uuid(),
  match: z.string().trim().min(1).max(64),
  speak: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((value) => !/[<>&]/u.test(value), {
      message: "Pronunciation output cannot contain <, >, or &",
    }),
  matchMode: z.enum(["word", "substring"]).default("word"),
  caseSensitive: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

const pronunciationSettingsObjectSchema = z.object({
  enabled: z.boolean().default(true),
  entries: z.array(pronunciationEntrySchema).max(50).default([]),
});

export const pronunciationSettingsSchema =
  pronunciationSettingsObjectSchema.superRefine((value, context) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16 * 1024) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pronunciation settings cannot exceed 16KB",
      });
    }
  });

export const cloudSettingsSchema = z.object({
  apiUrl: serviceUrlSchema("Cloud URL"),
  voiceId: z.preprocess(
    (value) => normalizeManagedVoice(value),
    z.enum(MANAGED_TTS_VOICES),
  ),
  model: z.preprocess(
    (value) => normalizeManagedModel(value),
    z.literal(MANAGED_TTS_MODEL),
  ),
  settingsRevision: z.number().int().nonnegative(),
});

export const autoSubmitSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["fixed", "smart"]),
  silenceDelay: z.number().finite().min(0.5).max(5),
  minTextLength: z.number().int().min(5).max(50),
  targetApp: z.string().trim().min(1).max(200),
  smartCandidateSilence: z.number().finite().min(0.2).max(1),
  smartTurnThreshold: z.number().finite().min(0.1).max(0.9),
  smartMaxSilence: z.number().finite().min(1).max(8),
  smartTextDelay: z.number().finite().min(0.1).max(1),
  submitCommandEnabled: z.boolean(),
  submitPhrase: z.literal("send it"),
});

export const voiceInputSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(["builtin", "wispr", "fluidvoice", "handy"]),
    silenceThreshold: z.number().finite().min(0.005).max(0.1),
    silenceDuration: z.number().finite().min(0.5).max(5),
    wisprHotkey: z.string().trim().min(1).max(100),
    fluidVoiceHotkey: z.string().trim().min(1).max(100).default("right_option"),
    handyCommand: z.string().trim().max(1_000),
    manualTriggerHotkey: z.string().trim().min(1).max(100),
    wakeWordEnabled: z.boolean(),
    wakePhrase: z.enum([
      "cursor",
      "hey cursor",
      "ok cursor",
      "codex",
      "hey codex",
      "ok codex",
      "claude",
      "hey claude",
      "ok claude",
      "hey google",
      "ok google",
      "hey chat",
      "ok chat",
    ]),
    wakeSensitivity: z.number().finite().min(0).max(1),
    wakeChime: z.boolean(),
    bargeIn: z.boolean().default(true),
    builtinModel: z.enum(["streaming", "parakeet", "cloud"]).default("parakeet"),
    echoCancellation: z.boolean().default(true),
    inputGainDb: z.number().finite().min(0).max(30).default(0),
    inputChannel: z.number().int().min(1).max(64).default(1),
    noiseSuppression: z.boolean().default(true),
  })
  // Discard retired fields such as ttsDelay from existing config files.
  .strip();

export const COMPLETION_SOUNDS = [
  "Hero",
  "Glass",
  "Ping",
  "Pop",
  "Purr",
  "Tink",
  "Submarine",
  "Bottle",
  "Blow",
  "Funk",
] as const;

export const completionFeedbackSchema = z.object({
  mode: z.enum(["speech", "sound", "both"]).default("speech"),
  sound: z.enum(COMPLETION_SOUNDS).default("Hero"),
});

export const settingsSchema = z
  .object({
    ttsEnabled: z.boolean(),
    pauseMediaDuringSpeech: z.boolean(),
    spokenResponseDetail: z.enum(["minimal", "brief", "detailed"]),
    ttsProvider: z.enum(["elevenlabs", "voicebox", "cloud"]),
    apiKey: z.string().max(1_000),
    voiceId: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    voiceSettings: voiceSettingsSchema,
    voicebox: voiceboxSettingsSchema,
    pronunciation: pronunciationSettingsSchema,
    cloud: cloudSettingsSchema,
    autoSubmit: autoSubmitSettingsSchema,
    voiceInput: voiceInputSettingsSchema,
    completionFeedback: completionFeedbackSchema.default({ mode: "speech", sound: "Hero" }),
    autoListen: z.boolean(),
  })
  .strict();

export const settingsUpdateSchema = settingsSchema
  .extend({
    voiceSettings: voiceSettingsSchema.partial(),
    voicebox: voiceboxSettingsSchema.partial(),
    pronunciation: pronunciationSettingsObjectSchema.partial(),
    cloud: cloudSettingsSchema.partial(),
    autoSubmit: autoSubmitSettingsSchema.partial(),
    voiceInput: voiceInputSettingsSchema.partial(),
    completionFeedback: completionFeedbackSchema.partial(),
  })
  .partial()
  .strict();

export type Config = z.infer<typeof settingsSchema>;
export type ConfigUpdate = z.infer<typeof settingsUpdateSchema>;

type Path = (string | number)[];

function valueAt(root: unknown, path: Path): unknown {
  let value = root;
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

function setAt(root: Record<string, unknown>, path: Path, value: unknown): void {
  const parent = valueAt(root, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]] = value;
}

/**
 * Parse settings, replacing each invalid value with its default and dropping
 * unrecognized keys, so a config written by a newer version doesn't reset
 * every setting. Returns null if the settings can't be repaired.
 */
export function parseSettingsLeniently(
  candidate: Record<string, unknown>,
  defaults: Config,
): { config: Config; repaired: string[] } | null {
  const working = structuredClone(candidate);
  const repaired: string[] = [];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = settingsSchema.safeParse(working);
    if (result.success) return { config: result.data, repaired };
    const issue = result.error.issues[0];
    const path = issue.path;
    const container = valueAt(working, path);
    if (issue.code === "unrecognized_keys" && container && typeof container === "object") {
      for (const key of issue.keys) {
        delete (container as Record<string, unknown>)[key];
        repaired.push([...path, key].join("."));
      }
      continue;
    }
    const arrayIndex = path.findIndex((key) => typeof key === "number");
    if (arrayIndex > 0) {
      const array = valueAt(working, path.slice(0, arrayIndex));
      if (Array.isArray(array)) {
        array.splice(path[arrayIndex] as number, 1);
        repaired.push(path.slice(0, arrayIndex + 1).join("."));
        continue;
      }
    }
    let fixed = false;
    for (let length = path.length; length > 0; length -= 1) {
      const fallback = valueAt(defaults, path.slice(0, length));
      if (fallback !== undefined) {
        setAt(working, path.slice(0, length), structuredClone(fallback));
        repaired.push(path.slice(0, length).join("."));
        fixed = true;
        break;
      }
    }
    if (!fixed) return null;
  }
  return null;
}
