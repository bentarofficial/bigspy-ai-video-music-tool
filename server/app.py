"""Web server localhost: tải nhạc lên, theo dõi tiến trình, chỉnh phụ đề/tiêu đề, render lại, mở Studio."""
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from make_video import slugify  # noqa: E402
from musicvideo.config import OUTPUT_DIR, PUBLIC_DIR, REMOTION_DIR, SIZES, load_env  # noqa: E402

UPLOADS = ROOT / "uploads"
ENV_FILE = ROOT / ".env"
STUDIO_PORT = 3010
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # không bật cửa sổ console trên Windows

app = FastAPI(title="AI Music Video Tool")
STATIC = Path(__file__).parent / "static"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=PUBLIC_DIR), name="media")
app.mount("/editor-assets", StaticFiles(directory=STATIC / "editor"), name="editor-assets")
procs: dict[str, subprocess.Popen] = {}
studio: dict = {"proc": None, "job": None}


# ---------- tiện ích ----------
def job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]+", job_id):
        raise HTTPException(400, "job id không hợp lệ")
    d = OUTPUT_DIR / job_id
    if not d.exists():
        raise HTTPException(404, "không có job")
    return d


def read_meta(d: Path) -> dict:
    f = d / "job.json"
    return json.loads(f.read_text(encoding="utf-8-sig")) if f.exists() else {}


def write_meta(d: Path, meta: dict) -> None:
    (d / "job.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


def status_of(job_id: str, d: Path) -> str:
    p = procs.get(job_id)
    if p and p.poll() is None:
        return "running"
    meta = read_meta(d)
    if meta.get("status") == "running":
        # p is None: server đã khởi động lại giữa chừng -> tiến trình cũ không còn
        meta["status"] = "stopped" if p is None else ("done" if p.returncode == 0 else "error")
        write_meta(d, meta)
    return meta.get("status", "unknown")


def spawn(job_id: str, d: Path, args: list[str]) -> None:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    log = open(d / "log.txt", "a", encoding="utf-8")
    log.write(f"\n===== {time.strftime('%H:%M:%S')} =====\n")
    log.flush()
    procs[job_id] = subprocess.Popen(
        [sys.executable, str(ROOT / "make_video.py"), *args],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=NO_WINDOW,
    )
    meta = read_meta(d)
    meta["status"] = "running"
    write_meta(d, meta)


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------- trang & cài đặt ----------
@app.get("/", response_class=HTMLResponse)
def index():
    html = (Path(__file__).parent / "static" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


# ---------- lựa chọn đã lưu trên form Tạo video (giữ qua mọi lần tắt/mở app) ----------
PREFS = ROOT / "prefs.json"


@app.get("/api/prefs")
def get_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@app.post("/api/prefs")
def set_prefs(body: dict):
    clean = {str(k)[:40]: v for k, v in body.items() if isinstance(v, (str, bool, int, float))}
    clean = {k: (v[:200] if isinstance(v, str) else v) for k, v in list(clean.items())[:60]}
    PREFS.write_text(json.dumps(clean, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"ok": True}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/update")
def update_check():
    from server import updater
    return updater.check()


@app.post("/api/update")
def update_apply():
    from server import updater
    if any(p.poll() is None for p in procs.values()):
        raise HTTPException(409, "Đang có video chạy — đợi xong hoặc dừng rồi hãy cập nhật.")
    return updater.apply()


@app.get("/api/settings")
def get_settings():
    load_env()
    mask = lambda v: (v[:4] + "…" + v[-4:]) if v and len(v) > 10 else ("đã đặt" if v else "")
    return {"PIXABAY_API_KEY": mask(os.environ.get("PIXABAY_API_KEY", "")),
            "claudeCli": bool(shutil.which("claude")),
            "claudeEnabled": os.environ.get("CLAUDE_DISABLED", "") != "1",
            "codexCli": bool(shutil.which("codex")),
            "codexEnabled": os.environ.get("CODEX_DISABLED", "") != "1"}


def _set_env(key: str, val: str | None) -> None:
    """Ghi (hoặc xoá khi val=None) một dòng trong .env và trong os.environ."""
    lines = ENV_FILE.read_text(encoding="utf-8-sig").splitlines() if ENV_FILE.exists() else []
    lines = [l for l in lines if not l.startswith(key + "=")]
    if val is None:
        os.environ.pop(key, None)
    else:
        lines.append(f"{key}={val}")
        os.environ[key] = val
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


@app.post("/api/settings")
def save_settings(PIXABAY_API_KEY: str = Form("")):
    if PIXABAY_API_KEY.strip():
        _set_env("PIXABAY_API_KEY", PIXABAY_API_KEY.strip())
    return get_settings()


@app.post("/api/settings/{service}/{action}")
def toggle_service(service: str, action: str):
    if action not in {"connect", "disconnect"}:
        raise HTTPException(400, "action không hợp lệ")
    if service == "pixabay":
        if action == "connect":
            raise HTTPException(400, "Dán key Pixabay rồi bấm Kết nối")
        _set_env("PIXABAY_API_KEY", None)
    elif service == "claude":
        _set_env("CLAUDE_DISABLED", None if action == "connect" else "1")
    elif service == "codex":
        _set_env("CODEX_DISABLED", None if action == "connect" else "1")
    else:
        raise HTTPException(404, "Dịch vụ không tồn tại")
    return get_settings()


# ---------- job ----------
@app.post("/api/jobs")
async def create_job(
    audio: UploadFile = File(...),
    title: str = Form(""), subtext: str = Form(""), lyrics: str = Form(""),
    lang: str = Form(""), orientation: str = Form("portrait"), subtitle_mode: str = Form("karaoke"),
    title_animation: str = Form("zoom"), title_color: str = Form("#ffffff"), title_font: str = Form(""), sub_font: str = Form(""),
    sub_color: str = Form("#ffffff"), sub_highlight: str = Form("#ffd23f"),
    title_out: str = Form("fade"), sub_in: str = Form(""), sub_out: str = Form("fade"), theme: str = Form(""),
    whisper_model: str = Form("small"), separate: bool = Form(False), no_lyrics: bool = Form(False),
    scene_length: float = Form(4.0),
    color_filter: str = Form("none"), filter_intensity: float = Form(1.0),
    claude_model: str = Form(""), claude_effort: str = Form(""),
    start: str = Form(""), end: str = Form(""),
):
    if audio.filename:
        try:  # tên file UTF-8 đôi khi bị giải mã nhầm thành latin-1 ("Tá»«ng" -> "Từng")
            audio.filename = audio.filename.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    ext = Path(audio.filename or "song.mp3").suffix.lower()
    if ext not in {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}:
        raise HTTPException(400, "chỉ nhận mp3, wav, m4a, flac, ogg, aac")
    job_id = f"{slugify(title or Path(audio.filename or 'song').stem)[:40]}-{secrets.token_hex(2)}"
    d = OUTPUT_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(exist_ok=True)
    src = UPLOADS / f"{job_id}{ext}"
    src.write_bytes(await audio.read())

    args = [str(src), "--job", job_id, "--orientation", orientation, "--subtitle-mode", subtitle_mode,
            "--title-animation", title_animation, "--title-color", title_color,
            "--whisper-model", whisper_model, "--scene-length", str(scene_length), "--render"]
    font_ok = lambda f: re.fullmatch(r"[A-Za-z0-9 ,\-]{1,80}", f)
    if font_ok(title_font): args += ["--title-font", title_font]
    if font_ok(sub_font): args += ["--sub-font", sub_font]
    if re.fullmatch(r"#[0-9a-fA-F]{6}", sub_color): args += ["--sub-color", sub_color]
    if re.fullmatch(r"#[0-9a-fA-F]{6}", sub_highlight): args += ["--sub-highlight", sub_highlight]
    for flag, v in (("--title-out", title_out), ("--sub-in", sub_in), ("--sub-out", sub_out)):
        if re.fullmatch(r"[a-z\-]{1,20}", v): args += [flag, v]
    if title: args += ["--title", title]
    if subtext: args += ["--subtitle-text", subtext]
    if lang: args += ["--lang", lang]
    if theme: args += ["--theme", theme]
    if re.fullmatch(r"[a-z0-9]{1,20}", color_filter) and color_filter != "none":
        args += ["--color-filter", color_filter, "--filter-intensity", f"{max(0.0, min(1.0, filter_intensity)):.2f}"]
    if re.fullmatch(r"[a-z0-9.\-]{1,60}", claude_model): args += ["--claude-model", claude_model]
    if claude_effort in {"low", "medium", "high", "xhigh", "max"}: args += ["--claude-effort", claude_effort]
    try:
        s, e = (float(start) if start else None), (float(end) if end else None)
    except ValueError:
        raise HTTPException(400, "thời điểm cắt không hợp lệ")
    if s is not None and s > 0: args += ["--start", f"{s:.3f}"]
    if e is not None and e > (s or 0): args += ["--end", f"{e:.3f}"]
    if separate: args.append("--separate")
    if no_lyrics: args.append("--no-lyrics")
    if lyrics.strip():
        (d / "lyrics_input.txt").write_text(lyrics, encoding="utf-8")
        args += ["--lyrics", str(d / "lyrics_input.txt")]

    write_meta(d, {"id": job_id, "title": title or audio.filename, "created": time.time(), "status": "running"})
    spawn(job_id, d, args)
    return {"id": job_id}


@app.get("/api/jobs")
def list_jobs():
    out = []
    if OUTPUT_DIR.exists():
        for d in OUTPUT_DIR.iterdir():
            if (d / "job.json").exists():
                m = read_meta(d)
                m["status"] = status_of(d.name, d)
                m["hasVideo"] = (d / "video.mp4").exists()
                out.append(m)
    return sorted(out, key=lambda m: m.get("created", 0), reverse=True)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    d = job_dir(job_id)
    log = (d / "log.txt").read_text(encoding="utf-8", errors="replace") if (d / "log.txt").exists() else ""
    return {**read_meta(d), "status": status_of(job_id, d), "log": log[-6000:],
            "hasVideo": (d / "video.mp4").exists(), "hasProps": (d / "props.json").exists()}


@app.get("/api/jobs/{job_id}/video")
def get_video(job_id: str):
    f = job_dir(job_id) / "video.mp4"
    if not f.exists():
        raise HTTPException(404, "chưa có video")
    return FileResponse(f, media_type="video/mp4", filename=f"{job_id}.mp4")


@app.get("/api/jobs/{job_id}/props")
def get_props(job_id: str):
    f = job_dir(job_id) / "props.json"
    if not f.exists():
        raise HTTPException(404, "chưa có props")
    return json.loads(f.read_text(encoding="utf-8"))


@app.put("/api/jobs/{job_id}/props")
def put_props(job_id: str, patch: dict):
    """Ghi đè các nhóm subtitle / title / lines / darken... rồi lưu lại."""
    f = job_dir(job_id) / "props.json"
    props = json.loads(f.read_text(encoding="utf-8"))
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(props.get(k), dict):
            props[k].update(v)
        else:
            props[k] = v
    f.write_text(json.dumps(props, ensure_ascii=False, indent=1), encoding="utf-8")
    return props


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: str):
    """Dừng job đang chạy cùng mọi tiến trình con (Whisper, tải clip, Remotion render)."""
    d = job_dir(job_id)
    p = procs.get(job_id)
    if p and p.poll() is None:
        meta = read_meta(d)
        meta["status"] = "stopped"
        write_meta(d, meta)
        subprocess.run(f"taskkill /PID {p.pid} /T /F", shell=True, capture_output=True)
        p.wait(timeout=10)
        with open(d / "log.txt", "a", encoding="utf-8") as log:
            log.write("\n■ Đã dừng theo yêu cầu.\n")
    return {"status": status_of(job_id, d)}


@app.patch("/api/jobs/{job_id}")
def rename_job(job_id: str, body: dict):
    """Đổi tên hiển thị của dự án (không đổi thư mục)."""
    d = job_dir(job_id)
    title = str(body.get("title", "")).strip()[:120]
    if not title:
        raise HTTPException(400, "Tên không được để trống")
    meta = read_meta(d)
    meta["title"] = title
    write_meta(d, meta)
    return meta


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    """Xoá dự án: dừng tiến trình (nếu có), xoá thư mục output và file nhạc đã tải lên."""
    d = job_dir(job_id)
    for p in (procs.pop(job_id, None), studio["proc"] if studio["job"] == job_id else None):
        if p and p.poll() is None:
            subprocess.run(f"taskkill /PID {p.pid} /T /F", shell=True, capture_output=True)
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
    if studio["job"] == job_id:
        studio.update(proc=None, job=None)
    for _ in range(5):  # Windows có thể giữ khoá file thêm chút sau khi kill
        try:
            shutil.rmtree(d)
            break
        except OSError:
            time.sleep(0.5)
    else:
        raise HTTPException(500, "Không xoá được thư mục dự án (file đang bị khoá?)")
    for f in UPLOADS.glob(f"{job_id}.*"):
        f.unlink(missing_ok=True)
    shutil.rmtree(PUBLIC_DIR / "jobs" / job_id / "media", ignore_errors=True)  # media nhập trong Editor
    return {"ok": True}


@app.post("/api/jobs/{job_id}/render")
def rerender(job_id: str):
    d = job_dir(job_id)
    if status_of(job_id, d) == "running":
        raise HTTPException(409, "job đang chạy")
    spawn(job_id, d, ["--render-only", str(d / "props.json")])
    return {"ok": True}


@app.post("/api/jobs/{job_id}/studio")
def open_studio(job_id: str):
    """Mở Remotion Studio để xem trước & chỉnh trực quan (màu, cỡ chữ, hiệu ứng...)."""
    d = job_dir(job_id)
    p = studio["proc"]
    if p and p.poll() is None and studio["job"] != job_id:
        subprocess.run(f"taskkill /PID {p.pid} /T /F", shell=True, capture_output=True)
        time.sleep(1)
    if not (studio["proc"] and studio["proc"].poll() is None and studio["job"] == job_id):
        log = open(d / "studio.log", "w", encoding="utf-8")
        studio["proc"] = subprocess.Popen(
            f'npx remotion studio src/index.ts --props="{d / "props.json"}" --port={STUDIO_PORT} --no-open',
            cwd=REMOTION_DIR, shell=True, stdout=log, stderr=subprocess.STDOUT, creationflags=NO_WINDOW,
        )
        studio["job"] = job_id
        (ROOT / ".studio.pid").write_text(str(studio["proc"].pid))
        for _ in range(60):
            if port_open(STUDIO_PORT):
                break
            time.sleep(0.5)
    return {"url": f"http://localhost:{STUDIO_PORT}"}


# ---------- Editor (timeline cắt ghép) ----------
MEDIA_EXT = {".mp4": "video", ".mov": "video", ".webm": "video", ".mkv": "video", ".m4v": "video",
             ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image", ".gif": "image",
             ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio", ".flac": "audio"}


@app.get("/editor", response_class=HTMLResponse)
def editor_page():
    html = (STATIC / "editor" / "editor.html").read_text(encoding="utf-8")
    # gắn ?v=<thời điểm sửa file> để trình duyệt luôn tải bản mới sau khi cập nhật
    for name in ("editor.css", "player.js", "editor.js"):
        v = int((STATIC / "editor" / name).stat().st_mtime)
        html = html.replace(f"/editor-assets/{name}\"", f"/editor-assets/{name}?v={v}\"")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


def _uid() -> str:
    return secrets.token_hex(4)


def blank_timeline(w: int, h: int) -> dict:
    return {"version": 1, "fps": 30, "width": w, "height": h, "background": "#000000",
            "tracks": [{"id": "t1", "kind": "mixed", "name": "Track 1"},
                       {"id": "v1", "kind": "main", "name": "Video chính"},
                       {"id": "a1", "kind": "mixed", "name": "Track 2"}],
            "clips": [], "media": []}


def _resolve_src(src: str) -> str:
    """Clip cũ có thể đã được chuẩn hoá thành *_n.mp4 sau khi job được tạo."""
    if not src or (PUBLIC_DIR / src).exists():
        return src
    alt = Path(src).with_name(Path(src).stem + "_n" + Path(src).suffix).as_posix()
    return alt if (PUBLIC_DIR / alt).exists() else src


def timeline_from_props(p: dict) -> dict:
    """Chuyển kết quả AI (props.json) thành timeline để chỉnh tiếp như trình dựng video."""
    tl = blank_timeline(p["width"], p["height"])
    tl["fps"] = p.get("fps", 30)
    tl["tracks"] = [{"id": "t1", "kind": "mixed", "name": "Tiêu đề"},
                    {"id": "t2", "kind": "mixed", "name": "Lời bài hát"},
                    {"id": "v1", "kind": "main", "name": "Video chính"},
                    {"id": "a1", "kind": "mixed", "name": "Nhạc"}]
    clips, media, seen = [], [], set()
    for s in p.get("scenes", []):
        dur = round(s["end"] - s["start"], 3)
        if dur <= 0:
            continue
        c = {"id": _uid(), "track": "v1", "type": "video", "start": s["start"], "dur": dur, "in": 0,
             "name": s.get("query") or Path(s["src"]).stem, "loop": True, "fit": "cover",
             "kenBurns": bool(p.get("kenBurns")), "dim": p.get("darken", 0), "volume": 0}
        tr = {"fade": "fade", "slide": "slide-left", "wipe": "wipe-left"}.get(s.get("transition", "none"))
        if clips and tr and p.get("transitionSeconds"):
            c["transition"] = {"type": tr, "dur": p["transitionSeconds"]}
        if s.get("src"):
            s["src"] = _resolve_src(s["src"])
            c.update(src=s["src"], srcDur=s.get("clipDuration"))
            if s["src"] not in seen:
                seen.add(s["src"])
                media.append({"id": _uid(), "name": c["name"], "src": s["src"], "type": "video",
                              "duration": s.get("clipDuration")})
        else:
            c["type"] = "image"
        clips.append(c)
    dur = p.get("duration", 1)
    if p.get("audio"):
        clips.append({"id": _uid(), "track": "a1", "type": "audio", "src": p["audio"], "start": 0, "dur": dur,
                      "in": 0, "srcDur": dur, "name": "Bài hát", "volume": 1})
        media.append({"id": _uid(), "name": "Bài hát", "src": p["audio"], "type": "audio", "duration": dur})
    if p.get("lines"):
        for ln in p["lines"]:  # mỗi câu 1 clip riêng để sửa / kéo từng câu
            d = round(ln["end"] - ln["start"], 3)
            if d > 0 and ln.get("words"):
                clips.append({"id": _uid(), "track": "t2", "type": "lyrics", "start": ln["start"], "dur": d,
                              "in": ln["start"], "name": " ".join(w["text"] for w in ln["words"]),
                              "lines": [ln], "subtitle": p["subtitle"]})
    t = p.get("title") or {}
    if t.get("enabled") and t.get("text"):
        clips.append({"id": _uid(), "track": "t1", "type": "text", "start": t.get("start", 0),
                      "dur": t.get("duration", 3), "name": t["text"], "title": {**t, "start": 0}})
    tl["clips"], tl["media"] = clips, media
    if p.get("colorFilter"):
        tl["filter"] = p["colorFilter"]
    return tl


@app.post("/api/projects")
def create_project(body: dict):
    """Dự án trống để tự cắt ghép."""
    title = str(body.get("title", "")).strip()[:120] or "Dự án mới"
    w, h = {**SIZES, "four5": (1080, 1350)}.get(body.get("orientation", "landscape"), SIZES["landscape"])
    job_id = f"{slugify(title)[:40]}-{secrets.token_hex(2)}"
    d = OUTPUT_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    write_meta(d, {"id": job_id, "title": title, "created": time.time(), "status": "done", "kind": "edit"})
    (d / "timeline.json").write_text(json.dumps(blank_timeline(w, h), ensure_ascii=False), encoding="utf-8")
    return {"id": job_id}


@app.get("/api/jobs/{job_id}/timeline")
def get_timeline(job_id: str):
    d = job_dir(job_id)
    f = d / "timeline.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    if (d / "props.json").exists():
        return timeline_from_props(json.loads((d / "props.json").read_text(encoding="utf-8")))
    raise HTTPException(404, "Dự án chưa có dữ liệu để dựng (AI chưa chạy xong?)")


@app.put("/api/jobs/{job_id}/timeline")
def put_timeline(job_id: str, tl: dict):
    d = job_dir(job_id)
    if not isinstance(tl.get("clips"), list) or not isinstance(tl.get("tracks"), list):
        raise HTTPException(400, "timeline không hợp lệ")
    (d / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


@app.post("/api/jobs/{job_id}/media")
async def upload_media(job_id: str, file: UploadFile = File(...)):
    job_dir(job_id)
    name = file.filename or "file"
    try:
        name = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    ext = Path(name).suffix.lower()
    if ext not in MEDIA_EXT:
        raise HTTPException(400, "Định dạng không hỗ trợ")
    folder = PUBLIC_DIR / "jobs" / job_id / "media"
    folder.mkdir(parents=True, exist_ok=True)
    fn = f"{slugify(Path(name).stem)[:40]}-{secrets.token_hex(2)}{ext}"
    with open(folder / fn, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)
    return {"id": _uid(), "name": name, "src": f"jobs/{job_id}/media/{fn}", "type": MEDIA_EXT[ext]}


EXPORTS = ROOT / "exports"
CRF = {"low": 28, "medium": 23, "high": 20, "best": 17}
X264 = {"fast": "veryfast", "balanced": "medium", "small": "slow"}


def _safe_name(name: str) -> str:
    """Tên file an toàn cho Windows & link tải (bỏ # ? % ...), giữ tiếng Việt."""
    name = re.sub(r"""[\\/:*?"<>|#%&{}$!'@+`=]""", "", name).strip(" .")
    return re.sub(r"\s+", " ", name)[:80] or "video"


@app.post("/api/jobs/{job_id}/export")
def export_timeline(job_id: str, body: dict):
    """Lưu timeline rồi render bằng composition Timeline của Remotion -> exports/<tên>.<đuôi>."""
    d = job_dir(job_id)
    if status_of(job_id, d) == "running":
        raise HTTPException(409, "Dự án đang chạy")
    tl = body.get("timeline", body)
    o = body.get("options") or {}
    if not tl.get("clips"):
        raise HTTPException(400, "Timeline trống")
    put_timeline(job_id, tl)

    fmt = o.get("format", "mp4") if o.get("format") in {"mp4", "hevc", "webm", "mp3"} else "mp4"
    codec, ext = {"mp4": ("h264", ".mp4"), "hevc": ("h265", ".mp4"), "webm": ("vp8", ".webm"), "mp3": ("mp3", ".mp3")}[fmt]
    render_tl = dict(tl)
    if int(o.get("fps") or 0) in {24, 25, 30, 50, 60}:
        render_tl["fps"] = int(o["fps"])
    (d / "timeline.render.json").write_text(json.dumps(render_tl, ensure_ascii=False), encoding="utf-8")

    flags = [f"--codec={codec}"]
    if codec != "mp3":
        flags.append(f"--crf={CRF.get(o.get('quality'), 20) + (6 if codec == 'vp8' else 0)}")
        if codec == "h264":
            flags.append(f"--x264-preset={X264.get(o.get('speed'), 'medium')}")
    if int(o.get("abr") or 0) in {128, 192, 320}:
        flags.append(f"--audio-bitrate={int(o['abr'])}k")

    EXPORTS.mkdir(exist_ok=True)
    base = _safe_name(o.get("name") or read_meta(d).get("title") or job_id)
    out, n = EXPORTS / f"{base}{ext}", 2
    while out.exists():
        out, n = EXPORTS / f"{base} ({n}){ext}", n + 1

    log = open(d / "log.txt", "a", encoding="utf-8")
    log.write(f"\n===== {time.strftime('%H:%M:%S')} Xuất video từ Editor -> {out.name} =====\n")
    log.flush()
    tmp = d / f"export.rendering{ext}"
    cmd = f'npx remotion render src/index.ts Timeline "{tmp}" --props="{d / "timeline.render.json"}" {" ".join(flags)}'
    h = int(o.get("height") or 0)
    short = min(tl["width"], tl["height"])
    if codec != "mp3" and h and h != short:
        # --scale của Remotion hay ra kích thước lẻ (1280.06) -> thu nhỏ bằng ffmpeg đi kèm, giữ cạnh chẵn
        vf = f"scale={'-2:' + str(h) if tl['width'] >= tl['height'] else str(h) + ':-2'}:flags=lanczos"
        crf = CRF.get(o.get("quality"), 20)
        venc = {"h264": f"-c:v libx264 -crf {crf} -preset {X264.get(o.get('speed'), 'medium')} -pix_fmt yuv420p",
                "h265": f"-c:v libx265 -crf {crf + 4} -tag:v hvc1 -pix_fmt yuv420p",
                "vp8": f"-c:v libvpx -crf {crf + 6} -b:v 0"}[codec]
        scaled = d / f"export.scaled{ext}"
        cmd += f' && npx remotion ffmpeg -y -loglevel error -i "{tmp}" -vf "{vf}" {venc} -c:a copy "{scaled}" && move /Y "{scaled}" "{tmp}"'
    cmd += f' && move /Y "{tmp}" "{out}"'

    if codec == "h264":  # bản H.264 cũng làm video chính của dự án (trang chủ xem/tải được)
        cmd += f' && copy /Y "{out}" "{d / "video.mp4"}"'
    procs[job_id] = subprocess.Popen(cmd, cwd=REMOTION_DIR, shell=True, stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=NO_WINDOW)
    meta = read_meta(d)
    meta.update(status="running", lastExport=out.name)
    write_meta(d, meta)
    return {"ok": True, "file": out.name}


def _last_export(job_id: str) -> Path:
    name = read_meta(job_dir(job_id)).get("lastExport")
    f = EXPORTS / name if name else None
    if not f or not f.exists():
        raise HTTPException(404, "Chưa có file xuất")
    return f


@app.get("/api/jobs/{job_id}/export-file")
def export_file(job_id: str):
    f = _last_export(job_id)
    return FileResponse(f, filename=f.name)


@app.post("/api/jobs/{job_id}/open-export")
def open_export(job_id: str):
    """Mở Explorer và chọn sẵn file vừa xuất."""
    f = _last_export(job_id)
    subprocess.Popen(f'explorer /select,"{f}"')
    return {"ok": True}
