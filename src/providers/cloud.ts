import { randomUUID } from "crypto";
import { getCloudToken } from "../credentials.js";
import { normalizeServiceUrl } from "../settings-schema.js";
import { decodeToPcm, readWebStream, withTimeout } from "../audio-output.js";
import type { Config } from "../config.js";
import type { TTSProviderAdapter } from "./types.js";

interface CloudErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

const CLOUD_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Cloud connection expired. Reconnect in settings.",
  subscription_required:
    "An active TalkToCursor Cloud subscription is required.",
  quota_exceeded:
    "Your Cloud voice allowance has been used for this billing period.",
  device_budget_exceeded:
    "This device has reached its Cloud voice budget for this billing period.",
  rate_limited: "Cloud is receiving too many requests. Try again shortly.",
  tts_unavailable: "Cloud speech is temporarily unavailable.",
  private_alpha_closed:
    "TalkToCursor Cloud speech is not accepting requests yet.",
};

export async function cloudError(response: Response, label: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as CloudErrorBody;
  const code = body.error?.code;
  return new Error(
    (code && CLOUD_ERROR_MESSAGES[code]) ||
      body.error?.message ||
      `${label} failed with HTTP ${response.status}`,
  );
}

function requireCloudToken(): string {
  const token = getCloudToken();
  if (!token) {
    throw new Error(
      "TalkToCursor Cloud is not connected. Open settings and connect your account.",
    );
  }
  return token;
}

function requestInit(text: string, config: Config, token: string, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      text,
      voiceId: config.cloud.voiceId,
      model: config.cloud.model,
      voiceSettings: {
        speed: config.voiceSettings.cloudSpeed,
        style: config.voiceSettings.cloudStyle,
      },
    }),
    signal,
  };
}

export const cloudProvider: TTSProviderAdapter = {
  async *stream(text, config, signal) {
    const token = requireCloudToken();
    const baseUrl = normalizeServiceUrl(config.cloud.apiUrl, "Cloud URL");
    const requestSignal = withTimeout(signal, 60_000);
    const response = await fetch(
      `${baseUrl}/api/v1/tts/stream`,
      requestInit(text, config, token, requestSignal),
    );

    if (response.status === 404) {
      // Cloud servers without the streaming route return MP3 from /api/v1/tts.
      const legacy = await fetch(
        `${baseUrl}/api/v1/tts`,
        requestInit(text, config, token, requestSignal),
      );
      if (!legacy.ok || !legacy.body) throw await cloudError(legacy, "Cloud TTS request");
      yield* decodeToPcm(readWebStream(legacy.body), requestSignal);
      return;
    }
    if (!response.ok || !response.body) {
      throw await cloudError(response, "Cloud TTS request");
    }
    yield* readWebStream(response.body);
  },
};
