"""Verified, atomic downloads for local speech models."""

import hashlib
import os
import shutil
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

COMPLETE_MARKER = ".complete"


@dataclass(frozen=True)
class ModelSpec:
    name: str
    url: str
    sha256: str
    description: str
    # Relative file paths and their minimum sizes in bytes.
    files: dict = field(default_factory=dict)
    archive: bool = True


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_valid(model_dir, spec):
    try:
        marker = (model_dir / COMPLETE_MARKER).read_text(encoding="utf-8").strip()
        return marker == spec.sha256 and all(
            (model_dir / name).is_file() and (model_dir / name).stat().st_size >= minimum
            for name, minimum in spec.files.items()
        )
    except OSError:
        return False


def _safe_extract(archive_path, destination):
    root = destination.resolve()
    with tarfile.open(archive_path, "r:*") as archive:
        for member in archive.getmembers():
            target = (destination / member.name).resolve()
            if root not in target.parents and target != root:
                raise RuntimeError("Model archive contains an unsafe path")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is not None:
                    with source, open(target, "wb") as output:
                        shutil.copyfileobj(source, output)


def is_downloaded(user_data_dir, spec):
    return _is_valid(Path(user_data_dir) / "models" / spec.name, spec)


def ensure_model(user_data_dir, spec, log_prefix="[models]"):
    """Return the model directory, downloading and verifying it if needed."""
    models_dir = Path(user_data_dir) / "models"
    model_dir = models_dir / spec.name
    if _is_valid(model_dir, spec):
        return model_dir

    models_dir.mkdir(parents=True, exist_ok=True)
    print(f"{log_prefix} Downloading {spec.description}...")
    download_path = None
    staging_dir = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{spec.name}-",
            dir=models_dir,
            delete=False,
        ) as temporary:
            download_path = Path(temporary.name)
            with urllib.request.urlopen(spec.url, timeout=120) as response:
                shutil.copyfileobj(response, temporary, length=1024 * 1024)
            temporary.flush()
            os.fsync(temporary.fileno())
        if sha256_file(download_path) != spec.sha256:
            raise RuntimeError(f"{spec.name} failed SHA-256 verification")

        staging_dir = Path(tempfile.mkdtemp(prefix=f".{spec.name}-", dir=models_dir))
        if spec.archive:
            _safe_extract(download_path, staging_dir)
            staged = staging_dir / spec.name
        else:
            staged = staging_dir / spec.name
            staged.mkdir()
            filename = next(iter(spec.files))
            shutil.move(str(download_path), staged / filename)
            download_path = None
        (staged / COMPLETE_MARKER).write_text(spec.sha256 + "\n", encoding="utf-8")
        if not _is_valid(staged, spec):
            raise RuntimeError(f"Downloaded {spec.name} is incomplete")
        if model_dir.exists():
            shutil.rmtree(model_dir)
        os.replace(staged, model_dir)
    finally:
        if download_path is not None:
            download_path.unlink(missing_ok=True)
        if staging_dir is not None:
            shutil.rmtree(staging_dir, ignore_errors=True)

    print(f"{log_prefix} Model ready: {model_dir}")
    return model_dir


RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"

SILERO_VAD = ModelSpec(
    name="silero-vad",
    url=f"{RELEASES}/asr-models/silero_vad.onnx",
    sha256="9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
    description="the local voice activity model (under 1 MB)",
    files={"silero_vad.onnx": 600_000},
    archive=False,
)

STREAMING_STT = ModelSpec(
    name="sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-80ms-int8",
    url=f"{RELEASES}/asr-models/sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-80ms-int8.tar.bz2",
    sha256="7bd33a914e93370a1ba9c2066d9e841bdcad8613fa2a00537c1ae15d851a14d8",
    description="the local streaming speech-to-text model (about 100 MB)",
    files={
        "tokens.txt": 1_000,
        "encoder.int8.onnx": 100_000_000,
        "decoder.int8.onnx": 1_000_000,
        "joiner.int8.onnx": 500_000,
    },
)

PARAKEET_STT = ModelSpec(
    name="sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    url=f"{RELEASES}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2",
    sha256="157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad",
    description="the local Parakeet speech-to-text model (about 480 MB)",
    files={
        "tokens.txt": 1_000,
        "encoder.int8.onnx": 100_000_000,
        "decoder.int8.onnx": 1_000_000,
        "joiner.int8.onnx": 500_000,
    },
)
