# TalkToCursor

**[talktocursor.com](https://talktocursor.com)**

A voice interface for Cursor and compatible MCP coding assistants. Your agent speaks progress updates, completions, and responses aloud using managed TalkToCursor Cloud, ElevenLabs, or local Voicebox TTS.

## Features

- **Text-to-Speech Providers** - Choose managed TalkToCursor Cloud, your own ElevenLabs key, or local Voicebox
- **Settings UI** - Connect providers, choose voices, and manage speech and hands-free settings
- **Spoken Response Detail** - Choose minimal “Done,” brief summaries, or detailed spoken updates
- **Smart Auto-Submit** - Distinguish finished prompts from thinking pauses with a small local audio model
- **Local Wake Phrases** - Start Wispr or Handy with a selectable phrase such as "Hey Cursor"
- **Provider-Aware Controls** - Cloud voice selection, ElevenLabs presets and tuning, and Voicebox profiles
- **Portable Cloud Settings** - Sync managed voice preferences across connected devices

## Coding Host Guides

TalkToCursor uses one stdio MCP package and one set of voice settings across supported hosts. Installation and persistent instruction formats differ:

- **[Cursor](https://talktocursor.com/cursor-tts/)** - Original integration with Cursor MCP rules and optional macOS hands-free dictation
- **[Claude Code](https://talktocursor.com/talk-to-claude-code/)** - Spoken output and custom voices alongside native voice dictation
- **[OpenAI Codex](https://talktocursor.com/talk-to-codex/)** - Custom/local TTS and spoken milestones alongside native Codex Voice
- **[Google Antigravity](https://talktocursor.com/talk-to-antigravity/)** - Spoken agent output alongside native live transcription
- **[Other MCP-compatible hosts](https://talktocursor.com/talk-to-ide/)** - Requirements and a generic local stdio MCP recipe

Support for an unlisted IDE is not implied. It must support local stdio MCP servers and allow the agent to call the `speak` tool.

## Recommended Voice Setup

TalkToCursor handles text-to-speech responses from the connected coding agent. Choose the provider that fits your priorities:

- **[TalkToCursor Cloud](https://cloud.talktocursor.com) (recommended for easiest setup)** - Managed Google Cloud TTS for $15/month with 100,000 included characters, portable settings, and no provider API key stored locally.
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor) (best for voice selection and control)** - Bring your own API key for a broad voice library, models, presets, and detailed tuning.
- **[Voicebox](https://github.com/jamiepine/voicebox) (free, private, and local)** - Run speech synthesis and voice cloning on your computer with manual setup.

For optional speech-to-text and the hands-free conversational loop:

- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended for easiest setup)** - Polished voice dictation with minimal configuration.
- **[Handy](https://github.com/cjpais/Handy) (free, private, and local)** - Open-source transcription using Whisper or Parakeet.

## Installation

### Recommended: install with your AI agent

Give this prompt to Cursor or another coding agent:

> Install TalkToCursor for my current coding assistant by following
> https://github.com/MindSyncTech/talk-to-cursor/blob/main/INSTALL.md
> Configure the MCP and persistent voice-feedback instructions. Ask before
> enabling paid Cloud services or installing the macOS Background Helper.

The agent can configure files and dependencies, but host restarts, account
sign-in, purchases, and operating-system permissions may still require you.

### 1. Install

The recommended setup lets your MCP host run TalkToCursor directly through `npx`, with no global install required. Skip to step 3 if you use this option.

For a global install instead:

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

### 3. Connect your coding host

For Cursor, edit (or create) `~/.cursor/mcp.json`:

Recommended `npx` configuration:

```json
{
  "mcpServers": {
    "talktocursor": {
      "command": "npx",
      "args": ["-y", "talktocursor"]
    }
  }
}
```

For OpenAI Codex:

```bash
codex mcp add talktocursor -- npx -y talktocursor
```

For Claude Code:

```bash
claude mcp add --scope user talktocursor -- npx -y talktocursor
```

For Google Antigravity, open its MCP management screen and add the same JSON entry shown for Cursor to the active raw configuration. Antigravity’s config path varies by release.

See the [full installation guide](INSTALL.md#choose-your-coding-host) for Claude Code scopes, Codex TOML, Antigravity PATH troubleshooting, generic MCP-host requirements, and source/global-install configurations.

For a global install in a JSON-based MCP host:

```json
{
  "mcpServers": {
    "talktocursor": {
      "command": "talktocursor"
    }
  }
}
```

For a source install in a JSON-based MCP host:

```json
{
  "mcpServers": {
    "talktocursor": {
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

Open the settings UI for the recommended `npx` setup:

```bash
npx -y --package talktocursor talktocursor-settings
```

For a global install:

```bash
talktocursor-settings
```

For a source install, use `npm run settings`.

Then open http://localhost:3847 in your browser and:
1. Select **TalkToCursor Cloud**, **ElevenLabs**, or **Voicebox** under Text-to-Speech Provider
2. Connect your Cloud account, save an ElevenLabs key, or connect local Voicebox
3. (Optional) Enable Auto-Submit if you want hands-free dictation

### 6. Choose a voice input provider (optional)

For the full hands-free conversational loop, choose one of these providers:

- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended)** — A polished voice-to-text experience with minimal setup.
- **[Handy](https://github.com/cjpais/Handy) (free & private)** — Open-source transcription that runs locally using Whisper or Parakeet, must be installed manually.

Install and launch your provider, select it under **Voice Input Provider**,
turn on **Enable Voice Input**, then click **Install & Start** under
**Cursor Hands-Free Background Helper**. The helper runs invisibly and starts at login.

After each task, your assistant speaks the result, starts the selected provider for your next command, and submits the transcription. You can also enable a local wake phrase to trigger Wispr or Handy at any time. The first wake-phrase launch downloads an English keyword model of about 20 MB. The automatic loop currently requires macOS and is designed for Cursor; Codex and Antigravity users may prefer native voice input.

### 7. Restart your coding host

Fully quit and reopen Cursor, Codex, Antigravity, or your other MCP host.

### 8. Test it

1. Open a new agent conversation
2. Check that the `speak` tool appears in the host’s MCP tools
3. Type: **"Use the speak tool to say hello"**
4. You should hear the voice through your speakers!

## Usage

Once configured, your coding agent can use TalkToCursor to speak:
- When starting a task
- When completing a task
- When encountering errors or needing clarification
- At major progress milestones

To encourage automatic voice feedback at these moments, add the appropriate Cursor rule, Claude Code `CLAUDE.md`, Codex `AGENTS.md`, or Antigravity global/workspace rule. See the [voice-feedback examples](INSTALL.md#configure-automatic-voice-feedback).

Use **Enable Spoken Responses** in the settings UI to pause or resume TTS without removing the `speak` tool or changing your voice-feedback instructions. On macOS, **Pause Media During Speech** can pause a playing Apple Music or Spotify session and resume only the players TalkToCursor paused.

## Voice Settings

ElevenLabs supports detailed voice controls:

- **Speed** (0.7x - 1.2x) - How fast the speech is delivered
- **Stability** (0-1) - More consistent vs. more expressive
- **Similarity Boost** (0-1) - How closely it matches the original voice
- **Style Exaggeration** (0-1) - Amplifies the speaker's style (V2+ models)

**ElevenLabs Quick Presets:**
- Default - Balanced settings
- Fast - Quick and energetic
- Slow - Clear and measured
- Expressive - Dynamic and varied
- Stable - Consistent tone
- Dramatic - Maximum style

TalkToCursor Cloud uses the fixed `gemini-2.5-flash-tts` model and a curated
list of Google voices, defaulting to Kore. Voicebox uses the profiles and models
available in your local Voicebox installation.

## Auto-Submit (Optional)

For completely hands-free dictation with Wispr Flow or Handy:

1. Enable "Auto-Submit" in the settings UI
2. Choose **Fixed Pause** or **Smart Turn**
3. Save the settings
4. Install and start the **Cursor Hands-Free Background Helper** in the settings UI

**Requirements:**
- macOS only (uses Accessibility API)
- PortAudio for microphone-based voice input (`brew install portaudio`)
- Grant Accessibility, Input Monitoring, and Microphone permissions to the background helper

Fixed Pause retains the original timer behavior. Smart Turn checks a short pause
with Pipecat's local Smart Turn v3.2 model, keeps listening when your thought
sounds unfinished, and submits quickly when it sounds complete. The verified
8.7 MB model downloads once on first use and stays under TalkToCursor's local
application data. You can also say **"send it"** to finish immediately; the
helper removes that trailing command before submission.

The helper monitors the text field and automatically presses Enter when
dictation finishes. Dictation started outside TalkToCursor continues to use the
fixed text delay. The helper can still be run manually with
`talktocursor-auto-submit` when needed.

## Configuration Files

- **macOS:** `~/Library/Application Support/TalkToCursor/config.json`
- **Windows:** `%APPDATA%\TalkToCursor\config.json`
- **Linux:** `${XDG_CONFIG_HOME:-~/.config}/talktocursor/config.json`
- **Cursor:** `~/.cursor/mcp.json`; use `<project>/.cursor/rules/voice-feedback.mdc` for a project or **Cursor Settings → Rules → User Rules** for all projects
- **Claude Code:** `claude mcp add` and optional global `~/.claude/CLAUDE.md` or project `CLAUDE.md`
- **Codex:** `~/.codex/config.toml` and optional global or project `AGENTS.md`
- **Antigravity:** use its MCP management screen for the active config; global rules use `~/.gemini/GEMINI.md` and workspace rules live under `.agents/rules`

Cloud device credentials are stored in the macOS Keychain when available, with a mode-0600 user-data file fallback. They are never returned by the local settings API.

## Troubleshooting

**Tool doesn't appear?**
- Fully quit and restart the coding host
- Check the correct host configuration in the [installation guide](INSTALL.md#choose-your-coding-host)
- In Claude Code, run `claude mcp list`
- In Codex, run `codex mcp list`
- In Antigravity on macOS, use an absolute path to `npx` if the GUI cannot find it
- For source installs, run `npm run build` to ensure the project is compiled

**Provider isn't connected?**
- Reopen the settings UI using the command for your installation method in step 5
- Connect TalkToCursor Cloud, save an ElevenLabs API key, or start Voicebox locally
- Restart the coding host

**No audio?**
- Check system volume and speaker output
- Install or verify `mpv`: `brew install mpv`
- Check the selected provider's connection status in the settings UI

**Auto-submit not working?**
- Ensure macOS Accessibility and Input Monitoring permissions are granted
- Check that Cursor is the frontmost app when dictating; other hosts are not currently verified for the Accessibility-based loop
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
- **TalkToCursor Cloud:** [cloud.talktocursor.com](https://cloud.talktocursor.com)
- **npm:** [npmjs.com/package/talktocursor](https://www.npmjs.com/package/talktocursor)
- **Support:** [support@talktocursor.com](mailto:support@talktocursor.com)

## License

MIT - see [LICENSE](LICENSE)

## Credits

- [ElevenLabs](https://try.elevenlabs.io/talktocursor) for TTS API
- [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech) for managed Cloud TTS
- [Voicebox](https://github.com/jamiepine/voicebox) for free, local text-to-speech and voice cloning
- [Handy](https://github.com/cjpais/Handy) for free, private local speech-to-text integration
- [Model Context Protocol](https://modelcontextprotocol.io) for MCP SDK

Disclosure: Some links on this page are affiliate links. They help support TalkToCursor at no extra cost to you.
