"""Shared microphone and speaker I/O for the Background Helper.

One PortAudio stream carries TTS playback and, when enabled, microphone
capture. Capture is echo-cancelled against the playback signal with the
WebRTC audio processing module shipped in the ``livekit`` package, so the
microphone can stay open while the agent speaks (barge-in).
"""

import collections
import queue
import threading
import time

import numpy as np

SAMPLE_RATE = 24000
FRAME_SAMPLES = 240  # 10 ms, required by the WebRTC audio processing module
PREROLL_SECONDS = 2.0


def resample_frame(samples, target_rate):
    """Resample one 10 ms float frame from 24 kHz to target_rate."""
    if target_rate == SAMPLE_RATE:
        return samples
    target_length = int(len(samples) * target_rate / SAMPLE_RATE)
    positions = np.arange(target_length) * (SAMPLE_RATE / target_rate)
    return np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)


class _EchoCanceller:
    def __init__(self):
        from livekit import rtc

        self._rtc = rtc
        self._apm = rtc.AudioProcessingModule(
            echo_cancellation=True,
            noise_suppression=True,
            high_pass_filter=True,
            auto_gain_control=False,
        )

    def set_delay_ms(self, delay_ms):
        try:
            self._apm.set_stream_delay_ms(int(delay_ms))
        except Exception:
            pass

    def process(self, capture, playback):
        rtc = self._rtc
        reverse = rtc.AudioFrame(playback.tobytes(), SAMPLE_RATE, 1, FRAME_SAMPLES)
        self._apm.process_reverse_stream(reverse)
        frame = rtc.AudioFrame(bytearray(capture.tobytes()), SAMPLE_RATE, 1, FRAME_SAMPLES)
        self._apm.process_stream(frame)
        return np.frombuffer(frame.data, dtype=np.int16).copy()


class MicReader:
    """Blocking reader that mimics ``sounddevice.InputStream.read``."""

    def __init__(self, audio, sample_rate, preroll_seconds):
        self._audio = audio
        self._sample_rate = sample_rate
        self._pending = collections.deque()
        self._available = 0
        self._condition = threading.Condition()
        self._closed = False
        if preroll_seconds > 0:
            for frame in audio.history(preroll_seconds):
                self._push(frame)

    def _push(self, frame_int16):
        samples = resample_frame(
            frame_int16.astype(np.float32) / 32768.0,
            self._sample_rate,
        )
        with self._condition:
            self._pending.append(samples)
            self._available += len(samples)
            self._condition.notify_all()

    def read(self, count, timeout=2.0):
        deadline = time.monotonic() + timeout
        with self._condition:
            while self._available < count:
                if self._closed:
                    raise RuntimeError("Microphone reader is closed")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("Microphone stopped delivering audio")
                self._condition.wait(remaining)
            parts = []
            needed = count
            while needed > 0:
                head = self._pending[0]
                if len(head) <= needed:
                    parts.append(head)
                    self._pending.popleft()
                    needed -= len(head)
                else:
                    parts.append(head[:needed])
                    self._pending[0] = head[needed:]
                    needed = 0
            self._available -= count
        return np.concatenate(parts).reshape(-1, 1), False

    def close(self):
        with self._condition:
            self._closed = True
            self._condition.notify_all()
        self._audio._remove_reader(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class DuplexAudio:
    def __init__(
        self,
        input_enabled=False,
        echo_cancellation=True,
        input_gain_db=0.0,
        on_playback_event=None,
    ):
        self.input_enabled = input_enabled
        self._input_gain = 10 ** (float(input_gain_db) / 20) if input_gain_db else 1.0
        self.on_playback_event = on_playback_event
        self._lock = threading.Lock()
        self._segments = collections.deque()
        self._streams = {}
        self._cancelled = collections.deque(maxlen=64)
        self._events = queue.Queue()
        self._captures = queue.Queue(maxsize=500)
        self._readers = set()
        self._listeners = set()
        self._history = collections.deque(
            maxlen=int(PREROLL_SECONDS * SAMPLE_RATE / FRAME_SAMPLES)
        )
        self._levels = collections.deque(maxlen=15)
        self._stream = None
        self._output_latency = 0.0
        self._aec = None
        if input_enabled and echo_cancellation:
            try:
                self._aec = _EchoCanceller()
            except Exception as error:
                print(f"[audio] Echo cancellation unavailable: {error}")

    @property
    def aec_active(self):
        return self._aec is not None

    def start(self):
        import sounddevice as sd

        if self.input_enabled:
            self._stream = sd.Stream(
                samplerate=SAMPLE_RATE,
                blocksize=FRAME_SAMPLES,
                channels=1,
                dtype="int16",
                latency="low",
                callback=self._duplex_callback,
            )
        else:
            self._stream = sd.OutputStream(
                samplerate=SAMPLE_RATE,
                blocksize=FRAME_SAMPLES,
                channels=1,
                dtype="int16",
                latency="low",
                callback=self._output_callback,
            )
        self._stream.start()
        latency = self._stream.latency
        if isinstance(latency, (tuple, list)):
            self._output_latency = float(latency[1])
            if self._aec is not None:
                self._aec.set_delay_ms((float(latency[0]) + float(latency[1])) * 1000)
        else:
            self._output_latency = float(latency)
        threading.Thread(target=self._event_loop, daemon=True).start()
        if self.input_enabled:
            threading.Thread(target=self._capture_loop, daemon=True).start()
        mode = "duplex" if self.input_enabled else "output"
        aec = "on" if self.aec_active else "off"
        boost = f", input boost +{20 * np.log10(self._input_gain):.0f} dB" if self._input_gain != 1.0 else ""
        print(f"[audio] Started {mode} audio (echo cancellation {aec}{boost})")

    def stop(self):
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    # ─── Playback ───────────────────────────────────────────────────────

    def begin_stream(self, stream_id):
        with self._lock:
            self._streams[stream_id] = {"ended": False, "started": False}

    def write(self, stream_id, pcm_bytes):
        if not pcm_bytes:
            return
        with self._lock:
            if stream_id in self._cancelled:
                return
            if stream_id not in self._streams:
                self._streams[stream_id] = {"ended": False, "started": False}
            self._segments.append([stream_id, bytearray(pcm_bytes)])

    def end_stream(self, stream_id):
        with self._lock:
            state = self._streams.get(stream_id)
            if state is None:
                if stream_id not in self._cancelled:
                    self._events.put(("finished", stream_id, False))
                return
            state["ended"] = True
            if not any(segment[0] == stream_id for segment in self._segments):
                del self._streams[stream_id]
                self._events.put(("finished", stream_id, False))

    def cancel(self, stream_id=None):
        """Drop queued audio. Returns the cancelled stream ids."""
        with self._lock:
            if stream_id is None:
                cancelled = list(self._streams)
                self._segments.clear()
                self._streams.clear()
            else:
                cancelled = [stream_id] if stream_id in self._streams else []
                self._segments = collections.deque(
                    segment for segment in self._segments if segment[0] != stream_id
                )
                self._streams.pop(stream_id, None)
            for cancelled_id in cancelled:
                self._cancelled.append(cancelled_id)
        for cancelled_id in cancelled:
            self._events.put(("finished", cancelled_id, True))
        return cancelled

    def is_playing(self):
        with self._lock:
            return bool(self._segments)

    def _fill(self, frames):
        needed = frames * 2
        output = bytearray()
        with self._lock:
            while len(output) < needed and self._segments:
                stream_id, buffer = self._segments[0]
                state = self._streams.get(stream_id)
                if state is not None and not state["started"]:
                    state["started"] = True
                    self._events.put(("started", stream_id, False))
                take = min(len(buffer), needed - len(output))
                output += buffer[:take]
                del buffer[:take]
                if not buffer:
                    self._segments.popleft()
                    if (
                        state is not None
                        and state["ended"]
                        and not any(s[0] == stream_id for s in self._segments)
                    ):
                        del self._streams[stream_id]
                        self._events.put(("finished", stream_id, False))
        if len(output) < needed:
            output += bytes(needed - len(output))
        return np.frombuffer(bytes(output), dtype=np.int16)

    def _output_callback(self, outdata, frames, _time, _status):
        outdata[:, 0] = self._fill(frames)

    def _duplex_callback(self, indata, outdata, frames, _time, _status):
        playback = self._fill(frames)
        outdata[:, 0] = playback
        try:
            self._captures.put_nowait((indata[:, 0].copy(), playback))
        except queue.Full:
            pass

    def _event_loop(self):
        while True:
            kind, stream_id, interrupted = self._events.get()
            if kind == "finished" and not interrupted and self._output_latency > 0:
                time.sleep(self._output_latency)
            if self.on_playback_event is not None:
                try:
                    self.on_playback_event(kind, stream_id, interrupted)
                except Exception as error:
                    print(f"[audio] Playback event handler failed: {error}")

    # ─── Capture ────────────────────────────────────────────────────────

    def add_listener(self, callback):
        """Call ``callback(int16_frame)`` for every echo-cancelled 10 ms frame."""
        with self._lock:
            self._listeners.add(callback)

        def remove():
            with self._lock:
                self._listeners.discard(callback)

        return remove

    def open_reader(self, sample_rate=16000, preroll_seconds=0.0):
        if not self.input_enabled:
            raise RuntimeError("Duplex audio was started without microphone input")
        reader = MicReader(self, sample_rate, preroll_seconds)
        with self._lock:
            self._readers.add(reader)
        return reader

    def history(self, seconds):
        count = int(seconds * SAMPLE_RATE / FRAME_SAMPLES)
        with self._lock:
            frames = list(self._history)
        return frames[-count:] if count else []

    def input_level(self):
        """Loudest RMS and peak (0-1 full scale) over the last ~150 ms of input."""
        with self._lock:
            levels = list(self._levels)
        if not levels:
            return 0.0, 0.0
        return max(rms for rms, _ in levels), max(peak for _, peak in levels)

    def _remove_reader(self, reader):
        with self._lock:
            self._readers.discard(reader)

    def _capture_loop(self):
        while True:
            capture, playback = self._captures.get()
            if len(capture) != FRAME_SAMPLES:
                continue
            if self._input_gain != 1.0:
                capture = np.clip(
                    capture.astype(np.float32) * self._input_gain, -32768, 32767
                ).astype(np.int16)
            if self._aec is not None:
                try:
                    capture = self._aec.process(capture, playback)
                except Exception as error:
                    print(f"[audio] Echo cancellation failed; continuing without it: {error}")
                    self._aec = None
            samples = capture.astype(np.float32) / 32768.0
            level = (
                float(np.sqrt(np.mean(samples * samples))),
                float(np.max(np.abs(samples))),
            )
            with self._lock:
                self._history.append(capture)
                self._levels.append(level)
                readers = list(self._readers)
                listeners = list(self._listeners)
            for reader in readers:
                reader._push(capture)
            for listener in listeners:
                try:
                    listener(capture)
                except Exception as error:
                    print(f"[audio] Capture listener failed: {error}")
