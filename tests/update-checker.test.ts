import { describe, expect, it } from "vitest";
import {
  checkForUpdates,
  detectInstallationMethod,
  isNewerVersion,
  updateCommandFor,
} from "../src/update-checker.js";

describe("update checker", () => {
  it("compares stable and prerelease semantic versions", () => {
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(true);
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.0-beta.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.0", "1.2.0-beta.2")).toBe(true);
    expect(isNewerVersion("1.2.1+build.4", "1.2.0+build.2")).toBe(true);
  });

  it("recognizes npx, global, source, and project installs", () => {
    expect(
      detectInstallationMethod("/Users/me/.npm/_npx/hash/node_modules/talktocursor"),
    ).toBe("npx");
    expect(
      detectInstallationMethod("/usr/local/lib/node_modules/talktocursor"),
    ).toBe("global");
    expect(detectInstallationMethod("/Users/me/src/talk-to-cursor")).toBe(
      "source",
    );
    expect(
      detectInstallationMethod("/Users/me/app/node_modules/talktocursor"),
    ).toBe("npm");
  });

  it("uses safe update instructions for extracted source and npx installs", () => {
    expect(updateCommandFor("source", "/Users/me/src/talk-to-cursor")).toContain(
      "Download the latest source",
    );
    expect(updateCommandFor("npx")).toContain(
      "--prefer-online talktocursor@latest",
    );
  });

  it("uses a fresh cache without contacting npm", async () => {
    let fetched = false;
    const status = await checkForUpdates(false, {
      now: () => Date.parse("2026-08-29T12:00:00.000Z"),
      readCache: () => ({
        checkedAt: "2026-08-29T11:00:00.000Z",
        latestVersion: "1.4.0",
      }),
      fetch: async () => {
        fetched = true;
        return Response.json({ version: "9.9.9" });
      },
    });

    expect(fetched).toBe(false);
    expect(status.latestVersion).toBe("1.4.0");
    expect(status.updateAvailable).toBe(true);
  });

  it("refreshes stale cache entries and persists the registry version", async () => {
    let written: { checkedAt: string; latestVersion: string } | null = null;
    const status = await checkForUpdates(false, {
      now: () => Date.parse("2026-08-29T12:00:00.000Z"),
      readCache: () => ({
        checkedAt: "2026-08-27T12:00:00.000Z",
        latestVersion: "1.1.0",
      }),
      writeCache: (cache) => {
        written = cache;
      },
      fetch: async () => Response.json({ version: "1.4.0" }),
    });

    expect(written).toEqual({
      checkedAt: "2026-08-29T12:00:00.000Z",
      latestVersion: "1.4.0",
    });
    expect(status.latestVersion).toBe("1.4.0");
    expect(status.checkFailed).toBe(false);
  });

  it("retains cached status when the registry check fails", async () => {
    const status = await checkForUpdates(true, {
      readCache: () => ({
        checkedAt: "2026-08-28T12:00:00.000Z",
        latestVersion: "1.4.0",
      }),
      fetch: async () => {
        throw new Error("offline");
      },
    });

    expect(status.latestVersion).toBe("1.4.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.checkFailed).toBe(true);
  });
});
