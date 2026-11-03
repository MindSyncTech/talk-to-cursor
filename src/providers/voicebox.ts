import type { TTSProviderAdapter } from "./types.js";
import { normalizeServiceUrl } from "../settings-schema.js";
import { withTimeout } from "../audio-output.js";

const PLAYBACK_DONE_STATUSES = new Set(["played", "playback_complete", "playback_finished"]);

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Voicebox plays audio itself. Prefer an explicit playback event from its
 * status stream; the duration estimate is only a fallback.
 */
async function waitForPlayback(
  baseUrl: string,
  generationId: string,
  fallbackPlaybackMs: number,
  signal: AbortSignal,
): Promise<void> {
  const requestSignal = withTimeout(signal, 90_000);
  const response = await fetch(
    `${baseUrl}/generate/${encodeURIComponent(generationId)}/status`,
    { signal: requestSignal },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Voicebox status request failed with HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let estimatedEnd: Promise<void> | null = null;
  try {
    while (true) {
      const next = reader.read();
      const { value, done } = estimatedEnd
        ? await Promise.race([
            next,
            estimatedEnd.then(() => ({ value: undefined, done: true as const })),
          ])
        : await next;
      if (done && estimatedEnd) {
        await estimatedEnd;
        return;
      }
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
        if (status.status && PLAYBACK_DONE_STATUSES.has(status.status)) return;
        if (status.status === "completed" && !estimatedEnd) {
          const reportedMs = Math.max(0, Number(status.duration) || 0) * 1000;
          estimatedEnd = delay((reportedMs || fallbackPlaybackMs) + 300, signal);
        }
      }
      if (done) break;
    }
    if (estimatedEnd) return await estimatedEnd;
    await delay(fallbackPlaybackMs, signal);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export const voiceboxProvider: TTSProviderAdapter = {
  async speak(text, config, signal) {
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
        signal: withTimeout(signal, 15_000),
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
        signal,
      );
    } catch (error) {
      if (signal.aborted) return;
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
