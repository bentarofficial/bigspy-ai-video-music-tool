"""Tạo music video từ một file nhạc.

Ví dụ:
  python make_video.py song.mp3 --title "Tên bài hát" --lyrics loi.txt --lang vi --render
  python make_video.py song.mp3 --orientation landscape --subtitle-mode preview --theme "ocean, sunset"
  python make_video.py --render-only output/ten-bai/props.json      # render lại sau khi sửa props
"""
import os
import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

from musicvideo import audio, keywords, lyrics, scenes
from musicvideo.config import (CACHE_DIR, CLIPS_DIR, JOBS_PUBLIC_DIR, OUTPUT_DIR, PUBLIC_DIR,
                               REMOTION_DIR, SIZES, load_env)
from musicvideo.pixabay import Pixabay


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFD", name.lower()).replace("đ", "d")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "job"


def render(props_path: Path, out: Path) -> None:
    print(f"▶ Render bằng Remotion -> {out}")
    subprocess.run(
        f'npx remotion render src/index.ts MusicVideo "{out}" --props="{props_path}" --timeout=120000',
        cwd=REMOTION_DIR, shell=True, check=True,
    )


def main() -> None:
    for stream in (sys.stdout, sys.stderr):  # console Windows mặc định cp1252 -> lỗi khi in tiếng Việt
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    load_env()
    import os

    p = argparse.ArgumentParser(description="AI Music Video Tool")
    p.add_argument("audio", nargs="?", help="file nhạc mp3/wav/m4a/flac")
    p.add_argument("--title", default="", help="tên bài hát hiện ở đầu video")
    p.add_argument("--subtitle-text", default="", help="dòng phụ dưới tên bài (ví dụ tên ca sĩ)")
    p.add_argument("--lyrics", help="file .txt lời bài hát (mỗi dòng một câu) — giúp phụ đề chính xác")
    p.add_argument("--lang", default=None, help="mã ngôn ngữ, ví dụ vi, en (bỏ trống = tự nhận)")
    p.add_argument("--whisper-model", default="small", help="tiny/base/small/medium/large-v3")
    p.add_argument("--no-auto-lyrics", action="store_true",
                   help="không tự tìm lời chuẩn trên mạng (LRCLIB / web) để sửa phụ đề")
    p.add_argument("--no-lyrics",action="store_true", help="bài không lời: bỏ qua phụ đề")
    p.add_argument("--orientation", choices=list(SIZES), default="portrait")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--scene-length", type=float, default=4.0, help="độ dài mong muốn mỗi cảnh (giây); 0 = auto, chỉ chuyển cảnh khi hát xong một câu")
    p.add_argument("--claude-model", default="", help="model Claude CLI, ví dụ claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2")
    p.add_argument("--codex-model", default="", help="model Codex CLI (vd gpt-5.6-terra); trống = mặc định của gói")
    p.add_argument("--claude-effort", default="", choices=["", *keywords.EFFORTS], help="mức suy nghĩ của Claude")
    p.add_argument("--theme", help="chủ đề hình ảnh, ví dụ 'ocean, sunset, city night'")
    p.add_argument("--subtitle-mode", choices=["karaoke", "preview", "full"], default="karaoke")
    p.add_argument("--title-animation", default="zoom", help="hiệu ứng xuất hiện tên bài (id trong remotion/src/anim.ts)")
    p.add_argument("--title-out", default="fade", help="hiệu ứng biến mất tên bài")
    p.add_argument("--sub-in", default="", help="hiệu ứng xuất hiện mỗi câu phụ đề (trống = mặc định)")
    p.add_argument("--sub-out", default="fade", help="hiệu ứng biến mất mỗi câu phụ đề")
    p.add_argument("--title-color", default="#ffffff")
    p.add_argument("--title-font", default="Arial Black, Arial, sans-serif", help="phông tên bài")
    p.add_argument("--sub-font", default="Arial Black, Arial, sans-serif", help="phông phụ đề")
    p.add_argument("--sub-color", default="#ffffff", help="màu chữ phụ đề")
    p.add_argument("--sub-highlight", default="#ffd23f", help="màu tô karaoke")
    p.add_argument("--color-filter", default="none", help="bộ lọc màu phủ toàn video (id trong remotion/src/colorFilter.tsx, ví dụ natural, cinematic, kodak, bw)")
    p.add_argument("--filter-intensity", type=float, default=1.0, help="cường độ bộ lọc 0..1")
    p.add_argument("--render", action="store_true", help="render ra MP4 ngay sau khi chuẩn bị xong")
    p.add_argument("--render-only", metavar="PROPS", help="chỉ render lại từ một props.json đã có")
    p.add_argument("--job", help="tên thư mục job (mặc định lấy từ tên bài)")
    p.add_argument("--start", type=float, help="cắt nhạc: bắt đầu từ giây thứ…")
    p.add_argument("--end", type=float, help="cắt nhạc: kết thúc ở giây thứ…")
    p.add_argument("--fade-in", type=float, default=0.5, help="fade-in khi cắt (giây)")
    p.add_argument("--fade-out", type=float, default=1.5, help="fade-out khi cắt (giây)")
    p.add_argument("--logo", help="ảnh logo kênh (PNG nền trong suốt) hiện ở góc video")
    p.add_argument("--logo-position", default="top-right", choices=["top-right", "top-left", "bottom-right", "bottom-left"])
    p.add_argument("--logo-size", type=float, default=14, help="chiều rộng logo, %% cạnh ngắn khung hình")
    p.add_argument("--logo-opacity", type=float, default=0.9)
    a = p.parse_args()
    if a.codex_model:
        os.environ["MV_CODEX_MODEL"] = a.codex_model

    if a.render_only:
        props = Path(a.render_only).resolve()
        render(props, props.parent / "video.mp4")
        return
    if not a.audio:
        p.error("cần đường dẫn file nhạc")

    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        sys.exit("Thiếu PIXABAY_API_KEY trong file .env (lấy tại https://pixabay.com/api/docs/)")

    src = Path(a.audio).resolve()
    job = a.job or slugify(a.title or src.stem)
    out_dir = OUTPUT_DIR / job
    pub_dir = JOBS_PUBLIC_DIR / job
    out_dir.mkdir(parents=True, exist_ok=True)
    pub_dir.mkdir(parents=True, exist_ok=True)

    print("① Chuẩn hóa audio")
    if a.start is not None or a.end is not None:
        # cắt đoạn nhạc cần dùng (cho video short) — mọi bước sau chỉ xử lý đoạn này
        s, e = a.start or 0.0, a.end
        print(f"  cắt đoạn {s:.1f}s → {e:.1f}s" if e else f"  cắt từ {s:.1f}s đến hết")
        src = audio.cut(src, out_dir / "song_cut.wav", s, e, a.fade_in, a.fade_out)
        song = pub_dir / "song.wav"
    else:
        song = pub_dir / f"song{src.suffix.lower()}"
    shutil.copyfile(src, song)
    wav = audio.to_wav(src, out_dir / "audio16k.wav")
    total = audio.duration_of(wav)
    print(f"  dài {total:.1f}s")

    lines: list[dict] = []
    if not a.no_lyrics:
        asr_input = wav
        print(f"③ Nhận diện lời (Whisper {a.whisper_model}, CPU — có thể mất vài phút)")
        recognized = lyrics.transcribe(asr_input, a.whisper_model, a.lang)
        clipped = a.start is not None or a.end is not None
        if a.lyrics and not clipped:
            print("  căn lời bài hát của bạn vào giọng hát")
            words = lyrics.align_lyrics(Path(a.lyrics).read_text(encoding="utf-8"), recognized, total)
        else:
            # Đã trích xuất xong -> tìm lời chuẩn (dán sẵn / LRCLIB / web) -> chỉ sửa chữ sai, giữ timing
            words = recognized
            ref = None
            if a.lyrics:
                ref = {"source": "lời bạn dán", "text": Path(a.lyrics).read_text(encoding="utf-8")}
            elif not a.no_auto_lyrics:
                print("  ③b Đối chiếu với lời bài hát chuẩn trên mạng")
                from musicvideo import lyrics_lookup
                heard = " ".join(w["text"] for line in recognized for w in line)
                ref = lyrics_lookup.find_reference(heard, a.title, a.subtitle_text, a.claude_model)
                if ref:
                    (out_dir / "lyrics_reference.txt").write_text(
                        f"# {ref['source']} (khớp {ref['score']:.0%})\n{ref['text']}", encoding="utf-8")
                else:
                    print("  ⚠ Không tìm được lời chuẩn khớp -> giữ phụ đề Whisper (có thể dán lời để sửa)")
            if ref:
                words, n = lyrics.correct_with_reference(recognized, ref["text"])
                print(f"  ✔ Sửa {n} chữ theo {ref['source']} (giữ nguyên thời gian karaoke)")
        lines = lyrics.to_lines(words)
        (out_dir / "lyrics.json").write_text(json.dumps(lines, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  {len(lines)} dòng lời")
        if not lines:
            print("  ⚠ Không nhận được lời. Hãy chọn đúng ngôn ngữ, dán lời bài hát, "
                  "hoặc bật tách giọng / dùng model Whisper lớn hơn.")

    print("④ Phân tích nhịp & chia cảnh")
    analysis = scenes.analyze(wav)
    scene_list = scenes.make_scenes(analysis, lines, a.scene_length)
    print(f"  tempo {analysis['tempo']:.0f} BPM, {len(scene_list)} cảnh")

    print("⑤ Chọn từ khóa hình ảnh")
    queries = keywords.generate(scene_list, a.title, a.theme, a.claude_model, a.claude_effort)

    print("⑥ Tìm & tải clip từ Pixabay")
    px = Pixabay(key, CACHE_DIR, CLIPS_DIR)
    used: set[int] = set()
    portrait = a.orientation == "portrait"
    out_scenes = []
    for i, (sc, q) in enumerate(zip(scene_list, queries)):
        dur = sc["end"] - sc["start"]
        hit = px.find(q, dur + 1, portrait, used)
        clip_src, clip_dur, credit = "", dur, ""
        if hit:
            used.add(hit["id"])
            path = px.download(hit)
            clip_src = path.relative_to(PUBLIC_DIR).as_posix()
            clip_dur = float(hit.get("duration") or dur)
            credit = f'{hit.get("user", "")} — {hit.get("pageURL", "")}'
        print(f"  [{i + 1:>2}/{len(scene_list)}] {sc['start']:6.1f}s  '{q}'  -> {clip_src or 'KHÔNG TÌM THẤY'}")
        out_scenes.append({"src": clip_src, "start": sc["start"], "end": sc["end"], "clipDuration": clip_dur,
                           "query": q, "transition": sc["transition"], "credit": credit})

    w, h = SIZES[a.orientation]
    base = min(w, h)
    props = {
        "fps": a.fps, "width": w, "height": h, "duration": round(total, 3),
        "audio": song.relative_to(PUBLIC_DIR).as_posix(),
        "transitionSeconds": 0.8, "kenBurns": True, "darken": 0.25,
        "scenes": out_scenes,
        "lines": lines,
        "subtitle": {
            "mode": a.subtitle_mode, "lookahead": 2, "leadIn": 0.6,
            "fontFamily": a.sub_font, "fontSize": round(base * 0.065),
            "color": a.sub_color, "highlightColor": a.sub_highlight, "strokeColor": "#000000", "strokeWidth": 6,
            "position": "bottom", "uppercase": False,
            **({"animIn": a.sub_in} if a.sub_in else {}), "animOut": a.sub_out,
        },
        "title": {
            "enabled": bool(a.title), "text": a.title, "subtext": a.subtitle_text,
            "start": 0.3, "duration": 4.0,
            "fontFamily": a.title_font, "fontSize": round(base * 0.11),
            "color": a.title_color, "accentColor": "#ff4fa3", "animation": a.title_animation, "animOut": a.title_out, "y": 42,
        },
    }
    if a.logo and Path(a.logo).is_file():
        logo = pub_dir / f"logo{Path(a.logo).suffix.lower()}"
        if Path(a.logo).resolve() != logo.resolve():
            shutil.copyfile(a.logo, logo)
        props["logo"] = {"src": logo.relative_to(PUBLIC_DIR).as_posix(), "position": a.logo_position,
                         "size": max(3.0, min(50.0, a.logo_size)), "opacity": max(0.0, min(1.0, a.logo_opacity)),
                         "margin": 4}
    if a.color_filter and a.color_filter != "none":
        props["colorFilter"] = {"preset": a.color_filter, "intensity": max(0.0, min(1.0, a.filter_intensity))}
    props_path = out_dir / "props.json"
    props_path.write_text(json.dumps(props, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✔ Đã tạo {props_path}")
    print(f"  Xem trước & chỉnh: cd remotion && npx remotion studio --props=\"{props_path}\"")

    if a.render:
        render(props_path, out_dir / "video.mp4")


if __name__ == "__main__":
    main()
