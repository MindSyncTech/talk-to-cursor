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
    provider: z.enum(["wispr", "handy"]),
    silenceThreshold: z.number().finite().min(0.005).max(0.1),
    silenceDuration: z.number().finite().min(0.5).max(5),
    wisprHotkey: z.string().trim().min(1).max(100),
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
  })
  // Discard retired fields such as ttsDelay from existing config files.
  .strip();

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
  })
  .partial()
  .strict();

export type Config = z.infer<typeof settingsSchema>;
export type ConfigUpdate = z.infer<typeof settingsUpdateSchema>;
