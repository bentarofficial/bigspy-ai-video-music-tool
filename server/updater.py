"""Tự cập nhật từ GitHub Releases: kiểm tra bản mới, tải app-update.zip, chép đè mã nguồn rồi khởi động lại."""
import json
import shutil
import subprocess
import time
import urllib.request
import zipfile
from pathlib import Path

REPO = "bentarofficial/bigspy-ai-video-music-tool"
ASSET = "app-update.zip"
ROOT = Path(__file__).resolve().parent.parent
# Dữ liệu của người dùng: không bao giờ bị ghi đè hay xóa khi cập nhật.
KEEP = {".env", ".cache", "output", "uploads", "logos", "logs", ".git", ".deps.hash", ".server.pid", ".studio.pid",
        "remotion/node_modules", "remotion/public/clips", "remotion/public/jobs"}


def current_version() -> str:
    f = ROOT / "VERSION"
    return f.read_text(encoding="utf-8").strip() if f.exists() else "0.0.0"


def _vtuple(v: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in v.lstrip("vV").split("-")[0].split("."))


def _get(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers={"User-Agent": "ai-music-video-updater",
                                               "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)


_cache: dict = {}


def check() -> dict:
    """Kết quả được nhớ 5 phút để không chạm giới hạn 60 lượt/giờ của GitHub API."""
    hit = _cache.get("v")
    if hit and time.time() - hit[0] < 300 and hit[1].get("current") == current_version():
        return hit[1]
    info = _check()
    if info.get("latest"):
        _cache["v"] = (time.time(), info)
    return info


def _check() -> dict:
    cur = current_version()
    try:
        with _get(f"https://api.github.com/repos/{REPO}/releases/latest") as r:
            rel = json.load(r)
    except Exception as e:  # mất mạng, chưa có release...
        return {"current": cur, "latest": None, "available": False, "error": str(e)}
    latest = rel.get("tag_name", "").lstrip("vV")
    asset = next((a for a in rel.get("assets", []) if a["name"] == ASSET), None)
    return {"current": cur, "latest": latest, "notes": rel.get("body") or "", "url": rel.get("html_url"),
            "download": asset and asset["browser_download_url"],
            "available": bool(asset) and _vtuple(latest) > _vtuple(cur)}


def _kept(rel: str) -> bool:
    return any(rel == k or rel.startswith(k + "/") for k in KEEP)


def apply() -> dict:
    info = _check()
    if not info["available"]:
        return {"ok": False, "message": "Đang dùng bản mới nhất.", **info}
    stage = ROOT / ".cache" / "update"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    zpath = stage / ASSET
    with _get(info["download"], timeout=120) as r, open(zpath, "wb") as f:
        shutil.copyfileobj(r, f)
    with zipfile.ZipFile(zpath) as z:
        for m in z.infolist():
            rel = m.filename.replace("\\", "/").strip("/")
            if not rel or m.is_dir() or ".." in rel.split("/") or _kept(rel):
                continue
            dst = ROOT / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
    # Khởi động lại qua `start` để tiến trình mới không nằm trong cây tiến trình của server (stop.ps1 kill cả cây).
    subprocess.Popen(f'cmd /c start "" /min powershell -NoProfile -ExecutionPolicy Bypass -File '
                     f'"{ROOT / "scripts" / "restart.ps1"}"', shell=True, cwd=ROOT)
    return {"ok": True, "message": f"Đã cập nhật lên {info['latest']}, đang khởi động lại…", **info}
