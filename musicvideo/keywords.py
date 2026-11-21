"""Sinh từ khóa tìm video (tiếng Anh) cho từng cảnh.

Dùng Claude CLI (`claude -p`, chạy bằng gói Claude đang đăng nhập — không cần API key) để đọc
lời bài hát và chọn hình ảnh phù hợp nội dung/cảm xúc.
Không có CLI hoặc lỗi: xoay vòng theo --theme hoặc bộ từ khóa mặc định.
"""
import json
import os
import re
import shutil
import subprocess

DEFAULT_THEMES = ["sunset sky", "city night lights", "ocean waves", "forest sunlight", "rain window",
                  "clouds timelapse", "road trip", "mountain landscape", "flowers field", "starry sky"]


def _fallback(scenes: list[dict], theme: str | None) -> list[str]:
    pool = [t.strip() for t in theme.split(",")] if theme else DEFAULT_THEMES
    return [pool[i % len(pool)] for i in range(len(scenes))]


MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2"]
EFFORTS = ["low", "medium", "high", "xhigh", "max"]


def _ask_claude(claude: str, prompt: str, model: str, effort: str) -> str:
    """Gọi `claude -p`: prompt qua stdin, tắt mọi tool, không lưu session -> chỉ trả lời văn bản.
    Bỏ ANTHROPIC_API_KEY khỏi môi trường để CLI dùng gói đang đăng nhập, không tính phí API."""
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    base = [claude, "-p", "--model", model, "--output-format", "text", "--tools", "", "--no-session-persistence"]
    attempts = [base + ["--effort", effort], base] if effort else [base]
    err = ""
    for cmd in attempts:  # model không hỗ trợ effort đã chọn -> thử lại với effort mặc định
        r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                           timeout=600, env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout
        err = (r.stderr or r.stdout).strip()[:300]
        if len(attempts) > 1 and cmd is attempts[0]:
            print(f"  (effort '{effort}' lỗi: {err} -> thử lại với effort mặc định)")
    raise RuntimeError(err)


def generate(scenes: list[dict], title: str = "", theme: str | None = None,
             model: str = "", effort: str = "") -> list[str]:
    claude = shutil.which("claude") if os.environ.get("CLAUDE_DISABLED") != "1" else None
    if not claude:
        print("  (không tìm thấy Claude CLI -> dùng từ khóa theo chủ đề)")
        return _fallback(scenes, theme)

    listing = "\n".join(
        f'{i}. [{s["start"]:.1f}-{s["end"]:.1f}s, energy {s["energy"]}] {s["lyrics"] or "(instrumental)"}'
        for i, s in enumerate(scenes)
    )
    prompt = f"""You are a music video editor choosing royalty-free stock footage from Pixabay.
Song title: {title or "unknown"}
{f"Desired visual theme: {theme}" if theme else ""}
Scenes (lyrics may be in any language):
{listing}

For EACH scene write a short English Pixabay video search query (2-3 words) for concrete,
filmable visuals matching the lyrics' meaning and mood. Keep a consistent visual style across
the video, vary shots between neighbouring scenes, prefer cinematic scenery/people silhouettes,
avoid text, logos and abstract words. Instrumental scenes: match the song's mood.
Reply with ONLY a JSON array of strings, exactly {len(scenes)} items, in order."""

    model = model or os.environ.get("MV_CLAUDE_MODEL") or "claude-haiku-5-5"
    effort = effort or os.environ.get("MV_CLAUDE_EFFORT") or ""
    print(f"  Claude CLI: model={model}, effort={effort or 'mặc định'}")
    try:
        text = _ask_claude(claude, prompt, model, effort)
        queries = json.loads(re.search(r"\[.*\]", text, re.S).group(0))
        queries = [str(q).strip() for q in queries]
        if len(queries) < len(scenes):
            queries += _fallback(scenes[len(queries):], theme)
        return queries[: len(scenes)]
    except Exception as e:  # mạng lỗi / JSON lỗi -> vẫn chạy tiếp
        print(f"  (Claude CLI lỗi: {e} -> dùng từ khóa theo chủ đề)")
        return _fallback(scenes, theme)
