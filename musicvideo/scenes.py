"""Phân tích nhịp (librosa) và chia bài hát thành các cảnh, điểm cắt rơi đúng beat."""
from pathlib import Path

import librosa
import numpy as np


def analyze(wav: Path) -> dict:
    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo = float(np.atleast_1d(tempo)[0]) or 120.0
    rms = librosa.feature.rms(y=y)[0]
    rms_t = librosa.times_like(rms, sr=sr)
    return {"tempo": tempo, "beats": [float(b) for b in beats], "rms": rms, "rms_t": rms_t,
            "duration": len(y) / sr}


def make_scenes(analysis: dict, lines: list[dict], target_len: float = 4.0, min_len: float = 1.5) -> list[dict]:
    total, beats, tempo = analysis["duration"], analysis["beats"], analysis["tempo"]
    beat_len = 60.0 / tempo
    # số beat mỗi cảnh, làm tròn về số chẵn để cắt theo nhịp nhạc
    n = max(2, int(round(target_len / beat_len / 2)) * 2)
    cuts = [0.0] + [b for b in beats[n::n] if b < total - min_len] + [total] if beats else \
        list(np.arange(0, total, target_len)) + [total]

    # gộp cảnh quá ngắn
    clean = [cuts[0]]
    for c in cuts[1:]:
        if c - clean[-1] >= min_len:
            clean.append(c)
    clean[-1] = total

    rms, rms_t = analysis["rms"], analysis["rms_t"]
    energies = []
    scenes = []
    for a, b in zip(clean[:-1], clean[1:]):
        mask = (rms_t >= a) & (rms_t < b)
        energies.append(float(rms[mask].mean()) if mask.any() else 0.0)
        text = " ".join(w["text"] for ln in lines for w in ln["words"] if w["start"] < b and w["end"] > a)
        scenes.append({"start": round(a, 3), "end": round(b, 3), "lyrics": text})

    # đoạn mạnh (điệp khúc) chuyển cảnh nhanh kiểu slide/wipe, đoạn nhẹ dùng fade
    hi = np.percentile(energies, 70) if energies else 0
    for i, (sc, e) in enumerate(zip(scenes, energies)):
        sc["energy"] = round(e / (max(energies) or 1), 3)
        sc["transition"] = "fade" if e < hi else ("slide" if i % 2 else "wipe")
    return scenes
