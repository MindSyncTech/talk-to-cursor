"""Listen for the spoken submit phrase after dictated text was inserted but not sent."""

import threading
import time


class PendingSendListener:
    """Runs only while unsent dictation waits in the target field."""

    def __init__(
        self,
        create_detector,
        open_reader,
        should_pause,
        still_pending,
        on_send,
        sample_rate=16000,
        read_seconds=0.1,
        check_interval=0.5,
    ):
        self._create_detector = create_detector
        self._open_reader = open_reader
        self._should_pause = should_pause
        self._still_pending = still_pending
        self._on_send = on_send
        self.sample_rate = sample_rate
        self.samples_per_read = int(read_seconds * sample_rate)
        self.check_interval = check_interval
        self._lock = threading.Lock()
        self._text = None
        self._reset_detector = False
        self._thread = None
        self._detector = None

    @property
    def armed(self):
        with self._lock:
            return self._text is not None

    def arm(self, text):
        text = (text or "").strip()
        if not text:
            return
        with self._lock:
            self._text = text
            self._reset_detector = True
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, daemon=True)
                self._thread.start()

    def disarm(self):
        with self._lock:
            self._text = None

    def _current(self):
        with self._lock:
            text = self._text
            reset = self._reset_detector
            self._reset_detector = False
            if text is None:
                self._thread = None
            return text, reset

    def _run(self):
        reader = None
        last_check = 0.0
        try:
            while True:
                text, reset = self._current()
                if text is None:
                    return
                if self._detector is None:
                    self._detector = self._create_detector()
                if reset:
                    self._detector.reset()

                if self._should_pause():
                    reader = _close(reader)
                    time.sleep(0.1)
                    continue

                now = time.monotonic()
                if now - last_check >= self.check_interval:
                    last_check = now
                    if not self._still_pending(text):
                        self._disarm_if(text)
                        continue

                if reader is None:
                    reader = self._open_reader()
                    reader.__enter__()
                    print("[send-it] Microphone open; listening for the phrase")
                samples, overflowed = reader.read(self.samples_per_read)
                if overflowed:
                    continue
                if self._detector.accept(samples, self.sample_rate):
                    self._disarm_if(text)
                    self._on_send(text)
        except Exception as error:
            print(f"[send-it] Stopped listening: {error}")
            with self._lock:
                self._text = None
                self._thread = None
        finally:
            _close(reader)

    def _disarm_if(self, text):
        with self._lock:
            if self._text == text:
                self._text = None


def _close(reader):
    if reader is not None:
        try:
            reader.__exit__(None, None, None)
        except Exception:
            pass
    return None
