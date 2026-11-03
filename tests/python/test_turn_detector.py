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
    instance.no_speech_timeout = 30.0
    instance.max_turn_seconds = 120.0
    instance._stop_requested = turn_detector.threading.Event()
    instance.audio_source = None
    instance.preroll_seconds = 0.0
    instance.on_audio = None
    instance.speech_detector = None
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

    def test_noise_above_threshold_ends_at_max_turn_duration(self):
        loud = np.full((800, 1), 0.05, dtype=np.float32)
        instance = detector("fixed")
        instance.max_turn_seconds = 1.0
        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=FakeInputStream([loud, loud, loud]),
            ),
            patch.object(turn_detector.time, "monotonic", side_effect=[0.0, 0.5, 1.2]),
        ):
            result = instance.wait_for_turn_end(verbose=False)
        self.assertTrue(result.speech_detected)
        self.assertEqual(result.reason, TurnEndReason.MAX_DURATION)

    def test_loud_noise_without_voice_is_not_speech(self):
        loud = np.full((800, 1), 0.05, dtype=np.float32)
        instance = detector("fixed")
        instance.no_speech_timeout = 1.0
        instance.speech_detector = SimpleNamespace(accept=lambda _samples: False)
        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=FakeInputStream([loud, loud, loud]),
            ),
            patch.object(turn_detector.time, "monotonic", side_effect=[0.0, 0.5, 1.2]),
        ):
            result = instance.wait_for_turn_end(verbose=False)
        self.assertFalse(result.speech_detected)
        self.assertEqual(result.reason, TurnEndReason.NO_SPEECH)

    def test_stop_request_finishes_turn_with_speech(self):
        loud = np.full((800, 1), 0.05, dtype=np.float32)
        instance = detector("fixed")

        class StoppingStream(FakeInputStream):
            reads = 0

            def read(self, chunk_size):
                self.reads += 1
                if self.reads == 2:
                    instance.request_stop()
                return super().read(chunk_size)

        with (
            patch.object(
                turn_detector.sd,
                "InputStream",
                return_value=StoppingStream([loud, loud]),
            ),
            patch.object(turn_detector.time, "monotonic", side_effect=[0.0, 0.05]),
        ):
            result = instance.wait_for_turn_end(verbose=False)
        self.assertEqual(result.reason, TurnEndReason.MANUAL_STOP)

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
