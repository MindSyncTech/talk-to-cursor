"""Built-in local speech-to-text for the Background Helper.

``streaming`` decodes while the user speaks (NeMo fast-conformer transducer),
so the transcript is ready as soon as the turn ends. ``parakeet`` decodes the
whole utterance at the end with the more accurate Parakeet TDT model.
"""

import threading

import numpy as np

from model_download import PARAKEET_STT, STREAMING_STT, ensure_model

SAMPLE_RATE = 16000
_recognizers = {}
_recognizers_lock = threading.Lock()


def _load_recognizer(user_data_dir, model):
    import sherpa_onnx

    with _recognizers_lock:
        if model in _recognizers:
            return _recognizers[model]
        if model == "parakeet":
            directory = ensure_model(user_data_dir, PARAKEET_STT, "[stt]")
            recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
                encoder=str(directory / "encoder.int8.onnx"),
                decoder=str(directory / "decoder.int8.onnx"),
                joiner=str(directory / "joiner.int8.onnx"),
                tokens=str(directory / "tokens.txt"),
                num_threads=4,
                sample_rate=SAMPLE_RATE,
                model_type="nemo_transducer",
            )
        else:
            directory = ensure_model(user_data_dir, STREAMING_STT, "[stt]")
            recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                tokens=str(directory / "tokens.txt"),
                encoder=str(directory / "encoder.int8.onnx"),
                decoder=str(directory / "decoder.int8.onnx"),
                joiner=str(directory / "joiner.int8.onnx"),
                num_threads=2,
                sample_rate=SAMPLE_RATE,
                enable_endpoint_detection=False,
            )
        _recognizers[model] = recognizer
        return recognizer


def preload(user_data_dir, model):
    """Download and load the model ahead of the first turn."""
    _load_recognizer(user_data_dir, model)


class BuiltinTranscriber:
    """Feed 16 kHz float samples during a turn, then call ``finish``."""

    def __init__(self, user_data_dir, model="streaming"):
        self.model = "parakeet" if model == "parakeet" else "streaming"
        self.recognizer = _load_recognizer(user_data_dir, self.model)
        self._lock = threading.Lock()
        self._chunks = []
        self._stream = None
        if self.model == "streaming":
            self._stream = self.recognizer.create_stream()

    def accept(self, samples):
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        with self._lock:
            if self._stream is not None:
                self._stream.accept_waveform(SAMPLE_RATE, samples)
                while self.recognizer.is_ready(self._stream):
                    self.recognizer.decode_stream(self._stream)
            else:
                self._chunks.append(samples.copy())

    def partial(self):
        with self._lock:
            if self._stream is None:
                return ""
            return _clean(self.recognizer.get_result(self._stream))

    def finish(self):
        with self._lock:
            if self._stream is not None:
                tail = np.zeros(int(0.4 * SAMPLE_RATE), dtype=np.float32)
                self._stream.accept_waveform(SAMPLE_RATE, tail)
                self._stream.input_finished()
                while self.recognizer.is_ready(self._stream):
                    self.recognizer.decode_stream(self._stream)
                return _clean(self.recognizer.get_result(self._stream))
            if not self._chunks:
                return ""
            stream = self.recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, np.concatenate(self._chunks))
            self.recognizer.decode_stream(stream)
            return _clean(stream.result.text)


def _clean(text):
    text = " ".join(str(text or "").split())
    if not text:
        return ""
    # Some English models emit all-caps text.
    if text.isupper():
        text = text.lower()
        text = text[0].upper() + text[1:]
    return text
