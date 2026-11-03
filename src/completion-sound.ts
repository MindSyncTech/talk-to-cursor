import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Config } from "./config.js";

export type CompletionFeedback = Config["completionFeedback"]["mode"];

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");

/** System sounds only exist on macOS, so other platforms always speak. */
export function completionFeedbackFor(
  config: Config,
  completion: boolean,
  platform: NodeJS.Platform = process.platform,
): CompletionFeedback {
  if (!completion || platform !== "darwin") return "speech";
  return config.completionFeedback.mode;
}

export function soundPath(sound: string): string {
  return sound.startsWith("ttc-")
    ? join(SOUNDS_DIR, `${sound}.mp3`)
    : `/System/Library/Sounds/${sound}.aiff`;
}

export function playCompletionSound(sound: string): Promise<void> {
  return new Promise((resolve) => {
    const player = spawn("afplay", [soundPath(sound)], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => player.kill(), 8_000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    player.on("error", (error) => {
      console.error(`[TTS] Could not play completion sound: ${error.message}`);
      done();
    });
    player.on("exit", done);
  });
}
