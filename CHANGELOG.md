# Changelog

## Unreleased

- Added Cloud dictation: paid Cloud accounts can choose **Cloud: Deepgram
  Nova-3** as the built-in voice input's Speech Model. Audio streams from your
  Mac directly to Deepgram, and the plan includes 500 dictation minutes per
  billing period. If Cloud can't be reached or the minutes run out, that turn
  is transcribed by a local model you've already downloaded.
- The Cloud Account card shows dictation minutes left alongside characters.
- Added an optional **Send Sound** that plays when TalkToCursor sends your
  message, with a choice of sounds. It can play after “send it”, after
  Auto-Submit, or both.
- The Activation Chime can now use a different sound instead of the built-in
  two-note chime.
- Fixed a glitch in the activation chime with Auto-Submit on. The Smart Turn,
  voice activity, and spoken submit command models now load once when the
  Background Helper starts instead of on every activation, so listening also
  starts a little sooner.
- Added 29 TalkToCursor UI sounds (clicks, confirmations, dings, message sent,
  pending review, question/error, and success jingles), loudness-matched to
  the macOS sounds and CC0-licensed from Freesound. The task completion,
  send, and activation sound pickers list them separately from the macOS
  sounds.
- Added **Instant Feedback**: TalkToCursor speaks a short acknowledgement
  ("let me take a look") the moment a prompt is sent, chosen by the kind of
  prompt and cached for your voice. With TalkToCursor Cloud, these phrases
  don't use the speech allowance. Voice prompts work through the Background
  Helper; Settings can install a Cursor or Claude Code prompt hook for typed
  prompts. The acknowledgement waits for the send sound to finish, then for
  a short, adjustable pause (0.3 seconds by default) so it sounds natural.
- Added a **Progress Updates** setting (all tasks, longer tasks only, or off)
  and a **Speaking Style** setting (casual or professional). Both are passed to
  the agent with the `speak` tool, and TalkToCursor holds back progress updates
  you've turned off.
- New defaults for new installs: Auto-Listen off, built-in voice input instead
  of Wispr Flow, and Smart Auto-Submit. Existing saved settings are kept.
- The send sound is on by default.
- Added a **Quick Replies** sound, separate from task completion: agents pass
  `"reply": true` for answers, follow-ups, and quick fixes (Ding 1 by default),
  and keep `"completion": true` and the success jingle for finished tasks and
  features. Quick replies start with the same speech-or-sound mode as Task
  Completion.
- Added an **Answers Needed** sound: agents pass `"question": true` to `speak`
  when they need your answer to continue, and a sound (Pending review 1 by
  default) plays before or instead of the question. The voice-feedback rule
  examples include the new flag.
- New default sounds: Success jingle 1 for task completion and Message sent 1
  for the send sound. Saved choices are kept.
- If `config.json` has a setting this version doesn't support, only that
  setting falls back to its default instead of every setting.

## 1.4.0 — 2026-11-01

- Added a Unix-socket connection between the MCP server and the Background
  Helper for instant listen, playback, and cancel signals, with the file-signal
  path kept as a fallback.
- Streamed speech: ElevenLabs and TalkToCursor Cloud start playing on the first
  sentence, and later sentences synthesize while earlier ones play.
- Added built-in on-device voice input (Parakeet by default, or a faster streaming model, via
  sherpa-onnx) with WebRTC echo cancellation, submitted directly without a
  clipboard round-trip.
- Added barge-in: talking over the assistant stops playback. Smart Turn now
  finishes confidently complete turns sooner, and listening starts 0.3 seconds
  after the activation chime instead of 1.7 seconds, so the first word isn't
  cut off.
- Added an Echo Cancellation toggle for headphone users and an Input Boost
  slider for quiet microphones. Both stay on this Mac and are not synced to
  Cloud profiles.
- Voice input now uses Silero voice activity detection, so fans, hum, and
  boosted-mic noise no longer count as speech, start turns, or trigger
  barge-in. The model is under 1 MB and downloads on first use.
- Added a Test microphone level meter that shows what the Background Helper
  hears after Input Boost, with a marker for the speech detection level.
- The manual trigger hotkey now plays the activation chime, and pressing it
  again while listening finishes the turn. Turns also end after two minutes so
  steady background noise can no longer keep listening open indefinitely. The
  voice input provider saves as soon as it is selected.
- The spoken “send it” command now has its own switch and works in either
  turn-detection mode, even with Auto-Submit off, so prompts submit only when
  you say it. With built-in voice input you can also say it after the text is
  typed in, until it's sent, you press Enter or Escape, move to another field,
  or leave Cursor.
- Auto-Submit is now off by default, and the Auto-Submit, Voice Input, and
  Wake Phrase switches save as soon as they are toggled.
- Built-in voice input now defaults to Parakeet. While its model is still
  downloading, the hotkey and wake phrase play an error sound instead of
  starting a turn, and the microphone meter says the model is downloading.
- The `speak` tool now always returns immediately, so the final chat response
  appears while completion speech plays. `waitForPlayback` is ignored, `listen`
  waits for queued speech to finish before Auto-Listen starts, and a failed
  speech is reported on the next `speak` call.
- The `speak` tool now reports the actual error (for example an invalid
  ElevenLabs key) instead of `[object Object]`.
- Added ElevenLabs Eleven v4, v4 Turbo, v3, and v3 Conversational to the TTS
  model list.
- TalkToCursor Cloud's optional plan is now $9/month (was $15).
- Cloud voices have their own speed setting, defaulting to 1.20x and going up to 2.00x. ElevenLabs speed is unchanged.
- Cloud voices now show common first names (for example, Emma instead of Kore), with new preview clips. Saved voice choices are unchanged.
- Added FluidVoice as a voice input provider, grouped with Handy under Other
  dictation apps. Its hotkey defaults to Right Option, and provider hotkeys now
  accept right-side modifiers such as `right_option` and named keys.
- Added a Task Completion setting on macOS: speak the final summary, play a
  system sound instead, or play a sound and then speak. Agents mark the final
  summary with the new `completion` option on `speak`; the voice-feedback rule
  examples include it.
- Hotkey fields have a Record button: click it and press the shortcut instead
  of typing key names. Left and right modifier keys are recorded separately.
- The FluidVoice hotkey can be read straight from FluidVoice's settings, and
  fills in automatically when FluidVoice is selected.
- The background helper's Restart button now waits for the new helper process
  and confirms the restart, instead of returning before it was running.
- Renamed the Manual Trigger Hotkey to Start Listening Hotkey and the provider
  hotkeys to Wispr and FluidVoice Shortcut, with clearer help text and a warning
  when the two are set to the same keys.
- Saying "send it" after dictated text appears now works with Wispr Flow,
  FluidVoice, and Handy, not just built-in voice input. It also works when you
  start Wispr or FluidVoice with their own shortcut instead of TalkToCursor's.
- New Input Channel setting for audio interfaces: choose which channel of the
  input device the helper records, instead of always channel 1. It stays on
  this Mac and isn't synced to Cloud.
- New Noise Suppression setting (on by default) filters steady background noise
  such as fans and hum before wake phrase and speech detection, for every
  voice input provider and with or without echo cancellation.
- Cloud account connection and settings Upload/Download moved to the Cloud
  page, so free accounts can sync preferences while using ElevenLabs or
  Voicebox for speech.
- Fixed manual trigger hotkeys that use named keys such as `ctrl+space` or
  `cmd+f5`, and the `control`, `option`, and `command` spellings.
- Fixed an intermittent "Bootstrap failed: 5" error when restarting the
  Background Helper after its launch settings changed.

## 1.3.0 — 2026-08-29

- Expanded free Cloud sync to include safe speech, provider, auto-submit,
  Smart Turn, voice-input, wake-phrase, and hotkey preferences while keeping
  credentials and machine-specific values local.
- Added up to 10 paid named settings profiles per account with per-project and
  coding-host assignments.
- Added automatic conflict-safe paid profile sync and rollback from up to 30
  prior versions retained for 90 days.
- Added paid-profile pronunciation dictionaries with up to 50 explicit
  user-authored word or phrase replacements.
- Added hard per-device budgets for each billing period.
- Added paid daily and per-device analytics for up to 12 billing periods, with
  in-app warnings at 80% and 95% of the included allowance.
- Added signed-in CSV usage export and optional Resend email alerts at the same
  allowance thresholds.
- Kept free account device pairing and manual safe portable sync. Credentials,
  paths, spoken text, and generated audio remain excluded.
- Added non-blocking npm update checks, install-specific update commands, and
  a manual refresh control in the local settings dashboard.
- Added Background Helper version tracking and in-place runtime, dependency,
  and LaunchAgent refresh support.
- Updated recommended `npx` configurations to request
  `talktocursor@latest` with `--prefer-online` after host restarts.

## 1.2.0 — 2026-08-29

- Added local Smart Turn detection, configurable wake phrases, and spoken
  “send it” submission.
- Added the macOS Background Helper and permissions checker for hands-free
  setup.
- Added Cloud voice previews, TTS enable/disable, optional media pausing,
  spoken-response detail, and Cloud speed/style controls. Cloud speed/style
  support also requires the corresponding Cloud server rollout.
- Serialized spoken announcements without blocking task-start work.
- Improved Auto-Listen and Auto-Submit reliability.
- Updated installation and setup documentation, including the supported host
  scope: TTS works with compatible MCP hosts; advanced hands-free controls are
  for Cursor on macOS.
