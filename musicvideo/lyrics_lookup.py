"""Tìm lời bài hát chuẩn trên mạng để sửa chữ Whisper nghe sai.

Thứ tự:
  1. LRCLIB (https://lrclib.net, miễn phí, không cần key) — tìm theo tên bài / ca sĩ.
  2. Claude CLI có bật WebSearch/WebFetch — "research" trên Google / trang lời nhạc,
     dùng chính câu Whisper nghe được để tìm đúng bài (kể cả khi tên bài bị đặt khác).
Mọi ứng viên đều được chấm điểm bằng cách so với chữ Whisper nghe được; chỉ nhận bản khớp đủ cao,
nên tìm nhầm bài trùng tên sẽ bị loại.
"""
import json
import os
import re


import urllib.parse
import urllib.request

from . import llm
from .lyrics import match_score

UA = {"User-Agent": "ai-music-video-tool/1.0 (+https://lrclib.net)"}
MIN_SCORE = 0.45  # tỉ lệ chữ Whisper nghe được tìm thấy trong lời chuẩn


def clean_title(title: str) -> str:
    """'Từng Yêu Chill (30s)' -> 'Từng Yêu' — bỏ ngoặc và các hậu tố phiên bản."""
    t = re.sub(r"[\(\[].*?[\)\]]", " ", title)
    t = re.sub(r"\b(chill|lofi|lo-fi|remix|cover|live|acoustic|short|ver(sion)?|beat|karaoke|"
               r"official|mv|audio|\d+s)\b", " ", t, flags=re.I)
    return re.sub(r"[\s\-_|]+", " ", t).strip()


def _get(url: str, timeout: float = 15) -> list | dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def lrclib_candidates(title: str, artist: str = "") -> list[dict]:
    out, seen = [], set()
    queries = []
    if title:
        if artist:
            queries.append({"track_name": title, "artist_name": artist})
        queries.append({"track_name": title})
        queries.append({"q": f"{title} {artist}".strip()})
    for q in queries:
        try:
            res = _get("https://lrclib.net/api/search?" + urllib.parse.urlencode(q))
        except Exception as e:
            print(f"  (LRCLIB lỗi: {e})")
            return out
        for x in res or []:
            text = x.get("plainLyrics") or ""
            if text and x.get("id") not in seen:
                seen.add(x.get("id"))
                out.append({"source": f'LRCLIB: {x.get("trackName")} — {x.get("artistName")}', "text": text})
    return out


def _ask_lyrics(prompt: str, model: str) -> dict:
    out = llm.ask(prompt, model or os.environ.get("MV_CLAUDE_MODEL") or "claude-sonnet-5-5",
                  web=True, timeout=420)
    return json.loads(re.search(r"\{.*\}", out, re.S).group(0))


_REPLY = """Reply with ONLY this JSON, nothing else:
{{"title": "...", "artist": "...", "url": "...", "lyrics": "full lyrics, one line per line"}}
If you cannot find it, reply {{"lyrics": ""}}."""


def claude_search(heard: str, title: str, artist: str, model: str = "") -> list[dict]:
    """Lần 1: tìm theo câu Whisper nghe được. Lần 2 (nếu trống): tìm theo tên bài + "lời bài hát"
    trên các trang lời tiếng Việt, rồi chọn bản có nội dung gần với câu nghe được nhất."""
    if not llm.available():
        return []
    by_lines = f"""Find the official lyrics of the song that contains these lines (transcribed by speech
recognition, so some words are WRONG — they sound similar to the real words):

\"\"\"{heard[:1500]}\"\"\"

Hint — title given by the user: {title or "unknown"} (may be a different song with the same name,
or contain extra words like "chill/remix"). Artist hint: {artist or "unknown"}.

Search the web (Google, lyric sites, music platforms) using distinctive phrases from the lines above.
Make sure the lyrics you return really contain these lines. """ + _REPLY
    by_title = f"""Search the web for the lyrics of the song titled "{title}"{f' by {artist}' if artist else ''}.
Try queries like "{title} lời bài hát", "{title} lyrics", and lyric sites (loibaihat.biz, nhac.vn,
zingmp3, nhaccuatui, lyricstranslate, Musixmatch, YouTube descriptions). Several songs may share this
title: pick the one whose lyrics are closest to these lines heard by speech recognition (words may be
misheard):

\"\"\"{heard[:800]}\"\"\"

""" + _REPLY
    prompts = [by_lines] + ([by_title] if title else [])
    for i, prompt in enumerate(prompts):
        if i:
            print("  thử lại: tìm theo tên bài + \"lời bài hát\"…")
        try:
            data = _ask_lyrics(prompt.replace("{{", "{").replace("}}", "}"), model)
        except Exception as e:
            print(f"  (AI tìm lời lỗi: {e})")
            continue
        text = str(data.get("lyrics") or "").strip()
        if text:
            src = f'Web: {data.get("title", "?")} — {data.get("artist", "?")} {data.get("url", "")}'.strip()
            return [{"source": src, "text": text}]
    print("  AI không tìm thấy lời trên web")
    return []


def find_reference(heard: str, title: str = "", artist: str = "", claude_model: str = "") -> dict | None:
    """Trả về {"source", "text", "score"} của bản lời khớp nhất, hoặc None."""
    if len(heard.split()) < 4:
        return None
    t = clean_title(title)

    def best(cands: list[dict]) -> dict | None:
        scored = [dict(c, score=match_score(heard, c["text"])) for c in cands]
        scored.sort(key=lambda c: c["score"], reverse=True)
        return scored[0] if scored else None

    b = best(lrclib_candidates(t, artist))
    if b:
        print(f"  LRCLIB tốt nhất: {b['source']} (khớp {b['score']:.0%})")
    if b and b["score"] >= MIN_SCORE:
        return b
    print("  tìm lời trên web bằng AI (Claude / Codex)…")
    w = best(claude_search(heard, t, artist, claude_model))
    if w:
        print(f"  Web: {w['source']} (khớp {w['score']:.0%})")
    cands = [c for c in (b, w) if c]
    top = max(cands, key=lambda c: c["score"], default=None)
    return top if top and top["score"] >= MIN_SCORE else None
