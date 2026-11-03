#!/usr/bin/env python3
"""
Auto-Submit and Voice Input Loop for TalkToCursor

Combines two features:
1. Auto-submit: Detects when text appears in the focused field and auto-presses Enter
2. Voice input loop: Triggers Wispr Flow, FluidVoice, or Handy after TTS and stops after silence

How it works:
  - Monitors the focused text field via Accessibility API for auto-submit
  - Uses fresh pasteboard plus keyboard-event observations when Cursor hides it
  - Watches for listen-signal.json from the MCP server
  - When signaled, starts the configured provider and monitors mic for silence
  - Registers a manual trigger hotkey to start voice input anytime

Requires macOS Accessibility and Input Monitoring permissions:
  System Settings > Privacy & Security > Accessibility / Input Monitoring
"""

import base64
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
    from AppKit import NSPasteboard, NSPasteboardTypeString, NSWorkspace
    from ApplicationServices import (
        AXUIElementCreateSystemWide,
        AXUIElementCopyAttributeValue,
        AXUIElementSetAttributeValue,
        AXIsProcessTrusted,
        AXIsProcessTrustedWithOptions,
        kAXTrustedCheckOptionPrompt,
    )
    from pynput.keyboard import Key, KeyCode, Controller, GlobalHotKeys, Listener
    from CoreFoundation import CFEqual
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
HELPER_SOCKET_PATH = USER_DATA_DIR / 'helper.sock'
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
            'fluidVoiceHotkey': 'right_option',
            'handyCommand': '',
            'manualTriggerHotkey': 'ctrl+shift+l',
            'wakeWordEnabled': False,
            'wakePhrase': 'hey cursor',
            'wakeSensitivity': 0.5,
            'wakeChime': True,
            'bargeIn': True,
            'builtinModel': 'parakeet',
            'echoCancellation': True,
            'inputGainDb': 0,
            'inputChannel': 1,
            'noiseSuppression': True,
        },
        'cloud': {
            'apiUrl': 'https://cloud.talktocursor.com',
        },
    }
    try:
        with open(CONFIG_PATH, 'r') as f:
            config = json.load(f)
            if 'autoSubmit' in config:
                defaults['autoSubmit'].update(config['autoSubmit'])
            if isinstance(config.get('cloud'), dict):
                defaults['cloud'].update(config['cloud'])
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
FLUIDVOICE_HOTKEY = config['voiceInput']['fluidVoiceHotkey']
HANDY_COMMAND = config['voiceInput']['handyCommand']
MANUAL_TRIGGER_HOTKEY = config['voiceInput']['manualTriggerHotkey']
WAKE_WORD_ENABLED = config['voiceInput']['wakeWordEnabled']
WAKE_PHRASE = config['voiceInput']['wakePhrase']
WAKE_SENSITIVITY = config['voiceInput']['wakeSensitivity']
WAKE_CHIME = config['voiceInput']['wakeChime']
BARGE_IN = config['voiceInput']['bargeIn']
BUILTIN_MODEL = (
    config['voiceInput']['builtinModel']
    if config['voiceInput']['builtinModel'] in ('streaming', 'cloud')
    else 'parakeet'
)
CLOUD_API_URL = config['cloud'].get('apiUrl') or 'https://cloud.talktocursor.com'
ECHO_CANCELLATION = config['voiceInput']['echoCancellation'] is not False
INPUT_GAIN_DB = min(30.0, max(0.0, float(config['voiceInput']['inputGainDb'] or 0)))
INPUT_CHANNEL = config['voiceInput'].get('inputChannel') or 1
NOISE_SUPPRESSION = config['voiceInput'].get('noiseSuppression') is not False
WAKE_CHIME_GUARD_SECONDS = 1.7
HELPER_CHIME_GUARD_SECONDS = 0.3

# ─── State ───────────────────────────────────────────────────────────────────

# Auto-submit state
last_text = None
last_change_time = 0.0
text_at_change_start = None
submit_timer = None
monitoring = True
voice_input_active = threading.Event()
pending_send = None
pending_send_element = None
dictation_watch = None
last_provider_toggle_at = 0.0
builtin_stt_loading = threading.Event()
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

# Shared helper audio and IPC, created in main()
helper_audio = None
helper_ipc = None
active_turn_detector = None

# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_frontmost_app():
    """Get the name of the currently focused application."""
    try:
        application = NSWorkspace.sharedWorkspace().frontmostApplication()
        return application.localizedName() if application else ""
    except Exception:
        return ""

def is_tts_playing():
    """Return true while helper playback runs or a recent TTS state is active."""
    if helper_audio is not None and helper_audio.is_playing():
        return True
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


HOTKEY_ALIASES = {
    'control': 'ctrl', 'option': 'alt', 'command': 'cmd',
    'return': 'enter', 'escape': 'esc',
    'right_shift': 'shift_r', 'right_ctrl': 'ctrl_r', 'right_control': 'ctrl_r',
    'right_option': 'alt_r', 'right_alt': 'alt_r',
    'right_cmd': 'cmd_r', 'right_command': 'cmd_r',
}


def parse_hotkey(hotkey_str):
    """Parse a hotkey string like 'shift+ctrl' or 'right_option' into Key objects."""
    keys = []
    for part in hotkey_str.lower().split('+'):
        part = part.strip().replace(' ', '_')
        part = HOTKEY_ALIASES.get(part, part)
        if len(part) == 1:
            keys.append(KeyCode.from_char(part))
        elif isinstance(getattr(Key, part, None), Key):
            keys.append(getattr(Key, part))
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
    if VOICE_INPUT_PROVIDER == 'builtin':
        return True

    global last_provider_toggle_at
    last_provider_toggle_at = time.monotonic()

    if VOICE_INPUT_PROVIDER == 'wispr':
        print(f"[voice-input] Pressing {WISPR_HOTKEY} to toggle Wispr Flow...")
        press_hotkey(parse_hotkey(WISPR_HOTKEY))
        return True

    if VOICE_INPUT_PROVIDER == 'fluidvoice':
        print(f"[voice-input] Pressing {FLUIDVOICE_HOTKEY} to toggle FluidVoice...")
        press_hotkey(parse_hotkey(FLUIDVOICE_HOTKEY))
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

def shared_microphone():
    """Echo-cancelled helper microphone, when duplex audio is running."""
    if helper_audio is not None and helper_audio.input_enabled:
        return helper_audio
    return None


def paste_text(text):
    """Paste through the clipboard, then restore the previous clipboard text."""
    pasteboard = NSPasteboard.generalPasteboard()
    previous = pasteboard.stringForType_(NSPasteboardTypeString)
    pasteboard.clearContents()
    pasteboard.setString_forType_(text, NSPasteboardTypeString)
    ctrl.press(Key.cmd)
    ctrl.press(KeyCode.from_char('v'))
    ctrl.release(KeyCode.from_char('v'))
    ctrl.release(Key.cmd)
    time.sleep(0.2)
    if previous is not None:
        pasteboard.clearContents()
        pasteboard.setString_forType_(previous, NSPasteboardTypeString)
    return True


def insert_text(text):
    """Insert text into the focused field; verify an Accessibility write."""
    before = get_focused_text()
    if before is not None:
        separator = ' ' if before and not before[-1].isspace() else ''
        if set_focused_text(before + separator + text):
            after = get_focused_text()
            if after is not None and after.rstrip().endswith(text):
                return True
    return paste_text(text)


def submit_prompt_text(text, command_requested=False):
    """Insert a finished transcript into the target app and optionally submit."""
    global monitoring, last_text, text_at_change_start, submit_timer, pending_send_element

    cleaned, had_phrase = strip_trailing_submit_phrase(text, SUBMIT_PHRASE)
    if had_phrase and SUBMIT_COMMAND_ENABLED:
        command_requested = True
        text = cleaned
    text = text.strip()
    if not text:
        print("[voice-input] Empty transcript; nothing to insert")
        return False
    if get_frontmost_app() != TARGET_APP:
        print(f"[voice-input] {TARGET_APP} is not frontmost; transcript not inserted")
        return False

    with submit_action_lock:
        monitoring = False
        try:
            if submit_timer is not None:
                submit_timer.cancel()
                submit_timer = None
            insert_text(text)
            submitted = command_requested or (
                AUTO_SUBMIT_ENABLED and len(text) >= MIN_TEXT_LENGTH
            )
            if submitted:
                if pending_send is not None:
                    pending_send.disarm()
                time.sleep(0.05)
                ctrl.press(Key.enter)
                ctrl.release(Key.enter)
                print(f"[voice-input] Submitted {len(text)} characters")
                broadcast({'type': 'turn.submitted', 'text': text})
            else:
                print(f"[voice-input] Inserted {len(text)} characters")
                if pending_send is not None:
                    pending_send_element = get_focused_element()
                    pending_send.arm(text)
                    print(f'[send-it] Say "{SUBMIT_PHRASE}" to send it')
            time.sleep(0.2)
        finally:
            last_text = get_focused_text()
            text_at_change_start = None
            monitoring = True
    return True


def get_focused_element():
    try:
        err, focused = AXUIElementCopyAttributeValue(
            AXUIElementCreateSystemWide(), "AXFocusedUIElement", None
        )
        return focused if err == 0 else None
    except Exception:
        return None


def pending_send_text_is_waiting(text):
    app = get_frontmost_app()
    if app != TARGET_APP:
        print(f'[send-it] Stopped listening: {app or "another app"} is frontmost')
        return False
    current = get_focused_text()
    if current is None:
        # Cursor's chat box hides its text; fall back to "the same field still has focus".
        focused = get_focused_element()
        if (
            focused is not None
            and pending_send_element is not None
            and not CFEqual(focused, pending_send_element)
        ):
            print("[send-it] Stopped listening: focus moved to another field")
            return False
        return True
    if text not in current:
        print(f"[send-it] Stopped listening: the dictated text is no longer in the focused field ({len(current)} characters there)")
        return False
    return True


def pending_send_should_pause():
    if voice_input_active.is_set():
        return True
    # On speakers without working echo cancellation, the assistant's voice reaches the mic.
    speakers_leak = ECHO_CANCELLATION and not (helper_audio is not None and helper_audio.aec_active)
    return speakers_leak and is_tts_playing()


def pending_send_open_reader():
    microphone = shared_microphone()
    if microphone is not None:
        return microphone.open_reader(sample_rate=16000)
    import sounddevice as sd

    from audio_io import input_stream_settings

    return sd.InputStream(
        channels=1, dtype="float32", samplerate=16000, blocksize=1600, **input_stream_settings()
    )


def send_pending_text(text):
    global monitoring, last_text
    with submit_action_lock:
        if not pending_send_text_is_waiting(text):
            return
        monitoring = False
        try:
            ctrl.press(Key.enter)
            ctrl.release(Key.enter)
            print(f'[send-it] Heard "{SUBMIT_PHRASE}"; submitted {len(text)} characters')
            broadcast({'type': 'turn.submitted', 'text': text})
            time.sleep(0.2)
        finally:
            last_text = get_focused_text()
            monitoring = True


def create_pending_send_listener():
    from pending_send import PendingSendListener

    def create_detector():
        from wake_word import StreamingKeywordDetector

        return StreamingKeywordDetector(
            USER_DATA_DIR,
            SUBMIT_PHRASE,
            0.65,
            filename="pending-send-keywords.txt",
        )

    def on_key_press(key):
        if key in (Key.enter, getattr(Key, 'esc', None)) and listener.armed:
            listener.disarm()
            print("[send-it] Stopped listening: Enter or Escape was pressed")

    listener = PendingSendListener(
        create_detector=create_detector,
        open_reader=pending_send_open_reader,
        should_pause=pending_send_should_pause,
        still_pending=pending_send_text_is_waiting,
        on_send=send_pending_text,
    )
    keys = Listener(on_press=on_key_press)
    keys.daemon = True
    keys.start()
    return listener


def arm_pending_send_for_dictation(text):
    """Listen for the submit phrase after an external dictation app pastes text."""
    global pending_send_element
    if pending_send is None or managed_submit_pending.is_set():
        return
    if get_frontmost_app() != TARGET_APP:
        return
    _, had_phrase = strip_trailing_submit_phrase(text, SUBMIT_PHRASE)
    if had_phrase:
        return
    pending_send_element = get_focused_element()
    pending_send.arm(text)
    print(f'[send-it] Dictation from {VOICE_INPUT_PROVIDER} arrived; say "{SUBMIT_PHRASE}" to send it')


def create_dictation_watch():
    from dictation_watch import DictationWatch

    return DictationWatch(
        snapshot=get_pasteboard_snapshot,
        on_text=arm_pending_send_for_dictation,
        settle_seconds=SMART_TEXT_DELAY,
    )


# Mac virtual key codes for the ANSI layout; Ctrl or Option can change the reported character.
MAC_VK_CHARS = {
    0: 'a', 1: 's', 2: 'd', 3: 'f', 4: 'h', 5: 'g', 6: 'z', 7: 'x', 8: 'c', 9: 'v',
    11: 'b', 12: 'q', 13: 'w', 14: 'e', 15: 'r', 16: 'y', 17: 't', 18: '1', 19: '2',
    20: '3', 21: '4', 22: '6', 23: '5', 24: '=', 25: '9', 26: '7', 27: '-', 28: '8',
    29: '0', 30: ']', 31: 'o', 32: 'u', 33: '[', 34: 'i', 35: 'p', 37: 'l', 38: 'j',
    39: "'", 40: 'k', 41: ';', 42: '\\', 43: ',', 44: '/', 45: 'n', 46: 'm', 47: '.',
    50: '`',
}


def setup_provider_shortcut_watch():
    """Notice when the user presses the dictation app's own shortcut directly."""
    if VOICE_INPUT_PROVIDER == 'wispr':
        hotkey = WISPR_HOTKEY
    elif VOICE_INPUT_PROVIDER == 'fluidvoice':
        hotkey = FLUIDVOICE_HOTKEY
    else:
        return None
    wanted = parse_hotkey(hotkey)
    if not wanted or dictation_watch is None:
        return None

    def identity(key):
        if isinstance(key, KeyCode):
            if key.vk in MAC_VK_CHARS:
                return MAC_VK_CHARS[key.vk]
            return key.char.lower() if key.char else key.vk
        return key

    target = {identity(key) for key in wanted}
    held = set()

    def on_press(key):
        name = identity(key)
        if name in held:
            return
        held.add(name)
        if not target <= held:
            return
        if voice_input_active.is_set() or time.monotonic() - last_provider_toggle_at < 1.0:
            return
        if get_frontmost_app() != TARGET_APP:
            return
        dictation_watch.start(timeout=300)

    def on_release(key):
        held.discard(identity(key))

    listener = Listener(on_press=on_press, on_release=on_release)
    listener.daemon = True
    listener.start()
    return listener


def create_speech_detector(sample_rate=16000):
    try:
        from speech_vad import SpeechActivityDetector

        return SpeechActivityDetector(USER_DATA_DIR, sample_rate=sample_rate)
    except Exception as error:
        print(f"[vad] Unavailable; using loudness only: {error}")
        return None


def local_fallback_transcriber():
    """A local transcriber for Cloud dictation outages, if a model is already downloaded."""
    from model_download import PARAKEET_STT, STREAMING_STT, is_downloaded
    from stt_engine import BuiltinTranscriber

    for model, spec in (('parakeet', PARAKEET_STT), ('streaming', STREAMING_STT)):
        if is_downloaded(USER_DATA_DIR, spec):
            return BuiltinTranscriber(USER_DATA_DIR, model)
    return None


def create_builtin_transcriber():
    if BUILTIN_MODEL == 'cloud':
        from cloud_dictation import CloudTranscriber, read_cloud_token

        return CloudTranscriber(
            CLOUD_API_URL,
            read_cloud_token(USER_DATA_DIR),
            fallback_factory=local_fallback_transcriber,
        )
    from stt_engine import BuiltinTranscriber

    return BuiltinTranscriber(USER_DATA_DIR, BUILTIN_MODEL)


def trigger_voice_input_loop(detector_start_delay=0.0, preroll_seconds=0.0):
    """Start the configured provider, detect turn completion, then stop it."""
    global managed_baseline_text, managed_submit_started
    global managed_baseline_pasteboard_count, managed_baseline_pasteboard_text
    global managed_input_observed_at, active_turn_detector

    if not voice_input_lock.acquire(blocking=False):
        print("[voice-input] Voice input is already active; ignoring duplicate trigger")
        return

    voice_input_active.set()
    provider_active = False
    transcriber = None
    try:
        from turn_detector import TurnDetector, TurnEndReason

        builtin = VOICE_INPUT_PROVIDER == 'builtin'
        if builtin:
            transcriber = create_builtin_transcriber()

        detector = TurnDetector(
            speech_detector=create_speech_detector(),
            mode=AUTO_SUBMIT_MODE if AUTO_SUBMIT_ENABLED else "fixed",
            user_data_dir=USER_DATA_DIR,
            silence_threshold=SILENCE_THRESHOLD,
            fixed_silence=SILENCE_DURATION,
            candidate_silence=SMART_CANDIDATE_SILENCE,
            smart_threshold=SMART_TURN_THRESHOLD,
            smart_max_silence=SMART_MAX_SILENCE,
            submit_command_enabled=SUBMIT_COMMAND_ENABLED,
            submit_phrase=SUBMIT_PHRASE,
            audio_source=shared_microphone(),
            preroll_seconds=preroll_seconds,
            on_audio=transcriber.accept if transcriber is not None else None,
        )
        active_turn_detector = detector

        if builtin:
            if detector_start_delay > 0:
                time.sleep(detector_start_delay)
            print("[voice-input] Listening with built-in speech-to-text...")
            result = detector.wait_for_turn_end(verbose=True)
            if not result.speech_detected:
                print("[voice-input] No speech detected; cancelling")
                return
            finishing, transcriber = transcriber, None
            transcript = finishing.finish()
            print(f"[voice-input] Transcript ready ({len(transcript)} characters)")
            submit_prompt_text(
                transcript,
                command_requested=result.reason == TurnEndReason.SUBMIT_COMMAND,
            )
            return

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
        if dictation_watch is not None:
            dictation_watch.start(timeout=600)
        if not toggle_voice_input():
            if dictation_watch is not None:
                dictation_watch.cancel()
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
            command_spoken = result.reason == TurnEndReason.SUBMIT_COMMAND
            if dictation_watch is not None:
                if command_spoken:
                    dictation_watch.cancel()
                else:
                    dictation_watch.start(timeout=15)
            if (AUTO_SUBMIT_ENABLED and AUTO_SUBMIT_MODE == "smart") or command_spoken:
                managed_submit_started = time.monotonic()
                if command_spoken:
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
            if dictation_watch is not None:
                dictation_watch.cancel()
            if toggle_voice_input():
                provider_active = False
    except Exception as error:
        print(f"[voice-input] Turn detection failed: {error}")
    finally:
        if provider_active:
            toggle_voice_input()
        if transcriber is not None and hasattr(transcriber, 'cancel'):
            transcriber.cancel()
        active_turn_detector = None
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
            if (AUTO_SUBMIT_ENABLED and fresh_length >= MIN_TEXT_LENGTH) or (
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

# ─── Barge-In ───────────────────────────────────────────────────────────────

class BargeInMonitor:
    """Stop agent speech when the user talks over it (echo-cancelled mic)."""

    RMS_THRESHOLD = 0.02
    SUSTAIN_FRAMES = 25          # 250 ms of 10 ms frames
    PLAYBACK_GRACE_SECONDS = 0.4  # let echo cancellation converge
    PREROLL_SECONDS = 0.6

    def __init__(self):
        self._loud_frames = 0
        self._playback_started_at = 0.0
        self._speech_detector = None

    def enable_voice_detection(self):
        self._speech_detector = create_speech_detector()

    def playback_started(self):
        self._playback_started_at = time.monotonic()
        self._loud_frames = 0
        if self._speech_detector is not None:
            self._speech_detector.reset()

    def on_frame(self, frame_int16):
        if not barge_in_available() or not helper_audio.is_playing():
            self._loud_frames = 0
            return
        if time.monotonic() - self._playback_started_at < self.PLAYBACK_GRACE_SECONDS:
            return
        samples = frame_int16.astype('float32') / 32768.0
        rms = float((samples ** 2).mean() ** 0.5)
        voiced = True
        if self._speech_detector is not None:
            from audio_io import resample_frame

            voiced = self._speech_detector.accept(resample_frame(samples, 16000))
        if rms >= self.RMS_THRESHOLD and voiced:
            self._loud_frames += 1
        else:
            self._loud_frames = max(0, self._loud_frames - 2)
        if self._loud_frames >= self.SUSTAIN_FRAMES:
            self._loud_frames = 0
            self.trigger()

    def trigger(self):
        cancelled = helper_audio.cancel()
        print(f"[barge-in] User speech detected; stopped {len(cancelled)} playback stream(s)")
        broadcast({'type': 'tts.cancel', 'ids': cancelled, 'reason': 'barge-in'})
        if not voice_input_active.is_set():
            threading.Thread(
                target=trigger_voice_input_loop,
                kwargs={'preroll_seconds': self.PREROLL_SECONDS},
                daemon=True,
            ).start()


barge_in_monitor = BargeInMonitor()


def chime_pcm():
    """A short two-note chime rendered as 24 kHz PCM for helper playback."""
    import numpy as np

    rate = 24000
    notes = []
    for frequency, duration in ((880.0, 0.09), (1318.5, 0.14)):
        t = np.arange(int(rate * duration)) / rate
        envelope = np.minimum(1.0, t / 0.005) * np.exp(-t * 18)
        notes.append(0.25 * np.sin(2 * np.pi * frequency * t) * envelope)
    audio = np.concatenate(notes)
    return (audio * 32767).astype(np.int16).tobytes()


def play_chime():
    """Play the activation chime; returns seconds to wait before listening."""
    if helper_audio is not None:
        stream_id = f"chime-{time.monotonic_ns()}"
        helper_audio.begin_stream(stream_id)
        helper_audio.write(stream_id, chime_pcm())
        helper_audio.end_stream(stream_id)
        # The chime lasts 0.23 s; listening starts right after it.
        return HELPER_CHIME_GUARD_SECONDS
    try:
        subprocess.Popen(
            ['afplay', '/System/Library/Sounds/Glass.aiff'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        pass
    return WAKE_CHIME_GUARD_SECONDS


def speech_model_still_loading():
    """True (and plays a warning sound) while the built-in model downloads or loads."""
    if VOICE_INPUT_PROVIDER != 'builtin' or not builtin_stt_loading.is_set():
        return False
    print(f"[voice-input] The {BUILTIN_MODEL} speech model is still loading; try again when it's ready")
    try:
        subprocess.Popen(
            ['afplay', '/System/Library/Sounds/Basso.aiff'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError:
        pass
    return True

# ─── Helper IPC ─────────────────────────────────────────────────────────────

def helper_state_message():
    return {
        'type': 'helper.state',
        'playback': helper_audio is not None,
        'sampleRate': 24000,
        'echoCancellation': bool(helper_audio is not None and helper_audio.aec_active),
        'bargeIn': barge_in_available(),
    }


def input_level_message():
    if helper_audio is None or not helper_audio.input_enabled:
        return {'type': 'level', 'available': False}
    rms, peak = helper_audio.input_level()
    return {
        'type': 'level',
        'available': True,
        'rms': rms,
        'peak': peak,
        'threshold': SILENCE_THRESHOLD,
        'gainDb': INPUT_GAIN_DB,
        'listening': voice_input_active.is_set(),
        'speechModelLoading': builtin_stt_loading.is_set(),
    }


def broadcast(message, role=None):
    if helper_ipc is not None:
        helper_ipc.broadcast(message, role=role)


def on_playback_event(kind, stream_id, interrupted):
    if kind == 'started':
        barge_in_monitor.playback_started()
    broadcast({
        'type': f'playback.{kind}',
        'id': stream_id,
        'interrupted': bool(interrupted),
    })


def handle_listen_request():
    """Start voice input once current speech has finished playing."""
    if not VOICE_INPUT_ENABLED:
        return

    def run():
        wait_for_tts_completion()
        trigger_voice_input_loop()

    threading.Thread(target=run, daemon=True).start()


def handle_ipc_message(client, message):
    kind = message['type']
    stream_id = str(message.get('id', ''))
    if kind == 'hello':
        client.send(helper_state_message())
    elif kind == 'level.get':
        client.send(input_level_message())
    elif kind == 'listen':
        print("[voice-input] Listen request received over IPC")
        handle_listen_request()
    elif kind == 'tts.start' and helper_audio is not None:
        helper_audio.begin_stream(stream_id)
    elif kind == 'tts.audio' and helper_audio is not None:
        helper_audio.write(stream_id, base64.b64decode(message.get('data') or ''))
    elif kind == 'tts.end' and helper_audio is not None:
        helper_audio.end_stream(stream_id)
    elif kind == 'tts.cancel' and helper_audio is not None:
        helper_audio.cancel(stream_id or None)

# ─── Voice Input Signal Watcher ─────────────────────────────────────────────

def watch_for_signals():
    """Watch for listen-signal.json when the MCP server cannot use IPC."""
    while True:
        if not VOICE_INPUT_ENABLED:
            time.sleep(0.5)
            continue
        
        try:
            if os.path.exists(SIGNAL_PATH):
                print("[voice-input] Listen signal detected!")
                os.remove(SIGNAL_PATH)
                handle_listen_request()
        
        except Exception as e:
            print(f"[voice-input] Error: {e}")
        
        time.sleep(0.3)

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
    aliases = HOTKEY_ALIASES
    parts = MANUAL_TRIGGER_HOTKEY.lower().split('+')
    formatted_parts = []
    for part in parts:
        part = aliases.get(part.strip(), part.strip())
        # Named keys (ctrl, space, f5, ...) need angle brackets; single characters do not.
        formatted_parts.append(f'<{part}>' if len(part) > 1 else part)
    formatted_hotkey = '+'.join(formatted_parts)
    
    def on_manual_trigger():
        print("[voice-input] Manual trigger activated!")
        if voice_input_active.is_set():
            detector = active_turn_detector
            if detector is not None:
                print("[voice-input] Manual trigger pressed again; finishing the turn")
                detector.request_stop()
            return
        if speech_model_still_loading():
            return
        guard = play_chime() if WAKE_CHIME else 0.0
        threading.Thread(target=trigger_voice_input_loop, args=(guard,), daemon=True).start()
    
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
    if speech_model_still_loading():
        return
    guard = play_chime() if WAKE_CHIME else 0.0
    trigger_voice_input_loop(guard)

def run_wake_word_listener():
    try:
        from wake_word import listen_for_wake_phrase
        listen_for_wake_phrase(
            user_data_dir=USER_DATA_DIR,
            phrase=WAKE_PHRASE,
            sensitivity=WAKE_SENSITIVITY,
            should_pause=wake_word_should_pause,
            on_detected=on_wake_word_detected,
            audio_source=shared_microphone(),
        )
    except ImportError as error:
        print(f"[wake-word] Missing dependency: {error}")
        print(f'[wake-word] Install dependencies with: {sys.executable} -m pip install -r "{PACKAGE_ROOT / "requirements.txt"}"')
    except Exception as error:
        print(f"[wake-word] Could not start: {error}")

# ─── Main ────────────────────────────────────────────────────────────────────

def audio_needs_input():
    # Noise suppression needs the shared microphone, so every provider's wake phrase and turn detection hear filtered audio.
    return VOICE_INPUT_ENABLED and (VOICE_INPUT_PROVIDER == 'builtin' or NOISE_SUPPRESSION)


def barge_in_available():
    return bool(
        helper_audio is not None
        and helper_audio.input_enabled
        and VOICE_INPUT_PROVIDER == 'builtin'
        # With echo cancellation turned off, the user is on headphones and playback cannot leak in.
        and (helper_audio.aec_active or not ECHO_CANCELLATION)
        and BARGE_IN
        and VOICE_INPUT_ENABLED
        and VOICE_INPUT_PROVIDER == 'builtin'
    )


def start_helper_audio():
    global helper_audio
    try:
        from audio_io import DuplexAudio

        audio = DuplexAudio(
            input_enabled=audio_needs_input(),
            echo_cancellation=ECHO_CANCELLATION,
            input_gain_db=INPUT_GAIN_DB,
            on_playback_event=on_playback_event,
            noise_suppression=NOISE_SUPPRESSION,
        )
        audio.start()
        helper_audio = audio
        if audio.input_enabled:
            barge_in_monitor.enable_voice_detection()
            audio.add_listener(barge_in_monitor.on_frame)
    except Exception as error:
        helper_audio = None
        print(f"[audio] Helper playback unavailable; the MCP server will play audio: {error}")


def start_helper_ipc():
    global helper_ipc
    try:
        from ipc_server import HelperIpcServer

        server = HelperIpcServer(HELPER_SOCKET_PATH, handle_ipc_message)
        server.start()
        helper_ipc = server
    except Exception as error:
        helper_ipc = None
        print(f"[ipc] Unavailable; using signal files: {error}")


def main():
    global pending_send, dictation_watch
    managed_input_observer = None
    manual_hotkey = None
    provider_shortcut_watch = None

    from audio_io import configure_input_channel

    configure_input_channel(INPUT_CHANNEL)
    start_helper_audio()
    start_helper_ipc()
    if VOICE_INPUT_ENABLED and SUBMIT_COMMAND_ENABLED:
        try:
            pending_send = create_pending_send_listener()
            if VOICE_INPUT_PROVIDER != 'builtin':
                dictation_watch = create_dictation_watch()
                provider_shortcut_watch = setup_provider_shortcut_watch()
        except Exception as error:
            print(f'[send-it] Listening for "{SUBMIT_PHRASE}" after dictation is unavailable: {error}')
    if VOICE_INPUT_ENABLED and VOICE_INPUT_PROVIDER == 'builtin' and BUILTIN_MODEL == 'cloud':
        print(f"[stt] Cloud dictation via {CLOUD_API_URL}")
    elif VOICE_INPUT_ENABLED and VOICE_INPUT_PROVIDER == 'builtin':
        def preload_stt():
            try:
                from stt_engine import preload
                preload(USER_DATA_DIR, BUILTIN_MODEL)
                print(f"[stt] Built-in speech-to-text ready ({BUILTIN_MODEL})")
            except Exception as error:
                print(f"[stt] Could not load built-in speech-to-text: {error}")
            finally:
                builtin_stt_loading.clear()
        builtin_stt_loading.set()
        threading.Thread(target=preload_stt, daemon=True).start()

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
    Input channel:   {INPUT_CHANNEL}
    Wispr hotkey:    {WISPR_HOTKEY if VOICE_INPUT_PROVIDER == 'wispr' else 'n/a'}
    FluidVoice hotkey: {FLUIDVOICE_HOTKEY if VOICE_INPUT_PROVIDER == 'fluidvoice' else 'n/a'}
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

    if VOICE_INPUT_ENABLED:
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
        if provider_shortcut_watch is not None:
            provider_shortcut_watch.stop()
        if helper_ipc is not None:
            helper_ipc.stop()
        if helper_audio is not None:
            helper_audio.stop()

if __name__ == '__main__':
    main()
