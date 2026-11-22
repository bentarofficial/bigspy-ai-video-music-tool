"""Xử lý audio: chuẩn hóa bằng FFmpeg (bản đóng gói sẵn qua imageio-ffmpeg)."""
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def to_wav(src: Path, dst: Path, sr: int = 16000) -> Path:
    """Chuyển về WAV mono — định dạng mà Whisper và librosa đọc ổn định nhất."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", str(sr), str(dst)],
        check=True,
    )
    return dst


def cut(src: Path, dst: Path, start: float, end: float | None,
        fade_in: float = 0.5, fade_out: float = 1.5) -> Path:
    """Cắt một đoạn nhạc (WAV chất lượng gốc) kèm fade-in/fade-out cho mượt đầu và cuối."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-ss", f"{start:.3f}"]
    if end:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-i", str(src)]
    length = (end - start) if end else None
    filters = []
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0 and length:
        filters.append(f"afade=t=out:st={max(0, length - fade_out):.3f}:d={fade_out}")
    if filters:
        cmd += ["-af", ",".join(filters)]
    subprocess.run(cmd + [str(dst)], check=True)
    return dst


def duration_of(wav: Path) -> float:
    import soundfile as sf

    info = sf.info(str(wav))
    return info.frames / info.samplerate

