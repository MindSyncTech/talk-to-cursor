# TalkToCursor - Installation Guide

**[talktocursor.com](https://talktocursor.com)** | **[npm](https://www.npmjs.com/package/talktocursor)** | **[GitHub](https://github.com/MindSyncTech/talk-to-cursor)**

A voice layer for MCP-compatible coding assistants. Your agent can speak progress updates through ElevenLabs, local Voicebox, or Google-powered TalkToCursor Cloud TTS, with optional alternative dictation on macOS.

---

## Choose Your Coding Host

TalkToCursor uses the same stdio MCP package in every host. Choose the configuration format your coding assistant supports.

- [Cursor setup](https://talktocursor.com/cursor-tts/)
- [Claude Code setup](https://talktocursor.com/talk-to-claude-code/)
- [OpenAI Codex setup](https://talktocursor.com/talk-to-codex/)
- [Google Antigravity setup](https://talktocursor.com/talk-to-antigravity/)
- [Other MCP-compatible hosts](https://talktocursor.com/talk-to-ide/)

## Recommended: Install With Your AI Agent

Give this prompt to Cursor or another coding agent:

> Install TalkToCursor for my current coding assistant by following
> https://github.com/MindSyncTech/talk-to-cursor/blob/main/INSTALL.md
> Configure the MCP and persistent voice-feedback instructions. Ask before
> enabling paid Cloud services or installing the macOS Background Helper.

The agent can configure files and dependencies. You may still need to restart
your coding host, sign in to a provider, approve purchases, and grant
operating-system permissions.

Requires Node.js 18 or newer. A global install is optional:

```bash
npm install -g talktocursor
```

### Cursor

Add to `~/.cursor/mcp.json`:

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

### Claude Code

Register TalkToCursor at user scope so it is available across projects:

```bash
claude mcp add --scope user talktocursor -- npx -y talktocursor
```

Omit `--scope user` to use Claude Code’s default local project scope. Run `claude mcp list` to confirm the server is registered.

### OpenAI Codex

Use Codex’s MCP command:

```bash
codex mcp add talktocursor -- npx -y talktocursor
```

Or add the equivalent entry to `~/.codex/config.toml`:

```toml
[mcp_servers.talktocursor]
command = "npx"
args = ["-y", "talktocursor"]
startup_timeout_sec = 30
```

The longer startup timeout gives the first npx download time to finish.

### Google Antigravity

Open Antigravity’s MCP Store and choose **Manage MCP servers** or **View raw config**. Add this entry to the active configuration:

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

Antigravity’s MCP config path has varied between releases, so use the file opened by the app rather than relying on a hard-coded location.

On macOS, an Antigravity app launched from the Dock or Spotlight may not inherit the shell path containing `npx`. If it reports that the executable cannot be found, replace `"npx"` with the absolute path returned by `which npx`.

### Other MCP-compatible hosts

Use the same JSON server entry shown above, adapted to your host’s local stdio MCP format. A compatible host must be able to launch Node.js commands and expose the package’s `speak` tool to the agent. Support is not implied for hosts that do not provide local stdio MCP tools.

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

Then replace the npx command in your host-specific configuration with the built server:

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

For a Codex source install, use the TOML equivalent:

```toml
[mcp_servers.talktocursor]
command = "node"
args = ["/ABSOLUTE/PATH/TO/talk-to-cursor/build/index.js"]
```

> **Important:** Replace `/ABSOLUTE/PATH/TO/talk-to-cursor` with the actual path on your machine.
>
> - macOS/Linux: `/Users/yourname/talk-to-cursor/build/index.js`
> - Windows: `C:\\Users\\yourname\\talk-to-cursor\\build\\index.js`

---

## Choose a TTS Provider

- **[TalkToCursor Cloud](https://cloud.talktocursor.com):** Managed Google Cloud TTS for $15/month with 100,000 included characters and portable settings. No provider credential is stored locally.
- **[ElevenLabs](https://try.elevenlabs.io/talktocursor):** Sign up and create an API key for full voice and model controls.
- **[Voicebox](https://github.com/jamiepine/voicebox) (free & local):** Install and run Voicebox, download a TTS model, and create a voice profile.

## Configure via the Settings UI

```bash
npx -y --package talktocursor talktocursor-settings
```

Open **http://localhost:3847** in your browser, then:

1. Select **ElevenLabs**, **Voicebox**, or **TalkToCursor Cloud** under Text-to-Speech Provider
2. Connect your Cloud account, save an ElevenLabs key, or connect local Voicebox
3. (Optional) Enable Auto-Listen for the hands-free voice loop

For a global install, use `talktocursor-settings`. For a source install, use
`npm run settings`. Remote provider URLs must use
HTTPS; plain HTTP is accepted only for localhost services such as Voicebox.

> **Alternatively**, you can set your API key via environment variable:
> ```json
> {
>   "mcpServers": {
>     "talktocursor": {
>       "command": "npx",
>       "args": ["-y", "talktocursor"],
>       "env": {
>         "ELEVENLABS_API_KEY": "your-api-key-here"
>       }
>     }
>   }
> }
> ```

## Restart Your Coding Host

Fully quit and reopen Cursor, Codex, Antigravity, or your other MCP host so it reloads the server configuration.

## Confirm the Connection

1. Open a new agent conversation.
2. Check that the `speak` tool appears in the host’s MCP tools.
3. Type: **"Use the speak tool to say hello."**
4. You should hear the selected voice through your speakers.

In Claude Code, use `claude mcp list`. In Codex, use `codex mcp list`. In Antigravity, use the MCP management panel.

---

## Configure Automatic Voice Feedback

The MCP connection exposes `speak`, but it does not force an agent to call the
tool. Add persistent instructions if you expect automatic speech at task
completion, when input is needed, or at milestones.

### Cursor

For the current project, create
`<project>/.cursor/rules/voice-feedback.mdc`. To apply the instruction to
every project, paste the same rule text into **Cursor Settings → Rules → User
Rules**. Do not rely on `~/.cursor/rules`; Cursor does not consistently load
that directory as global User Rules.

```markdown
---
description: MANDATORY voice feedback - agent MUST speak at task start and completion
alwaysApply: true
---

# Voice feedback

Use the `speak` tool at task start with `waitForPlayback: false` so work begins
immediately. Use `waitForPlayback: true` for important milestones, questions,
failures, required follow-ups, and completion.
Keep spoken updates to 1-2 sentences.
Do not read code, paths, logs, or stack traces aloud.

Before sending every final response, call the `speak` tool in the same turn
with a concise completion summary. Do this even if a task-start update was
already spoken.

Immediately after completion speech, call the `listen` tool. It safely does
nothing when Auto-Listen is disabled. Never call `listen` after task-start or
milestone speech.
```

### Claude Code

Add to the global `~/.claude/CLAUDE.md` or a project’s `CLAUDE.md`:

```markdown
## Voice feedback

Use the `speak` tool at task start, important milestones,
when asking a question, and at completion.
Keep spoken updates to 1-2 sentences.
Do not read code, paths, logs, or stack traces aloud.
```

### OpenAI Codex

Add to the applicable global `~/.codex/AGENTS.md` or project `AGENTS.md`:

```markdown
## Voice feedback

Use the `speak` tool at task start, important milestones,
when asking a question, and at completion.
Keep spoken updates to 1-2 sentences.
Do not read code, paths, logs, or stack traces aloud.
```

### Google Antigravity

Add to the global `~/.gemini/GEMINI.md`, or create an Always On Workspace Rule from Antigravity’s Customizations panel. Workspace rule files live under `.agents/rules`:

```markdown
## Voice feedback

Use the `speak` tool at task start, important milestones,
when asking a question, and at completion.
Keep spoken updates to 1-2 sentences.
Do not read code, paths, logs, or stack traces aloud.
```

---

## Optional: Hands-Free Dictation (macOS only)

For a fully hands-free experience with voice dictation. This Accessibility-based auto-submit workflow is designed for Cursor and is not claimed as verified in every MCP host. Claude Code, Codex, and Antigravity users may prefer their native voice input.

### Auto-Submit Setup

1. Enable **Auto-Submit** in the settings UI
2. Choose **Fixed Pause** or **Smart Turn**. Smart Turn uses a short audio pause
   plus a local endpoint model and supports the spoken **"send it"** command.
3. Click **Install & Start** under **Cursor Hands-Free Background Helper**. TalkToCursor
   creates a private Python environment, runs invisibly, and starts at login.
4. Grant Accessibility and Input Monitoring permissions when prompted:
   - System Settings > Privacy & Security > Accessibility and Input Monitoring
   - Allow the TalkToCursor background Python helper in both sections

To run the helper manually instead, install the packaged Python requirements.
For a global npm install:

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

Then run:

```bash
talktocursor-auto-submit
```

For a source install, use `npm run auto-submit`. The launcher uses `python3`
or the executable named by `TALKTOCURSOR_PYTHON`; it does not require a
repository `.venv`.

### Voice Input Setup

Choose a voice input provider:

- **[Wispr Flow](https://ref.wisprflow.ai/talktocursor) (recommended):** Install Wispr Flow and configure its dictation hotkey.
- **[Handy](https://github.com/cjpais/Handy) (free & private):** Install and launch Handy, download a transcription model, and grant Microphone, Accessibility, and Input Monitoring permissions.

Then:

1. Select your provider under **Voice Input Provider** in the settings UI
2. Turn on **Enable Voice Input**
3. For Wispr Flow, configure the hotkey to match your Wispr settings
4. For Handy, leave the command blank for auto-detection or enter its executable path
5. Install PortAudio with `brew install portaudio` (the Python packages are
   already listed in `requirements.txt`)

6. Grant Microphone, Accessibility, and Input Monitoring permissions to the TalkToCursor background helper
7. (Optional) Enable **Wake Phrase**, choose a phrase and sensitivity, and
   install the updated Python requirements. Detection is local; the first
   launch downloads an English keyword model of about 20 MB.
8. Ensure **Cursor Hands-Free Background Helper** shows **Running**. It handles
   auto-submit, voice input, manual hotkeys, and wake phrases.

When Smart Turn is selected, the first managed dictation downloads the pinned
Smart Turn v3.2 CPU model (about 8.7 MB), verifies its SHA-256 checksum, and
caches it locally. Audio inference stays on the Mac. If download or inference
fails, the helper uses the configured maximum-silence fallback.

---

## Configuration

Settings and signal files are stored in a stable per-user directory so npm upgrades do not delete them: `~/Library/Application Support/TalkToCursor` on macOS, `%APPDATA%\TalkToCursor` on Windows, or `${XDG_CONFIG_HOME:-~/.config}/talktocursor` on Linux.

| Setting | Description | Default |
|---------|-------------|---------|
| `ttsEnabled` | Allow spoken task updates and completions | `true` |
| `pauseMediaDuringSpeech` | Pause Apple Music or Spotify during speech on macOS | `false` |
| `spokenResponseDetail` | Spoken update length (`minimal`, `brief`, or `detailed`) | `brief` |
| `ttsProvider` | Text-to-speech provider (`elevenlabs`, `voicebox`, or `cloud`) | `cloud` |
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
| `autoSubmit.mode` | Turn detection mode (`fixed` or `smart`) | `fixed` |
| `autoSubmit.silenceDelay` | Text stability delay for fixed mode | `3.0` |
| `autoSubmit.smartCandidateSilence` | Quiet audio before a Smart Turn check | `0.8` |
| `autoSubmit.smartTurnThreshold` | Probability required to end the turn | `0.5` |
| `autoSubmit.smartMaxSilence` | Safety fallback after uncertain silence | `3.0` |
| `autoSubmit.smartTextDelay` | Text stability delay after Smart Turn | `0.2` |
| `autoSubmit.submitCommandEnabled` | Enable the spoken `send it` command | `true` |
| `voiceInput.enabled` | Automatic voice input loop | false |
| `voiceInput.provider` | Voice input provider (`wispr` or `handy`) | `wispr` |
| `voiceInput.wisprHotkey` | Wispr Flow recording shortcut | `shift+ctrl` |
| `voiceInput.handyCommand` | Optional Handy executable path | auto-detect |
| `voiceInput.wakeWordEnabled` | Always listen locally for a wake phrase | `false` |
| `voiceInput.wakePhrase` | Phrase that starts Wispr or Handy | `hey cursor` |
| `voiceInput.wakeSensitivity` | Wake-phrase detection sensitivity (0-1) | `0.5` |
| `voiceInput.wakeChime` | Play a sound before dictation starts | `true` |

TalkToCursor Cloud voice choices are grouped in the settings UI: Male
(Alnilam, Charon, Puck, Sadaltager, Umbriel, Sadachbia, Achird, Algenib,
Enceladus, Iapetus) and Female (Achernar, Despina, Kore, Leda, Sulafat,
Zephyr, Aoede, Callirrhoe, Laomedeia, Vindemiatrix). These managed settings do
not change the
ElevenLabs BYOK voice or model.

---

## Troubleshooting

### Tool doesn't appear
- Fully quit and restart the coding host
- Verify the host-specific MCP entry under [Choose Your Coding Host](#choose-your-coding-host)
- In Claude Code, run `claude mcp list`
- In Codex, run `codex mcp list`
- In Antigravity, check the MCP management panel; on macOS, use an absolute `npx` path if the GUI cannot find it
- For source installs, run `npm run build`

### "API key not set" error
- Open settings: `talktocursor-settings` (or `npm run settings` from source)
- Enter your API key and save
- Restart the coding host

### No audio output
- Check system volume and speaker output
- Verify `mpv` is installed: `brew install mpv`
- Test your API key in the settings UI

### Auto-submit not working
- Ensure macOS Accessibility and Input Monitoring permissions are granted
- Check that Cursor is the frontmost app; other hosts are not currently verified for this loop
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
