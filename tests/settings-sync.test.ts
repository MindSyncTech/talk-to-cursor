import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import {
  mergePortableSettings,
  SettingsSyncCoordinator,
  type ProfileSyncState,
} from "../src/settings-sync.js";
import {
  toPortableSettings,
  type PortableSettings,
  type SettingsProfile,
} from "../src/settings-profiles.js";

function settings(): PortableSettings {
  return toPortableSettings(structuredClone(DEFAULT_CONFIG));
}

function profile(
  revision: number,
  value: PortableSettings,
): SettingsProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Work",
    is_default: true,
    revision,
    settings: value,
  };
}

describe("portable settings merge", () => {
  it("merges disjoint leaf changes", () => {
    const base = settings();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.autoListen = false;
    remote.voiceSettings.speed = 0.9;

    const result = mergePortableSettings(base, local, remote);

    expect(result.conflictPaths).toEqual([]);
    expect(result.merged).toMatchObject({
      autoListen: false,
      voiceSettings: { speed: 0.9 },
    });
  });

  it("detects ancestor overlap", () => {
    const base = settings();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.autoSubmit.targetApp = "Claude";
    (remote as unknown as Record<string, unknown>).autoSubmit = "remote";

    const result = mergePortableSettings(base, local, remote);

    expect(result.merged).toBeNull();
    expect(result.conflictPaths).toContain("autoSubmit.targetApp");
  });

  it("treats arrays as atomic values", () => {
    const base = {
      ...settings(),
      shortcuts: ["a", "b"],
    } as unknown as PortableSettings;
    const local = {
      ...structuredClone(base),
      shortcuts: ["a", "local"],
    } as unknown as PortableSettings;
    const remote = {
      ...structuredClone(base),
      shortcuts: ["a", "remote"],
    } as unknown as PortableSettings;

    const result = mergePortableSettings(base, local, remote);

    expect(result.merged).toBeNull();
    expect(result.conflictPaths).toEqual(["shortcuts"]);
  });

  it("accepts identical overlapping changes", () => {
    const base = settings();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    local.autoListen = false;
    remote.autoListen = false;

    const result = mergePortableSettings(base, local, remote);

    expect(result.conflictPaths).toEqual([]);
    expect(result.merged?.autoListen).toBe(false);
  });
});

describe("settings sync coordinator", () => {
  it("starts only one periodic reconciler per coordinator", () => {
    vi.useFakeTimers();
    const base = settings();
    const state: ProfileSyncState = {
      entitled: true,
      activeProfileId: profile(1, base).id,
      revision: 1,
      baseSettings: base,
      conflict: null,
      lastError: null,
    };
    const coordinator = new SettingsSyncCoordinator({
      readState: () => state,
      writeState: vi.fn(),
      readLocal: () => base,
      applyLocal: vi.fn(),
      fetchProfile: async () => profile(1, base),
      updateProfile: vi.fn(),
    });

    expect(coordinator.startPolling()).toBe(true);
    expect(coordinator.startPolling()).toBe(false);
    coordinator.stopPolling();
    vi.useRealTimers();
  });

  it("debounces and safely retries disjoint changes after a second 409", async () => {
    vi.useFakeTimers();
    const base = settings();
    const local = structuredClone(base);
    local.autoListen = false;
    const remote = structuredClone(base);
    remote.voiceSettings.speed = 0.9;
    let state: ProfileSyncState = {
      entitled: true,
      activeProfileId: profile(1, base).id,
      revision: 1,
      baseSettings: base,
      conflict: null,
      lastError: null,
    };
    const update = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }))
      .mockResolvedValueOnce(profile(4, { ...remote, autoListen: false }));
    const applyLocal = vi.fn();
    let fetchedRevision = 1;
    const coordinator = new SettingsSyncCoordinator({
      readState: () => state,
      writeState: (next) => {
        state = { ...state, ...next };
      },
      readLocal: () => local,
      applyLocal,
      fetchProfile: async () => profile(++fetchedRevision, remote),
      updateProfile: update,
    });

    expect(coordinator.schedule()).toBe(true);
    expect(coordinator.schedule()).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(update).toHaveBeenCalledTimes(3);
    expect(update.mock.calls[1]?.[1]).toBe(2);
    expect(update.mock.calls[2]?.[1]).toBe(3);
    expect(applyLocal).toHaveBeenCalledWith({
      ...remote,
      autoListen: false,
    });
    expect(state.revision).toBe(4);
    expect(state.conflict).toBeNull();
    vi.useRealTimers();
  });

  it("persists genuinely different overlapping conflicts", async () => {
    const base = settings();
    const local = structuredClone(base);
    local.autoListen = false;
    const remote = structuredClone(base);
    remote.autoListen = false;
    local.spokenResponseDetail = "minimal";
    remote.spokenResponseDetail = "detailed";
    let state: ProfileSyncState = {
      entitled: true,
      activeProfileId: profile(1, base).id,
      revision: 1,
      baseSettings: base,
      conflict: null,
      lastError: null,
    };
    const update = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    const coordinator = new SettingsSyncCoordinator({
      readState: () => state,
      writeState: (next) => {
        state = { ...state, ...next };
      },
      readLocal: () => local,
      applyLocal: vi.fn(),
      fetchProfile: async () => profile(2, remote),
      updateProfile: update,
      now: () => "2026-08-29T12:00:00.000Z",
    });

    await coordinator.synchronize();

    expect(update).toHaveBeenCalledTimes(1);
    expect(state.conflict).toMatchObject({
      baseRevision: 1,
      remoteRevision: 2,
      paths: ["spokenResponseDetail"],
    });
    expect(coordinator.getStatus().conflict).toEqual({
      base_revision: 1,
      remote_revision: 2,
      paths: ["spokenResponseDetail"],
      created_at: "2026-08-29T12:00:00.000Z",
    });
  });

  it.each([
    ["useRemote", "detailed"],
    ["useLocal", "minimal"],
  ] as const)(
    "%s preserves disjoint changes while choosing only conflicting values",
    async (method, expectedDetail) => {
      const base = settings();
      const local = structuredClone(base);
      local.autoListen = false;
      local.spokenResponseDetail = "minimal";
      const remote = structuredClone(base);
      remote.voiceSettings.speed = 0.9;
      remote.spokenResponseDetail = "detailed";
      let state: ProfileSyncState = {
        entitled: true,
        activeProfileId: profile(1, base).id,
        revision: 1,
        baseSettings: base,
        conflict: null,
        lastError: null,
      };
      const applied: PortableSettings[] = [];
      const update = vi.fn(
        async (_id: string, revision: number, value: PortableSettings) =>
          profile(revision + 1, value),
      );
      const coordinator = new SettingsSyncCoordinator({
        readState: () => state,
        writeState: (next) => {
          state = { ...state, ...next };
        },
        readLocal: () => local,
        applyLocal: (value) => applied.push(value),
        fetchProfile: async () => profile(2, remote),
        updateProfile: vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error("conflict"), { status: 409 }),
          )
          .mockImplementation(update),
      });

      await coordinator.synchronize();
      expect(state.conflict?.paths).toEqual(["spokenResponseDetail"]);

      const resolved = await coordinator[method]();

      expect(resolved.settings).toMatchObject({
        autoListen: false,
        spokenResponseDetail: expectedDetail,
        voiceSettings: { speed: 0.9 },
      });
      expect(applied.at(-1)).toEqual(resolved.settings);
    },
  );

  it("pulls and applies remote-only changes during reconciliation", async () => {
    const base = settings();
    const remote = structuredClone(base);
    remote.voiceSettings.speed = 0.9;
    let state: ProfileSyncState = {
      entitled: true,
      activeProfileId: profile(1, base).id,
      revision: 1,
      baseSettings: base,
      conflict: null,
      lastError: null,
    };
    const applyLocal = vi.fn();
    const coordinator = new SettingsSyncCoordinator({
      readState: () => state,
      writeState: (next) => {
        state = { ...state, ...next };
      },
      readLocal: () => base,
      applyLocal,
      fetchProfile: async () => profile(2, remote),
      updateProfile: vi.fn(),
    });

    await coordinator.reconcile();

    expect(applyLocal).toHaveBeenCalledWith(remote);
    expect(state.revision).toBe(2);
    expect(state.baseSettings).toEqual(remote);
  });

  it("bounds repeated disjoint 409 retries without creating a false conflict", async () => {
    const base = settings();
    const local = structuredClone(base);
    local.autoListen = false;
    let state: ProfileSyncState = {
      entitled: true,
      activeProfileId: profile(1, base).id,
      revision: 1,
      baseSettings: base,
      conflict: null,
      lastError: null,
    };
    let remoteRevision = 1;
    const updateProfile = vi.fn().mockImplementation(async () => {
      remoteRevision += 1;
      throw Object.assign(new Error("conflict"), { status: 409 });
    });
    const coordinator = new SettingsSyncCoordinator({
      readState: () => state,
      writeState: (next) => {
        state = { ...state, ...next };
      },
      readLocal: () => local,
      applyLocal: vi.fn(),
      fetchProfile: async () => {
        const remote = structuredClone(base);
        remote.voiceSettings.speed = 1 - remoteRevision / 100;
        return profile(remoteRevision, remote);
      },
      updateProfile,
    });

    await coordinator.synchronize();

    expect(updateProfile).toHaveBeenCalledTimes(4);
    expect(state.conflict).toBeNull();
    expect(state.lastError).toContain("kept changing");
  });
});
