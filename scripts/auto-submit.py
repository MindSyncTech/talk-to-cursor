#!/usr/bin/env python3
"""
Auto-Submit and Wispr Voice Loop for Cursor TTS MCP

Combines two features:
1. Auto-submit: Detects when text appears in the focused field and auto-presses Enter
2. Wispr voice loop: Watches for listen signals, triggers Wispr, detects silence, and pastes

How it works:
  - Monitors the focused text field via Accessibility API for auto-submit
  - Watches for listen-signal.json from the MCP server
  - When signal detected, starts Wispr and monitors mic for silence
  - Registers a manual trigger hotkey to start Wispr anytime

Requires macOS Accessibility permissions:
  System Settings > Privacy & Security > Accessibility
"""

import time
import json
import os
import sys
import threading
import subprocess
from pathlib import Path
from ApplicationServices import (
    AXUIElementCreateSystemWide,
    AXUIElementCopyAttributeValue,
    AXIsProcessTrusted,
)
from pynput import keyboard
from pynput.keyboard import Key, KeyCode, Controller, HotKey, GlobalHotKeys

# Import our silence detector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from silence_detector import wait_for_silence

# ─── Configuration ───────────────────────────────────────────────────────────

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'config.json')
SIGNAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'listen-signal.json')
TTS_COMPLETE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tts-complete.json')

def load_config():
    defaults = {
        'autoSubmit': {
            'enabled': True,
            'silenceDelay': 3.0,
            'minTextLength': 15,
            'targetApp': 'Cursor',
        },
        'wisprLoop': {
            'enabled': False,
            'ttsDelay': 4.0,
            'silenceThreshold': 0.02,
            'silenceDuration': 2.0,
            'wisprHotkey': 'shift+ctrl',
            'manualTriggerHotkey': 'ctrl+shift+l',
        }
    }
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            for key in defaults:
                if key in config:
                    for subkey in defaults[key]:
                        if subkey in config[key]:
                            defaults[key][subkey] = config[key][subkey]
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return defaults

config = load_config()

AUTO_SUBMIT_ENABLED = config['autoSubmit']['enabled']
SILENCE_DELAY = config['autoSubmit']['silenceDelay']
MIN_TEXT_LENGTH = config['autoSubmit']['minTextLength']
TARGET_APP = config['autoSubmit']['targetApp']

WISPR_LOOP_ENABLED = config['wisprLoop']['enabled']
TTS_DELAY = config['wisprLoop']['ttsDelay']
SILENCE_THRESHOLD = config['wisprLoop']['silenceThreshold']
SILENCE_DURATION = config['wisprLoop']['silenceDuration']
WISPR_HOTKEY = config['wisprLoop']['wisprHotkey']
MANUAL_TRIGGER_HOTKEY = config['wisprLoop']['manualTriggerHotkey']

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
    print(f"[wispr-loop] Waiting for TTS to complete...")
    start_time = time.time()
    
    # Clear any stale completion signal first
    if os.path.exists(TTS_COMPLETE_PATH):
        try:
            os.remove(TTS_COMPLETE_PATH)
        except:
            pass
    
    while (time.time() - start_time) < timeout:
        if os.path.exists(TTS_COMPLETE_PATH):
            print(f"[wispr-loop] TTS completion signal received!")
            # Delete the completion signal
            try:
                os.remove(TTS_COMPLETE_PATH)
            except:
                pass
            return True
        time.sleep(0.1)  # Poll every 100ms
    
    # Timeout - proceed anyway with a warning
    print(f"[wispr-loop] Warning: TTS completion timeout after {timeout}s, proceeding anyway...")
    return False

def trigger_wispr_loop():
    """Execute the Wispr voice loop: start Wispr, wait for silence, stop Wispr."""
    print(f"[wispr-loop] Starting Wispr voice loop...")
    
    # Parse Wispr hotkey
    wispr_keys = parse_hotkey(WISPR_HOTKEY)
    
    # Trigger Wispr to start recording
    print(f"[wispr-loop] Pressing {WISPR_HOTKEY} to start Wispr recording...")
    press_hotkey(wispr_keys)
    
    # Wait for silence detection
    print(f"[wispr-loop] Monitoring mic for silence (threshold: {SILENCE_THRESHOLD}, duration: {SILENCE_DURATION}s)...")
    speech_detected = wait_for_silence(
        silence_threshold=SILENCE_THRESHOLD,
        silence_duration=SILENCE_DURATION,
        verbose=True
    )
    
    if speech_detected:
        # User spoke, now stop Wispr (triggers paste)
        print(f"[wispr-loop] Pressing {WISPR_HOTKEY} to stop Wispr and paste...")
        press_hotkey(wispr_keys)
        print(f"[wispr-loop] Wispr should paste text now, auto-submit will handle pressing Enter")
    else:
        print(f"[wispr-loop] No speech detected, cancelling")

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

# ─── Wispr Loop Signal Watcher ──────────────────────────────────────────────

def watch_for_signals():
    """Watch for listen-signal.json and trigger Wispr loop when found."""
    while True:
        if not WISPR_LOOP_ENABLED:
            time.sleep(0.5)
            continue
        
        try:
            if os.path.exists(SIGNAL_PATH):
                print(f"[wispr-loop] Listen signal detected!")
                
                # Delete the signal file
                os.remove(SIGNAL_PATH)
                
                # Wait for TTS to actually finish playing
                wait_for_tts_completion()
                
                # Start the Wispr loop in a separate thread so we don't block
                threading.Thread(target=trigger_wispr_loop, daemon=True).start()
        
        except Exception as e:
            print(f"[wispr-loop] Error: {e}")
        
        time.sleep(0.3)  # Poll for signal file every 300ms

# ─── Manual Trigger Hotkey ──────────────────────────────────────────────────

def setup_manual_trigger():
    """Register a global hotkey to manually trigger the Wispr loop."""
    if not WISPR_LOOP_ENABLED:
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
        print(f"[wispr-loop] Manual trigger activated!")
        threading.Thread(target=trigger_wispr_loop, daemon=True).start()
    
    try:
        hotkeys = GlobalHotKeys({
            formatted_hotkey: on_manual_trigger
        })
        hotkeys.start()
        return hotkeys
    except Exception as e:
        print(f"[wispr-loop] Failed to register manual trigger hotkey: {e}")
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
  Cursor Auto-Submit & Wispr Voice Loop
  ──────────────────────────────────────
  
  Auto-Submit: {'Enabled' if AUTO_SUBMIT_ENABLED else 'Disabled'}
    Submit delay:    {SILENCE_DELAY}s
    Min text length: {MIN_TEXT_LENGTH} chars
    Target app:      {TARGET_APP}
  
  Wispr Loop: {'Enabled' if WISPR_LOOP_ENABLED else 'Disabled'}
    TTS delay:       {TTS_DELAY}s
    Silence thresh:  {SILENCE_THRESHOLD}
    Silence duration: {SILENCE_DURATION}s
    Wispr hotkey:    {WISPR_HOTKEY}
    Manual trigger:  {MANUAL_TRIGGER_HOTKEY}

  Press Ctrl+C to stop.
""")

    # Start monitors in separate threads
    if AUTO_SUBMIT_ENABLED:
        text_monitor = threading.Thread(target=monitor_text_field, daemon=True)
        text_monitor.start()
        print("[auto-submit] Text field monitor started")
    
    if WISPR_LOOP_ENABLED:
        signal_watcher = threading.Thread(target=watch_for_signals, daemon=True)
        signal_watcher.start()
        print("[wispr-loop] Signal watcher started")
        
        manual_hotkey = setup_manual_trigger()
        if manual_hotkey:
            print(f"[wispr-loop] Manual trigger registered: {MANUAL_TRIGGER_HOTKEY}")
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[main] Stopped.")

if __name__ == '__main__':
    main()
