import type { Config } from "../config.js";

export interface TTSProviderAdapter {
  speak(text: string, config: Config): Promise<void>;
}
