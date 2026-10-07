#!/usr/bin/env python3
"""Transcribe un video/audio con faster-whisper y emite JSON: {language, text, segments[{start,end,text}]}.
Sale con código 2 si no hay voz (el worker sigue sin transcript)."""
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    path = sys.argv[1]
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, vad_filter=True, beam_size=5)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]
    if not out:
        return 2
    print(json.dumps({"language": info.language, "text": " ".join(s["text"] for s in out), "segments": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
