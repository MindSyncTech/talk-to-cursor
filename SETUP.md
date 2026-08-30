# Quick Setup Guide

Follow these steps to configure TalkToCursor after installing it.

## Step 0: Connect Your Coding Host

Follow the host-specific MCP instructions in [INSTALL.md](INSTALL.md#choose-your-coding-host):

- Cursor uses `~/.cursor/mcp.json`
- Claude Code uses `claude mcp add --scope user talktocursor -- npx -y --prefer-online talktocursor@latest`
- Codex uses `~/.codex/config.toml` or `codex mcp add`
- Antigravity uses the active raw configuration opened from its MCP management screen
- Other hosts must support local stdio MCP servers

## Step 1: Choose Your Text-to-Speech Provider

- **[TalkToCursor Cloud](https://cloud.talktocursor.com):** Create a free account to pair devices and manually upload or download portable preferences. The optional $15/month plan adds managed Google Cloud TTS with 100,000 characters, up to 10 project/host profiles with automatic conflict-safe sync and rollback, pronunciation rules, device budgets, up to 12 billing periods of analytics, CSV export, and in-app plus optional email allowance alerts. No provider API key is stored locally.
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor):** Create an API key for full voice and model controls.
- **[Voicebox](https://github.com/jamiepine/voicebox) (free & local):** Install and run Voicebox, download a model, and create a voice profile.

TalkToCursor Cloud uses the fixed `gemini-2.5-flash-tts` model and defaults to the Kore voice.

## Step 2: Configure TalkToCursor

Run `talktocursor-settings` (or `npm run settings` from a source checkout),
open **http://localhost:3847**, select your TTS provider, and configure it
there. Remote service URLs must use HTTPS; HTTP is allowed only for localhost.

If using ElevenLabs, you can alternatively add environment variables:

Open your shell profile file:
```bash
# For zsh (default on macOS)
nano ~/.zshrc

# OR for bash
nano ~/.bashrc
```

Add these lines at the end:
```bash
export ELEVENLABS_API_KEY="sk_your_actual_api_key_here"
export ELEVENLABS_VOICE_ID="21m00Tcm4TlvDq8ikWAM"  # Rachel voice (optional)
```

Save and reload:
```bash
source ~/.zshrc  # or ~/.bashrc
```

Verify it's set:
```bash
echo $ELEVENLABS_API_KEY
```

## Step 3: Restart Your Coding Host

Completely quit and restart the coding host so it reloads the MCP server.

1. Quit Cursor, Claude Code, Codex, Antigravity, or your other host
2. Reopen it and check its MCP tools

## Step 4: Test It!

1. Open a new agent conversation
2. Check the host’s MCP tools for `speak`
3. Type: **"Use the speak tool to say hello"**
4. Listen for the voice through your speakers.

## Step 5: Try Voice-to-Voice Coding

1. Install and open [Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended) or [Handy](https://github.com/cjpais/Handy) (free and private)
2. Select it under **Voice Input Provider** in the TalkToCursor settings UI
3. Install PortAudio with `brew install portaudio` and turn on **Enable Voice Input**
4. Click **Install & Start Background Helper** under **Cursor Hands-Free Background Helper**. It creates
   a private Python environment, runs invisibly, and starts at login.
5. Grant Accessibility, Input Monitoring, and Microphone permissions to the helper.
6. Optionally enable **Wake Phrase** and choose a phrase such as "Hey Cursor."
   The first launch downloads a local English keyword model of about 20 MB.
7. Speak a coding request: "Refactor the login function"
8. The agent will narrate what it's doing and listen for your next request

The automatic voice-input loop is designed for Cursor on macOS. Claude Code, Codex, and Antigravity users may prefer their native voice input.

For manual operation, install `requirements.txt` and run
`talktocursor-auto-submit` (or `npm run auto-submit` from source).
Auto-submit and the voice-input loop require macOS.

Auto-Submit offers **Fixed Pause** and **Smart Turn** modes. Smart Turn runs a
verified local endpoint model after a short pause, continues listening when a
thought appears unfinished, and falls back to a maximum silence timeout. Its
8.7 MB model downloads once on first use. The optional spoken **"send it"**
command ends the turn immediately and is removed from the prompt before Enter.

## What You Need to Configure

- **MCP Server:** add `talktocursor` using the host-specific configuration in `INSTALL.md`
- **TTS provider:** choose ElevenLabs, Voicebox, or TalkToCursor Cloud
- **Voice rule (optional):** add a rule controlling when the agent speaks
- **Audio playback:** install `mpv` with Homebrew if it is not available

## Troubleshooting

**Tool doesn't appear?**
- Fully quit and restart the coding host
- Check its MCP configuration using the host-specific instructions in `INSTALL.md`
- In Claude Code, run `claude mcp list`
- In Codex, run `codex mcp list`
- In Antigravity on macOS, use an absolute `npx` path if the GUI cannot find it

**"API key not set" error?**
- Verify: `echo $ELEVENLABS_API_KEY` shows your key
- Restart the coding host after setting the env var

**No audio?**
- Check system volume
- Test mpv: `mpv --version`
- Check speaker output in System Settings

## Next Steps

- Browse more voices at [ElevenLabs](https://try.elevenlabs.io/talktocursor)
- Check your usage at [ElevenLabs](https://try.elevenlabs.io/talktocursor)
- Read the full [README](README.md)

Enjoy coding by voice.
