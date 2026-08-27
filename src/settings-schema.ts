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
  "Achernar",
  "Despina",
  "Kore",
  "Leda",
  "Sulafat",
  "Zephyr",
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
  silenceDelay: z.number().finite().min(0.5).max(5),
  minTextLength: z.number().int().min(5).max(50),
  targetApp: z.string().trim().min(1).max(200),
});

export const voiceInputSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["wispr", "handy"]),
  ttsDelay: z.number().finite().min(1).max(8),
  silenceThreshold: z.number().finite().min(0.005).max(0.1),
  silenceDuration: z.number().finite().min(0.5).max(5),
  wisprHotkey: z.string().trim().min(1).max(100),
  handyCommand: z.string().trim().max(1_000),
  manualTriggerHotkey: z.string().trim().min(1).max(100),
});

export const settingsSchema = z
  .object({
    ttsProvider: z.enum(["elevenlabs", "voicebox", "cloud"]),
    apiKey: z.string().max(1_000),
    voiceId: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
    voiceSettings: voiceSettingsSchema,
    voicebox: voiceboxSettingsSchema,
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
    cloud: cloudSettingsSchema.partial(),
    autoSubmit: autoSubmitSettingsSchema.partial(),
    voiceInput: voiceInputSettingsSchema.partial(),
  })
  .partial()
  .strict();

export type Config = z.infer<typeof settingsSchema>;
export type ConfigUpdate = z.infer<typeof settingsUpdateSchema>;
