# Changelog

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
