"""NumPy-only Whisper log-mel features for Smart Turn v3.

Derived from Pipecat's BSD-2-Clause implementation and Hugging Face's
Apache-2.0 WhisperFeatureExtractor. See THIRD_PARTY_NOTICES.md.
"""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

_N_FFT = 400
_HOP_LENGTH = 160
_N_MELS = 80
_SAMPLE_RATE = 16000
_EPSILON = 1e-7


def _hertz_to_mel(frequency):
    frequency = np.atleast_1d(np.asarray(frequency, dtype=np.float64))
    mels = 3.0 * frequency / 200.0
    logarithmic = frequency >= 1000.0
    mels[logarithmic] = 15.0 + np.log(frequency[logarithmic] / 1000.0) * (
        27.0 / np.log(6.4)
    )
    return mels


def _mel_to_hertz(mels):
    mels = np.atleast_1d(np.asarray(mels, dtype=np.float64))
    frequency = 200.0 * mels / 3.0
    logarithmic = mels >= 15.0
    frequency[logarithmic] = 1000.0 * np.exp(
        (np.log(6.4) / 27.0) * (mels[logarithmic] - 15.0)
    )
    return frequency


def _build_mel_filterbank():
    mel_frequencies = np.linspace(
        float(_hertz_to_mel([0.0])[0]),
        float(_hertz_to_mel([_SAMPLE_RATE / 2.0])[0]),
        _N_MELS + 2,
    )
    filter_frequencies = _mel_to_hertz(mel_frequencies)
    fft_frequencies = np.linspace(0, _SAMPLE_RATE // 2, _N_FFT // 2 + 1)
    filter_differences = np.diff(filter_frequencies)
    slopes = np.expand_dims(filter_frequencies, 0) - np.expand_dims(
        fft_frequencies, 1
    )
    down_slopes = -slopes[:, :-2] / filter_differences[:-1]
    up_slopes = slopes[:, 2:] / filter_differences[1:]
    filters = np.maximum(0.0, np.minimum(down_slopes, up_slopes))
    filters *= np.expand_dims(
        2.0 / (filter_frequencies[2:] - filter_frequencies[:-2]), 0
    )
    return filters


_HANN_WINDOW = np.hanning(_N_FFT + 1)[:-1]
_MEL_FILTERS = _build_mel_filterbank()


def compute_whisper_log_mel_features(audio):
    """Return Smart Turn's float32 feature tensor with shape (80, 800)."""
    if audio.ndim != 1:
        raise ValueError(f"Expected one-dimensional audio, got {audio.shape}")

    samples = np.asarray(audio, dtype=np.float32)
    expected_samples = _SAMPLE_RATE * 8
    if samples.size != expected_samples:
        raise ValueError(
            f"Expected exactly {expected_samples} samples, got {samples.size}"
        )

    samples = (samples - samples.mean()) / np.sqrt(samples.var() + _EPSILON)
    padded = np.pad(
        samples.astype(np.float64), (_N_FFT // 2, _N_FFT // 2), mode="reflect"
    )
    windows = sliding_window_view(padded, _N_FFT)[::_HOP_LENGTH]
    spectrum = np.fft.rfft(windows * _HANN_WINDOW.astype(np.float64), axis=-1)
    magnitudes = (np.abs(spectrum) ** 2).T
    mel_spectrum = np.maximum(1e-10, _MEL_FILTERS.T @ magnitudes)
    log_spectrum = np.log10(mel_spectrum)[:, :-1]
    log_spectrum = np.maximum(log_spectrum, log_spectrum.max() - 8.0)
    return ((log_spectrum + 4.0) / 4.0).astype(np.float32)
