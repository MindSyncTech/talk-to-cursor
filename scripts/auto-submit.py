#!/usr/bin/env python3
"""
Auto-Submit and Voice Input Loop for TalkToCursor

Combines two features:
1. Auto-submit: Detects when text appears in the focused field and auto-presses Enter
2. Voice input loop: Triggers Wispr Flow or Handy after TTS and stops after silence

How it works:
  - Monitors the focused text field via Accessibility API for auto-submit
  - Watches for listen-signal.json from the MCP server
  - When signaled, starts the configured provider and monitors mic for silence
  - Registers a manual trigger hotkey to start voice input anytime

Requires macOS Accessibility permissions:
  System Settings > Privacy & Security > Accessibility
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

try:
    from ApplicationServices import (
        AXUIElementCreateSystemWide,
        AXUIElementCopyAttributeValue,
        AXIsProcessTrusted,
    )
    from pynput.keyboard import Key, KeyCode, Controller, GlobalHotKeys
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
            'silenceDelay': 3.0,
            'minTextLength': 15,
            'targetApp': 'Cursor',
        },
        'voiceInput': {
            'enabled': False,
            'provider': 'wispr',
            'ttsDelay': 4.0,
            'silenceThreshold': 0.02,
            'silenceDuration': 2.0,
            'wisprHotkey': 'shift+ctrl',
            'handyCommand': '',
            'manualTriggerHotkey': 'ctrl+shift+l',
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
SILENCE_DELAY = config['autoSubmit']['silenceDelay']
MIN_TEXT_LENGTH = config['autoSubmit']['minTextLength']
TARGET_APP = config['autoSubmit']['targetApp']

VOICE_INPUT_ENABLED = config['voiceInput']['enabled']
VOICE_INPUT_PROVIDER = config['voiceInput']['provider']
TTS_DELAY = config['voiceInput']['ttsDelay']
SILENCE_THRESHOLD = config['voiceInput']['silenceThreshold']
SILENCE_DURATION = config['voiceInput']['silenceDuration']
WISPR_HOTKEY = config['voiceInput']['wisprHotkey']
HANDY_COMMAND = config['voiceInput']['handyCommand']
MANUAL_TRIGGER_HOTKEY = config['voiceInput']['manualTriggerHotkey']

# ─── State ───────────────────────────────────────────────────────────────────

# Auto-submit state
last_text = None
last_change_time = 0.0
text_at_change_start = None
submit_timer = None
monitoring = True

# Controllers
ctrl = Controller()

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_frontmost_app():
    """Get the name of the currently focused application."""
    try:
        result = subprocess.run(
            ['osascript', '-e',
             'tell application "System Events" to get name of first application process whose frontmost is true'],
            capture_output=True, text=True, timeout=2
        )
        return result.stdout.strip()
    except Exception:
        return ""

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
    """Wait for the TTS completion signal file with timeout."""
    print("[voice-input] Waiting for TTS to complete...")
    start_time = time.time()
    
    # Clear any stale completion signal first
    if os.path.exists(TTS_COMPLETE_PATH):
        try:
            os.remove(TTS_COMPLETE_PATH)
        except:
            pass
    
    while (time.time() - start_time) < timeout:
        if os.path.exists(TTS_COMPLETE_PATH):
            print("[voice-input] TTS completion signal received!")
            # Delete the completion signal
            try:
                os.remove(TTS_COMPLETE_PATH)
            except:
                pass
            return True
        time.sleep(0.1)  # Poll every 100ms
    
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

def trigger_voice_input_loop():
    """Start the configured provider, wait for silence, then stop it."""
    print(f"[voice-input] Starting {VOICE_INPUT_PROVIDER} voice input loop...")

    if not toggle_voice_input():
        return
    
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from silence_detector import wait_for_silence
    except ImportError as error:
        print(f"[voice-input] Missing microphone dependency: {error}")
        print(f'[voice-input] Install dependencies with: {sys.executable} -m pip install -r "{PACKAGE_ROOT / "requirements.txt"}"')
        toggle_voice_input()
        return

    # Wait for silence detection
    print(f"[voice-input] Monitoring mic for silence (threshold: {SILENCE_THRESHOLD}, duration: {SILENCE_DURATION}s)...")
    speech_detected = wait_for_silence(
        silence_threshold=SILENCE_THRESHOLD,
        silence_duration=SILENCE_DURATION,
        verbose=True
    )
    
    if speech_detected:
        print(f"[voice-input] Speech complete; stopping {VOICE_INPUT_PROVIDER}...")
        toggle_voice_input()
        print("[voice-input] Transcribed text will be pasted and auto-submit will press Enter")
    else:
        print("[voice-input] No speech detected; cancelling")
        toggle_voice_input()

# ─── Auto-Submit Monitor ─────────────────────────────────────────────────────

def do_submit(new_text_length):
    """Press Enter if conditions are met."""
    global submit_timer, monitoring
    submit_timer = None

    if new_text_length < MIN_TEXT_LENGTH:
        return

    app = get_frontmost_app()
    if app != TARGET_APP:
        return

    # Briefly pause monitoring to avoid detecting our own Enter keypress
    monitoring = False
    print(f"[auto-submit] Dictation detected ({new_text_length} new chars), submitting...")
    time.sleep(0.15)
    ctrl.press(Key.enter)
    ctrl.release(Key.enter)
    time.sleep(0.5)
    monitoring = True

def monitor_text_field():
    """Poll the focused text field for changes (auto-submit monitor)."""
    global last_text, last_change_time, text_at_change_start, submit_timer, monitoring
    
    while True:
        if not AUTO_SUBMIT_ENABLED or not monitoring:
            time.sleep(0.2)
            continue
            
        try:
            current_text = get_focused_text()
            
            if current_text is None:
                time.sleep(0.15)
                continue
            
            # Detect text change
            if current_text != last_text:
                now = time.time()
                
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

# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    # Check accessibility permissions
    if not AXIsProcessTrusted():
        print("  ERROR: Accessibility permissions not granted!")
        print("  Go to: System Settings > Privacy & Security > Accessibility")
        print("  Add your terminal app (Terminal, iTerm, Cursor, etc.)")
        print()
        print("  The script will continue but may not work correctly.")
        print()

    print(f"""
  TalkToCursor Auto-Submit & Voice Input
  ───────────────────────────────────────
  
  Auto-Submit: {'Enabled' if AUTO_SUBMIT_ENABLED else 'Disabled'}
    Submit delay:    {SILENCE_DELAY}s
    Min text length: {MIN_TEXT_LENGTH} chars
    Target app:      {TARGET_APP}
  
  Voice Input: {'Enabled' if VOICE_INPUT_ENABLED else 'Disabled'}
    Provider:        {VOICE_INPUT_PROVIDER}
    TTS delay:       {TTS_DELAY}s
    Silence thresh:  {SILENCE_THRESHOLD}
    Silence duration: {SILENCE_DURATION}s
    Wispr hotkey:    {WISPR_HOTKEY if VOICE_INPUT_PROVIDER == 'wispr' else 'n/a'}
    Handy command:   {HANDY_COMMAND or 'auto-detect'}
    Manual trigger:  {MANUAL_TRIGGER_HOTKEY}

  Press Ctrl+C to stop.
""")

    # Start monitors in separate threads
    if AUTO_SUBMIT_ENABLED:
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
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[main] Stopped.")

if __name__ == '__main__':
    main()
