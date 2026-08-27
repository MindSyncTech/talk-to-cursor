# TalkToCursor - Installation Guide

**[talktocursor.com](https://talktocursor.com)** | **[npm](https://www.npmjs.com/package/talktocursor)** | **[GitHub](https://github.com/MindSyncTech/talk-to-cursor)**

A hands-free voice interface for Cursor AI. Your coding assistant speaks progress updates through ElevenLabs, local Voicebox, or Google-powered TalkToCursor Cloud TTS and can listen for voice commands.

---

## Quick Install (via npm)

```bash
npm install -g talktocursor
```

Requires Node.js 18 or newer.

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

Skip to [Step 3: Choose a TTS Provider](#step-3-choose-a-tts-provider).

---

## Manual Install (from source)

### Step 1: Download and extract

**Option A** - From tar.gz:
```bash
tar -xzf talk-to-cursor.tar.gz
cd talk-to-cursor
```

**Option B** - From GitHub:
```bash
git clone https://github.com/MindSyncTech/talk-to-cursor.git
cd talk-to-cursor
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
      "args": ["/ABSOLUTE/PATH/TO/talk-to-cursor/build/index.js"]
    }
  }
}
```

> **Important:** Replace `/ABSOLUTE/PATH/TO/talk-to-cursor` with the actual path on your machine.
>
> - macOS/Linux: `/Users/yourname/talk-to-cursor/build/index.js`
> - Windows: `C:\\Users\\yourname\\talk-to-cursor\\build\\index.js`

---

## Step 3: Choose a TTS Provider

- **[TalkToCursor Cloud](https://cloud.talktocursor.com):** Managed Google Cloud TTS for $15/month with 100,000 included characters and portable settings. No provider credential is stored locally.
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor):** Sign up and create an API key for full voice and model controls.
- **[Voicebox](https://github.com/jamiepine/voicebox) (free & local):** Install and run Voicebox, download a TTS model, and create a voice profile.

## Step 4: Configure via Settings UI

```bash
talktocursor-settings
```

Open **http://localhost:3847** in your browser, then:

1. Select **ElevenLabs**, **Voicebox**, or **TalkToCursor Cloud** under Text-to-Speech Provider
2. Connect your Cloud account, save an ElevenLabs key, or connect local Voicebox
3. (Optional) Enable Auto-Listen for the hands-free voice loop

For a source install, use `npm run settings`. Remote provider URLs must use
HTTPS; plain HTTP is accepted only for localhost services such as Voicebox.

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
2. Install the packaged Python requirements. For a global npm install:

```bash
python3 -m pip install -r "$(npm root -g)/talktocursor/requirements.txt"
```

For a source install, you can use a virtual environment:

```bash
cd talk-to-cursor
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

3. Run in a separate terminal:

```bash
talktocursor-auto-submit
```

For a source install, use `npm run auto-submit`. The launcher uses `python3`
or the executable named by `TALKTOCURSOR_PYTHON`; it does not require a
repository `.venv`.

4. Grant Accessibility permissions when prompted:
   - System Settings > Privacy & Security > Accessibility
   - Add your terminal app (Terminal.app, iTerm, or Cursor)

### Voice Input Loop Setup

Choose a voice input provider:

- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended):** Install Wispr Flow and configure its dictation hotkey.
- **[Handy](https://github.com/cjpais/Handy) (free & private):** Install and launch Handy, download a transcription model, and grant Microphone and Accessibility permissions.

Then:

1. Select your provider under **Voice Input Provider** in the settings UI
2. Enable **Voice Input Loop**
3. For Wispr Flow, configure the hotkey to match your Wispr settings
4. For Handy, leave the command blank for auto-detection or enter its executable path
5. Install PortAudio with `brew install portaudio` (the Python packages are
   already listed in `requirements.txt`)

6. Grant Microphone permissions to your terminal app
7. Run the auto-submit script (handles both auto-submit and voice input):

```bash
talktocursor-auto-submit
```

---

## Configuration

Settings and signal files are stored in a stable per-user directory so npm upgrades do not delete them: `~/Library/Application Support/TalkToCursor` on macOS, `%APPDATA%\TalkToCursor` on Windows, or `${XDG_CONFIG_HOME:-~/.config}/talktocursor` on Linux.

| Setting | Description | Default |
|---------|-------------|---------|
| `ttsProvider` | Text-to-speech provider (`elevenlabs`, `voicebox`, or `cloud`) | `elevenlabs` |
| `apiKey` | ElevenLabs API key | required for ElevenLabs |
| `voiceId` | ElevenLabs voice ID | Rachel |
| `model` | TTS model | `eleven_flash_v2_5` |
| `voiceSettings.speed` | Speech speed (0.7-1.2) | 1.0 |
| `voiceSettings.stability` | Voice stability (0-1) | 0.5 |
| `voiceSettings.similarityBoost` | Voice similarity (0-1) | 0.75 |
| `voiceSettings.style` | Style exaggeration (0-1) | 0.0 |
| `voicebox.baseUrl` | Local Voicebox API URL | `http://127.0.0.1:17493` |
| `voicebox.profile` | Voicebox profile name or ID | default binding |
| `voicebox.personality` | Use the Voicebox profile personality | false |
| `cloud.apiUrl` | TalkToCursor Cloud service URL | `https://cloud.talktocursor.com` |
| `cloud.voiceId` | Managed Google Cloud voice | `Kore` |
| `cloud.model` | Fixed managed Google Cloud model | `gemini-2.5-flash-tts` |
| `autoListen` | Auto-listen after tasks | true |
| `autoSubmit.enabled` | Auto-press Enter | false |
| `voiceInput.enabled` | Automatic voice input loop | false |
| `voiceInput.provider` | Voice input provider (`wispr` or `handy`) | `wispr` |
| `voiceInput.wisprHotkey` | Wispr Flow recording shortcut | `shift+ctrl` |
| `voiceInput.handyCommand` | Optional Handy executable path | auto-detect |

TalkToCursor Cloud voice choices are grouped in the settings UI: Male
(Alnilam, Charon, Puck, Sadaltager, Umbriel, Sadachbia) and Female (Achernar,
Despina, Kore, Leda, Sulafat, Zephyr). These managed settings do not change the
ElevenLabs BYOK voice or model.

---

## Troubleshooting

### Tool doesn't appear in Cursor
- Fully quit and restart Cursor (Cmd+Q)
- Verify `~/.cursor/mcp.json` has the correct path
- Run `npm run build` to ensure the project is compiled

### "API key not set" error
- Open settings: `talktocursor-settings` (or `npm run settings` from source)
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
| `talktocursor-settings` | Global-install settings command |
| `talktocursor-auto-submit` | Global-install auto-submit + voice loop (macOS) |

---

## License

MIT
