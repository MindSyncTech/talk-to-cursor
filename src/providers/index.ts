import type { Config } from "../config.js";
import { cloudProvider } from "./cloud.js";
import { elevenLabsProvider } from "./elevenlabs.js";
import type { TTSProviderAdapter } from "./types.js";
import { voiceboxProvider } from "./voicebox.js";

const providers: Record<Config["ttsProvider"], TTSProviderAdapter> = {
  elevenlabs: elevenLabsProvider,
  voicebox: voiceboxProvider,
  cloud: cloudProvider,
};

export async function speakWithProvider(text: string, config: Config) {
  const provider = providers[config.ttsProvider];
  if (!provider) {
    throw new Error(
      `Unsupported TTS provider '${String(config.ttsProvider)}'. Open TalkToCursor settings and select elevenlabs, voicebox, or cloud.`,
    );
  }
  await provider.speak(text, config);
}
