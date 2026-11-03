import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { promptHookInstalled, setPromptHook } from "../src/prompt-hooks.js";

function tempFile(contents?: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "ttc-hooks-")), "hooks.json");
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("prompt hooks", () => {
  it("adds the Cursor hook without touching other hooks, and removes only its own", () => {
    const other = { command: "./hooks/audit.sh" };
    const path = tempFile({ version: 1, hooks: { beforeSubmitPrompt: [other], stop: [other] } });

    setPromptHook("cursor", true, path);
    setPromptHook("cursor", true, path);
    const installed = JSON.parse(readFileSync(path, "utf8"));
    expect(installed.hooks.beforeSubmitPrompt).toHaveLength(2);
    expect(installed.hooks.beforeSubmitPrompt[1].command).toContain("prompt_hook.py' --cursor");
    expect(promptHookInstalled("cursor", path)).toBe(true);

    setPromptHook("cursor", false, path);
    const removed = JSON.parse(readFileSync(path, "utf8"));
    expect(removed.hooks).toEqual({ beforeSubmitPrompt: [other], stop: [other] });
    expect(promptHookInstalled("cursor", path)).toBe(false);
  });

  it("creates a Claude Code UserPromptSubmit hook and keeps other settings", () => {
    const path = tempFile({ model: "opus" });
    setPromptHook("claude", true, path);
    const settings = JSON.parse(readFileSync(path, "utf8"));
    expect(settings.model).toBe("opus");
    expect(settings.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({ type: "command" });
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).not.toContain("--cursor");

    setPromptHook("claude", false, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ model: "opus", hooks: {} });
  });

  it("refuses to overwrite a hooks file it can't parse", () => {
    const path = tempFile();
    writeFileSync(path, "{ not json");
    expect(() => setPromptHook("cursor", true, path)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });
});
