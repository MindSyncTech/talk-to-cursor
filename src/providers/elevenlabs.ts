import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { readWebStream } from "../audio-output.js";
import type { TTSProviderAdapter } from "./types.js";

export const elevenLabsProvider: TTSProviderAdapter = {
  async *stream(text, config, signal) {
    if (!config.apiKey) {
      throw new Error(
        "ElevenLabs API key is missing. Open TalkToCursor settings to configure it.",
      );
    }
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    const audio = await client.textToSpeech.stream(
      config.voiceId,
      {
        text,
        modelId: config.model,
        outputFormat: "pcm_24000",
        voiceSettings: {
          speed: config.voiceSettings.speed,
          stability: config.voiceSettings.stability,
          similarityBoost: config.voiceSettings.similarityBoost,
          style: config.voiceSettings.style,
        },
      },
      { abortSignal: signal },
    );
    yield* readWebStream(audio);
  },
};
