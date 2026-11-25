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


def _with_images(prompt: str, images: list[str]) -> str:
    if not images:
        return prompt
    return (prompt + "\n\nNgười dùng gửi kèm ảnh chụp màn hình (thường là chỗ bị lỗi trên video). "
            "Hãy dùng công cụ Read để xem TỪNG ảnh trước khi trả lời:\n" + "\n".join(images))


def _claude(exe: str, prompt: str, model: str, effort: str, web: bool, timeout: int,
            images: list[str] = ()) -> str:
    # Bỏ ANTHROPIC_API_KEY để CLI dùng gói đang đăng nhập, không tính phí API.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    tools = ",".join((["WebSearch", "WebFetch"] if web else []) + (["Read"] if images else []))
    base = [exe, "-p", "--model", model, "--output-format", "text", "--tools", tools, "--no-session-persistence"]
    if tools:
        base += ["--allowedTools", tools]
    for d in {str(Path(i).parent) for i in images}:
        base += ["--add-dir", d]
    prompt = _with_images(prompt, list(images))
    attempts = [base + ["--effort", effort], base] if effort else [base]
    err = ""
    for cmd in attempts:  # model không hỗ trợ effort đã chọn -> thử lại với effort mặc định
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                           timeout=timeout, env=env, creationflags=_NO_WINDOW)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
        err = (r.stderr or r.stdout).strip()[:300]
    raise RuntimeError(err or "Claude CLI không trả lời")


def _codex(exe: str, prompt: str, effort: str, web: bool, timeout: int, images: list[str] = ()) -> str:
    # --ignore-user-config: tránh model/MCP trong ~/.codex/config.toml không hợp với gói ChatGPT;
    # đăng nhập vẫn dùng chung. Sandbox read-only, không lưu phiên.
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "answer.txt"
        cmd = [exe] + (["--search"] if web else []) + [
            "exec", *([f"--image={','.join(images)}"] if images else []), "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
            "--sandbox", "read-only", "-C", tmp, "-o", str(out)]
        if os.environ.get("MV_CODEX_MODEL"):
            cmd += ["-m", os.environ["MV_CODEX_MODEL"]]
        if effort in CODEX_EFFORTS:
            cmd += ["-c", f"model_reasoning_effort={CODEX_EFFORTS[effort]}"]
        if images:
            prompt += "\n\nNgười dùng gửi kèm ảnh chụp màn hình (thường là chỗ bị lỗi trên video) — xem kỹ ảnh đính kèm."
        r = subprocess.run(cmd + ["-"], input=prompt, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, creationflags=_NO_WINDOW)
        text = out.read_text(encoding="utf-8", errors="replace") if out.exists() else ""
        if r.returncode == 0 and text.strip():
            return text
        lines = [l for l in (r.stderr or "").splitlines() if "ERROR" in l] or (r.stderr or "").splitlines()[-2:]
        raise RuntimeError(" | ".join(lines)[-300:] or "Codex CLI không trả lời")


def ask(prompt: str, model: str = "", effort: str = "", web: bool = False, timeout: int = 600,
        images: list[str] | None = None) -> str:
    """Trả về câu trả lời văn bản. MV_AI=claude|codex -> chỉ dùng CLI đó; không đặt -> Claude trước, Codex dự phòng."""
    errors = []

    def try_claude():
        if exe := claude_path():
            m = model or os.environ.get("MV_CLAUDE_MODEL") or "claude-haiku-5-5"
            if images and "haiku" in m:
                m = "claude-sonnet-5-5"  # có ảnh: Sonnet hiểu ảnh tốt hơn hẳn Haiku
            print(f"  Claude CLI: model={m}, effort={effort or 'mặc định'}{', web' if web else ''}")
            try:
                return _claude(exe, prompt, m, effort, web, timeout, images or [])
            except Exception as e:
                errors.append(f"Claude: {e}")
                print(f"  (Claude CLI lỗi: {e})")

    def try_codex():
        if exe := codex_path():
            print(f"  Codex CLI (ChatGPT): model={os.environ.get('MV_CODEX_MODEL') or 'mặc định'}, "
                  f"effort={effort or 'mặc định'}{', web' if web else ''}")
            try:
                return _codex(exe, prompt, effort, web, timeout, images or [])
            except Exception as e:
                errors.append(f"Codex: {e}")
                print(f"  (Codex CLI lỗi: {e})")

    only = os.environ.get("MV_AI")  # người dùng chọn hẳn một model -> chỉ dùng CLI đó, không dự phòng
    order = {"claude": (try_claude,), "codex": (try_codex,)}.get(only, (try_claude, try_codex))
    for f in order:
        if (out := f()) is not None:
            return out
    raise RuntimeError("; ".join(errors) or "không có Claude CLI hay Codex CLI")
