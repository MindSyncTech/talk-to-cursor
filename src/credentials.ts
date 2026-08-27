import {
  chmodSync,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { platform } from "os";
import { USER_DATA_DIR } from "./config.js";

const KEYCHAIN_SERVICE = "com.talktocursor.cloud";
const KEYCHAIN_ACCOUNT = "device-token";
const FALLBACK_PATH = join(USER_DATA_DIR, "cloud-token");

function readMacKeychain(): string {
  try {
    return execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

export function getCloudToken(): string {
  if (process.env.TALKTOCURSOR_CLOUD_TOKEN) {
    return process.env.TALKTOCURSOR_CLOUD_TOKEN;
  }
  if (platform() === "darwin") {
    const token = readMacKeychain();
    if (token) return token;
  }
  try {
    return existsSync(FALLBACK_PATH)
      ? readFileSync(FALLBACK_PATH, "utf-8").trim()
      : "";
  } catch {
    return "";
  }
}

export function saveCloudToken(token: string): "keychain" | "file" {
  if (!token.startsWith("ttc_live_")) {
    throw new Error("Cloud returned an invalid device credential");
  }

  if (platform() === "darwin") {
    try {
      execFileSync(
        "security",
        [
          "add-generic-password",
          "-U",
          "-a",
          KEYCHAIN_ACCOUNT,
          "-s",
          KEYCHAIN_SERVICE,
          "-w",
          token,
        ],
        { stdio: "ignore" },
      );
      if (existsSync(FALLBACK_PATH)) unlinkSync(FALLBACK_PATH);
      return "keychain";
    } catch {
      // Fall back to a private user-data file.
    }
  }

  writeFileSync(FALLBACK_PATH, `${token}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    chmodSync(FALLBACK_PATH, 0o600);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
  return "file";
}

export function deleteCloudToken(): void {
  if (platform() === "darwin") {
    try {
      execFileSync(
        "security",
        [
          "delete-generic-password",
          "-a",
          KEYCHAIN_ACCOUNT,
          "-s",
          KEYCHAIN_SERVICE,
        ],
        { stdio: "ignore" },
      );
    } catch {
      // The credential may not exist.
    }
  }
  try {
    if (existsSync(FALLBACK_PATH)) unlinkSync(FALLBACK_PATH);
  } catch {
    // Best effort cleanup.
  }
}
