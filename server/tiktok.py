"""Kết nối TikTok (Login Kit Desktop + PKCE) và gửi video vào hộp nháp (Content Posting API – Upload).

Token chỉ lưu trên máy (tiktok_token.json). Client Secret nằm trong .env, không bao giờ trả về trình duyệt.
"""
import hashlib
import json
import math
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / "tiktok_token.json"
DEFAULT_CLIENT_KEY = "sbaw4t0b403jsobyna"  # sandbox "test"; đổi sang key production qua .env khi app được duyệt
SCOPES = "user.info.basic,video.upload"
API = "https://open.tiktokapis.com/v2"

router = APIRouter()
_pending: dict[str, tuple[str, str, float]] = {}  # state -> (code_verifier, redirect_uri, lúc tạo)
_lock = threading.Lock()


def client_key() -> str:
    return os.environ.get("TIKTOK_CLIENT_KEY", "").strip() or DEFAULT_CLIENT_KEY


def client_secret() -> str:
    return os.environ.get("TIKTOK_CLIENT_SECRET", "").strip()


# ---------- token ----------
def _load() -> dict:
    try:
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(tok: dict) -> None:
    TOKEN_FILE.write_text(json.dumps(tok, ensure_ascii=False, indent=1), encoding="utf-8")


def _store(data: dict, old: dict | None = None) -> dict:
    now = time.time()
    tok = {**(old or {}), "access_token": data["access_token"], "refresh_token": data["refresh_token"],
           "open_id": data.get("open_id", (old or {}).get("open_id")), "scope": data.get("scope", ""),
           "expires_at": now + int(data.get("expires_in", 7200)) - 120,
           "refresh_expires_at": now + int(data.get("refresh_expires_in", 15552000))}
    _save(tok)
    return tok


def _oauth(fields: dict) -> dict:
    r = requests.post(f"{API}/oauth/token/", data={"client_key": client_key(), "client_secret": client_secret(), **fields},
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)
    data = r.json() if r.content else {}
    if "access_token" not in data:
        raise RuntimeError(data.get("error_description") or data.get("error") or f"HTTP {r.status_code}")
    return data


def access_token() -> str:
    """Token còn hạn; tự làm mới (refresh token xoay vòng: luôn lưu cái mới)."""
    with _lock:
        tok = _load()
        if not tok:
            raise HTTPException(401, "Chưa kết nối TikTok — vào Cài đặt → Kết nối TikTok.")
        if time.time() < tok.get("expires_at", 0):
            return tok["access_token"]
        if time.time() > tok.get("refresh_expires_at", 0):
            TOKEN_FILE.unlink(missing_ok=True)
            raise HTTPException(401, "Phiên TikTok đã hết hạn — hãy kết nối lại.")
        try:
            return _store(_oauth({"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]}), tok)["access_token"]
        except RuntimeError as e:
            raise HTTPException(401, f"Không làm mới được phiên TikTok ({e}) — hãy kết nối lại.")


def _api(method: str, path: str, **kw) -> dict:
    r = requests.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {access_token()}",
                                                         "Content-Type": "application/json; charset=UTF-8"},
                         timeout=60, **kw)
    data = r.json() if r.content else {}
    err = data.get("error") or {}
    if r.status_code >= 400 or (err.get("code") and err["code"] != "ok"):
        raise RuntimeError(_friendly(err.get("code")) or err.get("message") or f"HTTP {r.status_code}")
    return data.get("data") or {}


def _friendly(code: str | None) -> str:
    return {
        "spam_risk_too_many_pending_share": "Đã có 5 video đang chờ trong hộp thư TikTok (24 giờ qua). Hãy đăng hoặc xoá bớt trong app TikTok rồi thử lại.",
        "spam_risk_user_banned_from_posting": "Tài khoản TikTok này đang bị chặn đăng bài.",
        "scope_not_authorized": "Tài khoản chưa cấp quyền video.upload — hãy kết nối lại TikTok.",
        "access_token_invalid": "Phiên TikTok không hợp lệ — hãy kết nối lại.",
        "rate_limit_exceeded": "Gửi quá nhanh — đợi 1 phút rồi thử lại.",
    }.get(code or "", "")


# ---------- trạng thái & cài đặt ----------
def status() -> dict:
    tok = _load()
    out = {"connected": bool(tok), "clientKey": client_key(), "hasSecret": bool(client_secret()),
           "sandbox": client_key() == DEFAULT_CLIENT_KEY}
    if tok:
        out.update(name=tok.get("display_name", ""), avatar=tok.get("avatar_url", ""))
    return out


def _fetch_profile() -> None:
    try:
        u = _api("GET", "/user/info/?fields=open_id,display_name,avatar_url").get("user", {})
        tok = _load()
        tok.update(display_name=u.get("display_name", ""), avatar_url=u.get("avatar_url", ""))
        _save(tok)
    except Exception:
        pass  # chỉ để hiển thị, không bắt buộc


@router.get("/api/tiktok")
def get_status():
    return status()


@router.get("/api/tiktok/auth-url")
def auth_url(request: Request):
    if not client_secret():
        raise HTTPException(400, "Dán Client Secret của app TikTok trước.")
    port = request.url.port or 80
    redirect = f"http://127.0.0.1:{port}/tiktok/callback/"
    verifier = secrets.token_urlsafe(64)[:96]
    state = secrets.token_urlsafe(16)
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v[2] > 900]:
        _pending.pop(k, None)
    _pending[state] = (verifier, redirect, now)
    q = {"client_key": client_key(), "response_type": "code", "scope": SCOPES, "redirect_uri": redirect,
         "state": state, "code_challenge": hashlib.sha256(verifier.encode()).hexdigest(), "code_challenge_method": "S256"}
    return {"url": "https://www.tiktok.com/v2/auth/authorize/?" + urlencode(q)}


def _page(title: str, msg: str, ok: bool) -> HTMLResponse:
    color = "#3ecf8e" if ok else "#ff6b6b"
    return HTMLResponse(f"""<!doctype html><meta charset="utf-8"><title>{title}</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0e0e10;color:#e6e6e9;font:16px system-ui">
<div style="text-align:center;max-width:460px;padding:16px"><h2 style="color:{color}">{title}</h2><p>{msg}</p>
<p style="color:#9a9aa3">Có thể đóng tab này và quay lại công cụ.</p></div>
<script>try{{window.opener&&window.opener.postMessage('tiktok-connected','*')}}catch(e){{}}{'setTimeout(()=>window.close(),1500)' if ok else ''}</script></body>""")


@router.get("/tiktok/callback/")
def callback(state: str = "", code: str = "", error: str = "", error_description: str = ""):
    pend = _pending.pop(state, None)
    if error:
        return _page("Chưa kết nối", error_description or error, False)
    if not pend or not code:
        return _page("Chưa kết nối", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy bấm Kết nối TikTok lại.", False)
    verifier, redirect, _ = pend
    try:
        data = _oauth({"code": code, "grant_type": "authorization_code", "redirect_uri": redirect, "code_verifier": verifier})
    except RuntimeError as e:
        return _page("Kết nối lỗi", str(e), False)
    _store(data)
    _fetch_profile()
    return _page("Đã kết nối TikTok ✓", "Công cụ giờ có thể gửi video vào hộp nháp TikTok của bạn.", True)


@router.post("/api/tiktok/disconnect")
def disconnect():
    tok = _load()
    if tok:
        try:
            requests.post(f"{API}/oauth/revoke/", data={"client_key": client_key(), "client_secret": client_secret(),
                                                        "token": tok.get("access_token", "")}, timeout=15)
        except requests.RequestException:
            pass
    TOKEN_FILE.unlink(missing_ok=True)
    return status()


# ---------- gửi video vào hộp nháp ----------
CHUNK = 20 * 1024 * 1024


def chunk_plan(size: int) -> tuple[int, int]:
    """(chunk_size, total_chunk_count) theo quy tắc TikTok: ≤64 MB gửi 1 lần; lớn hơn chia khúc 20 MB,
    khúc cuối gộp phần dư (luôn < 40 MB, dưới giới hạn 128 MB)."""
    if size <= 64 * 1024 * 1024:
        return size, 1
    return CHUNK, math.floor(size / CHUNK)


def upload(video: Path, on_state) -> str:
    """Gửi file lên TikTok; on_state(dict) được gọi mỗi khi trạng thái đổi. Trả về publish_id."""
    size = video.stat().st_size
    csize, count = chunk_plan(size)
    init = _api("POST", "/post/publish/inbox/video/init/", json={"source_info": {
        "source": "FILE_UPLOAD", "video_size": size, "chunk_size": csize, "total_chunk_count": count}})
    pid, url = init["publish_id"], init["upload_url"]
    on_state({"state": "uploading", "publishId": pid, "progress": 0})
    with open(video, "rb") as f:
        for i in range(count):
            start = i * csize
            end = size - 1 if i == count - 1 else start + csize - 1
            f.seek(start)
            body = f.read(end - start + 1)
            r = requests.put(url, data=body, timeout=600, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(body)),
                "Content-Range": f"bytes {start}-{end}/{size}"})
            if r.status_code not in (200, 201, 206):
                raise RuntimeError(f"Tải khúc {i + 1}/{count} lỗi (HTTP {r.status_code})")
            on_state({"state": "uploading", "publishId": pid, "progress": round((i + 1) / count * 100)})
    on_state({"state": "processing", "publishId": pid})
    for _ in range(60):  # chờ TikTok xử lý tối đa ~5 phút
        time.sleep(5)
        st = _api("POST", "/post/publish/status/fetch/", json={"publish_id": pid})
        s = st.get("status")
        if s == "SEND_TO_USER_INBOX":
            on_state({"state": "inbox", "publishId": pid})
            return pid
        if s == "PUBLISH_COMPLETE":
            on_state({"state": "posted", "publishId": pid})
            return pid
        if s == "FAILED":
            raise RuntimeError(f"TikTok từ chối video: {st.get('fail_reason', 'không rõ lý do')}")
    on_state({"state": "processing", "publishId": pid, "note": "TikTok vẫn đang xử lý — kiểm tra hộp thư TikTok sau ít phút."})
    return pid
