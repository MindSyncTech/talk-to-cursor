# TalkToCursor

**[talktocursor.com](https://talktocursor.com)**

A hands-free voice interface for Cursor AI. Your coding assistant speaks progress updates, completions, and responses aloud using ElevenLabs, local Voicebox, or Google-powered TalkToCursor Cloud TTS.

## Features

- **Text-to-Speech Providers** - Choose your own ElevenLabs key, local Voicebox voice cloning, or managed TalkToCursor Cloud
- **Settings UI** - Web interface to configure API key, voice, and speech parameters
- **Auto-Submit** - Optional: automatically press Enter when dictation finishes (hands-free)
- **Voice Presets** - Quick settings for fast, slow, expressive, stable, and dramatic speech
- **Configurable** - Speed, stability, similarity boost, and style exaggeration controls

## Recommended Voice Setup

TalkToCursor handles text-to-speech responses from Cursor. For speech-to-text dictation, pair it with [Wispr Flow](https://ref.wisprflow.ai/talktocursor) for a smoother hands-free coding loop.

Choose a TTS provider:
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor)** - Recommended cloud text-to-speech provider (best quality)
- **[Voicebox](https://github.com/jamiepine/voicebox)** - Free, local text-to-speech and voice cloning (manual setup)

Choose a dictation service:
- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor)** - Recommended for voice dictation and hands-free prompts
- **[Handy](https://github.com/cjpais/Handy) (free & private)** — Open-source transcription that runs locally using Whisper or Parakeet, must be installed manually.

For TTS with minimal setup, consider:
- **[TalkToCursor Cloud](https://cloud.talktocursor.com)** - Managed Google Cloud TTS for $15/month with 100,000 included characters, portable settings, and no provider API key stored on the local device.

## Installation

### 1. Install

For a global install:

```bash
npm install -g talktocursor
```

Or clone/download this repository:

```bash
git clone https://github.com/MindSyncTech/talk-to-cursor.git
cd talk-to-cursor
```

Or download and extract the ZIP.

### 2. Install and build from source (source installs only)

```bash
npm install
npm run build
```

Skip this step for a global install.

### 3. Configure Cursor to use the MCP server

Edit (or create) `~/.cursor/mcp.json`:

For a global install:

```json
{
  "mcpServers": {
    "tts": {
      "command": "talktocursor"
    }
  }
}
```

For a source install:

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

**Important:** Replace `/ABSOLUTE/PATH/TO/talk-to-cursor` with the actual full path to where you cloned/downloaded this project.

For example:
- macOS/Linux: `/Users/yourname/talk-to-cursor/build/index.js`
- Windows: `C:\\Users\\yourname\\talk-to-cursor\\build\\index.js`

### 4. Choose a text-to-speech provider

- **[TalkToCursor Cloud](https://cloud.talktocursor.com):** Connect an account for managed Google Cloud TTS without storing a provider API key locally.
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor):** Sign up and create an API key for full voice and model controls.
- **[Voicebox](https://github.com/jamiepine/voicebox) (free & local):** Install and run Voicebox, download a TTS model, and create a voice profile.

### 5. Configure the MCP server

Open the settings UI (global install):

```bash
talktocursor-settings
```

For a source install, use `npm run settings`.

Then open http://localhost:3847 in your browser and:
1. Select **ElevenLabs**, **Voicebox**, or **TalkToCursor Cloud** under Text-to-Speech Provider
2. Connect your Cloud account, save an ElevenLabs key, or connect local Voicebox
3. (Optional) Enable Auto-Submit if you want hands-free dictation

### 6. Choose a voice input provider (optional)

For the full hands-free conversational loop, choose one of these providers:

- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended)** — A polished voice-to-text experience with minimal setup.
- **[Handy](https://github.com/cjpais/Handy) (free & private)** — Open-source transcription that runs locally using Whisper or Parakeet, must be installed manually.

Install and launch your provider, select it under **Voice Input Provider** in the settings UI, enable **Voice Input Loop**, and run:

```bash
talktocursor-auto-submit
```

For a source install, use `npm run auto-submit`.

After each task, your assistant speaks the result, starts the selected provider for your next command, and submits the transcription. The automatic loop currently requires macOS.

### 7. Restart Cursor

**Fully quit Cursor** (Cmd+Q on Mac, or close completely on Windows/Linux) and reopen it.

### 8. Test it

1. Open a new Cursor chat (Cmd+L)
2. Check that the `speak` tool appears in "Available Tools"
3. Type: **"Say hello using the speak tool"**
4. You should hear the voice through your speakers!

## Usage

Once installed, the Cursor AI agent will automatically speak at key moments:
- When starting a task
- When completing a task
- When encountering errors or needing clarification
- At major progress milestones

You can customize when the agent speaks by editing `~/.cursor/rules/voice-feedback.mdc`.

## Voice Settings

The settings UI lets you adjust:

- **Speed** (0.7x - 1.2x) - How fast the speech is delivered
- **Stability** (0-1) - More consistent vs. more expressive
- **Similarity Boost** (0-1) - How closely it matches the original voice
- **Style Exaggeration** (0-1) - Amplifies the speaker's style (V2+ models)

ElevenLabs keeps its BYOK voice and model controls. TalkToCursor Cloud uses the
fixed `gemini-2.5-flash-tts` model and a fixed list of Google voices, defaulting
to Kore.

**Quick Presets:**
- Default - Balanced settings
- Fast - Quick and energetic
- Slow - Clear and measured
- Expressive - Dynamic and varied
- Stable - Consistent tone
- Dramatic - Maximum style

## Auto-Submit (Optional)

For completely hands-free dictation with Wispr Flow or Handy:

1. Enable "Auto-Submit" in the settings UI
2. Adjust the silence delay (how long to wait after you stop speaking)
3. Save the settings
4. Run in a separate terminal:

```bash
python3 -m pip install -r "$(npm root -g)/talktocursor/requirements.txt"
talktocursor-auto-submit
```

For a source install, run `python3 -m pip install -r requirements.txt`, then use
`npm run auto-submit`.

**Requirements:**
- macOS only (uses Accessibility API)
- Python 3 with dependencies from `requirements.txt`
- PortAudio for microphone-based voice input (`brew install portaudio`)
- Grant Accessibility permissions: System Settings > Privacy & Security > Accessibility > Add your terminal app

The script monitors the text field and automatically presses Enter when dictation finishes.

## Configuration Files

- **macOS:** `~/Library/Application Support/TalkToCursor/config.json`
- **Windows:** `%APPDATA%\TalkToCursor\config.json`
- **Linux:** `${XDG_CONFIG_HOME:-~/.config}/talktocursor/config.json`
- **`~/.cursor/mcp.json`** - Registers the MCP server with Cursor
- **`~/.cursor/rules/voice-feedback.mdc`** - Controls when the agent speaks

Cloud device credentials are stored in the macOS Keychain when available, with a mode-0600 user-data file fallback. They are never returned by the local settings API.

## Troubleshooting

**Tool doesn't appear in Cursor?**
- Make sure you fully quit and restarted Cursor (Cmd+Q)
- Check that `~/.cursor/mcp.json` has the correct absolute path
- Run `npm run build` to ensure the project is compiled

**"API key not set" error?**
- Open the settings UI: `talktocursor-settings` (or `npm run settings` from source)
- Enter your ElevenLabs API key and click "Save API Key"
- Restart Cursor

**No audio?**
- Check system volume and speaker output
- Install or verify `mpv`: `brew install mpv`
- Test your API key in the settings UI

**Auto-submit not working?**
- Ensure macOS Accessibility permissions are granted
- Check that Cursor is the frontmost app when dictating
- Adjust the "Min Text Length" if short dictations aren't triggering
- Increase "Silence Delay" if prompts are being submitted too early

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run settings` - Open the web settings UI
- `npm run auto-submit` - Start the auto-submit script (macOS only)
- `talktocursor-settings` - Global-install settings command
- `talktocursor-auto-submit` - Global-install auto-submit command (macOS only)

## Links

- **Website:** [talktocursor.com](https://talktocursor.com)
- **npm:** [npmjs.com/package/talktocursor](https://www.npmjs.com/package/talktocursor)

## License

MIT - see [LICENSE](LICENSE)

## Credits

- [ElevenLabs](https://try.elevenlabs.io/talktocursor) for TTS API
- [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech) for managed Cloud TTS
- [Voicebox](https://github.com/jamiepine/voicebox) for free, local text-to-speech and voice cloning
- [Handy](https://github.com/cjpais/Handy) for free, private local speech-to-text integration
- [Model Context Protocol](https://modelcontextprotocol.io) for MCP SDK

Disclosure: Some links on this page are affiliate links. They help support TalkToCursor at no extra cost to you.
