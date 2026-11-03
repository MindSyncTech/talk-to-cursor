import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Config } from "./config.js";

export type CompletionFeedback = Config["completionFeedback"]["mode"];

const SOUNDS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "sounds");

export type SpeechKind = "update" | "completion" | "question";

/** Sounds play through afplay, which only exists on macOS, so other platforms always speak. */
export function soundFeedbackFor(
  config: Config,
  kind: SpeechKind,
  platform: NodeJS.Platform = process.platform,
): { mode: CompletionFeedback; sound: string } {
  if (kind === "update" || platform !== "darwin") return { mode: "speech", sound: "" };
  return kind === "completion" ? config.completionFeedback : config.questionFeedback;
}

export function completionFeedbackFor(
  config: Config,
  completion: boolean,
  platform: NodeJS.Platform = process.platform,
): CompletionFeedback {
  return soundFeedbackFor(config, completion ? "completion" : "update", platform).mode;
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
