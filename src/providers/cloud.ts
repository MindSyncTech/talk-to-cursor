import { randomUUID } from "crypto";
import { play } from "@elevenlabs/elevenlabs-js";
import { getCloudToken } from "../credentials.js";
import { normalizeServiceUrl } from "../settings-schema.js";
import type { TTSProviderAdapter } from "./types.js";

interface CloudErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export const cloudProvider: TTSProviderAdapter = {
  async speak(text, config) {
    const token = getCloudToken();
    if (!token) {
      throw new Error(
        "TalkToCursor Cloud is not connected. Open settings and connect your account.",
      );
    }

    const baseUrl = normalizeServiceUrl(config.cloud.apiUrl, "Cloud URL");
    const response = await fetch(`${baseUrl}/api/v1/tts`, {
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
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as CloudErrorBody;
      const code = body.error?.code;
      const messages: Record<string, string> = {
        unauthorized: "Cloud connection expired. Reconnect in settings.",
        subscription_required:
          "An active TalkToCursor Cloud subscription is required.",
        quota_exceeded:
          "Your Cloud voice allowance has been used for this billing period.",
        rate_limited: "Cloud is receiving too many requests. Try again shortly.",
        tts_unavailable: "Cloud speech is temporarily unavailable.",
        private_alpha_closed:
          "TalkToCursor Cloud speech is not accepting requests yet.",
      };
      throw new Error(
        (code && messages[code]) ||
          body.error?.message ||
          `Cloud TTS request failed with HTTP ${response.status}`,
      );
    }

    await play(
      response.body as unknown as AsyncIterable<Uint8Array>,
    );
  },
};
