import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { z } from "zod";
import {
  USER_DATA_DIR,
  getEffectiveConfig,
  loadConfig,
  saveConfig,
  setRuntimeConfigOverlay,
  writePrivateJson,
  type Config,
  type ConfigUpdate,
} from "./config.js";
import { getCloudToken } from "./credentials.js";
import {
  MANAGED_TTS_VOICES,
  MANAGED_TTS_MODEL,
  autoSubmitSettingsSchema,
  normalizeManagedModel,
  normalizeManagedVoice,
  pronunciationSettingsSchema,
  voiceInputSettingsSchema,
  voiceSettingsSchema,
} from "./settings-schema.js";
import {
  SettingsSyncCoordinator,
  type ProfileSyncState,
} from "./settings-sync.js";

export const SETTINGS_PROFILES_CACHE_PATH =
  `${USER_DATA_DIR}/settings-profiles-cache.json`;

const hostIdSchema = z.enum([
  "cursor",
  "claude-code",
  "codex",
  "antigravity",
  "other",
]);

const portableSettingsSchema = z.object({
  ttsEnabled: z.boolean(),
  pauseMediaDuringSpeech: z.boolean(),
  spokenResponseDetail: z.enum(["minimal", "brief", "detailed"]),
  ttsProvider: z.enum(["elevenlabs", "voicebox", "cloud"]),
  voiceId: z.preprocess(
    (value) => normalizeManagedVoice(value),
    z.enum(MANAGED_TTS_VOICES),
  ),
  model: z.preprocess(
    (value) => normalizeManagedModel(value),
    z.literal(MANAGED_TTS_MODEL),
  ),
  voiceSettings: voiceSettingsSchema,
  elevenLabs: z.object({
    voiceId: z.string().trim().min(1).max(200),
    model: z.string().trim().min(1).max(200),
  }),
  voicebox: z.object({
    profile: z.string().trim().max(200),
    personality: z.boolean(),
  }),
  autoSubmit: autoSubmitSettingsSchema,
  voiceInput: voiceInputSettingsSchema.omit({ handyCommand: true }),
  pronunciation: pronunciationSettingsSchema.default({
    enabled: true,
    entries: [],
  }),
  autoListen: z.boolean(),
});

export type PortableSettings = z.infer<typeof portableSettingsSchema>;

export interface SettingsProfile {
  id: string;
  name: string;
  is_default: boolean;
  revision: number;
  settings: PortableSettings;
  schema_version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SettingsAssignment {
  profile_id: string;
  host_id: HostId;
  project_key: string;
  project_label: string | null;
  updated_at?: string;
}

export type HostId = z.infer<typeof hostIdSchema>;

export interface ProjectContext {
  hostId: HostId;
  projectKey: string;
  projectLabel: string;
}

interface ProfilesCache {
  entitled: boolean;
  profiles: SettingsProfile[];
  assignments: SettingsAssignment[];
  sync: Omit<ProfileSyncState, "entitled">;
  updatedAt: string;
}

const EMPTY_SYNC_STATE: Omit<ProfileSyncState, "entitled"> = {
  activeProfileId: null,
  revision: null,
  baseSettings: null,
  conflict: null,
  lastError: null,
};

const EMPTY_CACHE: ProfilesCache = {
  entitled: false,
  profiles: [],
  assignments: [],
  sync: EMPTY_SYNC_STATE,
  updatedAt: "",
};

function normalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  const scp = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  const candidate = scp ? `https://${scp[1]}/${scp[2]}` : trimmed;
  try {
    const url = new URL(candidate);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    return `${url.hostname.toLowerCase()}/${path.toLowerCase()}`;
  } catch {
    return trimmed.replace(/\.git$/i, "").replace(/\\/g, "/").toLowerCase();
  }
}

function readGitRemote(projectRoot: string): string {
  try {
    return execFileSync(
      "git",
      ["-C", projectRoot, "config", "--get", "remote.origin.url"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

export function getProjectContext(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): ProjectContext {
  const hostId = hostIdSchema.catch("other").parse(
    (env.TALKTOCURSOR_HOST || "cursor").trim().toLowerCase(),
  );
  const projectRoot = resolve(env.TALKTOCURSOR_PROJECT_ROOT || cwd);
  const remote = readGitRemote(projectRoot);
  const alias = env.TALKTOCURSOR_PROJECT_ALIAS?.trim();
  let canonicalProjectRoot = projectRoot;
  try {
    canonicalProjectRoot = realpathSync.native(projectRoot);
  } catch {
    // A configured project root may not exist yet; resolved absolute identity is stable.
  }
  const identity = remote
    ? `git:${normalizeRemote(remote)}`
    : alias
      ? `local:${alias}`
      : `local-path:${canonicalProjectRoot}`;
  return {
    hostId,
    projectKey: createHash("sha256")
      .update(`${hostId}|${identity}`)
      .digest("hex"),
    projectLabel: basename(projectRoot) || "Project",
  };
}

export function toPortableSettings(config: Config): PortableSettings {
  return portableSettingsSchema.parse({
    ttsEnabled: config.ttsEnabled,
    pauseMediaDuringSpeech: config.pauseMediaDuringSpeech,
    spokenResponseDetail: config.spokenResponseDetail,
    ttsProvider: config.ttsProvider,
    voiceId: config.cloud.voiceId,
    model: config.cloud.model,
    voiceSettings: config.voiceSettings,
    elevenLabs: { voiceId: config.voiceId, model: config.model },
    voicebox: {
      profile: config.voicebox.profile,
      personality: config.voicebox.personality,
    },
    autoSubmit: config.autoSubmit,
    pronunciation: config.pronunciation,
    voiceInput: {
      enabled: config.voiceInput.enabled,
      provider: config.voiceInput.provider,
      silenceThreshold: config.voiceInput.silenceThreshold,
      silenceDuration: config.voiceInput.silenceDuration,
      wisprHotkey: config.voiceInput.wisprHotkey,
      manualTriggerHotkey: config.voiceInput.manualTriggerHotkey,
      wakeWordEnabled: config.voiceInput.wakeWordEnabled,
      wakePhrase: config.voiceInput.wakePhrase,
      wakeSensitivity: config.voiceInput.wakeSensitivity,
      wakeChime: config.voiceInput.wakeChime,
    },
    autoListen: config.autoListen,
  });
}

export function applyPortableSettings(
  settings: PortableSettings,
  local: Config,
): Config {
  const portable = portableSettingsSchema.parse(settings);
  return {
    ...local,
    ttsEnabled: portable.ttsEnabled,
    pauseMediaDuringSpeech: portable.pauseMediaDuringSpeech,
    spokenResponseDetail: portable.spokenResponseDetail,
    ttsProvider: portable.ttsProvider,
    voiceId: portable.elevenLabs.voiceId,
    model: portable.elevenLabs.model,
    voiceSettings: portable.voiceSettings,
    voicebox: {
      ...local.voicebox,
      profile: portable.voicebox.profile,
      personality: portable.voicebox.personality,
    },
    cloud: {
      ...local.cloud,
      voiceId: normalizeManagedVoice(portable.voiceId),
      model: normalizeManagedModel(portable.model) || MANAGED_TTS_MODEL,
    },
    autoSubmit: portable.autoSubmit,
    pronunciation: portable.pronunciation,
    voiceInput: {
      ...portable.voiceInput,
      handyCommand: local.voiceInput.handyCommand,
    },
    autoListen: portable.autoListen,
  };
}

function toRuntimeConfigOverlay(settings: PortableSettings): ConfigUpdate {
  const portable = portableSettingsSchema.parse(settings);
  return {
    ttsEnabled: portable.ttsEnabled,
    pauseMediaDuringSpeech: portable.pauseMediaDuringSpeech,
    spokenResponseDetail: portable.spokenResponseDetail,
    ttsProvider: portable.ttsProvider,
    voiceId: portable.elevenLabs.voiceId,
    model: portable.elevenLabs.model,
    voiceSettings: portable.voiceSettings,
    voicebox: portable.voicebox,
    cloud: {
      voiceId: portable.voiceId,
      model: portable.model,
    },
    autoSubmit: portable.autoSubmit,
    pronunciation: portable.pronunciation,
    voiceInput: portable.voiceInput,
    autoListen: portable.autoListen,
  };
}

function setRuntimeProfile(settings: PortableSettings | null): void {
  setRuntimeConfigOverlay(
    settings ? toRuntimeConfigOverlay(settings) : null,
  );
}

export function readProfilesCache(): ProfilesCache {
  try {
    if (!existsSync(SETTINGS_PROFILES_CACHE_PATH)) return structuredClone(EMPTY_CACHE);
    const parsed = JSON.parse(readFileSync(SETTINGS_PROFILES_CACHE_PATH, "utf8"));
    return {
      entitled: parsed.entitled === true,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      sync:
        parsed.sync && typeof parsed.sync === "object"
          ? { ...EMPTY_SYNC_STATE, ...parsed.sync }
          : { ...EMPTY_SYNC_STATE },
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return structuredClone(EMPTY_CACHE);
  }
}

function writeProfilesCache(update: Partial<ProfilesCache>): ProfilesCache {
  const next = {
    ...readProfilesCache(),
    ...update,
    updatedAt: new Date().toISOString(),
  };
  writePrivateJson(SETTINGS_PROFILES_CACHE_PATH, next);
  return next;
}

export function clearProfilesCache(): void {
  writePrivateJson(SETTINGS_PROFILES_CACHE_PATH, EMPTY_CACHE);
  setRuntimeProfile(null);
}

export function readProfileSyncState(): ProfileSyncState {
  const cache = readProfilesCache();
  return { entitled: cache.entitled, ...cache.sync };
}

function writeProfileSyncState(update: Partial<ProfileSyncState>): void {
  const cache = readProfilesCache();
  const { entitled, ...syncUpdate } = update;
  writeProfilesCache({
    ...(entitled === undefined ? {} : { entitled }),
    sync: { ...cache.sync, ...syncUpdate },
  });
}

function setActiveProfileBaseline(
  profile: SettingsProfile | null,
  entitled: boolean,
): void {
  setRuntimeProfile(profile?.settings ?? null);
  writeProfileSyncState({
    entitled,
    activeProfileId: profile?.id ?? null,
    revision: profile?.revision ?? null,
    baseSettings: profile?.settings ?? null,
    conflict: null,
    lastError: null,
  });
}

function isCloudAccessError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 401 || status === 402 || status === 403;
}

function cloudUrl(path: string): string {
  return `${loadConfig().cloud.apiUrl.replace(/\/+$/, "")}${path}`;
}

async function cloudRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<any> {
  const token = getCloudToken();
  if (!token) throw new Error("Connect TalkToCursor Cloud first.");
  const response = await fetch(cloudUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(timeoutMs),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(
      data?.error?.message || data?.error || "Cloud settings request failed.",
    ) as Error & { status?: number; body?: unknown };
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function fetchRemoteProfile(id: string): Promise<SettingsProfile> {
  const data = await cloudRequest(
    `/api/v1/settings/profiles/${encodeURIComponent(id)}`,
  );
  const cache = readProfilesCache();
  writeProfilesCache({
    entitled: data.entitled === true,
    profiles: [
      ...cache.profiles.filter((item) => item.id !== id),
      data.profile,
    ],
  });
  return data.profile;
}

async function updateRemoteProfileSettings(
  id: string,
  revision: number,
  settings: PortableSettings,
): Promise<SettingsProfile> {
  let metadata = readProfilesCache().profiles.find((item) => item.id === id);
  if (!metadata) metadata = await fetchRemoteProfile(id);
  const data = await cloudRequest(
    `/api/v1/settings/profiles/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        name: metadata.name,
        is_default: metadata.is_default,
        revision,
        settings,
      }),
    },
  );
  const cache = readProfilesCache();
  writeProfilesCache({
    entitled: data.entitled === true,
    profiles: cache.profiles.map((item) =>
      item.id === data.profile.id ? data.profile : item,
    ),
  });
  return data.profile;
}

const settingsSync = new SettingsSyncCoordinator({
  readState: readProfileSyncState,
  writeState: writeProfileSyncState,
  readLocal: () => toPortableSettings(getEffectiveConfig()),
  applyLocal: (settings) =>
    saveConfig(applyPortableSettings(settings, loadConfig())),
  fetchProfile: fetchRemoteProfile,
  updateProfile: updateRemoteProfileSettings,
  setRuntimeProfile,
});

export function scheduleSettingsProfileSync(config?: Config): boolean {
  const state = readProfileSyncState();
  if (config && state.entitled && state.activeProfileId) {
    setRuntimeProfile(toPortableSettings(config));
  }
  return settingsSync.schedule();
}

export function getSettingsProfileSyncStatus() {
  return settingsSync.getStatus();
}

export function startSettingsProfileSyncPolling(
  intervalMs = 60_000,
): boolean {
  const state = readProfileSyncState();
  setRuntimeProfile(
    state.entitled && state.activeProfileId
      ? state.conflict?.localSettings ?? state.baseSettings
      : null,
  );
  return settingsSync.startPolling(intervalMs);
}

export async function resolveSettingsProfileSyncConflict(
  resolution: "use_remote" | "use_local",
): Promise<SettingsProfile> {
  return resolution === "use_remote"
    ? settingsSync.useRemote()
    : settingsSync.useLocal();
}

export async function listProfiles(timeoutMs = 10_000): Promise<{
  entitled: boolean;
  profiles: SettingsProfile[];
  source: "remote" | "cache";
}> {
  try {
    const data = await cloudRequest(
      "/api/v1/settings/profiles",
      {},
      timeoutMs,
    );
    writeProfilesCache({
      entitled: data.entitled === true,
      profiles: data.profiles || [],
    });
    return { ...data, source: "remote" };
  } catch (error) {
    const cache = isCloudAccessError(error)
      ? writeProfilesCache({ entitled: false })
      : readProfilesCache();
    if (isCloudAccessError(error)) setRuntimeProfile(null);
    return {
      entitled: cache.entitled,
      profiles: cache.profiles,
      source: "cache",
    };
  }
}

export async function createProfile(
  name: string,
  isDefault = false,
): Promise<any> {
  const data = await cloudRequest("/api/v1/settings/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      is_default: isDefault,
      settings: toPortableSettings(loadConfig()),
    }),
  });
  const cache = readProfilesCache();
  writeProfilesCache({
    entitled: data.entitled === true,
    profiles: [...cache.profiles.filter((item) => item.id !== data.profile.id), data.profile],
  });
  return data;
}

export async function updateProfile(
  id: string,
  input: { name: string; revision: number; is_default: boolean },
): Promise<any> {
  const data = await cloudRequest(
    `/api/v1/settings/profiles/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...input,
        settings: toPortableSettings(loadConfig()),
      }),
    },
  );
  const cache = readProfilesCache();
  writeProfilesCache({
    entitled: data.entitled === true,
    profiles: cache.profiles.map((item) =>
      item.id === data.profile.id ? data.profile : item,
    ),
  });
  if (cache.sync.activeProfileId === id) {
    setActiveProfileBaseline(data.profile, data.entitled === true);
  }
  return data;
}

export async function deleteProfile(id: string, revision: number): Promise<void> {
  await cloudRequest(
    `/api/v1/settings/profiles/${encodeURIComponent(id)}?revision=${revision}`,
    { method: "DELETE" },
  );
  const cache = readProfilesCache();
  writeProfilesCache({
    profiles: cache.profiles.filter((item) => item.id !== id),
    assignments: cache.assignments.filter((item) => item.profile_id !== id),
  });
  if (cache.sync.activeProfileId === id) {
    setActiveProfileBaseline(null, cache.entitled);
    setRuntimeProfile(null);
  }
}

export async function applyProfile(
  id: string,
  persist = true,
): Promise<SettingsProfile> {
  let profile: SettingsProfile | undefined;
  try {
    const data = await cloudRequest(
      `/api/v1/settings/profiles/${encodeURIComponent(id)}`,
    );
    const cache = readProfilesCache();
    writeProfilesCache({
      entitled: data.entitled === true,
      profiles: [
        ...cache.profiles.filter((item) => item.id !== id),
        data.profile,
      ],
    });
    if (data.entitled !== true) {
      throw Object.assign(
        new Error("An active paid subscription is required to apply profiles."),
        { status: 402 },
      );
    }
    profile = data.profile;
  } catch (error) {
    const cache = isCloudAccessError(error)
      ? writeProfilesCache({ entitled: false })
      : readProfilesCache();
    if (!cache.entitled) throw error;
    profile = cache.profiles.find((item) => item.id === id);
  }
  if (!profile) throw new Error("Profile is unavailable locally and in Cloud.");
  const next = applyPortableSettings(profile.settings, loadConfig());
  if (persist) saveConfig(next);
  setRuntimeProfile(profile.settings);
  setActiveProfileBaseline(profile, true);
  return profile;
}

export async function listAssignments(timeoutMs = 10_000): Promise<{
  entitled: boolean;
  assignments: SettingsAssignment[];
  context: ProjectContext;
  source: "remote" | "cache";
}> {
  const context = getProjectContext();
  try {
    const params = new URLSearchParams({
      host_id: context.hostId,
      project_key: context.projectKey,
    });
    const data = await cloudRequest(
      `/api/v1/settings/assignments?${params}`,
      {},
      timeoutMs,
    );
    const cache = readProfilesCache();
    const otherAssignments = cache.assignments.filter(
      (item) =>
        item.host_id !== context.hostId ||
        item.project_key !== context.projectKey,
    );
    writeProfilesCache({
      entitled: data.entitled === true,
      assignments: [...otherAssignments, ...(data.assignments || [])],
    });
    return { ...data, context, source: "remote" };
  } catch (error) {
    const cache = isCloudAccessError(error)
      ? writeProfilesCache({ entitled: false })
      : readProfilesCache();
    if (isCloudAccessError(error)) setRuntimeProfile(null);
    return {
      entitled: cache.entitled,
      assignments: cache.assignments.filter(
        (item) =>
          item.host_id === context.hostId &&
          item.project_key === context.projectKey,
      ),
      context,
      source: "cache",
    };
  }
}

export async function assignProfile(profileId: string): Promise<any> {
  const context = getProjectContext();
  const data = await cloudRequest("/api/v1/settings/assignments", {
    method: "PUT",
    body: JSON.stringify({
      profile_id: profileId,
      host_id: context.hostId,
      project_key: context.projectKey,
      project_label: context.projectLabel,
    }),
  });
  const cache = readProfilesCache();
  writeProfilesCache({
    entitled: data.entitled === true,
    assignments: [
      ...cache.assignments.filter(
        (item) =>
          item.host_id !== context.hostId ||
          item.project_key !== context.projectKey,
      ),
      data.assignment,
    ],
  });
  const profile =
    cache.profiles.find((item) => item.id === profileId) ??
    (await fetchRemoteProfile(profileId));
  saveConfig(applyPortableSettings(profile.settings, loadConfig()));
  setRuntimeProfile(profile.settings);
  setActiveProfileBaseline(profile, data.entitled === true);
  return { ...data, context };
}

export async function deleteAssignment(): Promise<void> {
  const context = getProjectContext();
  const params = new URLSearchParams({
    host_id: context.hostId,
    project_key: context.projectKey,
  });
  await cloudRequest(`/api/v1/settings/assignments?${params}`, {
    method: "DELETE",
  });
  const cache = readProfilesCache();
  writeProfilesCache({
    assignments: cache.assignments.filter(
      (item) =>
        item.host_id !== context.hostId ||
        item.project_key !== context.projectKey,
    ),
  });
  setActiveProfileBaseline(null, cache.entitled);
  setRuntimeProfile(null);
}

export async function resolveStartupSettingsProfile(): Promise<
  SettingsProfile | null
> {
  const [assignmentResult, profileResult] = await Promise.all([
    listAssignments(1_500),
    listProfiles(1_500),
  ]);
  if (!assignmentResult.entitled || !profileResult.entitled) {
    setActiveProfileBaseline(null, false);
    setRuntimeProfile(null);
    return null;
  }
  const { assignments } = assignmentResult;
  const { profiles } = profileResult;
  const profile =
    profiles.find((item) => item.id === assignments[0]?.profile_id) ||
    profiles.find((item) => item.is_default);
  if (!profile) {
    setActiveProfileBaseline(null, true);
    setRuntimeProfile(null);
    return null;
  }
  setRuntimeProfile(profile.settings);
  setActiveProfileBaseline(profile, true);
  return profile;
}
