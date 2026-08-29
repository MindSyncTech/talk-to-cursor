#!/usr/bin/env python3
"""
Auto-Submit and Voice Input Loop for TalkToCursor

Combines two features:
1. Auto-submit: Detects when text appears in the focused field and auto-presses Enter
2. Voice input loop: Triggers Wispr Flow or Handy after TTS and stops after silence

How it works:
  - Monitors the focused text field via Accessibility API for auto-submit
  - Uses fresh pasteboard plus keyboard-event observations when Cursor hides it
  - Watches for listen-signal.json from the MCP server
  - When signaled, starts the configured provider and monitors mic for silence
  - Registers a manual trigger hotkey to start voice input anytime

Requires macOS Accessibility and Input Monitoring permissions:
  System Settings > Privacy & Security > Accessibility / Input Monitoring
"""

import time
import json
import os
import sys
import threading
import subprocess
import shlex
from pathlib import Path

if sys.platform != 'darwin':
    print("ERROR: TalkToCursor auto-submit and voice input are supported only on macOS.", file=sys.stderr)
    sys.exit(1)

# PyObjC can register framework Python as a foreground application when the
# Accessibility APIs initialize. LaunchAgents should remain dockless.
if os.environ.get('XPC_SERVICE_NAME') == 'com.mindsynctech.talktocursor.background':
    try:
        from AppKit import (
            NSApp,
            NSApplication,
        NSApplicationActivationPolicyProhibited,
            NSBundle,
        NSPasteboard,
        NSPasteboardTypeString,
        )

        bundle_info = NSBundle.mainBundle().infoDictionary()
        bundle_info['LSUIElement'] = True
        bundle_info['LSBackgroundOnly'] = True
        NSApplication.sharedApplication()
        NSApp.setActivationPolicy_(NSApplicationActivationPolicyProhibited)
    except Exception as error:
        print(f"[background-helper] Could not hide Dock icon: {error}")

try:
    from AppKit import NSWorkspace
    from ApplicationServices import (
        AXUIElementCreateSystemWide,
        AXUIElementCopyAttributeValue,
        AXUIElementSetAttributeValue,
        AXIsProcessTrusted,
        AXIsProcessTrustedWithOptions,
        kAXTrustedCheckOptionPrompt,
    )
    from pynput.keyboard import Key, KeyCode, Controller, GlobalHotKeys, Listener
    from submit_phrase import strip_trailing_submit_phrase
except ImportError as error:
    package_root = Path(os.environ.get(
        'TALKTOCURSOR_PACKAGE_ROOT',
        Path(__file__).resolve().parent.parent,
    ))
    requirements = package_root / 'requirements.txt'
    print(f"ERROR: Missing Python dependency: {error}", file=sys.stderr)
    print(
        f'Install auto-submit dependencies with: '
        f'{sys.executable} -m pip install -r "{requirements}"',
        file=sys.stderr,
    )
    sys.exit(1)

# ─── Configuration ───────────────────────────────────────────────────────────

def user_data_dir():
    override = os.environ.get('TALKTOCURSOR_DATA_DIR')
    if override:
        return Path(override).expanduser()
    if sys.platform == 'darwin':
        return Path.home() / 'Library' / 'Application Support' / 'TalkToCursor'
    if sys.platform == 'win32':
        return Path(os.environ.get('APPDATA', Path.home() / 'AppData' / 'Roaming')) / 'TalkToCursor'
    return Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'talktocursor'

USER_DATA_DIR = user_data_dir()
USER_DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
try:
    USER_DATA_DIR.chmod(0o700)
except OSError:
    pass

CONFIG_PATH = USER_DATA_DIR / 'config.json'
SIGNAL_PATH = USER_DATA_DIR / 'listen-signal.json'
TTS_COMPLETE_PATH = USER_DATA_DIR / 'tts-complete.json'
TTS_STATE_PATH = USER_DATA_DIR / 'tts-state.json'
PACKAGE_ROOT = Path(os.environ.get(
    'TALKTOCURSOR_PACKAGE_ROOT',
    Path(__file__).resolve().parent.parent,
))
LEGACY_CONFIG_PATH = PACKAGE_ROOT / 'config.json'

def migrate_legacy_config():
    if CONFIG_PATH.exists() or not LEGACY_CONFIG_PATH.exists():
        return
    try:
        content = LEGACY_CONFIG_PATH.read_text(encoding='utf-8')
        json.loads(content)
        temporary = CONFIG_PATH.with_suffix(f'.{os.getpid()}.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.chmod(0o600)
        os.replace(temporary, CONFIG_PATH)
        LEGACY_CONFIG_PATH.unlink()
        print(f"[config] Migrated settings to {CONFIG_PATH}")
    except (OSError, json.JSONDecodeError) as error:
        print(f"[config] Could not migrate legacy settings: {error}")

migrate_legacy_config()

def load_config():
    defaults = {
        'autoSubmit': {
            'enabled': False,
            'mode': 'fixed',
            'silenceDelay': 3.0,
            'minTextLength': 15,
            'targetApp': 'Cursor',
            'smartCandidateSilence': 0.8,
            'smartTurnThreshold': 0.5,
            'smartMaxSilence': 3.0,
            'smartTextDelay': 0.2,
            'submitCommandEnabled': True,
            'submitPhrase': 'send it',
        },
        'voiceInput': {
            'enabled': False,
            'provider': 'wispr',
            'silenceThreshold': 0.005,
            'silenceDuration': 2.0,
            'wisprHotkey': 'shift+ctrl',
            'handyCommand': '',
            'manualTriggerHotkey': 'ctrl+shift+l',
            'wakeWordEnabled': False,
            'wakePhrase': 'hey cursor',
            'wakeSensitivity': 0.5,
            'wakeChime': True,
        }
    }
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            if 'autoSubmit' in config:
                defaults['autoSubmit'].update(config['autoSubmit'])
            # Support configs created before voiceInput replaced wisprLoop.
            voice_input = config.get('voiceInput', config.get('wisprLoop', {}))
            defaults['voiceInput'].update(voice_input)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return defaults

config = load_config()

AUTO_SUBMIT_ENABLED = config['autoSubmit']['enabled']
AUTO_SUBMIT_MODE = config['autoSubmit']['mode']
SILENCE_DELAY = config['autoSubmit']['silenceDelay']
MIN_TEXT_LENGTH = config['autoSubmit']['minTextLength']
TARGET_APP = config['autoSubmit']['targetApp']
SMART_CANDIDATE_SILENCE = config['autoSubmit']['smartCandidateSilence']
SMART_TURN_THRESHOLD = config['autoSubmit']['smartTurnThreshold']
SMART_MAX_SILENCE = config['autoSubmit']['smartMaxSilence']
SMART_TEXT_DELAY = config['autoSubmit']['smartTextDelay']
SUBMIT_COMMAND_ENABLED = config['autoSubmit']['submitCommandEnabled']
SUBMIT_PHRASE = config['autoSubmit']['submitPhrase']

VOICE_INPUT_ENABLED = config['voiceInput']['enabled']
VOICE_INPUT_PROVIDER = config['voiceInput']['provider']
SILENCE_THRESHOLD = config['voiceInput']['silenceThreshold']
SILENCE_DURATION = config['voiceInput']['silenceDuration']
WISPR_HOTKEY = config['voiceInput']['wisprHotkey']
HANDY_COMMAND = config['voiceInput']['handyCommand']
MANUAL_TRIGGER_HOTKEY = config['voiceInput']['manualTriggerHotkey']
WAKE_WORD_ENABLED = config['voiceInput']['wakeWordEnabled']
WAKE_PHRASE = config['voiceInput']['wakePhrase']
WAKE_SENSITIVITY = config['voiceInput']['wakeSensitivity']
WAKE_CHIME = config['voiceInput']['wakeChime']
WAKE_CHIME_GUARD_SECONDS = 1.7

# ─── State ───────────────────────────────────────────────────────────────────

# Auto-submit state
last_text = None
last_change_time = 0.0
text_at_change_start = None
submit_timer = None
monitoring = True
voice_input_active = threading.Event()
voice_input_lock = threading.Lock()
submit_action_lock = threading.Lock()
managed_submit_pending = threading.Event()
submit_phrase_pending = threading.Event()
managed_input_observed = threading.Event()
managed_input_observed_at = 0.0
managed_submit_started = 0.0
managed_baseline_text = ""
managed_baseline_pasteboard_count = -1
managed_baseline_pasteboard_text = ""

# Controllers
ctrl = Controller()

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_frontmost_app():
    """Get the name of the currently focused application."""
    try:
        application = NSWorkspace.sharedWorkspace().frontmostApplication()
        return application.localizedName() if application else ""
    except Exception:
        return ""

def is_tts_playing():
    """Return true only for a recent active TTS state signal."""
    try:
        state = json.loads(TTS_STATE_PATH.read_text(encoding='utf-8'))
        timestamp = state.get('timestamp', '')
        if not state.get('speaking') or not timestamp:
            return False
        from datetime import datetime, timezone
        started = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - started).total_seconds()
        return 0 <= age < 120
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False

def get_focused_text():
    """Get the text content of the currently focused UI element via Accessibility API."""
    try:
        system_wide = AXUIElementCreateSystemWide()
        err, focused = AXUIElementCopyAttributeValue(
            system_wide, "AXFocusedUIElement", None
        )
        if err != 0 or focused is None:
            return None
        
        err, value = AXUIElementCopyAttributeValue(focused, "AXValue", None)
        if err != 0 or value is None:
            return None
        
        return str(value)
    except Exception:
        return None


def get_pasteboard_snapshot():
    """Return the macOS pasteboard change count and current plain text."""
    try:
        pasteboard = NSPasteboard.generalPasteboard()
        value = pasteboard.stringForType_(NSPasteboardTypeString)
        return int(pasteboard.changeCount()), str(value) if value is not None else ""
    except Exception:
        return -1, ""


def set_focused_text(value):
    """Set the focused field value through the Accessibility API."""
    try:
        system_wide = AXUIElementCreateSystemWide()
        err, focused = AXUIElementCopyAttributeValue(
            system_wide, "AXFocusedUIElement", None
        )
        if err != 0 or focused is None:
            return False
        return AXUIElementSetAttributeValue(focused, "AXValue", value) == 0
    except Exception:
        return False


def remove_spoken_submit_phrase(observed_text=None):
    current_text = get_focused_text()
    if current_text is None:
        current_text = observed_text
        if current_text is None:
            return False
    cleaned, changed = strip_trailing_submit_phrase(current_text, SUBMIT_PHRASE)
    if not changed:
        return False
    if get_focused_text() is not None and set_focused_text(cleaned):
        print(f'[auto-submit] Removed spoken command "{SUBMIT_PHRASE}"')
        return True

    removed_characters = len(current_text) - len(cleaned)
    for _ in range(removed_characters):
        ctrl.press(Key.backspace)
        ctrl.release(Key.backspace)
    print(f'[auto-submit] Removed spoken command "{SUBMIT_PHRASE}" with keyboard fallback')
    return True


def parse_hotkey(hotkey_str):
    """Parse a hotkey string like 'shift+ctrl' into Key objects."""
    parts = hotkey_str.lower().split('+')
    keys = []
    for part in parts:
        part = part.strip()
        if part == 'shift':
            keys.append(Key.shift)
        elif part == 'ctrl' or part == 'control':
            keys.append(Key.ctrl)
        elif part == 'alt' or part == 'option':
            keys.append(Key.alt)
        elif part == 'cmd' or part == 'command':
            keys.append(Key.cmd)
        elif len(part) == 1:
            keys.append(KeyCode.from_char(part))
    return keys

def press_hotkey(keys):
    """Press and release a hotkey combination."""
    # Press all keys
    for key in keys:
        ctrl.press(key)
    time.sleep(0.05)
    # Release in reverse order
    for key in reversed(keys):
        ctrl.release(key)

def wait_for_tts_completion(timeout=15.0):
    """Wait until the MCP reports that TTS playback is no longer active."""
    print("[voice-input] Waiting for TTS to complete...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_tts_playing():
            print("[voice-input] TTS playback is complete!")
            return True
        time.sleep(0.1)
    
    # Timeout - proceed anyway with a warning
    print(f"[voice-input] Warning: TTS completion timeout after {timeout}s, proceeding anyway...")
    return False

def toggle_voice_input():
    """Start or stop the configured voice input provider."""
    if VOICE_INPUT_PROVIDER == 'wispr':
        print(f"[voice-input] Pressing {WISPR_HOTKEY} to toggle Wispr Flow...")
        press_hotkey(parse_hotkey(WISPR_HOTKEY))
        return True

    if VOICE_INPUT_PROVIDER == 'handy':
        if HANDY_COMMAND:
            command = shlex.split(HANDY_COMMAND)
        elif sys.platform == 'darwin':
            command = ['/Applications/Handy.app/Contents/MacOS/Handy']
        else:
            command = ['handy']

        try:
            subprocess.run(
                [*command, '--toggle-transcription'],
                check=True,
                capture_output=True,
                text=True,
                timeout=5,
            )
            print("[voice-input] Toggled Handy transcription")
            return True
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            print(f"[voice-input] Could not control Handy: {error}")
            print("[voice-input] Make sure Handy is installed and already running.")
            return False

    print(f"[voice-input] Unknown provider: {VOICE_INPUT_PROVIDER}")
    return False

def trigger_voice_input_loop(detector_start_delay=0.0):
    """Start the configured provider, detect turn completion, then stop it."""
    global managed_baseline_text, managed_submit_started
    global managed_baseline_pasteboard_count, managed_baseline_pasteboard_text
    global managed_input_observed_at

    if not voice_input_lock.acquire(blocking=False):
        print("[voice-input] Voice input is already active; ignoring duplicate trigger")
        return

    voice_input_active.set()
    provider_active = False
    try:
        from turn_detector import TurnDetector, TurnEndReason

        detector = TurnDetector(
            mode=AUTO_SUBMIT_MODE if AUTO_SUBMIT_ENABLED else "fixed",
            user_data_dir=USER_DATA_DIR,
            silence_threshold=SILENCE_THRESHOLD,
            fixed_silence=SILENCE_DURATION,
            candidate_silence=SMART_CANDIDATE_SILENCE,
            smart_threshold=SMART_TURN_THRESHOLD,
            smart_max_silence=SMART_MAX_SILENCE,
            submit_command_enabled=(
                AUTO_SUBMIT_ENABLED
                and AUTO_SUBMIT_MODE == "smart"
                and SUBMIT_COMMAND_ENABLED
            ),
            submit_phrase=SUBMIT_PHRASE,
        )

        managed_baseline_text = get_focused_text() or ""
        (
            managed_baseline_pasteboard_count,
            managed_baseline_pasteboard_text,
        ) = get_pasteboard_snapshot()
        managed_submit_pending.clear()
        submit_phrase_pending.clear()
        managed_input_observed.clear()
        managed_input_observed_at = 0.0

        print(f"[voice-input] Starting {VOICE_INPUT_PROVIDER} voice input loop...")
        if not toggle_voice_input():
            return
        provider_active = True

        if detector_start_delay > 0:
            print(
                "[turn-detector] Transcription started; waiting for wake chime "
                "to clear before monitoring speech"
            )
            time.sleep(detector_start_delay)

        result = detector.wait_for_turn_end(verbose=True)
        if result.speech_detected:
            print(f"[voice-input] Speech complete; stopping {VOICE_INPUT_PROVIDER}...")
            if toggle_voice_input():
                provider_active = False
            if AUTO_SUBMIT_ENABLED and AUTO_SUBMIT_MODE == "smart":
                managed_submit_started = time.monotonic()
                if result.reason == TurnEndReason.SUBMIT_COMMAND:
                    submit_phrase_pending.set()
                managed_submit_pending.set()
                print(
                    "[voice-input] Waiting for transcription to settle before auto-submit"
                )
                threading.Thread(
                    target=watch_for_managed_transcription,
                    daemon=True,
                ).start()
            else:
                print(
                    "[voice-input] Transcribed text will be pasted and "
                    "auto-submit will press Enter"
                )
        else:
            print("[voice-input] No speech detected; cancelling")
            if toggle_voice_input():
                provider_active = False
    except Exception as error:
        print(f"[voice-input] Turn detection failed: {error}")
    finally:
        if provider_active:
            toggle_voice_input()
        voice_input_active.clear()
        voice_input_lock.release()

# ─── Auto-Submit Monitor ─────────────────────────────────────────────────────

def press_submit_key(
    *,
    require_managed_pending=False,
    managed_fresh=False,
    fallback=False,
):
    """Press Enter once, guarded by the target app and submit state."""
    global monitoring

    with submit_action_lock:
        if require_managed_pending:
            if not managed_submit_pending.is_set() or not managed_fresh:
                return False
        if get_frontmost_app() != TARGET_APP:
            if fallback:
                print(
                    f"[auto-submit] Smart Turn fallback cancelled because "
                    f"{TARGET_APP} is not frontmost"
                )
                managed_submit_pending.clear()
                submit_phrase_pending.clear()
            return False

        monitoring = False
        if fallback:
            print(
                "[auto-submit] Fresh transcription observed on the pasteboard; "
                "using guarded Smart Turn submit"
            )
            result = subprocess.run(
                [
                    "osascript",
                    "-e",
                    'tell application "System Events" to key code 36',
                ],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if result.returncode != 0:
                print(
                    "[auto-submit] System Events submit failed; "
                    "falling back to direct keyboard input"
                )
                ctrl.press(Key.enter)
                ctrl.release(Key.enter)
        else:
            ctrl.press(Key.enter)
            ctrl.release(Key.enter)
        time.sleep(0.5)
        monitoring = True
        managed_submit_pending.clear()
        submit_phrase_pending.clear()
        return True


def watch_for_managed_transcription():
    """Submit only after a fresh, stable dictation pasteboard value is observed."""
    observed_count = managed_baseline_pasteboard_count
    observed_text = None
    observed_at = 0.0
    deadline = managed_submit_started + 10.0

    while managed_submit_pending.is_set() and time.monotonic() < deadline:
        if get_frontmost_app() != TARGET_APP:
            print(
                f"[auto-submit] Managed submit cancelled because "
                f"{TARGET_APP} is not frontmost"
            )
            managed_submit_pending.clear()
            submit_phrase_pending.clear()
            return

        count, text = get_pasteboard_snapshot()
        if (
            count > managed_baseline_pasteboard_count
            and count != observed_count
            and text.strip()
            and text != managed_baseline_pasteboard_text
        ):
            observed_count = count
            observed_text = text
            observed_at = time.monotonic()

        if (
            observed_text is not None
            and managed_input_observed.is_set()
            and time.monotonic() - max(
                observed_at,
                managed_input_observed_at,
            ) >= SMART_TEXT_DELAY
        ):
            cleaned, command_in_text = strip_trailing_submit_phrase(
                observed_text,
                SUBMIT_PHRASE,
            )
            fresh_length = len(cleaned.strip() if command_in_text else observed_text.strip())
            command_requested = submit_phrase_pending.is_set()
            if fresh_length >= MIN_TEXT_LENGTH or (
                command_requested and fresh_length > 0
            ):
                do_submit(
                    fresh_length,
                    managed=True,
                    fresh_text=observed_text,
                    fallback=True,
                )
                return
        time.sleep(0.05)

    if managed_submit_pending.is_set():
        print("[auto-submit] No fresh transcription observed; submit cancelled")
        managed_submit_pending.clear()
        submit_phrase_pending.clear()


def do_submit(new_text_length, managed=False, fresh_text=None, fallback=False):
    """Press Enter if conditions are met."""
    global submit_timer
    submit_timer = None

    app = get_frontmost_app()
    if app != TARGET_APP:
        if managed:
            print(
                f"[auto-submit] Managed submit cancelled because "
                f"{TARGET_APP} is not frontmost"
            )
            managed_submit_pending.clear()
            submit_phrase_pending.clear()
        return

    command_requested = submit_phrase_pending.is_set()
    if command_requested:
        remove_spoken_submit_phrase(fresh_text)
        current_text = get_focused_text()
        if current_text is not None:
            new_text_length = len(current_text) - len(managed_baseline_text)
        elif fresh_text is not None:
            cleaned, changed = strip_trailing_submit_phrase(
                fresh_text,
                SUBMIT_PHRASE,
            )
            if changed:
                new_text_length = len(cleaned.strip())

    if new_text_length <= 0 or (
        new_text_length < MIN_TEXT_LENGTH and not command_requested
    ):
        managed_submit_pending.clear()
        submit_phrase_pending.clear()
        return

    print(f"[auto-submit] Dictation detected ({new_text_length} new chars), submitting...")
    time.sleep(0.15)
    press_submit_key(
        require_managed_pending=managed,
        managed_fresh=(new_text_length > 0),
        fallback=fallback,
    )

def monitor_text_field():
    """Poll the focused text field for changes (auto-submit monitor)."""
    global last_text, last_change_time, text_at_change_start, submit_timer, monitoring
    
    while True:
        if not AUTO_SUBMIT_ENABLED or not monitoring:
            time.sleep(0.2)
            continue
        if AUTO_SUBMIT_MODE == "smart" and voice_input_active.is_set():
            time.sleep(0.05)
            continue
            
        try:
            current_text = get_focused_text()
            
            if current_text is None:
                time.sleep(0.15)
                continue

            now = time.time()
            if managed_submit_pending.is_set():
                if time.monotonic() - managed_submit_started > 10:
                    print("[auto-submit] Timed out waiting for transcription")
                    managed_submit_pending.clear()
                    submit_phrase_pending.clear()
                    last_text = current_text
                    continue
                if current_text != last_text:
                    last_text = current_text
                    last_change_time = now
                    continue
                if (
                    current_text != managed_baseline_text
                    and now - last_change_time >= SMART_TEXT_DELAY
                ):
                    do_submit(
                        len(current_text) - len(managed_baseline_text),
                        managed=True,
                    )
                time.sleep(0.05)
                continue
            
            # Detect text change
            if current_text != last_text:
                # If this is the start of a new burst of changes, record the baseline
                if text_at_change_start is None:
                    text_at_change_start = last_text or ""
                
                new_chars = len(current_text) - len(text_at_change_start)
                
                last_text = current_text
                last_change_time = now
                
                # Cancel any pending submit
                if submit_timer is not None:
                    submit_timer.cancel()
                
                # Only schedule submit if meaningful text was added
                if new_chars >= MIN_TEXT_LENGTH:
                    submit_timer = threading.Timer(SILENCE_DELAY, do_submit, args=[new_chars])
                    submit_timer.daemon = True
                    submit_timer.start()
                
        except Exception as e:
            pass
        
        time.sleep(0.15)  # Poll ~7 times per second

# ─── Voice Input Signal Watcher ─────────────────────────────────────────────

def watch_for_signals():
    """Watch for listen-signal.json and trigger the voice input loop."""
    while True:
        if not VOICE_INPUT_ENABLED:
            time.sleep(0.5)
            continue
        
        try:
            if os.path.exists(SIGNAL_PATH):
                print("[voice-input] Listen signal detected!")
                
                # Delete the signal file
                os.remove(SIGNAL_PATH)
                
                # Wait for TTS to actually finish playing
                wait_for_tts_completion()
                
                # Start the voice input loop in a separate thread so we don't block
                threading.Thread(target=trigger_voice_input_loop, daemon=True).start()
        
        except Exception as e:
            print(f"[voice-input] Error: {e}")
        
        time.sleep(0.3)  # Poll for signal file every 300ms

# ─── Manual Trigger Hotkey ──────────────────────────────────────────────────

def setup_managed_input_observer():
    """Observe text-producing key events during managed dictation."""
    def on_press(key):
        global managed_input_observed_at
        managed_input_expected = (
            voice_input_active.is_set() or managed_submit_pending.is_set()
        )
        if not managed_input_expected or get_frontmost_app() != TARGET_APP:
            return
        if isinstance(key, KeyCode) and key.char:
            managed_input_observed_at = time.monotonic()
            managed_input_observed.set()

    observer = Listener(on_press=on_press)
    observer.start()
    return observer


def setup_manual_trigger():
    """Register a global hotkey to manually trigger the voice input loop."""
    if not VOICE_INPUT_ENABLED:
        return None
    
    # Convert hotkey string to format expected by GlobalHotKeys
    # e.g., "ctrl+shift+l" -> '<ctrl>+<shift>+l'
    parts = MANUAL_TRIGGER_HOTKEY.lower().split('+')
    formatted_parts = []
    for part in parts:
        part = part.strip()
        if part in ['shift', 'ctrl', 'control', 'alt', 'option', 'cmd', 'command']:
            formatted_parts.append(f'<{part}>')
        else:
            formatted_parts.append(part)
    formatted_hotkey = '+'.join(formatted_parts)
    
    def on_manual_trigger():
        print("[voice-input] Manual trigger activated!")
        threading.Thread(target=trigger_voice_input_loop, daemon=True).start()
    
    try:
        hotkeys = GlobalHotKeys({
            formatted_hotkey: on_manual_trigger
        })
        hotkeys.start()
        return hotkeys
    except Exception as e:
        print(f"[voice-input] Failed to register manual trigger hotkey: {e}")
        return None

# ─── Wake Word ───────────────────────────────────────────────────────────────

def wake_word_should_pause():
    return voice_input_active.is_set() or is_tts_playing()

def on_wake_word_detected():
    if WAKE_CHIME:
        try:
            subprocess.Popen(
                ['afplay', '/System/Library/Sounds/Glass.aiff'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError:
            pass
    trigger_voice_input_loop(
        WAKE_CHIME_GUARD_SECONDS if WAKE_CHIME else 0.0
    )

def run_wake_word_listener():
    try:
        from wake_word import listen_for_wake_phrase
        listen_for_wake_phrase(
            user_data_dir=USER_DATA_DIR,
            phrase=WAKE_PHRASE,
            sensitivity=WAKE_SENSITIVITY,
            should_pause=wake_word_should_pause,
            on_detected=on_wake_word_detected,
        )
    except ImportError as error:
        print(f"[wake-word] Missing dependency: {error}")
        print(f'[wake-word] Install dependencies with: {sys.executable} -m pip install -r "{PACKAGE_ROOT / "requirements.txt"}"')
    except Exception as error:
        print(f"[wake-word] Could not start: {error}")

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    managed_input_observer = None
    manual_hotkey = None

    # Check accessibility permissions
    if not AXIsProcessTrusted():
        AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: True})
        print("  ERROR: Accessibility permissions not granted!")
        print("  Go to: System Settings > Privacy & Security > Accessibility")
        print("  Allow the TalkToCursor Python helper (or your terminal for manual runs)")
        print()
        print("  The script will continue but may not work correctly.")
        print()

    print(f"""
  TalkToCursor Auto-Submit & Voice Input
  ───────────────────────────────────────
  
  Auto-Submit: {'Enabled' if AUTO_SUBMIT_ENABLED else 'Disabled'}
    Turn detection:  {AUTO_SUBMIT_MODE}
    Submit delay:    {SILENCE_DELAY}s
    Min text length: {MIN_TEXT_LENGTH} chars
    Target app:      {TARGET_APP}
    Submit command:  {SUBMIT_PHRASE if SUBMIT_COMMAND_ENABLED else 'disabled'}
  
  Voice Input: {'Enabled' if VOICE_INPUT_ENABLED else 'Disabled'}
    Provider:        {VOICE_INPUT_PROVIDER}
    Silence thresh:  {SILENCE_THRESHOLD}
    Silence duration: {SILENCE_DURATION}s
    Wispr hotkey:    {WISPR_HOTKEY if VOICE_INPUT_PROVIDER == 'wispr' else 'n/a'}
    Handy command:   {HANDY_COMMAND or 'auto-detect'}
    Manual trigger:  {MANUAL_TRIGGER_HOTKEY}

  Wake Phrase: {'Enabled' if WAKE_WORD_ENABLED else 'Disabled'}
    Phrase:          {WAKE_PHRASE}
    Sensitivity:     {WAKE_SENSITIVITY}
    Activation chime: {'Enabled' if WAKE_CHIME else 'Disabled'}

  Press Ctrl+C to stop.
""")

    # Start monitors in separate threads
    if AUTO_SUBMIT_ENABLED:
        managed_input_observer = setup_managed_input_observer()
        text_monitor = threading.Thread(target=monitor_text_field, daemon=True)
        text_monitor.start()
        print("[auto-submit] Text field monitor started")
    
    if VOICE_INPUT_ENABLED:
        signal_watcher = threading.Thread(target=watch_for_signals, daemon=True)
        signal_watcher.start()
        print("[voice-input] Signal watcher started")
        
        manual_hotkey = setup_manual_trigger()
        if manual_hotkey:
            print(f"[voice-input] Manual trigger registered: {MANUAL_TRIGGER_HOTKEY}")

        if WAKE_WORD_ENABLED:
            wake_listener = threading.Thread(
                target=run_wake_word_listener,
                daemon=True,
            )
            wake_listener.start()
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[main] Stopped.")
    finally:
        managed_submit_pending.clear()
        submit_phrase_pending.clear()
        if managed_input_observer is not None:
            managed_input_observer.stop()
        if manual_hotkey is not None:
            manual_hotkey.stop()

if __name__ == '__main__':
    main()
