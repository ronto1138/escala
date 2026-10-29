"""Reads a short text aloud and writes a WAV file to stdout. Input on stdin: {"lang": "en"|"es"|"fr", "text": "..."}.

Kokoro-82M (Apache 2.0) through kokoro-onnx (MIT), int8 weights: no GPU, no PyTorch. Not a Meta model: Meta's API has
no speech output (checked 2026-10-29). One process per card; the server keeps the result, so nothing stays in memory.
"""
import io
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

# One voice per language; its author grades the only French voice B- (Kokoro-82M VOICES.md).
VOICES = {"en": ("af_heart", "en-us"), "es": ("ef_dora", "es"), "fr": ("ff_siwis", "fr-fr")}
MODELS = os.environ.get("TTS_MODELS", "/opt/tts")
MAX_CHARS = 600


def main() -> int:
    req = json.load(sys.stdin)
    lang, text = req.get("lang"), str(req.get("text", "")).strip()[:MAX_CHARS]
    if lang not in VOICES or not text:
        print("need lang (en, es, fr) and text", file=sys.stderr)
        return 2
    voice, espeak_lang = VOICES[lang]
    kokoro = Kokoro(f"{MODELS}/kokoro-v1.0.int8.onnx", f"{MODELS}/voices-v1.0.bin")
    samples, rate = kokoro.create(text, voice=voice, speed=0.9, lang=espeak_lang)
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV")
    sys.stdout.buffer.write(buf.getvalue())
    return 0


if __name__ == "__main__":
    sys.exit(main())
