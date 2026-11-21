"""Gọi AI qua CLI đang đăng nhập (không cần API key).

Thứ tự: Claude CLI (`claude -p`) -> ChatGPT Codex CLI (`codex exec`) làm dự phòng.
Mỗi bên bật/tắt riêng qua CLAUDE_DISABLED=1 / CODEX_DISABLED=1 (nút Kết nối trong giao diện).
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
CODEX_EFFORTS = {"low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "xhigh"}


def claude_path() -> str | None:
    return shutil.which("claude") if os.environ.get("CLAUDE_DISABLED") != "1" else None


def codex_path() -> str | None:
    return shutil.which("codex") if os.environ.get("CODEX_DISABLED") != "1" else None


def available() -> bool:
    return bool(claude_path() or codex_path())


def _claude(exe: str, prompt: str, model: str, effort: str, web: bool, timeout: int) -> str:
    # Bỏ ANTHROPIC_API_KEY để CLI dùng gói đang đăng nhập, không tính phí API.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    tools = "WebSearch,WebFetch" if web else ""
    base = [exe, "-p", "--model", model, "--output-format", "text", "--tools", tools, "--no-session-persistence"]
    if web:
        base += ["--allowedTools", tools]
    attempts = [base + ["--effort", effort], base] if effort else [base]
    err = ""
    for cmd in attempts:  # model không hỗ trợ effort đã chọn -> thử lại với effort mặc định
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                           timeout=timeout, env=env, creationflags=_NO_WINDOW)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
        err = (r.stderr or r.stdout).strip()[:300]
    raise RuntimeError(err or "Claude CLI không trả lời")


def _codex(exe: str, prompt: str, effort: str, web: bool, timeout: int) -> str:
    # --ignore-user-config: tránh model/MCP trong ~/.codex/config.toml không hợp với gói ChatGPT;
    # đăng nhập vẫn dùng chung. Sandbox read-only, không lưu phiên.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "answer.txt"
        cmd = [exe] + (["--search"] if web else []) + [
            "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
            "--sandbox", "read-only", "-C", tmp, "-o", str(out)]
        if os.environ.get("MV_CODEX_MODEL"):
            cmd += ["-m", os.environ["MV_CODEX_MODEL"]]
        if effort in CODEX_EFFORTS:
            cmd += ["-c", f"model_reasoning_effort={CODEX_EFFORTS[effort]}"]
        r = subprocess.run(cmd + ["-"], input=prompt, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, creationflags=_NO_WINDOW)
        text = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
        if r.returncode == 0 and text.strip():
            return text
        lines = [l for l in (r.stderr or "").splitlines() if "ERROR" in l] or (r.stderr or "").splitlines()[-2:]
        raise RuntimeError(" | ".join(lines)[-300:] or "Codex CLI không trả lời")


def ask(prompt: str, model: str = "", effort: str = "", web: bool = False, timeout: int = 600) -> str:
    """Trả về câu trả lời văn bản. Lỗi ở Claude -> thử Codex. Hết cách -> RuntimeError."""
    errors = []
    if exe := claude_path():
        m = model or os.environ.get("MV_CLAUDE_MODEL") or "claude-haiku-5-5"
        print(f"  Claude CLI: model={m}, effort={effort or 'mặc định'}{', web' if web else ''}")
        try:
            return _claude(exe, prompt, m, effort, web, timeout)
        except Exception as e:
            errors.append(f"Claude: {e}")
            print(f"  (Claude CLI lỗi: {e})")
    if exe := codex_path():
        print(f"  Codex CLI (ChatGPT): effort={effort or 'mặc định'}{', web' if web else ''}")
        try:
            return _codex(exe, prompt, effort, web, timeout)
        except Exception as e:
            errors.append(f"Codex: {e}")
            print(f"  (Codex CLI lỗi: {e})")
    raise RuntimeError("; ".join(errors) or "không có Claude CLI hay Codex CLI")
