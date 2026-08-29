import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from submit_phrase import strip_trailing_submit_phrase


class SubmitPhraseTests(unittest.TestCase):
    def test_removes_only_trailing_command(self):
        self.assertEqual(
            strip_trailing_submit_phrase("Fix the login bug, send it!", "send it"),
            ("Fix the login bug", True),
        )

    def test_is_case_insensitive(self):
        self.assertEqual(
            strip_trailing_submit_phrase("Write tests SEND IT", "send it"),
            ("Write tests", True),
        )

    def test_preserves_command_inside_prompt(self):
        self.assertEqual(
            strip_trailing_submit_phrase("Explain what send it means here", "send it"),
            ("Explain what send it means here", False),
        )


if __name__ == "__main__":
    unittest.main()
