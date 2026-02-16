# Quick Setup Guide

Your Cursor TTS MCP server is fully built and configured! Follow these steps to get it working:

## Step 1: Get Your ElevenLabs API Key

1. Go to https://elevenlabs.io/app/settings/api-keys
2. Sign up or log in (free tier available)
3. Create a new API key and copy it

## Step 2: Add Environment Variables

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
4. Listen for the voice through your speakers! 🔊

## Step 5: Try Voice-to-Voice Coding

1. Open Wispr Flow (for speech-to-text input)
2. Speak a coding request: "Refactor the login function"
3. The agent will narrate what it's doing as it works
4. Follow along hands-free!

## What's Been Configured

✅ **MCP Server**: `~/cursor-tts-mcp/` (built and ready)
✅ **Cursor Config**: `~/.cursor/mcp.json` (server registered)
✅ **Voice Rule**: `~/.cursor/rules/voice-feedback.mdc` (agent knows to speak)
✅ **mpv**: Installed via Homebrew (audio playback)

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

- Browse more voices at: https://elevenlabs.io/app/voice-library
- Check your usage at: https://elevenlabs.io/app/usage
- Read the full README: `~/cursor-tts-mcp/README.md`

Enjoy coding by voice! 🎤✨
