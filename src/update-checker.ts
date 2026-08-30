import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_DATA_DIR, writePrivateJson } from "./config.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-metadata.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CACHE_PATH = resolve(USER_DATA_DIR, "update-status.json");
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const RELEASES_URL = "https://github.com/MindSyncTech/talk-to-cursor/releases";

export type InstallationMethod = "npx" | "global" | "source" | "npm";

export interface UpdateCache {
  checkedAt: string;
  latestVersion: string;
}

export interface UpdateCheckDependencies {
  now?: () => number;
  readCache?: () => UpdateCache | null;
  writeCache?: (cache: UpdateCache) => void;
  fetch?: typeof globalThis.fetch;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  checkFailed: boolean;
  installationMethod: InstallationMethod;
  updateCommand: string;
  releasesUrl: string;
}

function parseVersion(version: string): {
  numbers: number[];
  prerelease: string | null;
} | null {
  const match = version
    .trim()
    .match(
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
    );
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || null,
  };
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;

  for (let index = 0; index < 3; index += 1) {
    if (next.numbers[index] !== installed.numbers[index]) {
      return next.numbers[index] > installed.numbers[index];
    }
  }
  if (next.prerelease === installed.prerelease) return false;
  if (!next.prerelease) return true;
  if (!installed.prerelease) return false;
  return next.prerelease.localeCompare(installed.prerelease, undefined, {
    numeric: true,
  }) > 0;
}

export function detectInstallationMethod(
  packageRoot = PACKAGE_ROOT,
): InstallationMethod {
  const override = process.env.TALKTOCURSOR_INSTALL_METHOD;
  if (["npx", "global", "source", "npm"].includes(override || "")) {
    return override as InstallationMethod;
  }

  const normalized = packageRoot.split(sep).join("/");
  if (normalized.includes("/_npx/")) return "npx";
  if (
    normalized.includes("/lib/node_modules/talktocursor") ||
    normalized.includes("/npm/node_modules/talktocursor")
  ) {
    return "global";
  }
  if (
    existsSync(resolve(packageRoot, ".git")) ||
    !normalized.includes("/node_modules/talktocursor")
  ) {
    return "source";
  }
  return "npm";
}

export function updateCommandFor(
  method: InstallationMethod,
  packageRoot = PACKAGE_ROOT,
): string {
  if (method === "npx") {
    return "Restart your coding host; use npx -y --prefer-online talktocursor@latest";
  }
  if (method === "global") return "npm install -g talktocursor@latest";
  if (method === "source") {
    return existsSync(resolve(packageRoot, ".git"))
      ? "git pull && npm install && npm run build"
      : "Download the latest source, then run npm install && npm run build";
  }
  return "npm install talktocursor@latest";
}

function readCache(): UpdateCache | null {
  try {
    const value = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as UpdateCache;
    if (
      typeof value.checkedAt !== "string" ||
      typeof value.latestVersion !== "string" ||
      !parseVersion(value.latestVersion)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function toStatus(
  cache: UpdateCache | null,
  checkFailed = false,
): UpdateStatus {
  const installationMethod = detectInstallationMethod();
  return {
    currentVersion: PACKAGE_VERSION,
    latestVersion: cache?.latestVersion || null,
    updateAvailable: cache
      ? isNewerVersion(cache.latestVersion, PACKAGE_VERSION)
      : false,
    checkedAt: cache?.checkedAt || null,
    checkFailed,
    installationMethod,
    updateCommand: updateCommandFor(installationMethod),
    releasesUrl: RELEASES_URL,
  };
}

export async function checkForUpdates(
  force = false,
  dependencies: UpdateCheckDependencies = {},
): Promise<UpdateStatus> {
  const cached = dependencies.readCache
    ? dependencies.readCache()
    : readCache();
  const now = dependencies.now?.() ?? Date.now();
  const cacheAge = cached
    ? now - new Date(cached.checkedAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (!force && Number.isFinite(cacheAge) && cacheAge < CHECK_INTERVAL_MS) {
    return toStatus(cached);
  }

  try {
    const fetchRegistry = dependencies.fetch || globalThis.fetch;
    const response = await fetchRegistry(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
    const data = (await response.json()) as { version?: unknown };
    if (typeof data.version !== "string" || !parseVersion(data.version)) {
      throw new Error("npm registry returned an invalid version");
    }
    const nextCache = {
      checkedAt: new Date(now).toISOString(),
      latestVersion: data.version,
    };
    try {
      if (dependencies.writeCache) {
        dependencies.writeCache(nextCache);
      } else {
        writePrivateJson(CACHE_PATH, nextCache);
      }
    } catch {
      // A read-only data directory should not hide a successful update check.
    }
    return toStatus(nextCache);
  } catch {
    return toStatus(cached, true);
  }
}
