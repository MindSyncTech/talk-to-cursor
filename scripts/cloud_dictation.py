"""Cloud dictation for the Background Helper.

TalkToCursor Cloud opens a metered session and returns a short-lived Deepgram
token. Audio streams from this Mac directly to Deepgram; Cloud only sees the
session heartbeats it bills from. If Cloud can't be used, the turn's audio is
transcribed by a local model that is already downloaded.
"""

import json
import os
import platform
import queue
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
KEYCHAIN_SERVICE = "com.talktocursor.cloud"
KEYCHAIN_ACCOUNT = "device-token"
MAX_BUFFER_SECONDS = 600


class CloudDictationError(Exception):
    pass


def read_cloud_token(user_data_dir):
    token = os.environ.get("TALKTOCURSOR_CLOUD_TOKEN", "").strip()
    if token:
        return token
    if platform.system() == "Darwin":
        try:
            result = subprocess.run(
                [
                    "security",
                    "find-generic-password",
                    "-a",
                    KEYCHAIN_ACCOUNT,
                    "-s",
                    KEYCHAIN_SERVICE,
                    "-w",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        return (Path(user_data_dir) / "cloud-token").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def post_json(url, token, body, timeout):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "TalkToCursor-Helper",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read() or b"{}")
        except ValueError:
            payload = {}
        message = (payload.get("error") or {}).get("message")
        raise CloudDictationError(message or f"Cloud returned HTTP {error.code}") from None
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise CloudDictationError(f"Could not reach Cloud: {error}") from None


def connect_websocket(url, access_token):
    from websockets.sync.client import connect

    return connect(
        url,
        additional_headers={"Authorization": f"Bearer {access_token}"},
        open_timeout=10,
        close_timeout=3,
        max_size=2**20,
    )


def to_pcm16(samples):
    samples = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    return (samples * 32767.0).astype("<i2").tobytes()


class CloudTranscriber:
    """Feed 16 kHz float samples during a turn, then call ``finish``.

    Matches ``BuiltinTranscriber``. Connecting happens in the background so
    the first words aren't lost; audio is queued until the stream is open.
    """

    def __init__(
        self,
        api_url,
        token,
        fallback_factory=None,
        *,
        post=post_json,
        connect=connect_websocket,
        log=print,
    ):
        self._api_url = str(api_url or "").rstrip("/")
        self._token = token
        self._fallback_factory = fallback_factory
        self._post = post
        self._connect = connect
        self._log = log
        self._lock = threading.Lock()
        self._finals = []
        self._interim = ""
        self._samples = []
        self._buffered = 0
        self._queue = queue.Queue()
        self._connected = threading.Event()
        self._stop_sending = threading.Event()
        self._done = threading.Event()
        self._error = None
        self._ws = None
        self._receiver = None
        self._session_id = None
        self._heartbeat_seconds = 15.0
        self._final_reported = False
        self._worker = threading.Thread(target=self._run, daemon=True)
        self._worker.start()

    @property
    def error(self):
        return self._error

    def accept(self, samples):
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        with self._lock:
            if self._buffered < MAX_BUFFER_SECONDS * SAMPLE_RATE:
                self._samples.append(samples.copy())
                self._buffered += samples.size
        if not self._stop_sending.is_set():
            self._queue.put(to_pcm16(samples))

    def partial(self):
        with self._lock:
            return _clean(" ".join([*self._finals, self._interim]))

    def finish(self):
        self._stop_sending.set()
        self._queue.put(None)
        self._worker.join(timeout=15)
        if self._receiver is not None:
            self._receiver.join(timeout=5)
        self._close_socket()
        self._report_final()
        self._done.set()
        with self._lock:
            text = _clean(" ".join(self._finals))
        if self._error is not None:
            return self._fallback_transcript() or text
        return text

    def cancel(self):
        self._stop_sending.set()
        self._queue.put(None)
        self._done.set()
        self._close_socket()
        self._worker.join(timeout=15)
        self._report_final()

    def _run(self):
        try:
            if not self._token:
                raise CloudDictationError("connect a Cloud account first")
            session = self._post(
                f"{self._api_url}/api/v1/dictation/sessions",
                self._token,
                {},
                10,
            )
            self._session_id = session["sessionId"]
            self._heartbeat_seconds = max(5.0, float(session.get("heartbeatSeconds") or 15))
            if self._done.is_set():
                return
            try:
                self._ws = self._connect(session["listenUrl"], session["accessToken"])
            except Exception as error:
                raise CloudDictationError(f"could not connect to speech recognition: {error}") from None
            self._connected.set()
            self._receiver = threading.Thread(target=self._receive, daemon=True)
            self._receiver.start()
            threading.Thread(target=self._heartbeat, daemon=True).start()
            self._send_audio()
        except CloudDictationError as error:
            self._fail(error)
        except (KeyError, TypeError, ValueError) as error:
            self._fail(CloudDictationError(f"Cloud returned an unexpected session: {error}"))

    def _send_audio(self):
        while True:
            chunk = self._queue.get()
            if chunk is None:
                break
            try:
                self._ws.send(chunk)
            except Exception as error:
                self._fail(CloudDictationError(f"audio stream closed: {error}"))
                return
        try:
            self._ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass

    def _receive(self):
        try:
            for message in self._ws:
                if isinstance(message, bytes):
                    continue
                try:
                    data = json.loads(message)
                except ValueError:
                    continue
                if data.get("type") != "Results":
                    continue
                alternatives = (data.get("channel") or {}).get("alternatives") or [{}]
                transcript = str(alternatives[0].get("transcript") or "").strip()
                with self._lock:
                    if data.get("is_final"):
                        if transcript:
                            self._finals.append(transcript)
                        self._interim = ""
                    else:
                        self._interim = transcript
        except Exception as error:
            if not self._stop_sending.is_set():
                self._fail(CloudDictationError(f"speech recognition stopped: {error}"))

    def _heartbeat(self):
        while not self._done.wait(self._heartbeat_seconds):
            try:
                result = self._post(
                    f"{self._api_url}/api/v1/dictation/usage",
                    self._token,
                    {"sessionId": self._session_id},
                    10,
                )
            except CloudDictationError as error:
                self._log(f"[stt] Cloud dictation heartbeat failed: {error}")
                continue
            if result.get("shouldStop"):
                remaining = int(result.get("remainingSeconds") or 0)
                reason = "minutes used up" if remaining <= 0 else "session limit reached"
                self._log(f"[stt] Cloud dictation stopped ({reason})")
                self._stop_sending.set()
                self._queue.put(None)
                return

    def _report_final(self):
        with self._lock:
            if self._final_reported or self._session_id is None:
                return
            self._final_reported = True
        try:
            self._post(
                f"{self._api_url}/api/v1/dictation/usage",
                self._token,
                {"sessionId": self._session_id, "final": True},
                10,
            )
        except CloudDictationError as error:
            self._log(f"[stt] Could not close the Cloud dictation session: {error}")

    def _close_socket(self):
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass

    def _fail(self, error):
        if self._error is None:
            self._error = error
            self._log(f"[stt] Cloud dictation unavailable: {error}")
        self._stop_sending.set()

    def _fallback_transcript(self):
        transcriber = self._fallback_factory() if self._fallback_factory else None
        if transcriber is None:
            self._log("[stt] No local speech model is downloaded to fall back to")
            return ""
        self._log(f"[stt] Transcribing this turn with the local {transcriber.model} model")
        with self._lock:
            samples = list(self._samples)
        for chunk in samples:
            transcriber.accept(chunk)
        return transcriber.finish()


def _clean(text):
    return " ".join(str(text or "").split())
