"""Tìm và tải video miễn phí bản quyền từ Pixabay API (https://pixabay.com/api/docs/#api_search_videos).

Pixabay yêu cầu cache kết quả tìm kiếm 24h và không hotlink hàng loạt -> lưu cache JSON
và tải clip về máy một lần, dùng lại cho các video sau.
"""
import hashlib
import json
import subprocess
import time
from pathlib import Path

import requests

API = "https://pixabay.com/api/videos/"
CACHE_TTL = 24 * 3600


class Pixabay:
    def __init__(self, api_key: str, cache_dir: Path, clips_dir: Path):
        self.key = api_key
        self.cache_dir = cache_dir / "pixabay"
        self.clips_dir = clips_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.clips_dir.mkdir(parents=True, exist_ok=True)

    def search(self, query: str, per_page: int = 50) -> list[dict]:
        query = query[:100]
        f = self.cache_dir / (hashlib.md5(query.lower().encode()).hexdigest() + ".json")
        if f.exists() and time.time() - f.stat().st_mtime < CACHE_TTL:
            return json.loads(f.read_text(encoding="utf-8"))
        for attempt in range(3):
            r = requests.get(API, params={"key": self.key, "q": query, "per_page": per_page,
                                          "safesearch": "true", "video_type": "film"}, timeout=30)
            if r.status_code == 429:  # vượt giới hạn 100 request/phút
                time.sleep(20 * (attempt + 1))
                continue
            r.raise_for_status()
            hits = r.json().get("hits", [])
            f.write_text(json.dumps(hits), encoding="utf-8")
            return hits
        return []

    def find(self, query: str, min_duration: float, portrait: bool, used: set[int]) -> dict | None:
        """Thử câu truy vấn đầy đủ, rồi rút gọn dần nếu không có kết quả."""
        words = query.split()
        for q in [query] + [" ".join(words[:k]) for k in range(len(words) - 1, 0, -1)] + ["nature"]:
            hits = self.search(q)
            if hits:
                best = self._rank(hits, min_duration, portrait, used)
                if best:
                    return best
        return None

    @staticmethod
    def _rank(hits: list[dict], min_duration: float, portrait: bool, used: set[int]) -> dict | None:
        def score(h):
            v = h["videos"].get("medium") or h["videos"].get("large") or {}
            is_portrait = v.get("height", 0) > v.get("width", 1)
            return (
                h["id"] not in used,                 # ưu tiên clip chưa dùng
                h.get("duration", 0) >= min_duration,  # đủ dài để khỏi phải lặp
                is_portrait == portrait,             # đúng khổ dọc/ngang
                h.get("downloads", 0) + 20 * h.get("likes", 0),
            )
        return max(hits, key=score) if hits else None

    def download(self, hit: dict) -> Path:
        """Tải clip rồi chuẩn hóa. Trả về file đã chuẩn hóa (dùng lại nếu đã có)."""
        out = self.clips_dir / f"pixabay_{hit['id']}_n.mp4"
        if out.exists() and out.stat().st_size > 0:
            return out
        raw = self.clips_dir / f"pixabay_{hit['id']}.mp4"
        if not (raw.exists() and raw.stat().st_size > 0):
            vids = hit["videos"]
            # 'large' thường là 4K -> nặng; 'medium' (~1080p/720p) đủ đẹp cho video mạng xã hội
            v = next(vids[k] for k in ("medium", "large", "small", "tiny") if vids.get(k, {}).get("url"))
            tmp = raw.with_suffix(".part")
            with requests.get(v["url"], stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            tmp.replace(raw)
        normalize(raw, out)
        raw.unlink(missing_ok=True)  # chỉ giữ bản chuẩn hóa cho nhẹ ổ đĩa
        return out


def normalize(src: Path, dst: Path, max_side: int = 1920, fps: int = 30) -> Path:
    """Chuẩn hóa clip để Remotion đọc ổn định và render nhanh:
    cạnh dài ≤ 1920 (cạnh ngắn ≤ 1080), 30 fps cố định, H.264 yuv420p, keyframe dày, bỏ tiếng.
    (Clip Pixabay gốc có thể 2560x1440 bitrate cao / 59.94 fps -> Remotion hay lỗi 'No frame found'.)"""
    from .audio import FFMPEG

    tmp = dst.with_suffix(".tmp.mp4")
    scale = f"scale='if(gt(iw,ih),min({max_side},iw),-2)':'if(gt(iw,ih),-2,min({max_side},ih))'"
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-an",
         "-vf", f"{scale},fps={fps},format=yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", str(fps),
         "-movflags", "+faststart", str(tmp)],
        check=True,
    )
    tmp.replace(dst)
    return dst
