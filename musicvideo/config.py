"""Cấu hình chung: đường dẫn và đọc file .env (không cần thư viện ngoài)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTION_DIR = ROOT / "remotion"
PUBLIC_DIR = REMOTION_DIR / "public"
CLIPS_DIR = PUBLIC_DIR / "clips"          # clip Pixabay dùng chung giữa các job
JOBS_PUBLIC_DIR = PUBLIC_DIR / "jobs"     # audio của từng job (Remotion đọc qua staticFile)
OUTPUT_DIR = ROOT / "output"              # props.json, lời bài hát, video kết quả
CACHE_DIR = ROOT / ".cache"               # cache kết quả tìm kiếm Pixabay (24h)

SIZES = {
    "portrait": (1080, 1920),
    "landscape": (1920, 1080),
    "square": (1080, 1080),
}


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
