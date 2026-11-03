import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import {
  acknowledgementFor,
  ACKNOWLEDGEMENTS,
  classifyPrompt,
  LONG_TASK_MS,
  ProgressGate,
  speakToolDescription,
} from "../src/agent-speech.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { settingsSchema } from "../src/settings-schema.js";

describe("prompt classification", () => {
  it.each([
    ["The send button is broken after the update", "fix"],
    ["how does the settings sync work?", "question"],
    ["run the tests", "run"],
    ["can you review the latest changes", "review"],
    ["add a dark mode toggle to settings", "build"],
    ["is this ready to ship?", "question"],
    ["yes please", "reply"],
    ["the onboarding copy for new users in the dashboard", "general"],
    ["", "general"],
  ])("%s -> %s", (prompt, kind) => {
    expect(classifyPrompt(prompt)).toBe(kind);
  });

  it("skips prompts that only say thanks", () => {
    expect(classifyPrompt("Thanks!")).toBeNull();
    expect(acknowledgementFor("thank you", "casual")).toBeNull();
  });

  it("matches the phrase list TalkToCursor Cloud generates without using the allowance", () => {
    const phrases = [
      ...new Set(Object.values(ACKNOWLEDGEMENTS).flatMap((style) => Object.values(style).flat())),
    ];
    const fingerprint = createHash("sha256").update(phrases.sort().join("\n")).digest("hex");
    // Changing a phrase? Update Cloud's acknowledgement list and its fingerprint too.
    expect(fingerprint.slice(0, 16)).toBe("dc917b0c5d1ec8c1");
  });

  it("rotates through the phrases for the chosen style", () => {
    const phrases = ACKNOWLEDGEMENTS.professional.fix;
    const picked = phrases.map(() => acknowledgementFor("fix the crash", "professional"));
    expect(new Set(picked)).toEqual(new Set(phrases));
  });
});

describe("progress gate", () => {
  it("always allows the task-start update", () => {
    const gate = new ProgressGate();
    gate.promptReceived(0);
    expect(gate.allowUpdate("off", 1_000)).toBe(true);
    expect(gate.allowUpdate("off", 2_000)).toBe(false);
  });

  it("allows progress on longer tasks only after a minute", () => {
    const gate = new ProgressGate();
    gate.promptReceived(0);
    expect(gate.allowUpdate("long", 1_000)).toBe(true);
    expect(gate.allowUpdate("long", 30_000)).toBe(false);
    expect(gate.allowUpdate("long", LONG_TASK_MS)).toBe(true);
  });

  it("starts a new task after completion", () => {
    const gate = new ProgressGate();
    gate.allowUpdate("off", 0);
    gate.taskEnded();
    expect(gate.allowUpdate("off", 5_000)).toBe(true);
  });
});

describe("agent speech settings", () => {
  it("defaults existing configs to instant, casual feedback with all progress updates", () => {
    const { agentSpeech: _omitted, ...legacy } = DEFAULT_CONFIG;
    expect(settingsSchema.parse(legacy).agentSpeech).toEqual({
      instantFeedback: true,
      progressUpdates: "all",
      speakingStyle: "casual",
    });
  });

  it("describes the chosen behavior to the agent", () => {
    const description = speakToolDescription({
      ...DEFAULT_CONFIG,
      agentSpeech: { instantFeedback: false, progressUpdates: "off", speakingStyle: "professional" },
    });
    expect(description).toContain("Don't speak progress updates");
    expect(description).toContain("professional");
    expect(description).not.toContain("acknowledgement the moment");
  });
});
