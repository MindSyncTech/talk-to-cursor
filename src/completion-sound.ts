import { spawn } from "child_process";
import type { Config } from "./config.js";

export type CompletionFeedback = Config["completionFeedback"]["mode"];

/** System sounds only exist on macOS, so other platforms always speak. */
export function completionFeedbackFor(
  config: Config,
  completion: boolean,
  platform: NodeJS.Platform = process.platform,
): CompletionFeedback {
  if (!completion || platform !== "darwin") return "speech";
  return config.completionFeedback.mode;
}

export function playCompletionSound(sound: string): Promise<void> {
  return new Promise((resolve) => {
    const player = spawn("afplay", [`/System/Library/Sounds/${sound}.aiff`], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => player.kill(), 5_000);
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
