"""Web server localhost: tải nhạc lên, theo dõi tiến trình, chỉnh phụ đề/tiêu đề, render lại."""
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from make_video import slugify  # noqa: E402
from musicvideo.config import CACHE_DIR, CLIPS_DIR, EXPORTS_DIR, OUTPUT_DIR, PUBLIC_DIR, REMOTION_DIR, SIZES, UPLOADS_DIR, load_env  # noqa: E402

UPLOADS = UPLOADS_DIR
LOGOS = ROOT / "logos"  # thư viện logo kênh, giữ qua các lần mở app / cập nhật
LOGO_EXT = {".png", ".webp", ".jpg", ".jpeg", ".svg"}
ENV_FILE = ROOT / ".env"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # không bật cửa sổ console trên Windows

app = FastAPI(title="AI Music Video Tool")

# Starlette lưu file multipart lớn xuống thư mục tạm trước khi gọi endpoint.
# Dùng cùng ổ với dữ liệu để tránh lỗi mơ hồ khi ổ C (TEMP mặc định) đầy.
TEMP_DIR = CACHE_DIR / "tmp"
TEMP_DIR.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(TEMP_DIR)
os.environ["TMP"] = os.environ["TEMP"] = str(TEMP_DIR)


def _disk_full(exc: OSError) -> None:
    if exc.errno == 28:
        raise HTTPException(507, "Ổ lưu dữ liệu đã đầy. Hãy giải phóng dung lượng hoặc đặt AI_MUSIC_VIDEO_DATA_DIR trong file .env sang ổ còn trống.") from exc
    raise exc


@app.on_event("startup")
def _cleanup_update_leftovers():
    from server import updater
    updater.cleanup_old()

STATIC = Path(__file__).parent / "static"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=PUBLIC_DIR), name="media")
app.mount("/editor-assets", StaticFiles(directory=STATIC / "editor"), name="editor-assets")
procs: dict[str, subprocess.Popen] = {}


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


# ---------- trang & cài đặt ----------
@app.get("/favicon.png")
@app.get("/favicon.ico")
def favicon():
    return FileResponse(STATIC / "favicon.png", media_type="image/png")


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
    try:
        return updater.apply()
    except Exception as e:
        raise HTTPException(500, f"Cập nhật lỗi: {e}")


@app.get("/api/settings")
def get_settings():
    load_env()
    mask = lambda v: (v[:4] + "…" + v[-4:]) if v and len(v) > 10 else ("đã đặt" if v else "")
    return {"PIXABAY_API_KEY": mask(os.environ.get("PIXABAY_API_KEY", "")),
            "claudeCli": bool(shutil.which("claude")),
            "claudeEnabled": os.environ.get("CLAUDE_DISABLED", "") != "1",
            "codexCli": bool(shutil.which("codex")),
            "codexEnabled": os.environ.get("CODEX_DISABLED", "") != "1",
            "codexModels": _codex_models()}


def _codex_hint(desc: str) -> str:
    """Hậu tố dễ hiểu như model Claude: (nhanh) / (cân bằng) / (mạnh nhất) — đoán từ mô tả tiếng Anh của Codex."""
    d = desc.lower()
    for keys, hint in ((("most capable", "frontier", "smartest", "strongest", "flagship", "hardest"), "mạnh nhất"),
                       (("balanced", "everyday", "general"), "cân bằng"),
                       (("fast", "affordable", "mini", "simple", "easier", "light"), "nhanh"),
                       (("reason", "deep", "complex"), "hiểu sâu")):
        if any(k in d for k in keys):
            return f" ({hint}{', đời cũ' if 'legacy' in d else ''})"
    return " (đời cũ)" if "legacy" in d else ""


def _codex_models() -> list[dict]:
    """Model Codex mà gói ChatGPT đang đăng nhập được dùng (đọc cache của Codex CLI)."""
    try:
        data = json.loads((Path.home() / ".codex" / "models_cache.json").read_text(encoding="utf-8"))
        return [{"slug": m["slug"], "name": (m.get("display_name") or m["slug"]) + _codex_hint(m.get("description", ""))}
                for m in data.get("models", []) if m.get("visibility", "list") == "list" and m.get("slug")]
    except Exception:
        return []


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


# ---------- thư viện logo ----------
def _logo_path(name: str) -> Path:
    f = LOGOS / Path(name).name
    if f.suffix.lower() not in LOGO_EXT or not f.is_file():
        raise HTTPException(404, "Không có logo này")
    return f


@app.get("/api/logos")
def list_logos():
    if not LOGOS.exists():
        return []
    fs = sorted((f for f in LOGOS.iterdir() if f.suffix.lower() in LOGO_EXT), key=lambda f: f.stat().st_mtime, reverse=True)
    return [{"name": f.name, "url": f"/api/logos/{f.name}?v={int(f.stat().st_mtime)}"} for f in fs]


@app.get("/api/logos/{name}")
def get_logo(name: str):
    return FileResponse(_logo_path(name))


@app.post("/api/logos")
async def add_logo(file: UploadFile = File(...)):
    name = file.filename or "logo.png"
    try:
        name = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    ext = Path(name).suffix.lower()
    if ext not in LOGO_EXT:
        raise HTTPException(400, "logo chỉ nhận png, webp, jpg, svg (nên dùng PNG nền trong suốt)")
    data = await file.read()
    if len(data) > 5_000_000:
        raise HTTPException(400, "logo tối đa 5 MB")
    LOGOS.mkdir(exist_ok=True)
    stem = slugify(Path(name).stem)[:40] or "logo"
    f = LOGOS / f"{stem}{ext}"
    i = 2
    while f.exists() and f.read_bytes() != data:  # trùng tên khác nội dung -> đánh số
        f = LOGOS / f"{stem}-{i}{ext}"
        i += 1
    f.write_bytes(data)
    return {"name": f.name}


@app.delete("/api/logos/{name}")
def delete_logo(name: str):
    _logo_path(name).unlink()
    return {"ok": True}


# ---------- cắt nhạc: tải riêng đoạn đã chọn, giữ nguyên định dạng và chất lượng gốc ----------
@app.post("/api/cut-audio")
async def cut_audio(audio: UploadFile = File(...), start: float = Form(0.0), end: float = Form(0.0)):
    from starlette.background import BackgroundTask
    from musicvideo.audio import FFMPEG

    name = audio.filename or "audio.wav"
    try:
        name = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    ext = Path(name).suffix.lower() or ".wav"
    tmp = Path(tempfile.mkdtemp(prefix="cut-"))
    src, dst = tmp / f"src{ext}", tmp / f"out{ext}"
    src.write_bytes(await audio.read())
    cmd = [FFMPEG, "-y", "-loglevel", "error"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if end > start:
        cmd += ["-t", f"{end - start:.3f}"]
    # -c copy: không mã hoá lại -> WAV ra WAV, MP3 ra MP3, chất lượng y hệt file gốc
    cmd += ["-map", "0:a", "-map_metadata", "0", "-c", "copy", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode or not dst.exists():
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(500, "không cắt được nhạc: " + (r.stderr or "")[-300:])

    def fmt(t: float) -> str:
        return f"{int(t // 60)}m{int(t % 60):02d}"

    label = f" ({fmt(start)}-{fmt(end)})" if end > start else ""
    return FileResponse(dst, filename=f"{Path(name).stem}{label}{ext}",
                        background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True))


# ---------- job ----------
@app.post("/api/jobs")
async def create_job(
    audio: UploadFile = File(...),
    title: str = Form(""), subtext: str = Form(""), lyrics: str = Form(""),
    lang: str = Form(""), orientation: str = Form("portrait"), subtitle_mode: str = Form("karaoke"),
    title_animation: str = Form("zoom"), title_color: str = Form("#ffffff"), title_font: str = Form(""), sub_font: str = Form(""),
    sub_color: str = Form("#ffffff"), sub_highlight: str = Form("#ffd23f"),
    sub_stroke: str = Form("#000000"), sub_stroke_width: float = Form(6), sub_size: float = Form(6.5),
    sub_position: str = Form("bottom"), layout: str = Form("classic"), sub_upper: str = Form("0"), sub_lookahead: int = Form(2),
    sub_in_dur: float = Form(0.3), sub_out_dur: float = Form(0.15),
    title_out: str = Form("fade"), sub_in: str = Form(""), sub_out: str = Form("fade"), theme: str = Form(""),
    whisper_model: str = Form("small"), no_lyrics: bool = Form(False),
    scene_length: float = Form(4.0),
    color_filter: str = Form("none"), filter_intensity: float = Form(1.0),
    claude_model: str = Form(""), claude_effort: str = Form(""), ai_model: str = Form(""),
    start: str = Form(""), end: str = Form(""),
    logo_name: str = Form(""), logo_position: str = Form("top-right"),
    logo_size: float = Form(14), logo_opacity: float = Form(0.9),
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
    src = UPLOADS / f"{job_id}{ext}"
    try:
        d.mkdir(parents=True, exist_ok=True)
        UPLOADS.mkdir(parents=True, exist_ok=True)
        if audio.size and shutil.disk_usage(UPLOADS).free < audio.size + (16 << 20):
            raise HTTPException(507, "Ổ lưu dữ liệu không đủ chỗ cho file nhạc. Hãy giải phóng dung lượng hoặc đặt AI_MUSIC_VIDEO_DATA_DIR trong file .env sang ổ còn trống.")
        with src.open("wb") as out:
            while chunk := await audio.read(1 << 20):
                out.write(chunk)
    except OSError as exc:
        src.unlink(missing_ok=True)
        _disk_full(exc)

    args = [str(src), "--job", job_id, "--orientation", orientation, "--subtitle-mode", subtitle_mode,
            "--title-animation", title_animation, "--title-color", title_color,
            "--whisper-model", whisper_model, "--scene-length", str(scene_length), "--render"]
    font_ok = lambda f: re.fullmatch(r"[A-Za-z0-9 ,\-]{1,80}", f)
    if font_ok(title_font): args += ["--title-font", title_font]
    if font_ok(sub_font): args += ["--sub-font", sub_font]
    if re.fullmatch(r"#[0-9a-fA-F]{6}", sub_color): args += ["--sub-color", sub_color]
    if re.fullmatch(r"#[0-9a-fA-F]{6}", sub_highlight): args += ["--sub-highlight", sub_highlight]
    if re.fullmatch(r"#[0-9a-fA-F]{6}", sub_stroke): args += ["--sub-stroke", sub_stroke]
    args += ["--sub-stroke-width", str(max(0.0, min(16.0, sub_stroke_width))), "--sub-size", str(max(3.0, min(15.0, sub_size))),
             "--sub-lookahead", str(max(1, min(6, sub_lookahead))),
             "--sub-in-dur", str(max(0.1, min(2.0, sub_in_dur))), "--sub-out-dur", str(max(0.1, min(2.0, sub_out_dur)))]
    if sub_position in {"bottom", "center", "top"}: args += ["--sub-position", sub_position]
    if re.fullmatch(r"[a-z_]{1,20}", layout): args += ["--layout", layout]
    if sub_upper == "1": args += ["--sub-upper"]
    for flag, v in (("--title-out", title_out), ("--sub-in", sub_in), ("--sub-out", sub_out)):
        if re.fullmatch(r"[a-z\-]{1,20}", v): args += [flag, v]
    if title: args += ["--title", title]
    if subtext: args += ["--subtitle-text", subtext]
    if lang: args += ["--lang", lang]
    if theme: args += ["--theme", theme]
    if re.fullmatch(r"[a-z0-9]{1,20}", color_filter) and color_filter != "none":
        args += ["--color-filter", color_filter, "--filter-intensity", f"{max(0.0, min(1.0, filter_intensity)):.2f}"]
    if re.fullmatch(r"[a-z0-9.\-]{1,60}", claude_model): args += ["--claude-model", claude_model]
    cli, _, m = ai_model.partition(":")  # "claude:claude-opus-5-5" | "codex:gpt-6-luna" | "codex:" (mặc định)
    if cli in {"claude", "codex"} and re.fullmatch(r"[a-z0-9.\-]{0,60}", m):
        args += ["--ai", cli]
        if m: args += [f"--{cli}-model", m]
    if claude_effort in {"low", "medium", "high", "xhigh", "max"}: args += ["--claude-effort", claude_effort]
    try:
        s, e = (float(start) if start else None), (float(end) if end else None)
    except ValueError:
        raise HTTPException(400, "thời điểm cắt không hợp lệ")
    if s is not None and s > 0: args += ["--start", f"{s:.3f}"]
    if e is not None and e > (s or 0): args += ["--end", f"{e:.3f}"]
    if no_lyrics: args.append("--no-lyrics")
    if logo_name:
        lf = _logo_path(logo_name)
        shutil.copyfile(lf, d / f"logo{lf.suffix.lower()}")
        args += ["--logo", str(d / f"logo{lf.suffix.lower()}"), "--logo-size", f"{max(3.0, min(50.0, logo_size)):.1f}",
                 "--logo-opacity", f"{max(0.0, min(1.0, logo_opacity)):.2f}"]
        if logo_position in {"top-right", "top-left", "bottom-right", "bottom-left"}:
            args += ["--logo-position", logo_position]
    if lyrics.strip():
        (d / "lyrics_input.txt").write_text(lyrics, encoding="utf-8")
        args += ["--lyrics", str(d / "lyrics_input.txt")]

    write_meta(d, {"id": job_id, "title": title or audio.filename, "created": time.time(), "status": "running",
                   "args": args})
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
                m["hasUnexportedEdits"] = _has_unexported_edits(d)
                out.append(m)
    return sorted(out, key=lambda m: m.get("created", 0), reverse=True)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    d = job_dir(job_id)
    log = (d / "log.txt").read_text(encoding="utf-8", errors="replace") if (d / "log.txt").exists() else ""
    return {**read_meta(d), "status": status_of(job_id, d), "log": log[-6000:],
            "hasVideo": (d / "video.mp4").exists(), "hasProps": (d / "props.json").exists(),
            "hasUnexportedEdits": _has_unexported_edits(d), "hasTimeline": (d / "timeline.json").exists(),
            "aiUndo": (d / "timeline.ai-undo.json").exists()}


def _has_unexported_edits(d: Path) -> bool:
    timeline, video = d / "timeline.json", d / "video.mp4"
    return timeline.is_file() and video.is_file() and timeline.stat().st_mtime_ns > video.stat().st_mtime_ns


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
    p = procs.pop(job_id, None)
    if p and p.poll() is None:
        subprocess.run(f"taskkill /PID {p.pid} /T /F", shell=True, capture_output=True)
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
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


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    """Tiếp tục / chạy lại job đã dừng hoặc lỗi: bỏ qua các bước đã xong (audio, lời, từ khóa, clip đã tải)."""
    d = job_dir(job_id)
    if status_of(job_id, d) == "running":
        raise HTTPException(409, "job đang chạy")
    args = read_meta(d).get("args")
    if (d / "props.json").exists():  # đã chuẩn bị xong mọi thứ, chỉ còn bước render
        restore_clips(_props_srcs(d))
        with open(d / "log.txt", "a", encoding="utf-8") as log:
            log.write("\n▶ Tiếp tục: các bước trước đã xong, chỉ render lại.\n")
        spawn(job_id, d, ["--render-only", str(d / "props.json")])
    elif args and Path(args[0]).exists():
        with open(d / "log.txt", "a", encoding="utf-8") as log:
            log.write("\n▶ Tiếp tục từ bước đang dở (bỏ qua các bước đã xong)…\n")
        spawn(job_id, d, args)
    else:
        raise HTTPException(400, "Dự án tạo từ bản cũ, không lưu đủ thông tin để tiếp tục. Hãy tạo lại.")
    return {"ok": True}


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


def _logo_clip(lg: dict, w: int, h: int, dur: float) -> dict:
    """Logo ở góc -> clip ảnh "vừa khung" thu nhỏ, đặt đúng góc như bản render."""
    ar = 1.0
    try:
        from PIL import Image
        with Image.open(PUBLIC_DIR / lg["src"]) as im:
            ar = im.width / im.height
    except Exception:  # svg / ảnh lỗi -> coi như vuông
        pass
    base, m = min(w, h), min(w, h) * lg.get("margin", 4) / 100
    iw = base * lg.get("size", 14) / 100
    ih = iw / ar
    scale = iw / min(w, h * ar)  # ảnh "contain" trong khung full rồi scale
    v, hz = (lg.get("position") or "top-right").split("-")
    cx = m + iw / 2 if hz == "left" else w - m - iw / 2
    cy = m + ih / 2 if v == "top" else h - m - ih / 2
    return {"id": _uid(), "track": "t0", "type": "image", "src": lg["src"], "start": 0, "dur": dur, "name": "Logo", "isLogo": True,
            "fit": "contain", "x": round(cx / w * 100, 2), "y": round(cy / h * 100, 2), "scale": round(scale, 4),
            "opacity": lg.get("opacity", 1)}


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
        t0 = s.get("transition", "none")
        tr = {"fade": "fade", "slide": "slide-left", "wipe": "wipe-left"}.get(t0) or             (t0 if t0 in {"dissolve-zoom", "blur-dissolve", "soft-push", "light-leak"} else None)
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
    lg = p.get("logo") or {}
    if lg.get("src") and (PUBLIC_DIR / lg["src"]).exists():
        tl["tracks"].insert(0, {"id": "t0", "kind": "mixed", "name": "Logo"})
        clips.append(_logo_clip(lg, p["width"], p["height"], dur))
        media.append({"id": _uid(), "name": "Logo", "src": lg["src"], "type": "image"})
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


# ---------- Clip Pixabay đã tải (dùng chung giữa các dự án) ----------
CLIP_RE = re.compile(r"^clips/pixabay_(\d+)_n\.mp4$")


def restore_clips(srcs) -> int:
    """Tải lại các clip Pixabay đã bị người dùng dọn mà dự án vẫn cần. Trả về số clip đã tải lại."""
    missing = sorted({int(m.group(1)) for s in srcs if isinstance(s, str) and (m := CLIP_RE.match(s))
                      and not (PUBLIC_DIR / s).is_file()})
    if not missing:
        return 0
    load_env()
    key = os.environ.get("PIXABAY_API_KEY", "")
    if not key:
        raise HTTPException(400, "Clip của dự án đã bị dọn, cần kết nối Pixabay (Cài đặt) để tải lại.")
    from musicvideo.pixabay import Pixabay
    px, n = Pixabay(key, CACHE_DIR, CLIPS_DIR), 0
    for vid in missing:
        try:
            hit = px.by_id(vid)
            if hit:
                px.download(hit)
                n += 1
        except Exception as e:  # noqa: BLE001 - thiếu 1 clip vẫn mở được dự án
            print(f"  ⚠ không tải lại được clip {vid}: {e}", flush=True)
    return n


def _tl_srcs(tl: dict) -> set:
    return {c.get("src") for c in tl.get("clips", [])} | {m.get("src") for m in tl.get("media", [])}


def _props_srcs(d: Path) -> set:
    f = d / "props.json"
    if not f.exists():
        return set()
    return set(re.findall(r'"(clips/pixabay_\d+_n\.mp4)"', f.read_text(encoding="utf-8")))


def _any_running() -> bool:
    return any(p.poll() is None for p in procs.values())


@app.get("/api/clips")
def clips_usage():
    files = [f for f in CLIPS_DIR.glob("*") if f.is_file()] if CLIPS_DIR.exists() else []
    return {"count": len(files), "bytes": sum(f.stat().st_size for f in files), "running": _any_running()}


@app.post("/api/clips/cleanup")
def clips_cleanup():
    if _any_running():
        raise HTTPException(409, "Đang có video được tạo — đợi xong rồi dọn.")
    freed = n = 0
    for f in (CLIPS_DIR.glob("*") if CLIPS_DIR.exists() else []):
        if f.is_file():
            try:
                size = f.stat().st_size
                f.unlink()
                freed += size
                n += 1
            except OSError:
                pass  # file đang bị khoá (Editor đang phát) -> bỏ qua
    return {"freed": freed, "count": n}


@app.get("/api/jobs/{job_id}/timeline")
def get_timeline(job_id: str):
    d = job_dir(job_id)
    f = d / "timeline.json"
    if f.exists():
        tl = json.loads(f.read_text(encoding="utf-8"))
    elif (d / "props.json").exists():
        tl = timeline_from_props(json.loads((d / "props.json").read_text(encoding="utf-8")))
    else:
        tl = None
    if tl is not None:
        if status_of(job_id, d) != "running":
            restore_clips(_tl_srcs(tl))
        return tl
    raise HTTPException(404, "Dự án chưa có dữ liệu để dựng (AI chưa chạy xong?)")


@app.put("/api/jobs/{job_id}/timeline")
def put_timeline(job_id: str, tl: dict):
    d = job_dir(job_id)
    if not isinstance(tl.get("clips"), list) or not isinstance(tl.get("tracks"), list):
        raise HTTPException(400, "timeline không hợp lệ")
    (d / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


AI_EDIT_PROMPT = """Bạn là trợ lý dựng video trong một trình biên tập timeline. Người dùng ra lệnh bằng lời,
bạn trả về các THAO TÁC để sửa timeline. Chỉ trả về đúng 1 khối JSON, không giải thích ngoài JSON:
{"reply": "<tóm tắt ngắn bằng tiếng Việt những gì đã làm>", "ops": [ ... ]}

Các thao tác được phép:
- {"op":"update","ids":["<clip id>",...],"set":{"<khoá>": <giá trị>, ...}}  // khoá có thể có dấu chấm, vd "subtitle.color", "transition.type"
- {"op":"delete","ids":["<clip id>",...]}
- {"op":"add","clip":{"track":"<track id>","type":"text","start":0,"dur":3,"name":"...","title":{"text":"...","fontSize":80,"color":"#ffffff"}}}
  // nếu cần track mới (vd chưa có track Tiêu đề) thì đặt "track":"new" và "trackName":"Tiêu đề"
- {"op":"pixabay","query":"English visual search terms","start":0,"dur":5,"track":"<track id>"}
  // thêm clip Pixabay khi người dùng yêu cầu cảnh quay mới; dùng từ khoá hình ảnh tiếng Anh, không tự bịa URL.
- {"op":"timeline","set":{"filter":{"preset":"warm","intensity":1,"brightness":0,"contrast":0,"saturation":0,"temperature":0,"tint":0,"vignette":0,"hue":0,"fade":0},"width":1080,"height":1920,"background":"#000000"}}
  // filter: intensity 0-1; brightness/contrast/saturation/temperature/tint -100..100; vignette/fade 0..100; hue -180..180.
  // Khi đổi filter, giữ nguyên các giá trị cũ không liên quan. "Tăng nhẹ" ~ 15-25.
  // preset: {presets}

Quy ước clip: start/dur tính bằng giây; video có volume (0-2), dim (0-1, làm tối), fit ("cover"/"contain"),
scale, x, y (% vị trí, 50 = giữa), kenBurns (bool), speed, fadeIn/fadeOut (giây),
transition {"type": "<một trong: {transitions}>", "dur": 0.5}. "Mờ chéo" = "fade".
Câu lời (type "lyrics") có subtitle {mode: karaoke|preview|full, fontFamily, fontSize, color, highlightColor,
strokeColor, strokeWidth, uppercase, position: bottom|center|top}. Chữ của mỗi câu nằm ở "name".
SỬA CHỮ PHỤ ĐỀ (lời):
- Người dùng nói phụ đề/lời sai, chưa khớp, cần tra lại lời bài hát -> {"op":"fix_lyrics","lyrics":""}
  (máy sẽ tự research lời chuẩn trên mạng rồi đối chiếu và sửa mọi câu, giữ thời gian karaoke).
  Nếu người dùng dán sẵn lời đúng trong yêu cầu, đưa toàn bộ lời đó vào "lyrics".
- Người dùng chỉ rõ một/vài câu cần đổi thành chữ gì -> {"op":"set_text","id":"<clip id>","text":"<chữ mới>"}
Khi đổi kiểu phụ đề, áp dụng cho MỌI clip lyrics. Chỉ dùng id có trong timeline. Không tự bịa file media mới.
Nếu yêu cầu không làm được, trả "ops": [] và giải thích trong "reply".

TIMELINE HIỆN TẠI (rút gọn):
{timeline}

ĐANG CHỌN: {selected}

YÊU CẦU: {request}
"""


def _compact_timeline(tl: dict) -> dict:
    clips = []
    for c in tl.get("clips", []):
        c = {k: v for k, v in c.items() if k not in ("lines", "words")}
        if c.get("type") == "lyrics":  # mọi câu dùng chung kiểu -> chỉ gửi kiểu ở câu đầu cho gọn
            if any(x.get("type") == "lyrics" for x in clips):
                c.pop("subtitle", None)
        clips.append(c)
    return {"width": tl.get("width"), "height": tl.get("height"), "fps": tl.get("fps"),
            "filter": tl.get("filter"), "tracks": tl.get("tracks"), "clips": clips,
            "media": [{"name": m.get("name"), "type": m.get("type")} for m in tl.get("media", [])]}


@app.post("/api/jobs/{job_id}/ai-edit")
def ai_edit(job_id: str, body: dict):
    from musicvideo import llm
    job_dir(job_id)
    req = (body.get("prompt") or "").strip()
    tl = body.get("timeline")
    images = [p for n in (body.get("images") or [])[:6] if (p := _ai_image_path(job_id, str(n))).exists()]
    if images and not req:
        req = "Xem ảnh đính kèm: tìm chỗ bị lỗi trên video và sửa lại cho đúng."
    if not req or not isinstance(tl, dict):
        raise HTTPException(400, "Thiếu câu lệnh hoặc timeline")
    if not llm.available():
        raise HTTPException(400, "Chưa kết nối Claude CLI hay Codex CLI (vào Cài đặt > Kết nối)")
    prompt = (AI_EDIT_PROMPT.replace("{timeline}", json.dumps(_compact_timeline(tl), ensure_ascii=False))
              .replace("{selected}", json.dumps(body.get("selected") or [], ensure_ascii=False))
              .replace("{presets}", ", ".join(body.get("presets") or []) or "warm, cool, cinematic, vintage, bw")
              .replace("{transitions}", ", ".join(body.get("transitions") or []) or "fade, slide-left, wipe-left")
              .replace("{request}", req))
    try:
        out = llm.ask(prompt, effort="low", timeout=300, images=[str(p) for p in images])
    except Exception as e:
        raise HTTPException(500, f"AI lỗi: {e}")
    m = re.search(r"\{.*\}", out, re.S)
    try:
        res = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        res = None
    if not isinstance(res, dict) or not isinstance(res.get("ops"), list):
        raise HTTPException(500, "AI trả về không đúng định dạng: " + out.strip()[:200])
    reply, ops = str(res.get("reply") or ""), []
    pixabay_count = 0
    for o in res["ops"]:
        if not isinstance(o, dict):
            continue
        if o.get("op") == "fix_lyrics":
            r = fix_lyrics_ops(job_id, tl, str(o.get("lyrics") or ""))
            ops += r["ops"]
            reply = (reply + " " + r["reply"]).strip()
        elif o.get("op") == "set_text":
            ops += set_text_ops(tl, str(o.get("id") or ""), str(o.get("text") or ""))
        elif o.get("op") == "pixabay":
            if pixabay_count >= 3:
                reply = (reply + " Mỗi lệnh chỉ thêm tối đa 3 clip Pixabay.").strip()
                continue
            pixabay_count += 1
            try:
                ops.append(pixabay_add_op(job_id, tl, o))
            except Exception as e:
                reply = (reply + f" Không thêm được clip Pixabay: {e}").strip()
        elif o.get("op") in {"update", "delete", "add", "timeline"}:
            ops.append(o)
    return {"reply": reply, "ops": ops}


def pixabay_add_op(job_id: str, tl: dict, request: dict) -> dict:
    """Tìm, tải và chuẩn hoá một clip để Editor có thể thêm trực tiếp vào timeline."""
    from musicvideo.pixabay import Pixabay
    load_env()
    key = os.environ.get("PIXABAY_API_KEY", "")
    if not key:
        raise ValueError("Chưa kết nối Pixabay trong Cài đặt")
    query = str(request.get("query") or "").strip()[:100]
    if not query:
        raise ValueError("Thiếu từ khoá tìm kiếm")
    start = max(0.0, min(float(request.get("start") or 0), 24 * 3600))
    dur = max(1.0, min(float(request.get("dur") or 5), 60.0))
    used = {int(m.group(1)) for c in tl.get("clips", [])
            if (m := re.search(r"pixabay_(\d+)", str(c.get("src") or "")))}
    px = Pixabay(key, CACHE_DIR, CLIPS_DIR, project_id=job_id)
    hit = px.find(query, dur, tl.get("height", 0) > tl.get("width", 0), used)
    if not hit:
        raise ValueError(f"Không tìm thấy clip cho '{query}'")
    px.record_project(used | {int(hit["id"])})
    src = px.download(hit).relative_to(PUBLIC_DIR).as_posix()
    source_dur = float(hit.get("duration") or dur)
    media = {"id": _uid(), "name": f"Pixabay: {query}", "src": src, "type": "video", "duration": source_dur}
    track = str(request.get("track") or "new")
    clip = {"type": "video", "track": track, "trackName": "Video Pixabay", "src": src,
            "start": round(start, 3), "dur": round(min(dur, source_dur), 3), "srcDur": source_dur,
            "name": media["name"], "fit": "cover", "volume": 0}
    return {"op": "add_media", "media": media, "clip": clip}


def _lyric_clips(tl: dict) -> list[dict]:
    cs = [c for c in tl.get("clips", []) if c.get("type") == "lyrics" and c.get("lines")]
    return sorted(cs, key=lambda c: c.get("start", 0))


def _line_update(c: dict, words: list[dict]) -> dict:
    ln = {"start": words[0]["start"], "end": words[-1]["end"], "words": words}
    return {"op": "update", "ids": [c["id"]], "set": {"lines": [ln], "name": " ".join(w["text"] for w in words)}}


def set_text_ops(tl: dict, clip_id: str, text: str) -> list[dict]:
    """Thay chữ một câu; chia đều thời gian câu cho các chữ mới."""
    c = next((x for x in _lyric_clips(tl) if x["id"] == clip_id), None)
    toks = text.split()
    if not c or not toks:
        return []
    old = [w for ln in c["lines"] for w in ln.get("words", [])]
    a = old[0]["start"] if old else c["lines"][0]["start"]
    b = old[-1]["end"] if old else c["lines"][0]["end"]
    if len(toks) == len(old):  # cùng số chữ -> giữ nguyên thời gian từng chữ
        words = [dict(w, text=t) for w, t in zip(old, toks)]
    else:
        k = (b - a) / len(toks)
        words = [{"text": t, "start": round(a + i * k, 3), "end": round(a + (i + 1) * k, 3)} for i, t in enumerate(toks)]
    return [_line_update(c, words)]


def fix_lyrics_ops(job_id: str, tl: dict, ref_text: str = "") -> dict:
    """Research lời chuẩn (hoặc dùng lời người dùng đưa), đối chiếu với phụ đề hiện tại và sửa chữ sai."""
    from musicvideo import lyrics as lyr, lyrics_lookup
    clips = _lyric_clips(tl)
    if not clips:
        return {"reply": "Timeline chưa có phụ đề lời để sửa.", "ops": []}
    rec = [[dict(w) for ln in c["lines"] for w in ln.get("words", [])] for c in clips]
    heard = " ".join(w["text"] for line in rec for w in line)
    src = "lời bạn đưa"
    if not ref_text.strip():
        d = job_dir(job_id)
        f = d / "lyrics_input.txt"
        if f.exists():
            ref_text, src = f.read_text(encoding="utf-8"), "lời đã dán khi tạo video"
        else:
            meta = read_meta(d)
            ref = lyrics_lookup.find_reference(heard, meta.get("title", ""), meta.get("subtext", ""))
            if not ref:
                return {"reply": "Đã research nhưng không tìm được lời chuẩn khớp với bài này — "
                                 "hãy dán lời đúng vào ô AI (vd: \"sửa phụ đề theo lời: ...\").", "ops": []}
            ref_text, src = ref["text"], f'{ref["source"]} (khớp {ref["score"]:.0%})'
            (d / "lyrics_reference.txt").write_text(f"# {src}\n{ref_text}", encoding="utf-8")
    fixed, n = lyr.correct_with_reference(rec, ref_text, max_fix=12, rebreak=False)
    ops = [_line_update(c, ws) for c, ws, old in zip(clips, fixed, rec)
           if ws and [w["text"] for w in ws] != [w["text"] for w in old]]
    if not n or not ops:
        return {"reply": f"Đã đối chiếu với {src}: phụ đề đã khớp, không có chữ nào cần sửa.", "ops": []}
    return {"reply": f"Đã sửa {n} chữ theo {src}.", "ops": ops}


@app.post("/api/jobs/{job_id}/fix-lyrics")
def fix_lyrics(job_id: str, body: dict):
    tl = body.get("timeline")
    if not isinstance(tl, dict):
        raise HTTPException(400, "Thiếu timeline")
    return fix_lyrics_ops(job_id, tl, str(body.get("lyrics") or ""))


TRANSITIONS = ["none", "dissolve-zoom", "blur-dissolve", "soft-push", "light-leak", "fade", "fadeblack", "fadewhite",
               "flash", "slide-left", "slide-right", "slide-up", "slide-down", "wipe-left", "wipe-right", "wipe-up",
               "wipe-down", "circle", "zoom-in", "zoom-out", "blur", "spin", "whip-left", "whip-right", "zoom-blur",
               "glitch", "flip", "cube-left", "diamond", "split", "diag", "burn", "shake"]


def _filter_presets() -> list[str]:
    try:
        src = (REMOTION_DIR / "src" / "colorFilter.tsx").read_text(encoding="utf-8")
        return re.findall(r"^\s*([a-z0-9]+): \{name:", src, re.M)
    except OSError:
        return []


def _set_key(o: dict, key: str, v):
    *ps, last = key.split(".")
    for p in ps:
        if not isinstance(o.get(p), dict):
            o[p] = {}
        o = o[p]
    o[last] = v


def apply_ai_ops(tl: dict, ops: list) -> int:
    """Áp thao tác AI lên timeline ở server (giống applyAIOps của Editor) – dùng cho trang chủ."""
    n = 0
    clips = tl.setdefault("clips", [])
    tracks = tl.setdefault("tracks", [])
    by_id = {c.get("id"): c for c in clips}
    ok_tr = set(TRANSITIONS)

    def new_track(name: str | None) -> dict:
        t = {"id": "k" + _uid(), "kind": "mixed",
             "name": name or f"Track {sum(1 for x in tracks if x.get('kind') == 'mixed') + 1}"}
        tracks.insert(0, t)
        return t

    for o in ops:
        kind = o.get("op")
        targets = [by_id[i] for i in (o.get("ids") or ([o["id"]] if o.get("id") else [])) if i in by_id]
        if kind == "update" and isinstance(o.get("set"), dict):
            for c in targets:
                for k, v in o["set"].items():
                    if k != "id":
                        _set_key(c, k, v)
                if isinstance(c.get("transition"), dict) and c["transition"].get("type") not in ok_tr:
                    c["transition"]["type"] = "fade"
                n += 1
        elif kind == "delete":
            gone = {c["id"] for c in targets}
            clips[:] = [c for c in clips if c.get("id") not in gone]
            by_id = {c.get("id"): c for c in clips}
            n += len(gone)
        elif kind in ("add", "add_media") and isinstance(o.get("clip"), dict):
            if kind == "add_media":
                m = o.get("media") or {}
                if m.get("type") != "video" or not str(m.get("src", "")).startswith("clips/"):
                    continue
                media = tl.setdefault("media", [])
                if not any(x.get("src") == m["src"] for x in media):
                    media.append(m)
            c = dict(o["clip"])
            name = c.pop("trackName", None)
            t = next((x for x in tracks if x.get("id") == c.get("track")), None) \
                or (name and next((x for x in tracks if x.get("name") == name), None))
            if not t or (t.get("kind") == "main" and c.get("type") not in ("video", "image")):
                t = new_track(name)
            c = {"start": 0, "dur": 3, **c, "track": t["id"], "id": _uid()}
            clips.append(c)
            by_id[c["id"]] = c
            n += 1
        elif kind == "timeline" and isinstance(o.get("set"), dict):
            for k, v in o["set"].items():
                if k not in ("filter", "width", "height", "background"):
                    continue
                if k == "filter" and isinstance(v, dict):
                    v = {**(tl.get("filter") or {}), **v}
                    for f in ("brightness", "contrast", "saturation", "temperature", "tint", "vignette", "fade", "hue"):
                        x = v.get(f)
                        if isinstance(x, (int, float)) and x and abs(x) <= 1:
                            v[f] = round(x * 100)
                tl[k] = v
                n += 1
    return n


CHAT_KEEP = 200  # số tin nhắn giữ lại trong hội thoại AI mỗi dự án
AI_IMG_RE = re.compile(r"^[a-z0-9]{6,32}\.(jpg|png|webp)$")


def _ai_image_path(job_id: str, name: str) -> Path:
    if not AI_IMG_RE.match(name):
        raise HTTPException(400, "Tên ảnh không hợp lệ")
    return job_dir(job_id) / "ai_images" / name


@app.post("/api/jobs/{job_id}/ai-image")
async def upload_ai_image(job_id: str, file: UploadFile = File(...)):
    """Ảnh người dùng dán/kéo vào khung chat AI (chụp chỗ lỗi) -> lưu trong dự án để AI xem."""
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "Chỉ nhận ảnh JPG, PNG hoặc WEBP")
    data = await file.read()
    if len(data) > 15_000_000:
        raise HTTPException(400, "Ảnh quá lớn (tối đa 15 MB)")
    name = f"{secrets.token_hex(8)}.{ext}"
    p = _ai_image_path(job_id, name)
    p.parent.mkdir(exist_ok=True)
    p.write_bytes(data)
    return {"name": name}


@app.get("/api/jobs/{job_id}/ai-image/{name}")
def get_ai_image(job_id: str, name: str):
    p = _ai_image_path(job_id, name)
    if not p.exists():
        raise HTTPException(404, "Không có ảnh")
    return FileResponse(p)


def _chat_file(d: Path) -> Path:
    return d / "ai_chat.json"


def _chat_read(d: Path) -> list:
    try:
        return json.loads(_chat_file(d).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def _chat_add(d: Path, *msgs: dict):
    chat = _chat_read(d) + [{"who": m["who"], "text": str(m.get("text") or "")[:4000], "at": time.time(),
                             **({"images": [n for n in m["images"][:6] if AI_IMG_RE.match(str(n))]}
                                if isinstance(m.get("images"), list) and m["images"] else {})}
                            for m in msgs if m.get("who") in ("me", "ai", "ai err") and (m.get("text") or m.get("images"))]
    _chat_file(d).write_text(json.dumps(chat[-CHAT_KEEP:], ensure_ascii=False), encoding="utf-8")


@app.get("/api/jobs/{job_id}/ai-chat")
def get_ai_chat(job_id: str):
    return _chat_read(job_dir(job_id))


@app.post("/api/jobs/{job_id}/ai-chat")
def add_ai_chat(job_id: str, body: dict):
    _chat_add(job_dir(job_id), *[m for m in body.get("messages", []) if isinstance(m, dict)])
    return {"ok": True}


@app.delete("/api/jobs/{job_id}/ai-chat")
def clear_ai_chat(job_id: str):
    _chat_file(job_dir(job_id)).unlink(missing_ok=True)
    shutil.rmtree(job_dir(job_id) / "ai_images", ignore_errors=True)
    return {"ok": True}


def _ai_undo_file(d: Path) -> Path:
    return d / "timeline.ai-undo.json"


@app.post("/api/jobs/{job_id}/ai-apply")
def ai_apply(job_id: str, body: dict):
    """Trang chủ: sửa timeline đã lưu bằng câu lệnh (hoặc tra & sửa lời), lưu lại và giữ 1 bản để khôi phục."""
    d = job_dir(job_id)
    if status_of(job_id, d) == "running":
        raise HTTPException(409, "Dự án đang chạy")
    tl = get_timeline(job_id)
    before = json.dumps(tl, ensure_ascii=False)
    text = str(body.get("prompt") or "").strip()
    me = {"who": "me", "text": ("🔎 Tra & sửa lời phụ đề" + (" theo lời đã dán" if text else "")) if body.get("fixLyrics") else text}
    try:
        if body.get("fixLyrics"):
            r = fix_lyrics_ops(job_id, tl, text)
        else:
            r = ai_edit(job_id, {"prompt": text, "timeline": tl, "presets": _filter_presets(), "transitions": TRANSITIONS})
    except HTTPException as e:
        _chat_add(d, me, {"who": "ai err", "text": "⚠ " + str(e.detail)})
        raise
    n = apply_ai_ops(tl, r.get("ops") or [])
    if n:
        _ai_undo_file(d).write_text(before, encoding="utf-8")
        put_timeline(job_id, tl)
    reply = (r.get("reply") or "Xong.") + (f" ({n} thay đổi)" if n else "")
    _chat_add(d, me, {"who": "ai", "text": "✓ " + reply})
    return {"reply": reply, "changes": n, "canUndo": _ai_undo_file(d).exists(), "chat": _chat_read(d)}


@app.post("/api/jobs/{job_id}/ai-undo")
def ai_undo(job_id: str):
    d = job_dir(job_id)
    f = _ai_undo_file(d)
    if not f.exists():
        raise HTTPException(404, "Không còn bản nào để khôi phục")
    put_timeline(job_id, json.loads(f.read_text(encoding="utf-8")))
    f.unlink()
    _chat_add(d, {"who": "ai", "text": "↺ Đã khôi phục về trước lần sửa bằng AI gần nhất."})
    return {"ok": True, "chat": _chat_read(d)}


@app.post("/api/jobs/{job_id}/export-saved")
def export_saved(job_id: str):
    """Trang chủ: xuất MP4 từ timeline đã lưu (chỉnh sửa trong Editor hoặc bằng AI)."""
    return export_timeline(job_id, {"timeline": get_timeline(job_id), "options": {"format": "mp4"}})


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


EXPORTS = EXPORTS_DIR
CRF = {"low": 28, "medium": 23, "high": 20, "best": 17}
X264 = {"fast": "superfast", "balanced": "veryfast", "small": "medium"}


def _render_public(d: Path, tl: dict) -> Path:
    """Thư mục public tối giản chỉ chứa file dự án này dùng (hardlink, không tốn dung lượng).
    Remotion chép nguyên thư mục public (hàng trăm MB của mọi dự án) mỗi lần render -> rất chậm."""
    pub = d / "render-public"
    shutil.rmtree(pub, ignore_errors=True)
    srcs = {m.get("src") for m in tl.get("media", [])} | {c.get("src") for c in tl.get("clips", [])}
    root = PUBLIC_DIR.resolve()
    for src in filter(None, srcs):
        f = (PUBLIC_DIR / src).resolve()
        if not isinstance(src, str) or root not in f.parents or not f.is_file():
            continue
        dst = pub / src
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(f, dst)
        except OSError:  # khác ổ đĩa / không hỗ trợ hardlink
            shutil.copy2(f, dst)
    pub.mkdir(exist_ok=True)
    return pub


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
    restore_clips(_tl_srcs(tl))

    fmt = o.get("format", "mp4") if o.get("format") in {"mp4", "hevc", "webm", "mp3"} else "mp4"
    codec, ext = {"mp4": ("h264", ".mp4"), "hevc": ("h265", ".mp4"), "webm": ("vp8", ".webm"), "mp3": ("mp3", ".mp3")}[fmt]
    render_tl = dict(tl)
    if int(o.get("fps") or 0) in {24, 25, 30, 50, 60}:
        render_tl["fps"] = int(o["fps"])
    h = int(o.get("height") or 0)
    if codec != "mp3" and h and h != min(tl["width"], tl["height"]):
        # render thẳng ở cỡ đích (cạnh chẵn) -> không phải mã hoá lần 2 bằng ffmpeg
        k = h / min(tl["width"], tl["height"])
        render_tl["outWidth"] = max(2, round(tl["width"] * k / 2) * 2)
        render_tl["outHeight"] = max(2, round(tl["height"] * k / 2) * 2)
    (d / "timeline.render.json").write_text(json.dumps(render_tl, ensure_ascii=False), encoding="utf-8")

    flags = [f"--codec={codec}", "--timeout=120000"]
    if codec != "mp3":
        flags.append(f"--crf={CRF.get(o.get('quality'), 20) + (6 if codec == 'vp8' else 0)}")
        if codec == "h264":
            flags.append(f"--x264-preset={X264.get(o.get('speed'), 'veryfast')}")
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
    cmd = f'npx remotion render src/index.ts Timeline "{tmp}" --props="{d / "timeline.render.json"}" --public-dir="{_render_public(d, tl)}" {" ".join(flags)}'
    cmd += f' && move /Y "{tmp}" "{out}" && rmdir /S /Q "{d / "render-public"}"'

    if codec == "h264":  # bản H.264 cũng làm video chính của dự án (trang chủ xem/tải được)
        cmd += f' && copy /Y "{out}" "{d / "video.mp4"}"'
    procs[job_id] = subprocess.Popen(cmd, cwd=REMOTION_DIR, shell=True, stdout=log, stderr=subprocess.STDOUT,
                                     creationflags=NO_WINDOW)
    meta = read_meta(d)
    meta.update(status="running", lastExport=out.name)
    write_meta(d, meta)
    return {"ok": True, "file": out.name}


CLEANUP_GLOBS = ("audio16k.wav", "timeline.render.json", "export.rendering.*", "export.scaled.*", "*.before-*.json")
LOG_KEEP = 200_000  # byte giữ lại ở cuối mỗi file log


@app.post("/api/jobs/{job_id}/cleanup")
def cleanup_job(job_id: str):
    """Xoá file tạm không còn dùng sau khi xuất (giữ video, timeline, lời) và cắt bớt log dài."""
    d = job_dir(job_id)
    if status_of(job_id, d) == "running":
        return {"freed": 0}
    freed = 0
    shutil.rmtree(d / "render-public", ignore_errors=True)
    for pat in CLEANUP_GLOBS:
        for f in d.glob(pat):
            if f.is_file():
                freed += f.stat().st_size
                f.unlink(missing_ok=True)
    for f in [*d.glob("*.log"), d / "log.txt"]:
        if f.is_file() and f.stat().st_size > LOG_KEEP:
            data = f.read_bytes()
            freed += len(data) - LOG_KEEP
            f.write_bytes(data[-LOG_KEEP:])
    return {"freed": freed}


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


# ---------- TikTok: kết nối & gửi video vào hộp nháp ----------
from server import tiktok  # noqa: E402
import threading  # noqa: E402

app.include_router(tiktok.router)
DEFAULT_TAGS = "#NhacHayMoiNgay #xh #music #chillout #bentarmusic"


@app.post("/api/tiktok/settings")
def tiktok_settings(body: dict):
    """Lưu Client Secret / Client Key (production) / hashtag mặc định vào .env."""
    for k, env in (("clientSecret", "TIKTOK_CLIENT_SECRET"), ("clientKey", "TIKTOK_CLIENT_KEY"), ("hashtags", "TIKTOK_HASHTAGS")):
        if k in body:
            v = str(body[k]).strip()[:300]
            _set_env(env, v or None)
    return {**tiktok.status(), "hashtags": os.environ.get("TIKTOK_HASHTAGS", DEFAULT_TAGS)}


@app.get("/api/tiktok/settings")
def tiktok_get_settings():
    load_env()
    return {**tiktok.status(), "hashtags": os.environ.get("TIKTOK_HASHTAGS", DEFAULT_TAGS)}


def _caption(meta: dict) -> str:
    title = re.sub(r"\.(wav|mp3|m4a|flac|ogg|aac)$", "", meta.get("title") or "", flags=re.I).strip()
    return f"{title} {os.environ.get('TIKTOK_HASHTAGS', DEFAULT_TAGS)}".strip()


CAPTION_PROMPT = """Bạn viết caption TikTok tiếng Việt cho một video nhạc.
Tên bài: {title}
Lời bài hát (tham khảo):
<<<
{lyrics}
>>>

Yêu cầu:
- Viết 1–2 câu ngắn (tổng dưới 150 ký tự), cảm xúc, tự nhiên như người thật đăng TikTok.
- Lấy ý từ tên bài và tinh thần lời bài hát, KHÔNG chép nguyên câu nào trong lời.
- Có thể dùng 1 emoji hợp cảm xúc. Không bao caption trong dấu ngoặc kép.
- Chọn thêm 3–5 hashtag hợp tâm trạng bài (tiếng Việt không dấu hoặc tiếng Anh, vd: #nhactamtrang #hoainiem #chill).
{variant}
Chỉ trả về JSON một dòng: {{"caption": "...", "hashtags": ["#a", "#b"]}}"""


def _lyrics_text(d: Path) -> str:
    """Lời bài: lời người dùng dán / lời research được / phụ đề trong timeline / props."""
    for name in ("lyrics_input.txt", "lyrics_reference.txt"):
        f = d / name
        if f.exists():
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
            text = "\n".join(l for l in lines if not l.startswith("#")).strip()
            if text:
                return text
    for name in ("timeline.json", "props.json"):
        try:
            data = json.loads((d / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if name == "timeline.json":
            lines = [ln for c in data.get("clips", []) if c.get("type") == "lyrics" for ln in c.get("lines", [])]
        else:
            lines = data.get("lines") or []
        text = "\n".join(" ".join(w.get("text", "") for w in ln.get("words", [])) for ln in lines).strip()
        if text:
            return text
    return ""


def _merge_tags(*groups) -> str:
    seen, out = set(), []
    for g in groups:
        for t in (g.split() if isinstance(g, str) else g):
            t = "#" + re.sub(r"[^\w]", "", str(t).lstrip("#"))
            if len(t) > 1 and t.lower() not in seen:
                seen.add(t.lower())
                out.append(t)
    return " ".join(out)


@app.post("/api/jobs/{job_id}/tiktok/caption")
def ai_caption(job_id: str, body: dict | None = None):
    """AI viết 1–2 câu caption + hashtag từ tên bài và lời; luôn nối thêm hashtag cố định trong Cài đặt."""
    from musicvideo import llm
    d = job_dir(job_id)
    meta = read_meta(d)
    if not llm.available():
        raise HTTPException(400, "Chưa kết nối Claude CLI hay Codex CLI (Cài đặt → Kết nối) nên AI chưa viết được caption.")
    title = re.sub(r"\.(wav|mp3|m4a|flac|ogg|aac)$", "", meta.get("title") or "", flags=re.I).strip()
    title = re.sub(r"\s*\(\d+s\)$", "", title)
    variant = "Viết một phiên bản KHÁC hẳn (góc nhìn, cảm xúc khác)." if (body or {}).get("again") else ""
    prompt = CAPTION_PROMPT.format(title=title or "(không rõ)", lyrics=_lyrics_text(d)[:1500] or "(không có lời)",
                                   variant=variant)
    try:
        out = llm.ask(prompt, effort="low", timeout=180)
    except Exception as e:
        raise HTTPException(500, f"AI lỗi: {e}")
    m = re.search(r"\{.*\}", out, re.S)
    try:
        data = json.loads(m.group(0)) if m else {}
    except ValueError:
        data = {}
    cap = str(data.get("caption") or "").strip().strip('"').strip()
    if not cap:
        raise HTTPException(500, "AI trả lời không đúng định dạng — bấm Viết lại.")
    tags = _merge_tags(data.get("hashtags") or [], os.environ.get("TIKTOK_HASHTAGS", DEFAULT_TAGS))
    return {"caption": f"{cap}\n\n{tags}"}


@app.get("/api/jobs/{job_id}/tiktok")
def job_tiktok(job_id: str):
    meta = read_meta(job_dir(job_id))
    return {**(meta.get("tiktok") or {}), "caption": meta.get("caption") or _caption(meta), "saved": bool(meta.get("caption"))}


@app.post("/api/jobs/{job_id}/tiktok")
def send_tiktok(job_id: str, body: dict | None = None):
    d = job_dir(job_id)
    video = d / "video.mp4"
    if status_of(job_id, d) == "running":
        raise HTTPException(409, "Video đang render — đợi xong rồi gửi.")
    if not video.exists():
        raise HTTPException(400, "Dự án chưa có video — hãy xuất video trước.")
    cur = read_meta(d).get("tiktok") or {}
    if cur.get("state") in {"exporting", "starting", "uploading", "processing"} and time.time() - cur.get("at", 0) < 900:
        raise HTTPException(409, "Video này đang được gửi lên TikTok.")
    tiktok.access_token()  # báo lỗi ngay nếu chưa kết nối
    caption = str((body or {}).get("caption", "")).strip()[:2200]

    def set_state(s: dict):
        m = read_meta(d)
        m["tiktok"] = {**s, "at": time.time()}
        if caption:
            m["caption"] = caption
        write_meta(d, m)

    def run():
        try:
            if _has_unexported_edits(d):
                set_state({"state": "exporting"})
                tl = json.loads((d / "timeline.json").read_text(encoding="utf-8"))
                export_timeline(job_id, {"timeline": tl, "options": {"format": "mp4"}})
                if procs[job_id].wait() != 0:
                    raise RuntimeError("Xuất lại video thất bại. Mở dự án để xem log và thử xuất lại.")
                status_of(job_id, d)
                cleanup_job(job_id)
            set_state({"state": "starting"})
            tiktok.upload(video, set_state)
        except Exception as e:  # noqa: BLE001
            msg = e.detail if isinstance(e, HTTPException) else str(e)
            set_state({"state": "error", "error": msg})

    set_state({"state": "starting"})
    threading.Thread(target=run, daemon=True).start()
    return {"ok": True}
