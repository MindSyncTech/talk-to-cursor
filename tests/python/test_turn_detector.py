import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import turn_detector
from turn_detector import TurnDetector, TurnEndReason


class FakeInputStream:
    def __init__(self, chunks):
        self.chunks = iter(chunks)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _chunk_size):
        return next(self.chunks), False


def detector(mode, analyzer=None):
    instance = TurnDetector.__new__(TurnDetector)
    instance.mode = mode
    instance.silence_threshold = 0.02
    instance.fixed_silence = 0.1
    instance.candidate_silence = 0.1
    instance.smart_threshold = 0.5
    instance.smart_max_silence = 1.0
    instance.sample_rate = 16000
    instance.chunk_size = 800
    instance.smart_analyzer = analyzer
    instance.submit_detector = None
    return instance


class TurnDetectorTests(unittest.TestCase):
    def test_fixed_mode_completes_after_silence(self):
        chunks = [
            np.full((800, 1), 0.05, dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
        ]
        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=FakeInputStream(chunks),
            ),
            patch.object(turn_detector.time, "monotonic", side_effect=[0.0, 0.05, 0.2]),
        ):
            result = detector("fixed").wait_for_turn_end(verbose=False)
        self.assertEqual(result.reason, TurnEndReason.FIXED_PAUSE)

    def test_smart_mode_keeps_model_probability(self):
        chunks = [
            np.full((800, 1), 0.05, dtype=np.float32),
            np.full((800, 1), 0.05, dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
        ]
        analyzer = SimpleNamespace(
            predict=lambda _audio: SimpleNamespace(
                probability=0.8,
                inference_ms=12,
            )
        )
        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=FakeInputStream(chunks),
            ),
            patch.object(
                turn_detector.time,
                "monotonic",
                side_effect=[0.0, 1.5, 1.55, 1.7, 2.0],
            ),
        ):
            result = detector("smart", analyzer).wait_for_turn_end(verbose=False)
        self.assertEqual(result.reason, TurnEndReason.SMART_TURN)
        self.assertEqual(result.smart_probability, 0.8)

    def test_unavailable_smart_model_uses_max_silence(self):
        chunks = [
            np.full((800, 1), 0.05, dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
            np.zeros((800, 1), dtype=np.float32),
        ]
        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=FakeInputStream(chunks),
            ),
            patch.object(
                turn_detector.time,
                "monotonic",
                side_effect=[0.0, 0.05, 0.2, 1.1],
            ),
        ):
            result = detector("smart").wait_for_turn_end(verbose=False)
        self.assertEqual(result.reason, TurnEndReason.FIXED_PAUSE)


if __name__ == "__main__":
    unittest.main()
