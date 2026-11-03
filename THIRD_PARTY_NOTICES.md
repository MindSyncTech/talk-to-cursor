# Third-Party Notices

TalkToCursor installs the Python packages below only when the optional
hands-free helper is configured. The model files are downloaded at runtime and
are not included in the npm package.

## Silero VAD

TalkToCursor downloads the Silero VAD model on first use of voice input to
tell speech apart from background noise. Silero VAD is available under the MIT
License:

- https://github.com/snakers4/silero-vad
- https://github.com/snakers4/silero-vad/blob/master/LICENSE

The model file is fetched from the sherpa-onnx release mirror and verified by
SHA-256 before use.

## Pipecat Smart Turn

TalkToCursor can optionally download and run the Smart Turn v3.2 CPU model
published by Daily under the BSD 2-Clause License. The model and upstream
project are available at:

- https://huggingface.co/pipecat-ai/smart-turn-v3
- https://github.com/pipecat-ai/smart-turn

The NumPy Whisper feature extraction in `scripts/whisper_features.py` is
derived from Pipecat and Hugging Face Transformers.

```text
BSD 2-Clause License

Copyright (c) 2024–2026, Daily

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

Hugging Face Transformers portions are available under the Apache License 2.0:
https://github.com/huggingface/transformers/blob/main/LICENSE

## sherpa-onnx (k2-fsa)

Wake-phrase detection and built-in speech-to-text use
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), published by the k2-fsa
project under the Apache License 2.0:
https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE

## ONNX Runtime

Smart Turn inference uses
[ONNX Runtime](https://github.com/microsoft/onnxruntime), available under the
MIT License:
https://github.com/microsoft/onnxruntime/blob/main/LICENSE

## SentencePiece

Wake-phrase tokenization uses
[SentencePiece](https://github.com/google/sentencepiece), available under the
Apache License 2.0:
https://github.com/google/sentencepiece/blob/master/LICENSE

## Wake-Phrase Model

TalkToCursor optionally downloads
`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` from the k2-fsa
sherpa-onnx releases. The README shipped in that upstream model archive
identifies the model license as Apache License 2.0.

- Upstream model archive:
  https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
- Upstream pretrained-model documentation:
  https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html

## Speech-to-Text Models (NVIDIA NeMo)

Built-in voice input optionally downloads sherpa-onnx exports of NVIDIA NeMo
models, released by NVIDIA under the Creative Commons Attribution 4.0
International License (CC BY 4.0):

- `sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-80ms-int8`, derived
  from NVIDIA's streaming FastConformer transducer
- `sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8`, derived from
  [nvidia/parakeet-tdt-0.6b-v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)

License: https://creativecommons.org/licenses/by/4.0/

## TalkToCursor UI Sounds

The sounds in `sounds/` come from [Freesound](https://freesound.org) and are
dedicated to the public domain under CC0 1.0. TalkToCursor renamed them and
normalized their loudness.

License: https://creativecommons.org/publicdomain/zero/1.0/

## LiveKit

Echo cancellation uses the
[LiveKit Python SDK](https://github.com/livekit/python-sdks) (`livekit`),
available under the Apache License 2.0. Its audio processing module includes
the WebRTC audio processing library, available under the BSD 3-Clause License:
https://webrtc.googlesource.com/src/+/refs/heads/main/LICENSE
