"""Hybrid RMS, Smart Turn, and spoken-command turn detection."""

import threading
import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import numpy as np
import sounddevice as sd


class TurnEndReason(Enum):
    SMART_TURN = "smart_turn"
    SUBMIT_COMMAND = "submit_command"
    FIXED_PAUSE = "fixed_pause"
    NO_SPEECH = "no_speech"
    MANUAL_STOP = "manual_stop"
    MAX_DURATION = "max_duration"


@dataclass(frozen=True)
class TurnEndResult:
    speech_detected: bool
    reason: TurnEndReason
    smart_probability: Optional[float] = None


class TurnDetector:
    def __init__(
        self,
        *,
        mode,
        user_data_dir,
        silence_threshold,
        fixed_silence,
        candidate_silence,
        smart_threshold,
        smart_max_silence,
        submit_command_enabled,
        submit_phrase,
        submit_sensitivity=0.65,
        no_speech_timeout=30.0,
        max_turn_seconds=120.0,
        sample_rate=16000,
        chunk_size=800,
        audio_source=None,
        preroll_seconds=0.0,
        on_audio=None,
        speech_detector=None,
    ):
        self.audio_source = audio_source
        self.speech_detector = speech_detector
        self.preroll_seconds = float(preroll_seconds)
        self.on_audio = on_audio
        self.mode = mode
        self.silence_threshold = float(silence_threshold)
        self.fixed_silence = float(fixed_silence)
        self.candidate_silence = float(candidate_silence)
        self.smart_threshold = float(smart_threshold)
        self.smart_max_silence = float(smart_max_silence)
        self.no_speech_timeout = float(no_speech_timeout)
        self.max_turn_seconds = float(max_turn_seconds)
        self._stop_requested = threading.Event()
        self.sample_rate = sample_rate
        self.chunk_size = chunk_size
        self.smart_analyzer = None
        self.submit_detector = None

        if mode == "smart":
            try:
                from smart_turn import SmartTurnAnalyzer

                self.smart_analyzer = SmartTurnAnalyzer(user_data_dir)
                print("[smart-turn] Local endpoint detector ready")
            except Exception as error:
                print(f"[smart-turn] Unavailable; using fixed-pause fallback: {error}")

        if submit_command_enabled:
            try:
                from wake_word import StreamingKeywordDetector

                self.submit_detector = StreamingKeywordDetector(
                    user_data_dir,
                    submit_phrase,
                    submit_sensitivity,
                    filename="submit-command-keywords.txt",
                )
                print(f'[turn-detector] Spoken submit command ready: "{submit_phrase}"')
            except Exception as error:
                print(f"[turn-detector] Spoken submit command unavailable: {error}")

    @property
    def fast_path_threshold(self):
        """Probability that completes a turn without a second confirmation."""
        return min(0.95, self.smart_threshold + 0.25)

    def _open_microphone(self):
        if self.audio_source is not None:
            return self.audio_source.open_reader(
                sample_rate=self.sample_rate,
                preroll_seconds=self.preroll_seconds,
            )
        from audio_io import input_stream_settings

        return sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=self.chunk_size,
            **input_stream_settings(),
        )

    def request_stop(self):
        """Finish the current turn as soon as the next audio chunk arrives."""
        self._stop_requested.set()

    def wait_for_turn_end(self, verbose=True):
        """Block until speech ends semantically or a fallback condition fires."""
        audio_chunks = deque(
            maxlen=max(1, int((8 * self.sample_rate) / self.chunk_size))
        )
        speech_detected = False
        silence_started = None
        speech_started = None
        next_smart_check = 0.0
        last_probability = None
        completion_checks = 0
        listening_started = None
        noise_floor = min(0.001, self.silence_threshold / 3)
        effective_threshold = min(
            self.silence_threshold,
            max(0.0015, noise_floor * 2.5),
        )

        if verbose:
            detector_name = (
                "Smart Turn"
                if self.mode == "smart" and self.smart_analyzer is not None
                else "fixed pause"
            )
            voice_check = (
                ", voice activity detection on" if self.speech_detector is not None else ""
            )
            print(
                f"[turn-detector] Listening with {detector_name} "
                f"(adaptive RMS threshold: {effective_threshold:.4f}, "
                f"configured ceiling: {self.silence_threshold:.4f}{voice_check})"
            )

        with self._open_microphone() as microphone:
            while True:
                audio_data, overflowed = microphone.read(self.chunk_size)
                if overflowed and verbose:
                    print("[turn-detector] Warning: microphone buffer overflow")

                samples = audio_data.reshape(-1).astype(np.float32, copy=False)
                audio_chunks.append(samples.copy())
                if self.on_audio is not None:
                    self.on_audio(samples)
                rms = float(np.sqrt(np.mean(samples ** 2)))
                now = time.monotonic()
                if listening_started is None:
                    listening_started = now

                if self._stop_requested.is_set():
                    print("[turn-detector] Stop requested; finishing turn")
                    return TurnEndResult(
                        speech_detected=speech_detected,
                        reason=(
                            TurnEndReason.MANUAL_STOP
                            if speech_detected
                            else TurnEndReason.NO_SPEECH
                        ),
                        smart_probability=last_probability,
                    )

                if (
                    speech_started is not None
                    and now - speech_started >= self.max_turn_seconds
                ):
                    print(
                        f"[turn-detector] Turn reached {self.max_turn_seconds:.0f}s; "
                        "finishing. Background noise may be above the speech threshold."
                    )
                    return TurnEndResult(
                        speech_detected=True,
                        reason=TurnEndReason.MAX_DURATION,
                        smart_probability=last_probability,
                    )

                if self.submit_detector is not None and self.submit_detector.accept(
                    samples, self.sample_rate
                ):
                    print("[turn-detector] Spoken submit command detected")
                    return TurnEndResult(
                        speech_detected=True,
                        reason=TurnEndReason.SUBMIT_COMMAND,
                        smart_probability=last_probability,
                    )

                voiced = (
                    self.speech_detector.accept(samples)
                    if self.speech_detector is not None
                    else True
                )
                if rms >= effective_threshold and voiced:
                    if not speech_detected and verbose:
                        print(
                            f"[turn-detector] Speech detected "
                            f"(RMS: {rms:.4f}, threshold: {effective_threshold:.4f})"
                        )
                    if speech_started is None:
                        speech_started = now
                    speech_detected = True
                    silence_started = None
                    next_smart_check = 0.0
                    completion_checks = 0
                    continue

                if not speech_detected:
                    noise_floor = (noise_floor * 0.9) + (rms * 0.1)
                    effective_threshold = min(
                        self.silence_threshold,
                        max(0.0015, noise_floor * 2.5),
                    )
                    if (
                        listening_started is not None
                        and now - listening_started >= self.no_speech_timeout
                    ):
                        print(
                            f"[turn-detector] No speech detected after "
                            f"{self.no_speech_timeout:.0f}s; cancelling turn"
                        )
                        return TurnEndResult(
                            speech_detected=False,
                            reason=TurnEndReason.NO_SPEECH,
                        )
                    continue
                if silence_started is None:
                    silence_started = now
                    next_smart_check = now + self.candidate_silence
                    continue

                quiet_for = now - silence_started
                if self.mode != "smart" or self.smart_analyzer is None:
                    fallback_silence = (
                        self.smart_max_silence
                        if self.mode == "smart"
                        else self.fixed_silence
                    )
                    if quiet_for >= fallback_silence:
                        return TurnEndResult(
                            speech_detected=True,
                            reason=TurnEndReason.FIXED_PAUSE,
                        )
                    continue

                if quiet_for >= self.smart_max_silence:
                    print(
                        f"[smart-turn] Maximum silence reached "
                        f"({quiet_for:.2f}s); completing turn"
                    )
                    return TurnEndResult(
                        speech_detected=True,
                        reason=TurnEndReason.FIXED_PAUSE,
                        smart_probability=last_probability,
                    )

                if now < next_smart_check:
                    continue
                if speech_started is not None and now - speech_started < 1.5:
                    next_smart_check = now + self.candidate_silence
                    continue

                try:
                    turn_audio = np.concatenate(tuple(audio_chunks))
                    prediction = self.smart_analyzer.predict(turn_audio)
                    last_probability = prediction.probability
                    print(
                        f"[smart-turn] Completion probability "
                        f"{prediction.probability:.2f} "
                        f"({prediction.inference_ms:.0f} ms)"
                    )
                    if prediction.probability >= self.smart_threshold:
                        completion_checks += 1
                        if (
                            completion_checks >= 2
                            or prediction.probability >= self.fast_path_threshold
                        ):
                            return TurnEndResult(
                                speech_detected=True,
                                reason=TurnEndReason.SMART_TURN,
                                smart_probability=prediction.probability,
                            )
                        print(
                            "[smart-turn] Completion candidate; waiting for "
                            "confirmation"
                        )
                        next_smart_check = now + 0.25
                        continue
                    completion_checks = 0
                except Exception as error:
                    print(f"[smart-turn] Inference failed; using fallback: {error}")
                    self.smart_analyzer = None

                next_smart_check = now + self.candidate_silence
