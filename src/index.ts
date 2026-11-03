#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getEffectiveConfig,
  LISTEN_SIGNAL_PATH,
  TTS_COMPLETE_PATH,
  TTS_STATE_PATH,
  writePrivateJson,
} from "./config.js";
import { speakWithProvider } from "./providers/index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-metadata.js";
import { pauseMediaForSpeech } from "./media-control.js";
import { segmentSentences } from "./sentence-segmentation.js";
import {
  resolveStartupSettingsProfile,
  startSettingsProfileSyncPolling,
} from "./settings-profiles.js";
import { applyPronunciation } from "./pronunciation.js";
import { checkForUpdates } from "./update-checker.js";
import { HelperIpcClient, type HelperMessage } from "./helper-ipc.js";
import { playCompletionSound, soundFeedbackFor, type SpeechKind } from "./completion-sound.js";
import {
  ACKNOWLEDGEMENTS,
  acknowledgementFor,
  ProgressGate,
  speakToolDescription,
} from "./agent-speech.js";
import { acknowledgementAudio, prewarmAcknowledgements, voiceFingerprint } from "./ack-cache.js";
import { playPcm } from "./audio-output.js";
import type { Config } from "./config.js";
// Create server instance
const server = new McpServer({
  name: PACKAGE_NAME,
  version: PACKAGE_VERSION,
});

const helper = new HelperIpcClient("mcp");
let helperPlayback = false;

helper.on("message", (message: HelperMessage) => {
  if (message.type === "helper.state") {
    helperPlayback = Boolean(message.playback);
  } else if (message.type === "tts.cancel") {
    interruptSpeech("the user started speaking");
  } else if (message.type === "prompt.received") {
    acknowledgePrompt(typeof message.text === "string" ? message.text : "");
  }
});
helper.on("disconnected", () => {
  helperPlayback = false;
});

// TTS queue to prevent overlapping audio
interface TTSQueueItem {
  text: string;
  kind: SpeechKind | "ack";
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

const ttsQueue: TTSQueueItem[] = [];
let isProcessingQueue = false;
let currentSpeech: AbortController | null = null;

function interruptedResult(reason: string) {
  return {
    content: [
      {
        type: "text",
        text: `Speech was interrupted because ${reason}; continue with the user's new request.`,
      },
    ],
  };
}

/** Stop current playback and drop queued speech (barge-in). */
function interruptSpeech(reason: string) {
  currentSpeech?.abort();
  for (const item of ttsQueue.splice(0)) item.resolve(interruptedResult(reason));
}

function briefSpokenResponse(text: string): string {
  const trimmed = text.trim();
  const sentences = segmentSentences(trimmed);
  const brief = sentences.filter(Boolean).slice(0, 2).join(" ");
  return brief.length > 420 ? `${brief.slice(0, 417).trimEnd()}...` : brief;
}

function formatSpokenResponse(
  text: string,
  detail: "minimal" | "brief" | "detailed",
): string {
  const trimmed = text.trim();
  if (detail === "detailed" || !trimmed) return trimmed;

  const requiresExplanation =
    trimmed.includes("?") ||
    /\b(error|failed|failure|blocked|blocker|warning|cannot|can't|could not|denied|unauthorized|permission|required|must|need you|action needed|next step|follow[- ]?up|please choose|please confirm)\b/i.test(
      trimmed,
    );
  const isRoutineCompletion =
    /^(?:done|completed|finished|fixed|added|updated|changed|removed|created|implemented|installed|configured|saved|deployed|resolved)\b/i.test(
      trimmed,
    ) ||
    /^(?:i|we)(?:'ve| have)?\s+(?:completed|finished|fixed|added|updated|changed|removed|created|implemented|installed|configured|saved|deployed|resolved)\b/i.test(
      trimmed,
    );
  if (requiresExplanation) return trimmed;
  if (detail === "minimal" && isRoutineCompletion && !requiresExplanation) {
    return "Done.";
  }
  if (detail === "minimal") return briefSpokenResponse(trimmed);
  return briefSpokenResponse(trimmed);
}

async function processTTSQueue() {
  if (isProcessingQueue || ttsQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (ttsQueue.length > 0) {
    const item = ttsQueue.shift()!;

    try {
      const config = getEffectiveConfig();
      if (item.kind === "ack") {
        await speakAcknowledgement(item.text, config);
        item.resolve(null);
        continue;
      }
      const feedback = soundFeedbackFor(config, item.kind);
      if (feedback.mode !== "speech") {
        await playCompletionSound(feedback.sound);
      }
      if (feedback.mode === "sound" || (feedback.mode === "both" && !config.ttsEnabled)) {
        writePrivateJson(TTS_COMPLETE_PATH, {
          timestamp: new Date().toISOString(),
          completed: true,
        });
        console.error(`[TTS] Played the ${feedback.sound} ${item.kind} sound`);
        item.resolve({
          content: [{ type: "text", text: `Played the ${item.kind} sound.` }],
        });
        continue;
      }
      if (!config.ttsEnabled) {
        writePrivateJson(TTS_COMPLETE_PATH, {
          timestamp: new Date().toISOString(),
          completed: true,
          skipped: true,
        });
        console.error(`[TTS] Speech output is disabled, skipping playback`);
        item.resolve({
          content: [
            {
              type: "text",
              text: "Speech output is disabled; nothing was spoken.",
            },
          ],
        });
        continue;
      }

      const spokenText = applyPronunciation(
        formatSpokenResponse(item.text, config.spokenResponseDetail),
        config.pronunciation,
      );
      console.error(
        `[TTS] Speaking ${spokenText.length} characters with ${config.ttsProvider}`,
      );
      const resumeMedia = config.pauseMediaDuringSpeech
        ? await pauseMediaForSpeech()
        : async () => {};
      writePrivateJson(TTS_STATE_PATH, {
        timestamp: new Date().toISOString(),
        speaking: true,
      });
      const controller = new AbortController();
      currentSpeech = controller;
      let interrupted = false;
      try {
        const result = await speakWithProvider(
          spokenText,
          config,
          controller.signal,
          { helper, helperPlayback },
        );
        interrupted = result.interrupted;
      } finally {
        currentSpeech = null;
        writePrivateJson(TTS_STATE_PATH, {
          timestamp: new Date().toISOString(),
          speaking: false,
        });
        await resumeMedia();
      }

      if (interrupted) {
        console.error(`[TTS] Playback interrupted`);
        item.resolve(interruptedResult("the user started speaking"));
        for (const queued of ttsQueue.splice(0)) {
          if (queued.kind === "ack") ttsQueue.push(queued);
          else queued.resolve(interruptedResult("the user started speaking"));
        }
        continue;
      }

      // Write TTS completion signal for background script
      const completionSignal = {
        timestamp: new Date().toISOString(),
        completed: true,
      };
      writePrivateJson(TTS_COMPLETE_PATH, completionSignal);
      console.error(`[TTS] Playback complete`);

      item.resolve({
        content: [
          {
            type: "text",
            text: `Spoken: "${spokenText}"`,
          },
        ],
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[TTS] Error: ${errorMessage}`);

      item.resolve({
        content: [
          {
            type: "text",
            text: `Failed to speak: ${errorMessage}`,
          },
        ],
        isError: true,
      });
    }
  }

  isProcessingQueue = false;
}

async function speakAcknowledgement(text: string, config: Config) {
  const controller = new AbortController();
  currentSpeech = controller;
  writePrivateJson(TTS_STATE_PATH, { timestamp: new Date().toISOString(), speaking: true });
  try {
    const spokenText = applyPronunciation(text, config.pronunciation);
    const target = { helper, helperPlayback };
    const audio = acknowledgementAudio(spokenText, config, controller.signal);
    if (audio) await playPcm(audio, controller.signal, target);
    else await speakWithProvider(spokenText, config, controller.signal, target);
    console.error(`[TTS] Acknowledged the prompt: "${spokenText}"`);
  } catch (error) {
    console.error(
      `[TTS] Acknowledgement failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    currentSpeech = null;
    writePrivateJson(TTS_STATE_PATH, { timestamp: new Date().toISOString(), speaking: false });
  }
}

const progress = new ProgressGate();

/** Speak a short acknowledgement the moment a prompt is sent (Instant Feedback). */
function acknowledgePrompt(prompt: string) {
  progress.promptReceived();
  const config = getEffectiveConfig();
  if (!config.ttsEnabled || !config.agentSpeech.instantFeedback) return;
  const phrase = acknowledgementFor(prompt, config.agentSpeech.speakingStyle);
  if (!phrase) return;
  interruptSpeech("the user sent a new prompt");
  ttsQueue.unshift({ text: phrase, kind: "ack", resolve: () => {}, reject: () => {} });
  processTTSQueue();
}

async function waitForSpeechIdle(): Promise<void> {
  while (isProcessingQueue || ttsQueue.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function queueTTS(text: string, kind: SpeechKind = "update"): Promise<any> {
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text, kind, resolve, reject });
    processTTSQueue();
  });
}

// Register the speak tool
let lastSpeechError: string | null = null;

let speakDescription = speakToolDescription(getEffectiveConfig());

const speakTool = server.registerTool(
  "speak",
  {
    description: speakDescription,
    inputSchema: {
      text: z
        .string()
        .optional()
        .describe("Required. The text to speak aloud. Keep it concise (1-2 sentences max)."),
      message: z.string().optional().describe("Alias for text."),
      content: z.string().optional().describe("Alias for text."),
      speech: z.string().optional().describe("Alias for text."),
      completion: z
        .boolean()
        .optional()
        .describe(
          "Set true for the final task-completion summary. The user may have chosen a completion sound instead of, or before, this speech.",
        ),
      question: z
        .boolean()
        .optional()
        .describe(
          "Set true when you need the user's answer or decision before you can continue. The user may have chosen an answers-needed sound instead of, or before, this speech.",
        ),
      waitForPlayback: z
        .boolean()
        .optional()
        .describe("Deprecated and ignored; speech never blocks the agent."),
    },
  },
  async (args) => {
    const text = [args.text, args.message, args.content, args.speech]
      .find((value) => typeof value === "string" && value.trim() !== "");
    if (!text) {
      return {
        content: [
          {
            type: "text",
            text: 'Nothing to speak. Call speak again with { "text": "..." }.',
          },
        ],
        isError: true,
      };
    }

    const previousError = lastSpeechError;
    lastSpeechError = null;

    const kind: SpeechKind =
      args.completion === true ? "completion" : args.question === true ? "question" : "update";
    const config = getEffectiveConfig();
    refreshAgentSpeech(config);
    if (kind === "completion") progress.taskEnded();
    if (kind === "update" && !progress.allowUpdate(config.agentSpeech.progressUpdates)) {
      return {
        content: [
          {
            type: "text",
            text:
              config.agentSpeech.progressUpdates === "off"
                ? "Not spoken: the user turned off spoken progress updates. Speak again only for a question or the final summary."
                : "Not spoken: spoken progress updates start once a task has run for about a minute.",
          },
        ],
      };
    }
    void queueTTS(text, kind).then((result) => {
      if (result?.isError) {
        lastSpeechError = result.content?.[0]?.text ?? "Speech failed";
        console.error(`[TTS] Background speech failed: ${lastSpeechError}`);
      }
    });
    return {
      content: [
        {
          type: "text",
          text: previousError
            ? `Speech queued. The previous speech did not play (${previousError}); tell the user.`
            : "Speech queued; continue immediately.",
        },
      ],
    };
  }
);

let prewarmedFor: string | null = null;

/** Keep the speak tool's guidance and cached acknowledgements in step with settings. */
function refreshAgentSpeech(config: Config) {
  const description = speakToolDescription(config);
  if (description !== speakDescription) {
    speakDescription = description;
    speakTool.update({ description });
  }
  const fingerprint = voiceFingerprint(config);
  const key = `${fingerprint}|${config.agentSpeech.speakingStyle}`;
  if (!config.agentSpeech.instantFeedback || !config.ttsEnabled || !fingerprint || key === prewarmedFor) {
    return;
  }
  prewarmedFor = key;
  const phrases = Object.values(ACKNOWLEDGEMENTS[config.agentSpeech.speakingStyle])
    .flat()
    .map((text) => applyPronunciation(text, config.pronunciation));
  void prewarmAcknowledgements(phrases, config, AbortSignal.timeout(120_000))
    .then((cached) => {
      if (cached) console.error(`[TTS] Cached ${cached} acknowledgement phrases`);
    })
    .catch((error) => {
      prewarmedFor = null;
      console.error(
        `[TTS] Could not cache acknowledgements: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

// Register the listen tool
server.registerTool(
  "listen",
  {
    description:
      "Signal the background script to start listening with the configured voice input provider once queued speech has finished playing. Always call this immediately after final task-completion speech; it returns right away and safely does nothing when Auto-Listen is disabled. Never call it after task-start or milestone speech.",
    inputSchema: {},
  },
  async () => {
    try {
      const config = getEffectiveConfig();
      if (!config.voiceInput.enabled) {
        console.error(`[TTS] Voice input is disabled, skipping listen signal`);
        return {
          content: [
            {
              type: "text",
              text: "Voice input is disabled; no listen signal was created.",
            },
          ],
        };
      }
      // Check if auto-listen is enabled
      if (!config.autoListen) {
        console.error(`[TTS] Auto-listen is disabled, skipping listen signal`);
        return {
          content: [
            {
              type: "text",
              text: "Auto-listen is disabled",
            },
          ],
        };
      }

      void waitForSpeechIdle().then(() => {
        if (helper.send({ type: "listen" })) {
          console.error(`[TTS] Listen request sent to the Background Helper`);
        } else {
          writePrivateJson(LISTEN_SIGNAL_PATH, {
            timestamp: new Date().toISOString(),
            triggered: true,
          });
          console.error(`[TTS] Listen signal written`);
        }
      });

      return {
        content: [
          {
            type: "text",
            text: "Listening for user input...",
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[TTS] Listen error: ${errorMessage}`);

      return {
        content: [
          {
            type: "text",
            text: `Failed to start listening: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Main function to start the server
async function main() {
  try {
    const profile = await resolveStartupSettingsProfile();
    if (profile) {
      console.error(`[TTS] Settings profile: ${profile.name}`);
    }
  } catch (error) {
    console.error(
      `[TTS] Settings profile unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  startSettingsProfileSyncPolling();
  const config = getEffectiveConfig();

  console.error(`[TTS] Starting ${PACKAGE_NAME} MCP Server v${PACKAGE_VERSION}...`);
  console.error(`[TTS] Provider: ${config.ttsProvider}`);
  if (config.ttsProvider === "elevenlabs") {
    console.error(`[TTS] Voice ID: ${config.voiceId}`);
    console.error(`[TTS] Model: ${config.model}`);
  } else {
    if (config.ttsProvider === "voicebox") {
      console.error(`[TTS] Voicebox URL: ${config.voicebox.baseUrl}`);
      console.error(
        `[TTS] Voicebox profile: ${config.voicebox.profile || "default binding"}`,
      );
    } else {
      console.error(`[TTS] Cloud URL: ${config.cloud.apiUrl}`);
    }
  }

  helper.start();
  setTimeout(() => refreshAgentSpeech(getEffectiveConfig()), 5_000).unref();
  setInterval(() => refreshAgentSpeech(getEffectiveConfig()), 15_000).unref();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[TTS] Server running on stdio");

  void checkForUpdates().then((status) => {
    if (status.updateAvailable) {
      console.error(
        `[TTS] Update available: v${status.latestVersion} (installed v${status.currentVersion}). ${status.updateCommand}`,
      );
    }
  });
}

main().catch((error) => {
  console.error("[TTS] Fatal error in main():", error);
  process.exit(1);
});
