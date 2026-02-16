# TalkToCursor

**[talktocursor.com](https://talktocursor.com)**

A hands-free voice interface for Cursor AI. Your coding assistant speaks progress updates, completions, and responses aloud using ElevenLabs TTS, enabling fully voice-driven coding workflows.

## Features

- 🔊 **Text-to-Speech** - Agent speaks aloud via ElevenLabs API
- 🎛️ **Settings UI** - Web interface to configure API key, voice, and speech parameters
- ⚡ **Auto-Submit** - Optional: automatically press Enter when dictation finishes (hands-free)
- 🎨 **Voice Presets** - Quick settings for fast, slow, expressive, stable, and dramatic speech
- 🔧 **Configurable** - Speed, stability, similarity boost, and style exaggeration controls

## Installation

### 1. Clone or download this repository

```bash
git clone https://github.com/yourusername/cursor-tts-mcp.git
cd cursor-tts-mcp
```

Or download and extract the ZIP.

### 2. Install dependencies

```bash
npm install
```

### 3. Build the project

```bash
npm run build
```

### 4. Configure Cursor to use the MCP server

Edit (or create) `~/.cursor/mcp.json`:

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

**Important:** Replace `/ABSOLUTE/PATH/TO/cursor-tts-mcp` with the actual full path to where you cloned/downloaded this project.

For example:
- macOS/Linux: `/Users/yourname/cursor-tts-mcp/build/index.js`
- Windows: `C:\\Users\\yourname\\cursor-tts-mcp\\build\\index.js`

### 5. Get your ElevenLabs API key

1. Go to [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys)
2. Sign up or log in (free tier available)
3. Create a new API key and copy it

### 6. Configure the MCP server

Open the settings UI:

```bash
npm run settings
```

Then open http://localhost:3847 in your browser and:
1. Paste your ElevenLabs API key
2. Click "Test Key" to verify it works
3. Click "Save API Key"
4. (Optional) Choose a voice, model, and voice settings
5. (Optional) Enable Auto-Submit if you want hands-free dictation

### 7. Restart Cursor

**Fully quit Cursor** (Cmd+Q on Mac, or close completely on Windows/Linux) and reopen it.

### 8. Test it

1. Open a new Cursor chat (Cmd+L)
2. Check that the `speak` or `user-tts-speak` tool appears in "Available Tools"
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

**Quick Presets:**
- Default - Balanced settings
- Fast - Quick and energetic
- Slow - Clear and measured
- Expressive - Dynamic and varied
- Stable - Consistent tone
- Dramatic - Maximum style

## Auto-Submit (Optional)

For completely hands-free dictation:

1. Enable "Auto-Submit" in the settings UI
2. Adjust the silence delay (how long to wait after you stop speaking)
3. Save the settings
4. Run in a separate terminal:

```bash
npm run auto-submit
```

**Requirements:**
- macOS only (uses Accessibility API)
- Grant Accessibility permissions: System Settings > Privacy & Security > Accessibility > Add your terminal app

The script monitors the text field and automatically presses Enter when dictation finishes.

## Configuration Files

- **`config.json`** - Stores API key, voice settings, and auto-submit preferences
- **`~/.cursor/mcp.json`** - Registers the MCP server with Cursor
- **`~/.cursor/rules/voice-feedback.mdc`** - Controls when the agent speaks

## Troubleshooting

**Tool doesn't appear in Cursor?**
- Make sure you fully quit and restarted Cursor (Cmd+Q)
- Check that `~/.cursor/mcp.json` has the correct absolute path
- Run `npm run build` to ensure the project is compiled

**"API key not set" error?**
- Open the settings UI: `npm run settings`
- Enter your ElevenLabs API key and click "Save API Key"
- Restart Cursor

**No audio?**
- Check system volume and speaker output
- Verify `mpv` is installed: `mpv --version` (installed automatically by ElevenLabs SDK)
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

## Links

- **Website:** [talktocursor.com](https://talktocursor.com)
- **npm:** [npmjs.com/package/talktocursor](https://www.npmjs.com/package/talktocursor)

## License

MIT — see [LICENSE](LICENSE)

## Credits

- [ElevenLabs](https://elevenlabs.io) for TTS API
- [Model Context Protocol](https://modelcontextprotocol.io) for MCP SDK
