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
import { completionFeedbackFor, playCompletionSound } from "./completion-sound.js";
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
  }
});
helper.on("disconnected", () => {
  helperPlayback = false;
});

// TTS queue to prevent overlapping audio
interface TTSQueueItem {
  text: string;
  completion: boolean;
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
      const feedback = completionFeedbackFor(config, item.completion);
      if (feedback !== "speech") {
        await playCompletionSound(config.completionFeedback.sound);
      }
      if (feedback === "sound" || (feedback === "both" && !config.ttsEnabled)) {
        writePrivateJson(TTS_COMPLETE_PATH, {
          timestamp: new Date().toISOString(),
          completed: true,
        });
        console.error(`[TTS] Played the ${config.completionFeedback.sound} completion sound`);
        item.resolve({
          content: [{ type: "text", text: "Played the completion sound." }],
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
          queued.resolve(interruptedResult("the user started speaking"));
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

async function waitForSpeechIdle(): Promise<void> {
  while (isProcessingQueue || ttsQueue.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function queueTTS(text: string, completion = false): Promise<any> {
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text, completion, resolve, reject });
    processTTSQueue();
  });
}

// Register the speak tool
let lastSpeechError: string | null = null;

server.registerTool(
  "speak",
  {
    description:
      "Speak text aloud using text-to-speech. Speech is queued and the tool returns immediately, so keep working or write the final chat response while it plays. Pass completion: true on the final task-completion summary. After final completion speech, call the listen tool; it waits for playback before Auto-Listen starts. State task-start actions and factual answers explicitly; keep routine completion updates concise. The user's Spoken Response Detail setting applies at playback.",
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

    void queueTTS(text, args.completion === true).then((result) => {
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
