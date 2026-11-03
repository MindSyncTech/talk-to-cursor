import type { Config } from "../config.js";
import {
  pipelined,
  playPcm,
  type PlaybackResult,
  type PlaybackTarget,
} from "../audio-output.js";
import { segmentSentences } from "../sentence-segmentation.js";
import { cloudProvider } from "./cloud.js";
import { elevenLabsProvider } from "./elevenlabs.js";
import type { TTSProviderAdapter } from "./types.js";
import { voiceboxProvider } from "./voicebox.js";

const providers: Record<Config["ttsProvider"], TTSProviderAdapter> = {
  elevenlabs: elevenLabsProvider,
  voicebox: voiceboxProvider,
  cloud: cloudProvider,
};

/**
 * Speak the first sentence on its own so audio starts quickly, then the rest
 * as one request so Cloud usage stays at two requests per utterance.
 */
export function splitForStreaming(text: string): string[] {
  const sentences = segmentSentences(text);
  if (sentences.length <= 1) return [text.trim()].filter(Boolean);
  return [sentences[0], sentences.slice(1).join(" ")];
}

export async function speakWithProvider(
  text: string,
  config: Config,
  signal: AbortSignal = new AbortController().signal,
  target: PlaybackTarget = { helper: null, helperPlayback: false },
): Promise<PlaybackResult> {
  const provider = providers[config.ttsProvider];
  if (!provider) {
    throw new Error(
      `Unsupported TTS provider '${String(config.ttsProvider)}'. Open TalkToCursor settings and select elevenlabs, voicebox, or cloud.`,
    );
  }
  if (provider.stream) {
    const stream = provider.stream.bind(provider);
    return playPcm(
      pipelined(splitForStreaming(text), (part) => stream(part, config, signal)),
      signal,
      target,
    );
  }
  await provider.speak!(text, config, signal);
  return { interrupted: signal.aborted };
}
