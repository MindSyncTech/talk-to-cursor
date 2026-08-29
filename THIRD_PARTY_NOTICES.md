# Third-Party Notices

TalkToCursor installs the Python packages below only when the optional
hands-free helper is configured. The model files are downloaded at runtime and
are not included in the npm package.

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

Wake-phrase detection uses
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
