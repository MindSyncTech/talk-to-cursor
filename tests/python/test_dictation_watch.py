import threading
import time
import unittest

from dictation_watch import DictationWatch


class FakePasteboard:
    def __init__(self, text="copied earlier"):
        self.count = 1
        self.text = text
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            return self.count, self.text

    def paste(self, text):
        with self.lock:
            self.count += 1
            self.text = text


def wait_for(predicate, timeout=1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return False


class DictationWatchTests(unittest.TestCase):
    def make(self, pasteboard):
        received = []
        watch = DictationWatch(
            snapshot=pasteboard.snapshot,
            on_text=received.append,
            settle_seconds=0.01,
            poll_seconds=0.005,
        )
        return watch, received

    def test_reports_fresh_dictated_text_once(self):
        pasteboard = FakePasteboard()
        watch, received = self.make(pasteboard)
        watch.start(timeout=1)
        pasteboard.paste("  fix the login bug  ")
        self.assertTrue(wait_for(lambda: received))
        pasteboard.paste("another paste")
        time.sleep(0.05)
        self.assertEqual(received, ["fix the login bug"])
        self.assertFalse(watch.active)

    def test_ignores_restored_and_empty_pasteboard_values(self):
        pasteboard = FakePasteboard()
        watch, received = self.make(pasteboard)
        watch.start(timeout=0.1)
        pasteboard.paste("copied earlier")
        pasteboard.paste("   ")
        time.sleep(0.15)
        self.assertEqual(received, [])

    def test_extending_keeps_the_original_baseline(self):
        pasteboard = FakePasteboard()
        watch, received = self.make(pasteboard)
        watch.start(timeout=1)
        watch.start(timeout=1)
        pasteboard.paste("dictated")
        self.assertTrue(wait_for(lambda: received))
        self.assertEqual(received, ["dictated"])

    def test_cancel_stops_without_reporting(self):
        pasteboard = FakePasteboard()
        watch, received = self.make(pasteboard)
        watch.start(timeout=1)
        watch.cancel()
        pasteboard.paste("dictated")
        time.sleep(0.05)
        self.assertEqual(received, [])
        self.assertFalse(watch.active)

    def test_can_watch_again_after_reporting(self):
        pasteboard = FakePasteboard()
        watch, received = self.make(pasteboard)
        watch.start(timeout=1)
        pasteboard.paste("first")
        self.assertTrue(wait_for(lambda: received))
        watch.start(timeout=1)
        pasteboard.paste("second")
        self.assertTrue(wait_for(lambda: len(received) == 2))
        self.assertEqual(received, ["first", "second"])


if __name__ == "__main__":
    unittest.main()
