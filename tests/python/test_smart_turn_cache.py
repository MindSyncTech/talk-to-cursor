import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import smart_turn


class SmartTurnCacheTests(unittest.TestCase):
    def test_accepts_only_exact_size_and_digest(self):
        payload = b"verified-model"
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.onnx"
            model.write_bytes(payload)
            with (
                patch.object(smart_turn, "MODEL_SIZE", len(payload)),
                patch.object(
                    smart_turn,
                    "MODEL_SHA256",
                    hashlib.sha256(payload).hexdigest(),
                ),
            ):
                self.assertTrue(smart_turn._model_is_valid(model))
                model.write_bytes(payload + b"corrupt")
                self.assertFalse(smart_turn._model_is_valid(model))


if __name__ == "__main__":
    unittest.main()
