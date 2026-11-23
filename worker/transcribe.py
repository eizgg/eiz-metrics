#!/usr/bin/env python3
"""Transcribe un video/audio con faster-whisper y emite JSON: {language, text, segments[{start,end,text}]}.
Sale con código 2 si no hay voz (el worker sigue sin transcript).

El audio lo decodifica ffmpeg (ya instalado para el resto del pipeline) y se le pasa a whisper como array:
así no dependemos de PyAV, cuya API cambia entre versiones y rompía decode_audio de faster-whisper."""
import json
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000


def load_audio(path: str) -> np.ndarray:
    """Audio mono a 16 kHz en float32 [-1, 1], que es lo que espera whisper."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        # Video sin pista de audio = sin voz; cualquier otro error de ffmpeg se propaga (el worker lo loguea)
        if b"does not contain any stream" in r.stderr or b"matches no streams" in r.stderr:
            return np.zeros(0, np.float32)
        raise RuntimeError(f"ffmpeg no pudo extraer el audio: {r.stderr.decode(errors='replace')[-400:]}")
    return np.frombuffer(r.stdout, np.int16).astype(np.float32) / 32768.0


def main() -> int:
    path = sys.argv[1]
    audio = load_audio(path)
    if audio.size == 0:
        return 2
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, vad_filter=True, beam_size=5)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
    if not out:
        return 2
    print(json.dumps({"language": info.language, "text": " ".join(s["text"] for s in out), "segments": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
