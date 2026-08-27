#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getEffectiveConfig,
  LISTEN_SIGNAL_PATH,
  TTS_COMPLETE_PATH,
  writePrivateJson,
} from "./config.js";
import { speakWithProvider } from "./providers/index.js";
import { getCloudToken } from "./credentials.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package-metadata.js";

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

async function processTTSQueue() {
  if (isProcessingQueue || ttsQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  while (ttsQueue.length > 0) {
    const item = ttsQueue.shift()!;

    try {
      const config = getEffectiveConfig();
      console.error(
        `[TTS] Speaking ${item.text.length} characters with ${config.ttsProvider}`,
      );
      await speakWithProvider(item.text, config);

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
            text: `Spoken: "${item.text}"`,
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
      "Speak text aloud using text-to-speech. Use this to announce task progress, completions, and important updates so the user can follow along without looking at the screen.",
    inputSchema: {
      text: z
        .string()
        .describe("The text to speak aloud. Keep it concise (1-2 sentences max)."),
    },
  },
  async ({ text }) => {
    // Queue the TTS request to prevent overlapping audio
    return await queueTTS(text);
  }
);

// Register the listen tool
server.registerTool(
  "listen",
  {
    description:
      "Signal the background script to start listening with the configured voice input provider. Call this after speaking task completion to enable the hands-free conversational loop.",
    inputSchema: {},
  },
  async () => {
    try {
      const config = getEffectiveConfig();
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
  if (config.ttsProvider === "elevenlabs" && !config.apiKey) {
    console.error(
      "[TTS] ERROR: ElevenLabs is selected, but no API key is configured. Set ELEVENLABS_API_KEY or use the settings UI."
    );
    console.error("[TTS] Run 'talktocursor-settings' to open the settings UI.");
    console.error("[TTS] Or get your API key from: https://elevenlabs.io/app/settings/api-keys");
    process.exit(1);
  }
  if (config.ttsProvider === "cloud" && !getCloudToken()) {
    console.error(
      "[TTS] ERROR: TalkToCursor Cloud is selected, but no Cloud account is connected.",
    );
    console.error(
      "[TTS] Run 'talktocursor-settings', then connect your Cloud account or select another provider.",
    );
    process.exit(1);
  }

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
