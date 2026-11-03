import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { PYTHON_PATH, RUNTIME_DIR } from "./background-service.js";

export type PromptHookHost = "cursor" | "claude";

export const PROMPT_HOOK_PATHS: Record<PromptHookHost, string> = {
  cursor: join(homedir(), ".cursor", "hooks.json"),
  claude: join(homedir(), ".claude", "settings.json"),
};

const HOOK_SCRIPT = "prompt_hook.py";
const HOOK_TIMEOUT_SECONDS = 2;

type Json = Record<string, any>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function promptHookCommand(host: PromptHookHost): string {
  const command = `${shellQuote(PYTHON_PATH)} ${shellQuote(join(RUNTIME_DIR, HOOK_SCRIPT))}`;
  return host === "cursor" ? `${command} --cursor` : command;
}

function isOurs(entry: unknown): boolean {
  return (
    !!entry &&
    typeof entry === "object" &&
    typeof (entry as Json).command === "string" &&
    (entry as Json).command.includes(HOOK_SCRIPT)
  );
}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} does not contain a JSON object`);
  }
  return parsed;
}

function writeJson(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

/** Cursor: hooks.beforeSubmitPrompt is a list of { command }. */
function cursorEntries(file: Json): unknown[] {
  return Array.isArray(file.hooks?.beforeSubmitPrompt) ? file.hooks.beforeSubmitPrompt : [];
}

/** Claude Code: hooks.UserPromptSubmit is a list of { hooks: [{ type, command }] }. */
function claudeGroups(file: Json): Json[] {
  return Array.isArray(file.hooks?.UserPromptSubmit) ? file.hooks.UserPromptSubmit : [];
}

function withoutOurClaudeHooks(groups: Json[]): Json[] {
  return groups
    .map((group) =>
      Array.isArray(group?.hooks)
        ? { ...group, hooks: group.hooks.filter((hook: unknown) => !isOurs(hook)) }
        : group,
    )
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
}

export function promptHookInstalled(
  host: PromptHookHost,
  path = PROMPT_HOOK_PATHS[host],
): boolean {
  try {
    const file = readJson(path);
    return host === "cursor"
      ? cursorEntries(file).some(isOurs)
      : claudeGroups(file).some((group) => Array.isArray(group?.hooks) && group.hooks.some(isOurs));
  } catch {
    return false;
  }
}

/** Add or remove the TalkToCursor prompt hook, leaving every other hook untouched. */
export function setPromptHook(
  host: PromptHookHost,
  installed: boolean,
  path = PROMPT_HOOK_PATHS[host],
): void {
  const file = readJson(path);
  const hooks: Json =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks) ? file.hooks : {};
  const command = promptHookCommand(host);
  if (host === "cursor") {
    file.version ??= 1;
    const entries = cursorEntries(file).filter((entry) => !isOurs(entry));
    if (installed) entries.push({ command, timeout: HOOK_TIMEOUT_SECONDS });
    hooks.beforeSubmitPrompt = entries;
    if (!entries.length) delete hooks.beforeSubmitPrompt;
  } else {
    const groups = withoutOurClaudeHooks(claudeGroups(file));
    if (installed) {
      groups.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] });
    }
    hooks.UserPromptSubmit = groups;
    if (!groups.length) delete hooks.UserPromptSubmit;
  }
  file.hooks = hooks;
  writeJson(path, file);
}
