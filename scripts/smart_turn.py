"""Local Smart Turn v3.2 model download and ONNX inference."""

import hashlib
import os
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from whisper_features import compute_whisper_log_mel_features

MODEL_FILENAME = "smart-turn-v3.2-cpu.onnx"
MODEL_REVISION = "f766f81d3cfdf7737ac64aad813d91bbfd56bf93"
MODEL_URL = (
    "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/"
    f"{MODEL_REVISION}/{MODEL_FILENAME}"
)
MODEL_SIZE = 8_679_182
MODEL_SHA256 = "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f"


@dataclass(frozen=True)
class SmartTurnResult:
    probability: float
    inference_ms: float


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _model_is_valid(path):
    return (
        path.is_file()
        and path.stat().st_size == MODEL_SIZE
        and _sha256(path) == MODEL_SHA256
    )


def ensure_model(user_data_dir):
    """Download, verify, and atomically cache Smart Turn's CPU model."""
    model_dir = Path(user_data_dir) / "models" / "smart-turn-v3.2"
    model_path = model_dir / MODEL_FILENAME
    if _model_is_valid(model_path):
        return model_path

    model_dir.mkdir(parents=True, exist_ok=True)
    if model_path.exists():
        model_path.unlink()

    print("[smart-turn] Downloading verified Smart Turn v3.2 model (8.7 MB)...")
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="smart-turn-",
            suffix=".onnx.tmp",
            dir=model_dir,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            request = urllib.request.Request(
                MODEL_URL,
                headers={"User-Agent": "TalkToCursor/1.2.0"},
            )
            with urllib.request.urlopen(request, timeout=90) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    temporary.write(chunk)
            temporary.flush()
            os.fsync(temporary.fileno())

        if not _model_is_valid(temporary_path):
            raise RuntimeError("Smart Turn model failed size or SHA-256 verification")
        temporary_path.replace(model_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    print(f"[smart-turn] Model ready: {model_path}")
    return model_path


class SmartTurnAnalyzer:
    def __init__(self, user_data_dir):
        try:
            import onnxruntime as ort
        except ImportError as error:
            raise RuntimeError(
                "Smart Turn requires onnxruntime; reinstall the background helper"
            ) from error

        model_path = ensure_model(user_data_dir)
        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(str(model_path), sess_options=options)

    def predict(self, audio):
        """Predict endpoint probability from the last eight seconds of 16 kHz audio."""
        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        expected_samples = 8 * 16000
        if samples.size > expected_samples:
            samples = samples[-expected_samples:]
        elif samples.size < expected_samples:
            samples = np.pad(samples, (expected_samples - samples.size, 0))

        started = time.perf_counter()
        features = compute_whisper_log_mel_features(samples)
        output = self._session.run(
            None,
            {"input_features": np.expand_dims(features, axis=0)},
        )
        probability = float(np.asarray(output[0]).reshape(-1)[0])
        return SmartTurnResult(
            probability=probability,
            inference_ms=(time.perf_counter() - started) * 1000,
        )
