"""Prompt-submit hook for Cursor and Claude Code.

Forwards the prompt to the Background Helper so TalkToCursor can speak an
instant acknowledgement. It never blocks or alters the prompt; with --cursor
it prints the response Cursor's beforeSubmitPrompt hook expects.
"""

import json
import socket
import sys
from pathlib import Path

# The helper runtime lives in <data dir>/background-helper/runtime.
SOCKET_PATH = Path(__file__).resolve().parents[2] / 'helper.sock'
MAX_PROMPT_CHARS = 2000


def read_prompt(stream):
    try:
        payload = json.load(stream)
    except (ValueError, OSError):
        return ''
    prompt = payload.get('prompt') if isinstance(payload, dict) else None
    return prompt[:MAX_PROMPT_CHARS] if isinstance(prompt, str) else ''


def notify_helper(prompt, socket_path=SOCKET_PATH):
    messages = [
        {'type': 'hello', 'role': 'hook'},
        {'type': 'prompt.submitted', 'text': prompt},
    ]
    payload = ''.join(json.dumps(message) + '\n' for message in messages).encode('utf-8')
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(0.5)
    try:
        connection.connect(str(socket_path))
        connection.sendall(payload)
        return True
    except OSError:
        return False
    finally:
        connection.close()


def main():
    notify_helper(read_prompt(sys.stdin))
    if '--cursor' in sys.argv:
        print(json.dumps({'continue': True}))


if __name__ == '__main__':
    main()
