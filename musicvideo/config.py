"""Cấu hình chung: đường dẫn và đọc file .env (không cần thư viện ngoài)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REMOTION_DIR = ROOT / "remotion"


def _data_dir() -> Path:
    value = os.environ.get("AI_MUSIC_VIDEO_DATA_DIR")
    if not value:
        env_file = ROOT / ".env"
        if env_file.exists():
            for raw in env_file.read_text(encoding="utf-8").splitlines():
                key, sep, setting = raw.strip().partition("=")
                if sep and key.strip() == "AI_MUSIC_VIDEO_DATA_DIR":
                    value = setting.strip().strip('"').strip("'")
                    break
    if not value:
        return ROOT
    path = Path(os.path.expandvars(value)).expanduser()
    return (path if path.is_absolute() else ROOT / path).resolve()


DATA_DIR = _data_dir()
PUBLIC_DIR = REMOTION_DIR / "public" if DATA_DIR == ROOT else DATA_DIR / "public"
CLIPS_DIR = PUBLIC_DIR / "clips"          # clip Pixabay dùng chung giữa các job
JOBS_PUBLIC_DIR = PUBLIC_DIR / "jobs"     # audio của từng job (Remotion đọc qua staticFile)
OUTPUT_DIR = DATA_DIR / "output"           # props.json, lời bài hát, video kết quả
CACHE_DIR = DATA_DIR / ".cache"            # cache kết quả tìm kiếm Pixabay (24h)
UPLOADS_DIR = DATA_DIR / "uploads"
EXPORTS_DIR = DATA_DIR / "exports"

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
