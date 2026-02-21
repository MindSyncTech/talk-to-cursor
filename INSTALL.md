# TalkToCursor - Installation Guide

**[talktocursor.com](https://talktocursor.com)** | **[npm](https://www.npmjs.com/package/talktocursor)** | **[GitHub](https://github.com/MindSyncTech/talktocursor)**

A hands-free voice interface for Cursor AI. Your coding assistant speaks progress updates aloud and can listen for voice commands using ElevenLabs TTS.

---

## Quick Install (via npm)

```bash
npm install -g talktocursor
```

Then add to your Cursor MCP config (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tts": {
      "command": "npx",
      "args": ["-y", "talktocursor"]
    }
  }
}
```

Skip to [Step 3: Get your ElevenLabs API Key](#step-3-get-your-elevenlabs-api-key).

---

## Manual Install (from source)

### Step 1: Download and extract

**Option A** - From tar.gz:
```bash
tar -xzf talk-to-cursor.tar.gz
cd cursor-tts-mcp
```

**Option B** - From GitHub:
```bash
git clone https://github.com/yourusername/cursor-tts-mcp.git
cd cursor-tts-mcp
```

### Step 2: Install dependencies and build

```bash
npm install
npm run build
```

Then add to your Cursor MCP config (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tts": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/cursor-tts-mcp/build/index.js"]
    }
  }
}
```

> **Important:** Replace `/ABSOLUTE/PATH/TO/cursor-tts-mcp` with the actual path on your machine.
>
> - macOS/Linux: `/Users/yourname/cursor-tts-mcp/build/index.js`
> - Windows: `C:\\Users\\yourname\\cursor-tts-mcp\\build\\index.js`

---

## Step 3: Get your ElevenLabs API Key

1. Go to [elevenlabs.io/app/settings/api-keys](https://try.elevenlabs.io/talktocursor)
2. Sign up or log in (free tier available with 10,000 characters/month)
3. Create a new API key and copy it

## Step 4: Configure via Settings UI

```bash
npm run settings
```

Open **http://localhost:3847** in your browser, then:

1. Paste your ElevenLabs API key and click **Save API Key**
2. Click **Test Key** to verify it works
3. (Optional) Browse and select a voice
4. (Optional) Adjust voice settings (speed, stability, style)
5. (Optional) Enable Auto-Listen for hands-free voice loop

> **Alternatively**, you can set your API key via environment variable:
> ```json
> {
>   "mcpServers": {
>     "tts": {
>       "command": "npx",
>       "args": ["-y", "talktocursor"],
>       "env": {
>         "ELEVENLABS_API_KEY": "your-api-key-here"
>       }
>     }
>   }
> }
> ```

## Step 5: Restart Cursor

**Fully quit Cursor** (Cmd+Q on Mac) and reopen it. The MCP server needs a fresh restart to load.

## Step 6: Test it

1. Open a new Cursor chat (Cmd+L)
2. Check that the `speak` tool appears in "Available Tools"
3. Type: **"Say hello using the speak tool"**
4. You should hear the voice through your speakers!

---

## Optional: Voice Feedback Rule

For the best experience, create a Cursor rule so the agent automatically speaks at key moments.

Create the file `~/.cursor/rules/voice-feedback.mdc`:

```markdown
---
description: MANDATORY voice feedback - agent MUST speak at task start and completion
alwaysApply: true
---

# Voice Feedback Rule

You MUST use the `speak` tool at these moments:
- **Task Start**: Briefly announce what you're about to do
- **Task Completion**: Summarize what was done

Keep messages concise (1-2 sentences). Always speak at start and end of every task.
```

---

## Optional: Hands-Free Dictation (macOS only)

For a fully hands-free experience with voice dictation:

### Auto-Submit Setup

1. Enable **Auto-Submit** in the settings UI
2. Set up a Python virtual environment:

```bash
cd cursor-tts-mcp
python3 -m venv .venv
source .venv/bin/activate
pip install pynput pyobjc-framework-ApplicationServices
```

3. Run in a separate terminal:

```bash
npm run auto-submit
```

4. Grant Accessibility permissions when prompted:
   - System Settings > Privacy & Security > Accessibility
   - Add your terminal app (Terminal.app, iTerm, or Cursor)

### Wispr Voice Loop Setup (requires Wispr Flow)

For a full conversational voice loop using [Wispr Flow](https://ref.wisprflow.ai/talktocursor):

1. Install Wispr Flow and configure its dictation hotkey
2. Enable **Wispr Voice Loop** in the settings UI
3. Configure the hotkey to match your Wispr Flow settings
4. Install additional Python dependency:

```bash
source .venv/bin/activate
pip install sounddevice numpy
brew install portaudio
```

5. Grant Microphone permissions to your terminal app
6. Run the auto-submit script (handles both auto-submit and voice loop):

```bash
npm run auto-submit
```

---

## Configuration

All settings are stored in `config.json` in the project root. You can edit this directly or use the settings UI.

| Setting | Description | Default |
|---------|-------------|---------|
| `apiKey` | ElevenLabs API key | (required) |
| `voiceId` | ElevenLabs voice ID | Rachel |
| `model` | TTS model | `eleven_flash_v2_5` |
| `voiceSettings.speed` | Speech speed (0.7-1.2) | 1.0 |
| `voiceSettings.stability` | Voice stability (0-1) | 0.5 |
| `voiceSettings.similarityBoost` | Voice similarity (0-1) | 0.75 |
| `voiceSettings.style` | Style exaggeration (0-1) | 0.0 |
| `autoListen` | Auto-listen after tasks | true |
| `autoSubmit.enabled` | Auto-press Enter | false |
| `wisprLoop.enabled` | Voice loop with Wispr | false |

---

## Troubleshooting

### Tool doesn't appear in Cursor
- Fully quit and restart Cursor (Cmd+Q)
- Verify `~/.cursor/mcp.json` has the correct path
- Run `npm run build` to ensure the project is compiled

### "API key not set" error
- Open settings: `npm run settings`
- Enter your API key and save
- Restart Cursor

### No audio output
- Check system volume and speaker output
- Verify `mpv` is installed: `brew install mpv`
- Test your API key in the settings UI

### Auto-submit not working
- Ensure macOS Accessibility permissions are granted
- Check that Cursor is the frontmost app
- Try increasing the silence delay in settings

---

## Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run settings` | Open settings UI (port 3847) |
| `npm run auto-submit` | Start auto-submit + voice loop (macOS) |

---

## License

MIT
