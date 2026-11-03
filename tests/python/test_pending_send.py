import threading
import time
import unittest

import numpy as np

from pending_send import PendingSendListener


class FakeReader:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, count):
        time.sleep(0.005)
        return np.zeros(count, dtype=np.float32), False


class FakeDetector:
    def __init__(self, fire_after):
        self.fire_after = fire_after
        self.reads = 0

    def reset(self):
        self.reads = 0

    def accept(self, samples, sample_rate):
        self.reads += 1
        return self.fire_after is not None and self.reads >= self.fire_after


def wait_until(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class PendingSendListenerTests(unittest.TestCase):
    def make(self, detector, still_pending=lambda text: True, should_pause=lambda: False):
        sent = []
        listener = PendingSendListener(
            create_detector=lambda: detector,
            open_reader=FakeReader,
            should_pause=should_pause,
            still_pending=still_pending,
            on_send=sent.append,
            check_interval=0.0,
        )
        return listener, sent

    def test_sends_when_phrase_is_heard(self):
        listener, sent = self.make(FakeDetector(fire_after=3))
        listener.arm("fix the login bug")
        self.assertTrue(wait_until(lambda: sent == ["fix the login bug"]))
        self.assertTrue(wait_until(lambda: not listener.armed))

    def test_stops_when_text_is_no_longer_waiting(self):
        waiting = threading.Event()
        waiting.set()
        listener, sent = self.make(
            FakeDetector(fire_after=None),
            still_pending=lambda text: waiting.is_set(),
        )
        listener.arm("draft prompt")
        time.sleep(0.05)
        waiting.clear()
        self.assertTrue(wait_until(lambda: not listener.armed))
        self.assertEqual(sent, [])

    def test_does_not_listen_while_paused(self):
        detector = FakeDetector(fire_after=1)
        listener, sent = self.make(detector, should_pause=lambda: True)
        listener.arm("draft prompt")
        time.sleep(0.1)
        self.assertEqual(sent, [])
        self.assertEqual(detector.reads, 0)
        listener.disarm()


if __name__ == "__main__":
    unittest.main()
