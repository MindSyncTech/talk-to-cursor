import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { USER_DATA_DIR } from "./config.js";
import { PACKAGE_VERSION } from "./package-metadata.js";
import { isNewerVersion } from "./update-checker.js";

const execFileAsync = promisify(execFile);
const LABEL = "com.mindsynctech.talktocursor.background";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_DIR = join(USER_DATA_DIR, "background-helper");
const RUNTIME_DIR = join(HELPER_DIR, "runtime");
const VENV_DIR = join(HELPER_DIR, "venv");
const LOG_DIR = join(HELPER_DIR, "logs");
const VERSION_PATH = join(HELPER_DIR, "version");
const PYTHON_PATH = join(VENV_DIR, "bin", "python");
const PLIST_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${LABEL}.plist`,
);
const SERVICE_TARGET = `gui/${userInfo().uid}/${LABEL}`;
const SERVICE_DOMAIN = `gui/${userInfo().uid}`;
const RUNTIME_FILES = [
  "auto-submit.py",
  "silence_detector.py",
  "smart_turn.py",
  "submit_phrase.py",
  "turn_detector.py",
  "wake_word.py",
  "whisper_features.py",
] as const;

export interface BackgroundServiceStatus {
  supported: boolean;
  installed: boolean;
  running: boolean;
  dependenciesReady: boolean;
  launchesAtLogin: boolean;
  installedVersion: string | null;
  currentVersion: string;
  updateAvailable: boolean;
  logPath: string;
}

export interface BackgroundPermissionStatus {
  accessibility: string;
  inputMonitoring: string;
  microphone: string;
  applicationPath: string;
}

export function helperUpdateAvailable(
  installed: boolean,
  installedVersion: string | null,
  currentVersion = PACKAGE_VERSION,
): boolean {
  return (
    installed &&
    (!installedVersion || isNewerVersion(currentVersion, installedVersion))
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function serviceIsRunning(): boolean {
  if (platform() !== "darwin") return false;
  return (
    spawnSync("/bin/launchctl", ["print", SERVICE_TARGET], {
      stdio: "ignore",
    }).status === 0
  );
}

export function getBackgroundServiceStatus(): BackgroundServiceStatus {
  const installed = existsSync(PLIST_PATH);
  let installedVersion: string | null = null;
  try {
    installedVersion = readFileSync(VERSION_PATH, "utf8").trim() || null;
  } catch {
    // Helpers installed before version tracking are treated as outdated.
  }
  return {
    supported: platform() === "darwin",
    installed,
    running: serviceIsRunning(),
    dependenciesReady: existsSync(PYTHON_PATH),
    launchesAtLogin: installed,
    installedVersion,
    currentVersion: PACKAGE_VERSION,
    updateAvailable: helperUpdateAvailable(installed, installedVersion),
    logPath: join(LOG_DIR, "background-helper.log"),
  };
}

async function run(command: string, args: string[], timeout = 300_000) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout,
    });
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(detail || message);
  }
}

function copyRuntimeFiles() {
  mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  for (const filename of RUNTIME_FILES) {
    copyFileSync(
      join(PACKAGE_ROOT, "scripts", filename),
      join(RUNTIME_DIR, filename),
    );
  }
  copyFileSync(
    join(PACKAGE_ROOT, "requirements.txt"),
    join(RUNTIME_DIR, "requirements.txt"),
  );
}

function writeInstalledVersion() {
  writeFileSync(VERSION_PATH, `${PACKAGE_VERSION}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function runtimeRequirementsChanged(): boolean {
  const source = join(PACKAGE_ROOT, "requirements.txt");
  const installed = join(RUNTIME_DIR, "requirements.txt");
  return (
    !existsSync(installed) ||
    readFileSync(source, "utf8") !== readFileSync(installed, "utf8")
  );
}

async function installDependencies() {
  if (!existsSync(PYTHON_PATH)) {
    await run(
      process.env.TALKTOCURSOR_PYTHON || "python3",
      ["-m", "venv", VENV_DIR],
      120_000,
    );
  }
  await run(
    PYTHON_PATH,
    ["-m", "pip", "install", "-r", join(RUNTIME_DIR, "requirements.txt")],
    600_000,
  );
}

function launchAgentContents(): string {
  const logPath = join(LOG_DIR, "background-helper.log");
  const errorLogPath = join(LOG_DIR, "background-helper-error.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(PYTHON_PATH)}</string>
    <string>${escapeXml(join(RUNTIME_DIR, "auto-submit.py"))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(RUNTIME_DIR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONUNBUFFERED</key>
    <string>1</string>
    <key>TALKTOCURSOR_DATA_DIR</key>
    <string>${escapeXml(USER_DATA_DIR)}</string>
    <key>TALKTOCURSOR_PACKAGE_ROOT</key>
    <string>${escapeXml(RUNTIME_DIR)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(errorLogPath)}</string>
</dict>
</plist>
`;
}

function writeLaunchAgent(): boolean {
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const plist = launchAgentContents();
  const changed =
    !existsSync(PLIST_PATH) || readFileSync(PLIST_PATH, "utf8") !== plist;
  writeFileSync(PLIST_PATH, plist, { encoding: "utf8", mode: 0o644 });
  chmodSync(PLIST_PATH, 0o644);
  return changed;
}

function bootOut() {
  if (platform() !== "darwin") return;
  spawnSync("/bin/launchctl", ["bootout", SERVICE_TARGET], {
    stdio: "ignore",
  });
}

export async function startBackgroundService() {
  if (platform() !== "darwin") {
    throw new Error("The background helper is currently supported only on macOS.");
  }
  if (!existsSync(PLIST_PATH)) {
    throw new Error("Install the background helper first.");
  }
  const dependenciesChanged = runtimeRequirementsChanged();
  copyRuntimeFiles();
  if (dependenciesChanged || !existsSync(PYTHON_PATH)) {
    await installDependencies();
  }
  const wasRunning = serviceIsRunning();
  const launchAgentChanged = writeLaunchAgent();
  if (wasRunning && launchAgentChanged) {
    await run("/bin/launchctl", ["bootout", SERVICE_TARGET], 30_000);
    await run("/bin/launchctl", ["bootstrap", SERVICE_DOMAIN, PLIST_PATH], 30_000);
  } else if (wasRunning) {
    await run("/bin/launchctl", ["kickstart", "-k", SERVICE_TARGET], 30_000);
  } else {
    await run("/bin/launchctl", ["bootstrap", SERVICE_DOMAIN, PLIST_PATH], 30_000);
  }
  writeInstalledVersion();
  return getBackgroundServiceStatus();
}

export async function installBackgroundService() {
  if (platform() !== "darwin") {
    throw new Error("The background helper is currently supported only on macOS.");
  }
  mkdirSync(HELPER_DIR, { recursive: true, mode: 0o700 });
  copyRuntimeFiles();
  await installDependencies();
  writeLaunchAgent();
  return startBackgroundService();
}

export async function checkBackgroundServicePermissions(
  requestMissing = false,
): Promise<BackgroundPermissionStatus> {
  if (platform() !== "darwin") {
    throw new Error("Permission checks are currently supported only on macOS.");
  }
  if (!existsSync(PYTHON_PATH)) {
    throw new Error("Install the background helper before checking permissions.");
  }

  const args = [join(PACKAGE_ROOT, "scripts", "check_permissions.py")];
  if (requestMissing) args.push("--request");
  const { stdout } = await run(PYTHON_PATH, args, 60_000);
  const result = JSON.parse(stdout) as Partial<BackgroundPermissionStatus>;
  if (
    !result.accessibility ||
    !result.inputMonitoring ||
    !result.microphone ||
    !result.applicationPath
  ) {
    throw new Error("The background helper returned an invalid permission status.");
  }
  return result as BackgroundPermissionStatus;
}

export function stopBackgroundService() {
  bootOut();
  return getBackgroundServiceStatus();
}

export function uninstallBackgroundService() {
  bootOut();
  rmSync(PLIST_PATH, { force: true });
  rmSync(HELPER_DIR, { force: true, recursive: true });
  return getBackgroundServiceStatus();
}

export function getBackgroundServiceLog(): string {
  const logPath = join(LOG_DIR, "background-helper.log");
  const errorLogPath = join(LOG_DIR, "background-helper-error.log");
  const output = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const errors = existsSync(errorLogPath)
    ? readFileSync(errorLogPath, "utf8")
    : "";
  return [output, errors].filter(Boolean).join("\n").slice(-20_000);
}
