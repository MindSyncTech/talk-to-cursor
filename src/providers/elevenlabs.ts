import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";
import type { TTSProviderAdapter } from "./types.js";

export const elevenLabsProvider: TTSProviderAdapter = {
  async speak(text, config) {
    if (!config.apiKey) {
      throw new Error(
        "ElevenLabs API key is missing. Open TalkToCursor settings to configure it.",
      );
    }
    const client = new ElevenLabsClient({ apiKey: config.apiKey });
    const audio = await client.textToSpeech.convert(config.voiceId, {
      text,
      modelId: config.model,
      voiceSettings: {
        speed: config.voiceSettings.speed,
        stability: config.voiceSettings.stability,
        similarityBoost: config.voiceSettings.similarityBoost,
        style: config.voiceSettings.style,
      },
    });
    await play(audio);
  },
};
