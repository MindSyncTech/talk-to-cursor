import type { TTSProviderAdapter } from "./types.js";
import { normalizeServiceUrl } from "../settings-schema.js";

async function waitForPlayback(
  baseUrl: string,
  generationId: string,
  fallbackPlaybackMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(
      `${baseUrl}/generate/${encodeURIComponent(generationId)}/status`,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body) {
      throw new Error(`Voicebox status request failed with HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        const dataLine = event
          .split(/\r?\n/)
          .find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const status = JSON.parse(dataLine.slice(5).trim()) as {
          status?: string;
          duration?: number;
          error?: string;
        };
        if (status.status === "failed" || status.status === "not_found") {
          throw new Error(status.error || `Voicebox generation ${status.status}`);
        }
        if (status.status === "completed") {
          const reportedMs = Math.max(0, Number(status.duration) || 0) * 1000;
          await new Promise((resolve) =>
            setTimeout(resolve, (reportedMs || fallbackPlaybackMs) + 300),
          );
          return;
        }
      }
      if (done) break;
    }
    throw new Error("Voicebox status stream ended before completion");
  } finally {
    clearTimeout(timeout);
  }
}

export const voiceboxProvider: TTSProviderAdapter = {
  async speak(text, config) {
    const baseUrl = normalizeServiceUrl(config.voicebox.baseUrl, "Voicebox URL");
    try {
      const response = await fetch(`${baseUrl}/speak`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Voicebox-Client-Id": "talktocursor",
        },
        body: JSON.stringify({
          text,
          profile: config.voicebox.profile || undefined,
          personality: config.voicebox.personality,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Voicebox request failed with HTTP ${response.status}`);
      }

      const generation = (await response.json()) as { id?: string };
      if (!generation.id) {
        throw new Error("Voicebox did not return a generation ID");
      }
      await waitForPlayback(
        baseUrl,
        generation.id,
        Math.max(1_500, (text.length / 13) * 1000),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new Error(`Voicebox timed out at ${baseUrl}`);
      }
      if (message.startsWith("Voicebox")) throw error;
      throw new Error(`Could not reach Voicebox at ${baseUrl}: ${message}`);
    }
  },
};
