"""Notice when an external dictation app pastes fresh text into the target app."""

import threading
import time


class DictationWatch:
    """Waits for a new, non-empty pasteboard value after dictation starts.

    Dictation apps such as Wispr Flow and FluidVoice insert text by pasting, and
    may restore the previous pasteboard right after, so the first fresh value
    seen is the dictated text.
    """

    def __init__(
        self,
        snapshot,
        on_text,
        settle_seconds=0.2,
        poll_seconds=0.05,
        clock=time.monotonic,
        sleep=time.sleep,
    ):
        self._snapshot = snapshot
        self._on_text = on_text
        self._settle_seconds = settle_seconds
        self._poll_seconds = poll_seconds
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._deadline = 0.0
        self._baseline = (-1, "")
        self._thread = None

    @property
    def active(self):
        with self._lock:
            return self._clock() < self._deadline

    def start(self, timeout):
        """Begin watching, or move the deadline of a watch already in progress."""
        with self._lock:
            now = self._clock()
            if now >= self._deadline:
                self._baseline = self._snapshot()
            self._deadline = now + timeout
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()

    def cancel(self):
        with self._lock:
            self._deadline = 0.0

    def _run(self):
        while True:
            with self._lock:
                if self._clock() >= self._deadline:
                    self._thread = None
                    return
                baseline_count, baseline_text = self._baseline
            count, text = self._snapshot()
            if count > baseline_count and text.strip() and text != baseline_text:
                self._sleep(self._settle_seconds)
                with self._lock:
                    cancelled = self._clock() >= self._deadline
                    self._deadline = 0.0
                    self._thread = None
                if not cancelled:
                    self._on_text(text.strip())
                return
            self._sleep(self._poll_seconds)
