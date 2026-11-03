"""Silero voice activity detection so steady noise is not mistaken for speech."""

from model_download import SILERO_VAD, ensure_model


class SpeechActivityDetector:
    def __init__(self, user_data_dir, sample_rate=16000, threshold=0.5):
        import sherpa_onnx

        directory = ensure_model(user_data_dir, SILERO_VAD, "[vad]")
        config = sherpa_onnx.VadModelConfig()
        config.silero_vad.model = str(directory / "silero_vad.onnx")
        config.silero_vad.threshold = threshold
        config.silero_vad.min_silence_duration = 0.2
        config.silero_vad.min_speech_duration = 0.1
        config.silero_vad.window_size = 512
        config.sample_rate = sample_rate
        config.num_threads = 1
        self._vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)

    def accept(self, samples):
        """Feed float32 mono samples; return True while a voice is detected."""
        self._vad.accept_waveform(samples)
        # Completed segments are not needed; drain them so the buffer stays small.
        while not self._vad.empty():
            self._vad.pop()
        return bool(self._vad.is_speech_detected())

    def reset(self):
        self._vad.reset()
