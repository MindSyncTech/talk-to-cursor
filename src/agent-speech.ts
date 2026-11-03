import type { Config } from "./config.js";

export type PromptKind =
  | "question"
  | "fix"
  | "build"
  | "review"
  | "run"
  | "reply"
  | "general";

type Style = Config["agentSpeech"]["speakingStyle"];

/** TalkToCursor Cloud generates exactly these phrases without using the allowance. */
export const ACKNOWLEDGEMENTS: Record<Style, Record<PromptKind, readonly string[]>> = {
  casual: {
    question: ["Good question, let me check.", "Let me look into that.", "Hmm, let me find out."],
    fix: ["On it, let me dig into that.", "Let me see what's going on.", "Okay, let me track that down."],
    build: ["Sure, working on that now.", "On it.", "Sounds good, getting started."],
    review: ["Let me take a look.", "Sure, one sec while I look.", "Let me check that out."],
    run: ["Sure, running that now.", "On it, one sec."],
    reply: ["Got it.", "Okay, sounds good.", "Got it, thanks."],
    general: ["Sure, one sec.", "Let me take a look at that, one sec.", "Okay, on it."],
  },
  professional: {
    question: ["Let me look into that.", "I'll check and report back.", "Let me find that out."],
    fix: ["I'll investigate the issue.", "I'll look into what's causing that.", "Understood. I'll diagnose the problem."],
    build: [
      "Understood. I'll start on the implementation.",
      "I'll examine the codebase to see how that can be implemented.",
      "I'll get started on that now.",
    ],
    review: ["I'll review that now.", "Let me examine that.", "I'll take a look."],
    run: ["I'll run that now.", "Starting that now."],
    reply: ["Understood.", "Noted, thank you.", "Understood, proceeding."],
    general: ["Understood. I'll get started.", "I'll look into that now.", "Certainly, one moment."],
  },
};

const THANKS_ONLY = /^(?:thanks|thank you|thx|ty|cheers|great|perfect|nice|awesome)[\s.!]*$/;
const SHORT_REPLY =
  /^(?:yes|yeah|yep|yup|no|nope|ok|okay|sure|correct|right|exactly|go ahead|do it|sounds good|please do|option|the first|the second|both|neither|either)\b/;
const FIX = /\b(?:fix|bug|bugs|broken|error|errors|crash|crashes|crashing|fail|fails|failing|failed|not working|doesn't work|isn't working|wrong|issue)\b/;
const WH_QUESTION = /^(?:what|why|how|when|where|who|which)\b/;
const RUN = /^(?:please\s+)?(?:run|deploy|test|install|restart|start|push|commit|publish|release|merge)\b/;
const REVIEW = /\b(?:review|check|look at|take a look|audit|inspect|verify|investigate)\b/;
const BUILD = /\b(?:add|create|build|implement|make|write|update|change|refactor|set up|setup|remove|rename|move|replace|support)\b/;
const QUESTION_START = /^(?:is|are|can|could|should|would|does|do|did|will|have|has)\b/;

/** Classify a prompt, or return null when it needs no acknowledgement ("thanks"). */
export function classifyPrompt(text: string): PromptKind | null {
  const prompt = text.trim().toLowerCase().slice(0, 400);
  if (!prompt) return "general";
  if (THANKS_ONLY.test(prompt)) return null;
  const words = prompt.split(/\s+/).length;
  if (words <= 4 && SHORT_REPLY.test(prompt)) return "reply";
  if (FIX.test(prompt)) return "fix";
  if (WH_QUESTION.test(prompt)) return "question";
  if (RUN.test(prompt)) return "run";
  if (REVIEW.test(prompt)) return "review";
  if (BUILD.test(prompt)) return "build";
  if (prompt.endsWith("?") || QUESTION_START.test(prompt)) return "question";
  return words <= 3 ? "reply" : "general";
}

const rotation = new Map<string, number>();

/** Pick the next acknowledgement for a prompt, rotating through the variants. */
export function acknowledgementFor(text: string, style: Style): string | null {
  const kind = classifyPrompt(text);
  if (!kind) return null;
  const phrases = ACKNOWLEDGEMENTS[style][kind];
  const key = `${style}:${kind}`;
  const index = rotation.get(key) ?? 0;
  rotation.set(key, index + 1);
  return phrases[index % phrases.length];
}

export const LONG_TASK_MS = 60_000;

const MAX_SEND_SOUND_WAIT_MS = 3_000;

/** Wait for the send sound to finish, then the user's chosen pause, before acknowledging. */
export function acknowledgementDelayMs(sendSoundMs: number, pauseMs: number): number {
  const sendSound = Number.isFinite(sendSoundMs)
    ? Math.min(Math.max(sendSoundMs, 0), MAX_SEND_SOUND_WAIT_MS)
    : 0;
  return sendSound + Math.max(pauseMs, 0);
}

/**
 * Decides which "update" speech plays. The first update of a task is its
 * task-start statement and always plays; later ones are progress updates.
 */
export class ProgressGate {
  private taskStartedAt: number | null = null;
  private updates = 0;

  promptReceived(now = Date.now()): void {
    this.taskStartedAt = now;
    this.updates = 0;
  }

  taskEnded(): void {
    this.taskStartedAt = null;
    this.updates = 0;
  }

  allowUpdate(mode: Config["agentSpeech"]["progressUpdates"], now = Date.now()): boolean {
    if (this.taskStartedAt === null) this.taskStartedAt = now;
    const isTaskStart = this.updates === 0;
    this.updates += 1;
    if (isTaskStart || mode === "all") return true;
    if (mode === "off") return false;
    return now - this.taskStartedAt >= LONG_TASK_MS;
  }
}

const STYLE_GUIDANCE: Record<Style, string> = {
  casual:
    "Speaking style: casual and friendly, like a teammate (\"let me take a look at that, one sec\").",
  professional:
    "Speaking style: professional and precise (\"I'll examine the codebase to see how that can be implemented\").",
};

const PROGRESS_GUIDANCE: Record<Config["agentSpeech"]["progressUpdates"], string> = {
  all: "Speak brief progress updates at important milestones (\"about halfway done\", \"running the final tests\").",
  long: "Speak progress updates only on tasks that run longer than about a minute; skip them on quick tasks.",
  off: "Don't speak progress updates; speak only a task-start update when useful, questions, and the final summary.",
};

export function speakToolDescription(config: Config): string {
  const parts = [
    "Speak text aloud using text-to-speech. Speech is queued and the tool returns immediately, so keep working or write the final chat response while it plays.",
    "On the final message, pass completion: true when a task or feature is finished, or reply: true when you answered a question, followed up, or made a quick fix. Pass question: true when you need the user's answer to continue. After final speech, call the listen tool; it waits for playback before Auto-Listen starts.",
    "State task-start actions and factual answers explicitly; keep routine completion updates concise. The user's Spoken Response Detail setting applies at playback.",
  ];
  if (config.agentSpeech.instantFeedback) {
    parts.push(
      "TalkToCursor already speaks a short acknowledgement the moment each prompt is sent, so don't open with a generic one (\"sure\", \"let me check\"); make any task-start update specific.",
    );
  }
  parts.push(PROGRESS_GUIDANCE[config.agentSpeech.progressUpdates]);
  parts.push(STYLE_GUIDANCE[config.agentSpeech.speakingStyle]);
  return parts.join(" ");
}
