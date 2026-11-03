import json
import queue
import threading
import unittest

import numpy as np

from cloud_dictation import CloudDictationError, CloudTranscriber, to_pcm16

SESSION = {
    "sessionId": "session-1",
    "accessToken": "jwt-1",
    "listenUrl": "wss://api.deepgram.com/v1/listen?model=nova-3",
    "heartbeatSeconds": 15,
}


def result(transcript, is_final=True):
    return json.dumps({
        "type": "Results",
        "is_final": is_final,
        "channel": {"alternatives": [{"transcript": transcript}]},
    })


class FakeSocket:
    """Replays transcripts once the client sends CloseStream."""

    def __init__(self, transcripts):
        self.transcripts = transcripts
        self.sent = []
        self.messages = queue.Queue()
        self.closed = False

    def send(self, message):
        self.sent.append(message)
        if isinstance(message, str) and json.loads(message).get("type") == "CloseStream":
            for transcript in self.transcripts:
                self.messages.put(result(transcript))
            self.messages.put(None)

    def __iter__(self):
        while True:
            message = self.messages.get(timeout=2)
            if message is None:
                return
            yield message

    def close(self):
        self.closed = True
        self.messages.put(None)


class FakeCloud:
    def __init__(self, error=None):
        self.error = error
        self.calls = []
        self.lock = threading.Lock()

    def post(self, url, token, body, timeout):
        with self.lock:
            self.calls.append((url.rsplit("/", 1)[-1], token, dict(body)))
        if self.error and url.endswith("/sessions"):
            raise self.error
        if url.endswith("/sessions"):
            return dict(SESSION)
        return {"accepted": True, "remainingSeconds": 1000, "shouldStop": False}

    def finals(self):
        return [body for name, _token, body in self.calls if name == "usage" and body.get("final")]


class FakeLocal:
    model = "parakeet"

    def __init__(self):
        self.samples = 0

    def accept(self, samples):
        self.samples += len(samples)

    def finish(self):
        return f"local transcript of {self.samples} samples"


def speech(seconds=0.1):
    return np.full(int(16000 * seconds), 0.1, dtype=np.float32)


class CloudTranscriberTest(unittest.TestCase):
    def transcriber(self, cloud, socket=None, fallback=None, token="ttc_live_token"):
        connected = []

        def connect(url, access_token):
            connected.append((url, access_token))
            return socket

        transcriber = CloudTranscriber(
            "https://cloud.example.com/",
            token,
            fallback_factory=fallback,
            post=cloud.post,
            connect=connect,
            log=lambda _message: None,
        )
        return transcriber, connected

    def test_streams_audio_and_joins_final_transcripts(self):
        cloud = FakeCloud()
        socket = FakeSocket(["Open the settings", "page please."])
        transcriber, connected = self.transcriber(cloud, socket)

        transcriber.accept(speech())
        transcriber.accept(speech())
        text = transcriber.finish()

        self.assertEqual(text, "Open the settings page please.")
        self.assertEqual(connected, [(SESSION["listenUrl"], "jwt-1")])
        audio = [message for message in socket.sent if isinstance(message, bytes)]
        self.assertEqual(sum(len(chunk) for chunk in audio), 2 * 1600 * 2)
        self.assertEqual(json.loads(socket.sent[-1]), {"type": "CloseStream"})
        self.assertTrue(socket.closed)
        self.assertEqual(cloud.finals(), [{"sessionId": "session-1", "final": True}])
        self.assertEqual(cloud.calls[0][1], "ttc_live_token")

    def test_audio_sent_before_the_socket_opens_is_not_lost(self):
        cloud = FakeCloud()
        socket = FakeSocket(["hello"])
        gate = threading.Event()
        original = cloud.post

        def slow_post(url, token, body, timeout):
            if url.endswith("/sessions"):
                gate.wait(1)
            return original(url, token, body, timeout)

        cloud.post = slow_post
        transcriber, _connected = self.transcriber(cloud, socket)
        transcriber.accept(speech())
        gate.set()

        self.assertEqual(transcriber.finish(), "hello")
        self.assertEqual(len([m for m in socket.sent if isinstance(m, bytes)]), 1)

    def test_falls_back_to_a_local_model_when_cloud_refuses(self):
        cloud = FakeCloud(CloudDictationError("Your included Cloud dictation minutes have been used"))
        transcriber, connected = self.transcriber(cloud, fallback=FakeLocal)

        transcriber.accept(speech(0.5))
        text = transcriber.finish()

        self.assertEqual(text, "local transcript of 8000 samples")
        self.assertEqual(connected, [])
        self.assertEqual(cloud.finals(), [])

    def test_without_a_token_never_contacts_cloud(self):
        cloud = FakeCloud()
        transcriber, _connected = self.transcriber(cloud, token="", fallback=lambda: None)

        transcriber.accept(speech())

        self.assertEqual(transcriber.finish(), "")
        self.assertEqual(cloud.calls, [])
        self.assertIn("Cloud account", str(transcriber.error))

    def test_closes_the_session_when_the_socket_cannot_connect(self):
        cloud = FakeCloud()

        def refuse(url, access_token):
            raise OSError("connection refused")

        transcriber = CloudTranscriber(
            "https://cloud.example.com",
            "ttc_live_token",
            post=cloud.post,
            connect=refuse,
            log=lambda _message: None,
        )
        transcriber.accept(speech())

        self.assertEqual(transcriber.finish(), "")
        self.assertEqual(cloud.finals(), [{"sessionId": "session-1", "final": True}])

    def test_cancel_closes_the_session_without_transcribing(self):
        cloud = FakeCloud()
        socket = FakeSocket(["ignored"])
        transcriber, _connected = self.transcriber(cloud, socket)

        transcriber.accept(speech())
        transcriber.cancel()

        self.assertTrue(socket.closed)
        self.assertEqual(cloud.finals(), [{"sessionId": "session-1", "final": True}])

    def test_partial_includes_interim_results(self):
        cloud = FakeCloud()
        socket = FakeSocket([])
        transcriber, _connected = self.transcriber(cloud, socket)
        transcriber._connected.wait(1)
        socket.messages.put(result("first part"))
        socket.messages.put(result("second", is_final=False))

        for _ in range(100):
            if transcriber.partial() == "first part second":
                break
            threading.Event().wait(0.01)
        self.assertEqual(transcriber.partial(), "first part second")
        transcriber.cancel()

    def test_pcm16_conversion_clips_and_scales(self):
        pcm = np.frombuffer(to_pcm16([0.0, 1.0, -2.0]), dtype="<i2")
        self.assertEqual(pcm.tolist(), [0, 32767, -32767])


if __name__ == "__main__":
    unittest.main()
