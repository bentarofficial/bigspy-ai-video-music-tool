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
    if target_len <= 0:
        return _finish(analysis, lines, _lyric_cuts(analysis, lines, min_len))
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
    return _finish(analysis, lines, clean)


def _snap(t: float, lo: float, hi: float, beats: list[float]) -> float:
    """Chọn beat gần t nhất nằm trong khoảng [lo, hi]; không có thì giữ t."""
    inside = [b for b in beats if lo <= b <= hi]
    return min(inside, key=lambda b: abs(b - t)) if inside else t


def _lyric_cuts(analysis: dict, lines: list[dict], min_len: float,
                min_scene: float = 2.5, idle_len: float = 4.0) -> list[float]:
    """Chế độ auto: chỉ cắt cảnh ở khoảng nghỉ giữa hai câu hát (không bao giờ cắt giữa câu).
    Câu quá ngắn được gộp chung cảnh; đoạn nhạc dạo không lời được chia theo beat."""
    total, beats = analysis["duration"], analysis["beats"]
    spans = []
    for ln in lines:
        ws = ln.get("words") or []
        s = ln.get("start", ws[0]["start"] if ws else None)
        e = ln.get("end", ws[-1]["end"] if ws else None)
        if s is not None and e is not None:
            spans.append((float(s), float(e)))
    spans.sort()
    if not spans:
        step = idle_len
        return [0.0] + [t for t in np.arange(step, total - min_len, step)] + [total]

    def idle(a: float, b: float) -> list[float]:  # chia đoạn không lời theo beat
        n = int((b - a) // idle_len)
        return [_snap(a + k * (b - a) / n, a + 1, b - 1, beats) for k in range(1, n)] if n >= 2 else []

    cuts = [0.0]
    # nhạc dạo đầu: cắt ngay trước câu đầu tiên
    first = spans[0][0]
    if first >= min_len:
        cuts += idle(0.0, first)
        cuts.append(_snap(first - 0.15, max(cuts[-1] + min_len, first - 0.6), first, beats))
    for (s0, e0), (s1, _) in zip(spans, spans[1:]):
        gap_lo, gap_hi = e0, max(e0, s1)
        if gap_hi - gap_lo > 2 * idle_len:  # đoạn nhạc dạo giữa bài
            cuts.append(_snap(gap_lo + 0.3, gap_lo, gap_lo + 1.0, beats))
            cuts += idle(cuts[-1], gap_hi)
            cuts.append(_snap(gap_hi - 0.15, gap_hi - 0.6, gap_hi, beats))
            continue
        if gap_hi - cuts[-1] < min_scene:  # cảnh hiện tại còn quá ngắn -> gộp câu tiếp theo
            continue
        cuts.append(_snap((gap_lo + gap_hi) / 2, gap_lo, gap_hi, beats))
    last = spans[-1][1]
    if total - last > 2 * idle_len:  # đoạn kết không lời
        cuts.append(_snap(last + 0.3, last, last + 1.0, beats))
        cuts += idle(cuts[-1], total)
    clean = [0.0]
    for c in sorted(cuts[1:]):
        if c - clean[-1] >= min_len and total - c >= min_len:
            clean.append(round(c, 3))
    return clean + [total]


def _finish(analysis: dict, lines: list[dict], clean: list[float]) -> list[dict]:
    rms, rms_t = analysis["rms"], analysis["rms_t"]
    energies = []
    scenes = []
    for a, b in zip(clean[:-1], clean[1:]):
        mask = (rms_t >= a) & (rms_t < b)
        energies.append(float(rms[mask].mean()) if mask.any() else 0.0)
        text = " ".join(w["text"] for ln in lines for w in ln["words"] if w["start"] < b and w["end"] > a)
        scenes.append({"start": round(a, 3), "end": round(b, 3), "lyrics": text})

    # Chuyển cảnh KẾT HỢP (cả 2 cảnh cùng chuyển động, ease-in-out) để không khựng ở điểm cắt.
    # Đoạn nhẹ: hoà tan + zoom / nhoè / ánh sáng; đoạn mạnh (điệp khúc): đẩy mềm xen hoà tan + zoom.
    soft = ["dissolve-zoom", "blur-dissolve", "dissolve-zoom", "light-leak"]
    strong = ["soft-push", "dissolve-zoom", "soft-push", "blur-dissolve"]
    hi = np.percentile(energies, 70) if energies else 0
    for i, (sc, e) in enumerate(zip(scenes, energies)):
        sc["energy"] = round(e / (max(energies) or 1), 3)
        sc["transition"] = (strong if e >= hi else soft)[i % 4]
    return scenes
