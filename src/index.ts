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

// Create server instance
const server = new McpServer({
  name: PACKAGE_NAME,
  version: PACKAGE_VERSION,
});

// TTS queue to prevent overlapping audio
interface TTSQueueItem {
  text: string;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

const ttsQueue: TTSQueueItem[] = [];
let isProcessingQueue = false;

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

      const spokenText = formatSpokenResponse(
        item.text,
        config.spokenResponseDetail,
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
      try {
        await speakWithProvider(spokenText, config);
      } finally {
        writePrivateJson(TTS_STATE_PATH, {
          timestamp: new Date().toISOString(),
          speaking: false,
        });
        await resumeMedia();
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

      item.reject({
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

function queueTTS(text: string): Promise<any> {
  return new Promise((resolve, reject) => {
    ttsQueue.push({ text, resolve, reject });
    processTTSQueue();
  });
}

// Register the speak tool
server.registerTool(
  "speak",
  {
    description:
      "Speak text aloud using text-to-speech. For task-start announcements set waitForPlayback to false so work begins immediately. For completion speech leave it true, then call the listen tool so Auto-Listen starts after playback. State task-start actions and factual answers explicitly; keep routine completion updates concise. The user's Spoken Response Detail setting applies at playback.",
    inputSchema: {
      text: z
        .string()
        .describe("The text to speak aloud. Keep it concise (1-2 sentences max)."),
      waitForPlayback: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Set false for task-start announcements; leave true for completion speech, questions, failures, and required follow-ups.",
        ),
    },
  },
  async ({ text, waitForPlayback }) => {
    if (waitForPlayback) {
      return await queueTTS(text);
    }

    void queueTTS(text).catch((error) => {
      console.error(`[TTS] Background speech failed: ${String(error)}`);
    });
    return {
      content: [
        {
          type: "text",
          text: "Speech queued; continue the task immediately.",
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
      "Signal the background script to start listening with the configured voice input provider. Always call this immediately after final task-completion speech; it safely does nothing when Auto-Listen is disabled. Never call it after task-start or milestone speech.",
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

      const signal = {
        timestamp: new Date().toISOString(),
        triggered: true,
      };
      
      writePrivateJson(LISTEN_SIGNAL_PATH, signal);
      console.error(`[TTS] Listen signal written`);

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[TTS] Server running on stdio");
}

main().catch((error) => {
  console.error("[TTS] Fatal error in main():", error);
  process.exit(1);
});
