#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ElevenLabsClient, play } from "@elevenlabs/elevenlabs-js";
import { getEffectiveConfig } from "./config.js";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load config (config.json with env var overrides)
const config = getEffectiveConfig();

// Create server instance
const server = new McpServer({
  name: "cursor-tts",
  version: "1.0.0",
});

// Initialize ElevenLabs client
const elevenlabs = new ElevenLabsClient({
  apiKey: config.apiKey,
});

const voiceId = config.voiceId;

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
      console.error(`[TTS] Speaking: ${item.text}`);

      // Call ElevenLabs TTS API
      const audio = await elevenlabs.textToSpeech.convert(voiceId, {
        text: item.text,
        modelId: config.model,
        voiceSettings: {
          speed: config.voiceSettings.speed,
          stability: config.voiceSettings.stability,
          similarityBoost: config.voiceSettings.similarityBoost,
          style: config.voiceSettings.style,
        },
      });

      // Play and WAIT for audio to complete
      await play(audio);

      // Write TTS completion signal for background script
      const completionPath = join(__dirname, "..", "tts-complete.json");
      const completionSignal = {
        timestamp: new Date().toISOString(),
        completed: true,
      };
      writeFileSync(completionPath, JSON.stringify(completionSignal, null, 2), "utf-8");
      console.error(`[TTS] Playback complete, signal written: ${completionPath}`);

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
      "Signal the background script to start listening for user voice input via Wispr Flow. Call this after speaking task completion to enable hands-free conversational loop.",
    inputSchema: {},
  },
  async () => {
    try {
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

      const signalPath = join(__dirname, "..", "listen-signal.json");
      const signal = {
        timestamp: new Date().toISOString(),
        triggered: true,
      };
      
      writeFileSync(signalPath, JSON.stringify(signal, null, 2), "utf-8");
      console.error(`[TTS] Listen signal written: ${signalPath}`);

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
  // Validate API key
  if (!config.apiKey) {
    console.error(
      "[TTS] ERROR: No API key found! Set ELEVENLABS_API_KEY env var or configure via the settings UI."
    );
    console.error("[TTS] Run 'npm run settings' to open the settings UI.");
    console.error("[TTS] Or get your API key from: https://elevenlabs.io/app/settings/api-keys");
    process.exit(1);
  }

  console.error(`[TTS] Starting Cursor TTS MCP Server...`);
  console.error(`[TTS] Voice ID: ${voiceId}`);
  console.error(`[TTS] Model: ${config.model}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[TTS] Server running on stdio");
}

main().catch((error) => {
  console.error("[TTS] Fatal error in main():", error);
  process.exit(1);
});
