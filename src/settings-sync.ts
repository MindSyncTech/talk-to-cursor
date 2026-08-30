import type { PortableSettings, SettingsProfile } from "./settings-profiles.js";

export type SyncConflict = {
  profileId: string;
  baseRevision: number;
  remoteRevision: number;
  paths: string[];
  baseSettings: PortableSettings;
  localSettings: PortableSettings;
  remoteSettings: PortableSettings;
  createdAt: string;
};

export type ProfileSyncState = {
  entitled: boolean;
  activeProfileId: string | null;
  revision: number | null;
  baseSettings: PortableSettings | null;
  conflict: SyncConflict | null;
  lastError?: string | null;
};

type Path = string[];
type MergeResult = {
  merged: PortableSettings | null;
  localChangedPaths: string[];
  remoteChangedPaths: string[];
  conflictPaths: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedPaths(base: unknown, value: unknown, path: Path = []): Path[] {
  if (equal(base, value)) return [];
  if (isObject(base) && isObject(value)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(value)]);
    return [...keys].flatMap((key) =>
      changedPaths(base[key], value[key], [...path, key]),
    );
  }
  return [path];
}

function overlaps(left: Path, right: Path): boolean {
  const length = Math.min(left.length, right.length);
  return left.slice(0, length).every((part, index) => part === right[index]);
}

function displayPath(path: Path): string {
  return path.length ? path.join(".") : "$";
}

function valueAtPath(value: unknown, path: Path): unknown {
  let current = value;
  for (const key of path) {
    current = isObject(current) ? current[key] : undefined;
  }
  return current;
}

function pathsConflict(
  localPath: Path,
  remotePath: Path,
  local: PortableSettings,
  remote: PortableSettings,
): boolean {
  if (!overlaps(localPath, remotePath)) return false;
  const commonPath = localPath.slice(
    0,
    Math.min(localPath.length, remotePath.length),
  );
  return !equal(
    valueAtPath(local, commonPath),
    valueAtPath(remote, commonPath),
  );
}

function applyPath(target: Record<string, unknown>, source: unknown, path: Path) {
  if (path.length === 0) return structuredClone(source);
  let destination: Record<string, unknown> = target;
  let origin: unknown = source;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]!;
    origin = isObject(origin) ? origin[key] : undefined;
    if (!isObject(destination[key])) destination[key] = {};
    destination = destination[key] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1]!;
  const originObject = isObject(origin) ? origin : {};
  if (Object.prototype.hasOwnProperty.call(originObject, leaf)) {
    destination[leaf] = structuredClone(originObject[leaf]);
  } else {
    delete destination[leaf];
  }
  return target;
}

export function mergePortableSettings(
  base: PortableSettings,
  local: PortableSettings,
  remote: PortableSettings,
): MergeResult {
  const localPaths = changedPaths(base, local);
  const remotePaths = changedPaths(base, remote);
  const conflicts = localPaths.filter((localPath) =>
    remotePaths.some((remotePath) =>
      pathsConflict(localPath, remotePath, local, remote),
    ),
  );
  if (conflicts.length) {
    return {
      merged: null,
      localChangedPaths: localPaths.map(displayPath),
      remoteChangedPaths: remotePaths.map(displayPath),
      conflictPaths: conflicts.map(displayPath),
    };
  }

  let merged: unknown = structuredClone(remote);
  for (const path of localPaths) {
    merged = applyPath(merged as Record<string, unknown>, local, path);
  }
  return {
    merged: merged as PortableSettings,
    localChangedPaths: localPaths.map(displayPath),
    remoteChangedPaths: remotePaths.map(displayPath),
    conflictPaths: [],
  };
}

function resolvePortableSettings(
  base: PortableSettings,
  local: PortableSettings,
  remote: PortableSettings,
  resolution: "use_remote" | "use_local",
): PortableSettings {
  const localPaths = changedPaths(base, local);
  const remotePaths = changedPaths(base, remote);
  let resolved: unknown = structuredClone(remote);
  for (const localPath of localPaths) {
    const conflicts = remotePaths.some((remotePath) =>
      pathsConflict(localPath, remotePath, local, remote),
    );
    if (!conflicts || resolution === "use_local") {
      resolved = applyPath(
        resolved as Record<string, unknown>,
        local,
        localPath,
      );
    }
  }
  return resolved as PortableSettings;
}

type CoordinatorDependencies = {
  readState: () => ProfileSyncState;
  writeState: (state: Partial<ProfileSyncState>) => void;
  readLocal: () => PortableSettings;
  applyLocal: (settings: PortableSettings) => void;
  fetchProfile: (id: string) => Promise<SettingsProfile>;
  updateProfile: (
    id: string,
    revision: number,
    settings: PortableSettings,
  ) => Promise<SettingsProfile>;
  setRuntimeProfile?: (settings: PortableSettings | null) => void;
  now?: () => string;
};

function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number })?.status;
}

export class SettingsSyncCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private resyncRequested = false;
  private readonly maxUpdateAttempts = 3;

  constructor(
    private readonly dependencies: CoordinatorDependencies,
    private readonly debounceMs = 2_000,
  ) {}

  schedule(): boolean {
    const state = this.dependencies.readState();
    if (
      !state.entitled ||
      !state.activeProfileId ||
      !state.baseSettings ||
      state.revision === null ||
      state.conflict
    ) {
      return false;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.synchronize();
    }, this.debounceMs);
    this.timer.unref?.();
    return true;
  }

  startPolling(intervalMs = 60_000): boolean {
    if (this.pollTimer) return false;
    this.pollTimer = setInterval(() => {
      void this.reconcile();
    }, intervalMs);
    this.pollTimer.unref?.();
    return true;
  }

  stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  getStatus() {
    const state = this.dependencies.readState();
    return {
      active_profile_id: state.activeProfileId,
      revision: state.revision,
      entitled: state.entitled,
      status: state.conflict
        ? "conflict"
        : this.syncing
          ? "syncing"
          : this.timer
            ? "pending"
            : state.lastError
              ? "error"
              : state.activeProfileId
                ? "synced"
                : "inactive",
      conflict: state.conflict
        ? {
            base_revision: state.conflict.baseRevision,
            remote_revision: state.conflict.remoteRevision,
            paths: state.conflict.paths,
            created_at: state.conflict.createdAt,
          }
        : null,
      last_error: state.lastError ?? null,
    };
  }

  async synchronize(): Promise<void> {
    await this.runSync(false);
  }

  async reconcile(): Promise<void> {
    await this.runSync(true);
  }

  private async runSync(forcePull: boolean): Promise<void> {
    if (this.syncing) {
      this.resyncRequested = true;
      return;
    }
    const state = this.dependencies.readState();
    if (
      !state.entitled ||
      !state.activeProfileId ||
      !state.baseSettings ||
      state.revision === null ||
      state.conflict
    ) {
      if (!state.entitled || !state.activeProfileId) {
        this.dependencies.setRuntimeProfile?.(null);
      }
      return;
    }
    const local = this.dependencies.readLocal();
    if (!forcePull && equal(local, state.baseSettings)) return;

    this.syncing = true;
    try {
      if (!forcePull && !equal(local, state.baseSettings)) {
        try {
          const profile = await this.dependencies.updateProfile(
            state.activeProfileId,
            state.revision,
            local,
          );
          this.setBaseline(profile);
          return;
        } catch (error) {
          if (errorStatus(error) !== 409) throw error;
        }
      }

      for (let attempt = 0; attempt < this.maxUpdateAttempts; attempt += 1) {
        const remote = await this.dependencies.fetchProfile(
          state.activeProfileId,
        );
        const merge = mergePortableSettings(
          state.baseSettings,
          local,
          remote.settings,
        );
        if (!merge.merged) {
          this.setConflict(state, local, remote, merge.conflictPaths);
          return;
        }
        if (equal(merge.merged, remote.settings)) {
          if (!equal(local, merge.merged)) {
            this.dependencies.applyLocal(merge.merged);
          }
          this.setBaseline(remote);
          return;
        }
        try {
          const updated = await this.dependencies.updateProfile(
            state.activeProfileId,
            remote.revision,
            merge.merged,
          );
          this.dependencies.applyLocal(merge.merged);
          this.setBaseline(updated);
          return;
        } catch (error) {
          if (errorStatus(error) !== 409) throw error;
        }
      }
      throw new Error(
        "Profile kept changing during synchronization; retry on the next sync.",
      );
    } catch (error) {
      const status = errorStatus(error);
      const lostAccess = status === 401 || status === 402 || status === 403;
      this.dependencies.writeState({
        ...(lostAccess
          ? { entitled: false, conflict: null }
          : {}),
        lastError: error instanceof Error ? error.message : String(error),
      });
      if (lostAccess) this.dependencies.setRuntimeProfile?.(null);
    } finally {
      this.syncing = false;
      if (this.resyncRequested) {
        this.resyncRequested = false;
        this.schedule();
      }
    }
  }

  async useRemote(): Promise<SettingsProfile> {
    return this.resolveConflict("use_remote");
  }

  async useLocal(): Promise<SettingsProfile> {
    return this.resolveConflict("use_local");
  }

  private async resolveConflict(
    resolution: "use_remote" | "use_local",
  ): Promise<SettingsProfile> {
    const state = this.requireConflict();
    const conflict = state.conflict!;
    for (let attempt = 0; attempt < this.maxUpdateAttempts; attempt += 1) {
      const remote = await this.dependencies.fetchProfile(
        state.activeProfileId!,
      );
      const currentMerge = mergePortableSettings(
        conflict.baseSettings,
        conflict.localSettings,
        remote.settings,
      );
      const newConflictPaths = currentMerge.conflictPaths.filter(
        (path) => !conflict.paths.includes(path),
      );
      if (newConflictPaths.length) {
        this.setConflict(
          state,
          conflict.localSettings,
          remote,
          currentMerge.conflictPaths,
        );
        throw Object.assign(
          new Error(
            "The profile changed again; review the updated conflicts before choosing.",
          ),
          { status: 409 },
        );
      }
      const resolved = resolvePortableSettings(
        conflict.baseSettings,
        conflict.localSettings,
        remote.settings,
        resolution,
      );
      if (equal(resolved, remote.settings)) {
        this.dependencies.applyLocal(resolved);
        this.setBaseline(remote);
        return remote;
      }
      try {
        const updated = await this.dependencies.updateProfile(
          remote.id,
          remote.revision,
          resolved,
        );
        this.dependencies.applyLocal(resolved);
        this.setBaseline(updated);
        return updated;
      } catch (error) {
        if (errorStatus(error) !== 409) throw error;
      }
    }
    throw Object.assign(
      new Error(
        "Profile kept changing while resolving the conflict; review it again.",
      ),
      { status: 409 },
    );
  }

  private requireConflict(): ProfileSyncState {
    const state = this.dependencies.readState();
    if (!state.conflict || !state.activeProfileId) {
      throw Object.assign(new Error("There is no settings sync conflict."), {
        status: 409,
      });
    }
    return state;
  }

  private setBaseline(profile: SettingsProfile): void {
    this.dependencies.setRuntimeProfile?.(profile.settings);
    this.dependencies.writeState({
      entitled: true,
      activeProfileId: profile.id,
      revision: profile.revision,
      baseSettings: profile.settings,
      conflict: null,
      lastError: null,
    });
  }

  private setConflict(
    state: ProfileSyncState,
    local: PortableSettings,
    remote: SettingsProfile,
    paths: string[],
  ): void {
    this.dependencies.setRuntimeProfile?.(local);
    this.dependencies.writeState({
      conflict: {
        profileId: remote.id,
        baseRevision: state.revision!,
        remoteRevision: remote.revision,
        paths,
        baseSettings: structuredClone(state.baseSettings!),
        localSettings: local,
        remoteSettings: remote.settings,
        createdAt:
          this.dependencies.now?.() ?? new Date().toISOString(),
      },
      lastError: null,
    });
  }
}
