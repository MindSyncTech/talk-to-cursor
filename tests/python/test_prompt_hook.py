import io
import json
import tempfile
import time
import unittest
from pathlib import Path

import prompt_hook
from ipc_server import HelperIpcServer


class PromptHookTest(unittest.TestCase):
    def test_reads_the_prompt_and_tolerates_bad_input(self):
        self.assertEqual(prompt_hook.read_prompt(io.StringIO('{"prompt": "fix it"}')), 'fix it')
        self.assertEqual(prompt_hook.read_prompt(io.StringIO('not json')), '')
        self.assertEqual(prompt_hook.read_prompt(io.StringIO('[]')), '')

    def test_returns_quietly_when_the_helper_is_not_running(self):
        self.assertFalse(prompt_hook.notify_helper('hi', Path('/nonexistent/helper.sock')))

    def test_delivers_the_prompt_and_helper_targets_the_newest_mcp_client(self):
        received = []
        directory = tempfile.mkdtemp(dir='/tmp')
        server = HelperIpcServer(Path(directory) / 'h.sock', lambda client, message: received.append(message))
        server.start()
        try:
            self.assertTrue(prompt_hook.notify_helper('add tests', server.socket_path))
            deadline = time.monotonic() + 2
            while len(received) < 2 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(received[-1], {'type': 'prompt.submitted', 'text': 'add tests'})
            self.assertFalse(server.send_latest({'type': 'prompt.received'}, role='mcp'))
        finally:
            server.stop()


if __name__ == '__main__':
    unittest.main()
