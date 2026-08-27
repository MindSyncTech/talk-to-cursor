# Quick Setup Guide

Follow these steps to configure TalkToCursor after installing it.

## Step 1: Choose Your Text-to-Speech Provider

- **[TalkToCursor Cloud](https://cloud.talktocursor.com):** Managed Google Cloud TTS for $15/month with 100,000 included characters and portable settings. No provider API key is stored locally.
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

## Step 3: Restart Cursor

**Important**: Completely quit and restart Cursor for it to load the MCP server.

1. Press `Cmd+Q` to quit Cursor
2. Reopen Cursor from Applications or Spotlight

## Step 4: Test It!

1. Open a new Cursor chat (Cmd+L)
2. Check "Available Tools" - you should see a "speak" tool
3. Type: **"Say hello using the speak tool"**
4. Listen for the voice through your speakers.

## Step 5: Try Voice-to-Voice Coding

1. Install and open [Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended) or [Handy](https://github.com/cjpais/Handy) (free and private)
2. Select it under **Voice Input Provider** in the TalkToCursor settings UI
3. Install the optional Python dependencies:
   `python3 -m pip install -r "$(npm root -g)/talktocursor/requirements.txt"`
4. Install PortAudio with `brew install portaudio`, enable **Voice Input Loop**,
   and run `talktocursor-auto-submit`
5. Speak a coding request: "Refactor the login function"
6. The agent will narrate what it's doing and listen for your next request

For a source checkout, install `requirements.txt` directly and use
`npm run auto-submit`. Auto-submit and the voice-input loop require macOS.

## What You Need to Configure

- **MCP Server:** add `talktocursor` to `~/.cursor/mcp.json`
- **TTS provider:** choose ElevenLabs, Voicebox, or TalkToCursor Cloud
- **Voice rule (optional):** add a rule controlling when the agent speaks
- **Audio playback:** install `mpv` with Homebrew if it is not available

## Troubleshooting

**Tool doesn't appear?**
- Make sure you fully quit and restarted Cursor (Cmd+Q)
- Check the MCP config exists: `cat ~/.cursor/mcp.json`

**"API key not set" error?**
- Verify: `echo $ELEVENLABS_API_KEY` shows your key
- Restart Cursor after setting the env var

**No audio?**
- Check system volume
- Test mpv: `mpv --version`
- Check speaker output in System Settings

## Next Steps

- Browse more voices at [ElevenLabs](https://try.elevenlabs.io/talktocursor)
- Check your usage at [ElevenLabs](https://try.elevenlabs.io/talktocursor)
- Read the full [README](README.md)

Enjoy coding by voice.
