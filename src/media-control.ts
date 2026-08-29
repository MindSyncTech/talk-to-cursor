import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NOOP = async () => {};
const SUPPORTED_PLAYERS = new Set(["Music", "Spotify"]);

const PAUSE_SCRIPT = `
set pausedPlayers to {}

tell application "System Events"
  set musicRunning to exists process "Music"
  set spotifyRunning to exists process "Spotify"
end tell

if musicRunning then
  tell application "Music"
    if player state is playing then
      pause
      set end of pausedPlayers to "Music"
    end if
  end tell
end if

if spotifyRunning then
  tell application "Spotify"
    if player state is playing then
      pause
      set end of pausedPlayers to "Spotify"
    end if
  end tell
end if

set AppleScript's text item delimiters to ","
return pausedPlayers as text
`;

const RESUME_SCRIPT = `
on run playerNames
  tell application "System Events"
    set musicRunning to exists process "Music"
    set spotifyRunning to exists process "Spotify"
  end tell

  repeat with playerName in playerNames
    if playerName is "Music" and musicRunning then
      tell application "Music" to play
    else if playerName is "Spotify" and spotifyRunning then
      tell application "Spotify" to play
    end if
  end repeat
end run
`;

export type ResumeMedia = () => Promise<void>;

export async function pauseMediaForSpeech(): Promise<ResumeMedia> {
  if (platform() !== "darwin") return NOOP;

  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-e", PAUSE_SCRIPT],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );
    const pausedPlayers = stdout
      .trim()
      .split(",")
      .map((player) => player.trim())
      .filter((player) => SUPPORTED_PLAYERS.has(player));

    if (pausedPlayers.length === 0) return NOOP;
    console.error(`[TTS] Paused media: ${pausedPlayers.join(", ")}`);

    return async () => {
      try {
        await execFileAsync(
          "/usr/bin/osascript",
          ["-e", RESUME_SCRIPT, ...pausedPlayers],
          { encoding: "utf8", timeout: 5_000 },
        );
        console.error(`[TTS] Resumed media: ${pausedPlayers.join(", ")}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[TTS] Could not resume media: ${message}`);
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[TTS] Could not pause media: ${message}`);
    return NOOP;
  }
}
