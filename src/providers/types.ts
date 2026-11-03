import type { Config } from "../config.js";
import type { PcmChunk } from "../audio-output.js";

export interface TTSProviderAdapter {
  /** Stream 24 kHz mono s16le PCM for playback by TalkToCursor. */
  stream?(text: string, config: Config, signal: AbortSignal): AsyncIterable<PcmChunk>;
  /** Providers that play audio themselves, such as Voicebox. */
  speak?(text: string, config: Config, signal: AbortSignal): Promise<void>;
}
