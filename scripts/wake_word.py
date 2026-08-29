#!/usr/bin/env python3
"""Local wake-phrase detection for the TalkToCursor voice input loop."""

import hashlib
import os
import shutil
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

MODEL_NAME = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/"
    f"{MODEL_NAME}.tar.bz2"
)
MODEL_ARCHIVE_SHA256 = (
    "f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a"
)
MODEL_FILES = {
    "tokens": "tokens.txt",
    "bpe": "bpe.model",
    "encoder": "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder": "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "joiner": "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
}
MODEL_MIN_BYTES = {
    "tokens": 1_000,
    "bpe": 100_000,
    "encoder": 1_000_000,
    "decoder": 100_000,
    "joiner": 50_000,
}
COMPLETE_MARKER = ".complete"


def _model_paths(model_dir):
    return {name: model_dir / filename for name, filename in MODEL_FILES.items()}


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _model_is_valid(model_dir):
    marker = model_dir / COMPLETE_MARKER
    paths = _model_paths(model_dir)
    try:
        return (
            marker.read_text(encoding="utf-8").strip() == MODEL_ARCHIVE_SHA256
            and all(
                path.is_file() and path.stat().st_size >= MODEL_MIN_BYTES[name]
                for name, path in paths.items()
            )
        )
    except OSError:
        return False


def _extract_model(archive_path, models_dir):
    """Extract regular files and directories without trusting archive paths."""
    destination = models_dir.resolve()
    with tarfile.open(archive_path, "r:bz2") as archive:
        for member in archive.getmembers():
            target = (models_dir / member.name).resolve()
            if destination not in target.parents and target != destination:
                raise RuntimeError("Wake-word model archive contains an unsafe path")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is not None:
                    with source, open(target, "wb") as output:
                        shutil.copyfileobj(source, output)


def ensure_model(user_data_dir):
    model_dir = Path(user_data_dir) / "models" / MODEL_NAME
    paths = _model_paths(model_dir)
    if _model_is_valid(model_dir):
        return paths

    models_dir = model_dir.parent
    models_dir.mkdir(parents=True, exist_ok=True)
    print("[wake-word] Downloading the local English wake-word model (about 20 MB)...")

    archive_path = None
    staging_dir = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix="talktocursor-kws-",
            suffix=".tar.bz2",
            dir=models_dir,
            delete=False,
        ) as temporary:
            archive_path = Path(temporary.name)
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
                shutil.copyfileobj(response, temporary)
            temporary.flush()
            os.fsync(temporary.fileno())
        if _sha256(archive_path) != MODEL_ARCHIVE_SHA256:
            raise RuntimeError("Wake-word model failed SHA-256 verification")

        staging_dir = Path(tempfile.mkdtemp(
            prefix=f".{MODEL_NAME}-",
            dir=models_dir,
        ))
        _extract_model(archive_path, staging_dir)
        staged_model_dir = staging_dir / MODEL_NAME
        marker = staged_model_dir / COMPLETE_MARKER
        marker.write_text(MODEL_ARCHIVE_SHA256 + "\n", encoding="utf-8")
        if not _model_is_valid(staged_model_dir):
            raise RuntimeError("Downloaded wake-word model is incomplete")

        if model_dir.exists():
            shutil.rmtree(model_dir)
        os.replace(staged_model_dir, model_dir)
    finally:
        if archive_path is not None:
            archive_path.unlink(missing_ok=True)
        if staging_dir is not None:
            shutil.rmtree(staging_dir, ignore_errors=True)

    if not _model_is_valid(model_dir):
        raise RuntimeError("Downloaded wake-word model is incomplete")
    print(f"[wake-word] Model ready: {model_dir}")
    return paths


def create_keyword_file(
    user_data_dir,
    phrase,
    bpe_model,
    filename="wake-word-keywords.txt",
):
    import sentencepiece as spm

    processor = spm.SentencePieceProcessor(model_file=str(bpe_model))
    pieces = processor.encode(phrase.upper(), out_type=str)
    if not pieces:
        raise RuntimeError(f"Could not tokenize wake phrase: {phrase}")

    if Path(filename).name != filename:
        raise ValueError("Keyword filename must not contain a path")
    keyword_path = user_data_dir / filename
    temporary_path = keyword_path.with_suffix(f".{time.time_ns()}.tmp")
    temporary_path.write_text(" ".join(pieces) + "\n", encoding="utf-8")
    temporary_path.chmod(0o600)
    temporary_path.replace(keyword_path)
    return keyword_path


class StreamingKeywordDetector:
    """Feed 16 kHz float samples and report a configured phrase."""

    def __init__(
        self,
        user_data_dir,
        phrase,
        sensitivity,
        filename="wake-word-keywords.txt",
    ):
        import sherpa_onnx

        self.phrase = phrase
        paths = ensure_model(user_data_dir)
        keyword_path = create_keyword_file(
            user_data_dir,
            phrase,
            paths["bpe"],
            filename=filename,
        )
        normalized_sensitivity = max(0.0, min(1.0, float(sensitivity)))
        if normalized_sensitivity <= 0.5:
            threshold = 0.5 - (normalized_sensitivity * 0.4)
        else:
            # Preserve the established lower half of the control, then make
            # the upper half progressively more responsive. At maximum
            # sensitivity the threshold is 0.005 instead of the former 0.10.
            threshold = 0.3 - ((normalized_sensitivity - 0.5) * 0.59)
        keyword_score = 1.5 + max(
            0.0,
            (normalized_sensitivity - 0.5) * 2.0,
        )
        self.spotter = sherpa_onnx.KeywordSpotter(
            tokens=str(paths["tokens"]),
            encoder=str(paths["encoder"]),
            decoder=str(paths["decoder"]),
            joiner=str(paths["joiner"]),
            keywords_file=str(keyword_path),
            num_threads=2,
            max_active_paths=(
                8 if normalized_sensitivity >= 0.75 else 4
            ),
            keywords_score=keyword_score,
            keywords_threshold=threshold,
            provider="cpu",
        )
        self.stream = self.spotter.create_stream()

    def reset(self):
        self.stream = self.spotter.create_stream()

    def accept(self, samples, sample_rate=16000):
        self.stream.accept_waveform(sample_rate, samples.reshape(-1))
        while self.spotter.is_ready(self.stream):
            self.spotter.decode_stream(self.stream)
        result = self.spotter.get_result(self.stream)
        if not result:
            return False
        self.spotter.reset_stream(self.stream)
        return True


def listen_for_wake_phrase(
    user_data_dir,
    phrase,
    sensitivity,
    should_pause,
    on_detected,
):
    """Listen continuously and call on_detected after the configured phrase."""
    import sounddevice as sd

    detector = StreamingKeywordDetector(
        user_data_dir,
        phrase,
        sensitivity,
    )

    sample_rate = 16000
    samples_per_read = int(0.1 * sample_rate)
    print(
        f'[wake-word] Listening for "{phrase}" '
        f"(sensitivity: {float(sensitivity):.2f})"
    )

    while True:
        while should_pause():
            time.sleep(0.1)

        detector.reset()
        detected = False
        try:
            with sd.InputStream(
                channels=1,
                dtype="float32",
                samplerate=sample_rate,
                blocksize=samples_per_read,
            ) as microphone:
                while not should_pause():
                    samples, overflowed = microphone.read(samples_per_read)
                    if overflowed:
                        continue
                    if detector.accept(samples, sample_rate):
                        detected = True
                        break
        except Exception as error:
            print(f"[wake-word] Microphone error: {error}")
            time.sleep(1)
            continue

        if detected:
            print(f'[wake-word] Detected "{phrase}"')
            on_detected()
            time.sleep(0.5)
