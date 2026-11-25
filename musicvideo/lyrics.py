"""Lấy lời bài hát kèm thời điểm từng chữ.

- Không có lời sẵn: Whisper (faster-whisper) tự nghe.
- Có file lời (.txt, mỗi dòng một câu): vẫn chạy Whisper để lấy thời gian, rồi căn lời
  của người dùng vào kết quả nhận diện (chính xác hơn nhiều so với để Whisper tự đoán chữ).
"""
import difflib
import re
import unicodedata
from pathlib import Path

Word = dict  # {"text": str, "start": float, "end": float}


def lyric_hint(lyric_text: str, limit: int = 600) -> str:
    """Đầu lời bài hát làm 'gợi ý' cho Whisper: nghe đúng từ vựng, chính tả, dấu thanh của bài hơn."""
    lines = [l.strip() for l in lyric_text.splitlines() if l.strip() and not l.strip().startswith(("[", "("))]
    text = " ".join(lines)
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0]


def transcribe(audio: Path, model_size: str = "small", language: str | None = None,
               hint: str = "") -> list[list[Word]]:
    from faster_whisper import WhisperModel

    import soundfile as sf

    # Đọc WAV 16kHz mono (đã chuẩn hóa bằng FFmpeg) và đưa thẳng mảng mẫu cho Whisper,
    # tránh phụ thuộc vào bộ giải mã PyAV (các bản mới không tương thích).
    samples, sr = sf.read(str(audio), dtype="float32", always_2d=False)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    if sr != 16000:
        raise ValueError(f"cần audio 16kHz, nhận {sr}Hz")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    lines, lang = _run(model, samples, 0.0, language, True, hint)
    print(f"  ngôn ngữ nhận diện: {lang}")

    # Whisper hay "đứt mạch" giữa bài (condition_on_previous_text kẹt lại) và bỏ sót cả đoạn lời.
    # Nghe lại riêng từng khoảng trống dài (kể cả đoạn cuối) với ngữ cảnh mới.
    total = len(samples) / sr
    for g0, g1 in _gaps(lines, total, GAP_RETRY):
        extra, _ = _run(model, samples[int(g0 * sr):int(g1 * sr)], g0, lang, False, hint)
        extra = [l for l in extra if l[0]["start"] >= g0 - 0.2 and l[-1]["end"] <= g1 + 0.5]
        if extra:
            print(f"  nghe lại {g0:.1f}s→{g1:.1f}s: thêm {len(extra)} dòng")
            lines.extend(extra)
    lines.sort(key=lambda l: l[0]["start"])
    return lines


GAP_RETRY = 6.0  # khoảng không có lời dài hơn mức này thì nghe lại


def _gaps(lines: list[list[Word]], total: float, min_gap: float) -> list[tuple[float, float]]:
    out, prev = [], 0.0
    for l in lines + [[{"start": total, "end": total}]]:
        if l[0]["start"] - prev >= min_gap:
            out.append((prev, l[0]["start"]))
        prev = max(prev, l[-1]["end"])
    return out


def _run(model, samples, offset: float, language, cond: bool, hint: str = ""):
    # KHÔNG dùng VAD: bộ lọc giọng nói coi giọng hát lẫn trong nhạc là tiếng ồn và cắt mất lời.
    segments, info = model.transcribe(
        samples, language=language, word_timestamps=True, vad_filter=False, beam_size=5,
        # Giữ ngữ cảnh câu trước: với nhạc, tắt đi lại khiến Whisper "bịa" câu kiểu "subscribe…"
        condition_on_previous_text=cond,
        initial_prompt=hint or None,
    )
    lines = []
    for seg in segments:
        # Không lọc theo no_speech_prob: với giọng hát lẫn nhạc, chỉ số này luôn cao (0.8–0.97)
        # kể cả khi là lời thật -> lọc sẽ xoá nhầm lời. Chỉ bỏ các câu "ảo giác" quen thuộc.
        if HALLUCINATION.search(seg.text):
            continue
        words = [
            {"text": w.word.strip(), "start": round(float(w.start) + offset, 3),
             "end": round(float(w.end) + offset, 3)}
            for w in (seg.words or []) if w.word.strip()
        ]
        lines.extend(split_line(words))
    return lines, info.language


# Câu Whisper hay "bịa" ra ở đoạn chỉ có nhạc (học từ phụ đề YouTube)
HALLUCINATION = re.compile(r"subscribe|đăng ký kênh|ghiền mì gõ|cảm ơn các bạn đã (xem|theo dõi)|"
                           r"like và share|amara\.org|vietsub|thanks for watching", re.I)


def split_line(words: list[Word], max_words: int = 8, gap: float = 0.6) -> list[list[Word]]:
    """Chặt đoạn dài thành dòng phụ đề ngắn: ngắt ở dấu câu, chỗ ngừng hát, hoặc khi quá dài."""
    out, cur = [], []
    for i, w in enumerate(words):
        if cur and (w["start"] - cur[-1]["end"] > gap or len(cur) >= max_words):
            out.append(cur)
            cur = []
        cur.append(w)
        if w["text"][-1:] in ",.!?;" and len(cur) >= 3:
            out.append(cur)
            cur = []
    if cur:
        if out and len(cur) <= 2 and len(out[-1]) + len(cur) <= max_words + 2:
            out[-1].extend(cur)  # tránh dòng mồ côi 1–2 chữ
        else:
            out.append(cur)
    return out


def _norm(token: str) -> str:
    """Chữ thường, bỏ dấu và ký tự đặc biệt để so khớp ('Yêu,' -> 'yeu')."""
    token = unicodedata.normalize("NFD", token.lower()).replace("đ", "d")
    return "".join(c for c in token if unicodedata.category(c)[0] in "LN")


# Cặp chữ hay khác nhau giữa bản lời và giọng hát thật (ca sĩ nam/nữ, hát lại đổi ngôi).
# Khi Whisper nghe rõ một chữ trong cặp mà lời dán ghi chữ kia -> giữ chữ ca sĩ hát.
_VARIANTS = [{"anh", "em"}, {"chang", "nang"}, {"chong", "vo"}, {"ong", "ba"}, {"trai", "gai"},
             {"co", "cau"}, {"chau", "co"}, {"he", "she"}, {"him", "her"}, {"his", "her"}, {"boy", "girl"},
             {"man", "woman"}, {"king", "queen"}, {"husband", "wife"}, {"boyfriend", "girlfriend"}]
VARIANT_LOG: list[str] = []  # các chỗ đã giữ theo giọng hát (để in ra log)


def _variant(heard: str, ref: str) -> bool:
    a, b = _norm(heard), _norm(ref)
    return a != b and {a, b} in _VARIANTS


def _keep_sung(heard: dict, ref_tok: str) -> str:
    """Chữ hiển thị: giữ chữ ca sĩ hát nếu là biến thể (anh/em…), giữ hoa/thường và dấu câu của lời dán."""
    if not _variant(heard["text"], ref_tok):
        return ref_tok
    core = re.sub(r"[^\w]", "", heard["text"])
    if ref_tok[:1].isupper():
        core = core[:1].upper() + core[1:]
    VARIANT_LOG.append(f"{ref_tok} -> {core} ({heard['start']:.1f}s)")
    return re.sub(r"\w+", core, ref_tok, count=1)


def align_lyrics(lyric_text: str, recognized: list[list[Word]], total: float) -> list[list[Word]]:
    lyric_lines = [l.strip() for l in lyric_text.splitlines() if l.strip() and not l.strip().startswith("[")]
    user = [(li, tok) for li, line in enumerate(lyric_lines) for tok in line.split()]
    rec = [w for line in recognized for w in line]
    if not user:
        return recognized

    times: list[tuple[float, float] | None] = [None] * len(user)
    sm = difflib.SequenceMatcher(None, [_norm(t) for _, t in user], [_norm(w["text"]) for w in rec], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (rec[j1 + k]["start"], rec[j1 + k]["end"])
        elif tag == "replace" and i2 - i1 == j2 - j1:
            # cùng số chữ: giữ thời gian từng chữ; chữ biến thể (anh/em…) lấy theo giọng hát
            for k in range(i2 - i1):
                w = rec[j1 + k]
                times[i1 + k] = (w["start"], w["end"])
                li, tok = user[i1 + k]
                user[i1 + k] = (li, _keep_sung(w, tok))
        elif tag == "replace":
            # Whisper nghe sai chữ: chia đều khoảng thời gian của đoạn nghe sai cho các chữ đúng
            a, b = rec[j1]["start"], rec[j2 - 1]["end"]
            step = (b - a) / (i2 - i1)
            for k in range(i2 - i1):
                times[i1 + k] = (a + k * step, a + (k + 1) * step)

    # Chữ không khớp được: nội suy giữa hai chữ đã biết thời gian
    i = 0
    while i < len(times):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        left = times[i - 1][1] if i > 0 else (rec[0]["start"] if rec else 0.0)
        right = times[j][0] if j < len(times) else total
        right = min(right, left + 0.6 * (j - i))  # chữ không khớp: tối đa ~0.6s mỗi chữ
        start = i
        if right - left < 0.15 * (j - i) and i > 0:
            # không còn chỗ trống: chia chung thời lượng với chữ đứng trước
            start, left = i - 1, times[i - 1][0]
        step = max(right - left, 0.1) / (j - start)
        for k in range(start, j):
            times[k] = (left + (k - start) * step, left + (k - start + 1) * step)
        i = j

    lines: list[list[Word]] = [[] for _ in lyric_lines]
    for (li, tok), (s, e) in zip(user, times):
        lines[li].append({"text": tok, "start": round(s, 3), "end": round(max(e, s + 0.05), 3)})
    return [l for l in lines if l]


def _ref_tokens(ref_text: str) -> list[str]:
    lines = [l.strip() for l in ref_text.splitlines() if l.strip() and not l.strip().startswith(("[", "("))]
    return [t for l in lines for t in l.split() if _norm(t)]


def match_score(heard: str, ref_text: str) -> float:
    """Tỉ lệ chữ Whisper nghe được có mặt (đúng thứ tự) trong lời chuẩn — để chọn đúng bài."""
    a = [_norm(t) for t in heard.split() if _norm(t)]
    b = [_norm(t) for t in _ref_tokens(ref_text)]
    if not a or not b:
        return 0.0
    hit = sum(m.size for m in difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    return hit / len(a)


def _anchored_opcodes(blocks, n_a: int, n_b: int) -> list[tuple]:
    """Opcode như SequenceMatcher, nhưng bỏ các cụm khớp ngắn (1–2 chữ) nhảy xa trong lời chuẩn —
    thường là chữ trùng ngẫu nhiên ở chỗ khác của bài (vd. 'buồn' ở một câu khác)."""
    kept, pa, pb = [], 0, 0
    for a, b, size in blocks:
        if not size:
            continue
        if size >= 3 or not kept or (b - pb) <= (a - pa) + 3:
            kept.append((a, b, size))
            pa, pb = a + size, b + size
    ops, pa, pb = [], 0, 0
    for a, b, size in [*kept, (n_a, n_b, 0)]:
        if pa < a or pb < b:
            tag = "replace" if pa < a and pb < b else ("delete" if pa < a else "insert")
            ops.append((tag, pa, a, pb, b))
        if size:
            ops.append(("equal", a, a + size, b, b + size))
        pa, pb = a + size, b + size
    return ops


def correct_with_reference(recognized: list[list[Word]], ref_text: str,
                           max_fix: int = 6) -> tuple[list[list[Word]], int]:
    """Sửa chữ Whisper nghe sai bằng lời chuẩn, GIỮ NGUYÊN thời gian từng chữ và cách chia dòng.

    - Chữ khớp (bỏ dấu): lấy chữ của lời chuẩn (sửa dấu thanh), giữ start/end.
    - Đoạn nghe sai nằm GIỮA hai đoạn khớp: thay bằng chữ đúng; cùng số chữ -> giữ nguyên từng
      start/end, khác số chữ -> chia đều khoảng thời gian đoạn đó.
    - Đoạn ở mép (đầu/cuối clip) hoặc quá dài: không tự sửa (có thể là phần lời ngoài đoạn cắt).
    Trả về (dòng đã sửa, số chữ đã thay đổi).
    """
    rec = [dict(w, line=li) for li, line in enumerate(recognized) for w in line]
    ref = _ref_tokens(ref_text)
    if not rec or not ref:
        return recognized, 0
    ref_n = [_norm(t) for t in ref]
    changed = 0

    def fix(span: list[dict], depth: int = 0) -> list[dict]:
        nonlocal changed
        sm = difflib.SequenceMatcher(None, [_norm(w["text"]) for w in span], ref_n, autojunk=False)
        ops = _anchored_opcodes(sm.get_matching_blocks(), len(span), len(ref_n))
        out: list[dict] = []
        for k, (tag, j1, j2, i1, i2) in enumerate(ops):
            part = span[j1:j2]
            if tag == "equal":
                for w, t in zip(part, ref[i1:i2]):
                    if t != w["text"]:
                        changed += 1
                    out.append(dict(w, text=t))
                continue
            bounded = 0 < k < len(ops) - 1 and ops[k - 1][0] == "equal" and ops[k + 1][0] == "equal"
            n_rec, n_ref = j2 - j1, i2 - i1
            small = max(n_rec, n_ref) <= max_fix and (min(n_rec, n_ref) == 0 or max(n_rec, n_ref) <= 2 * min(n_rec, n_ref))
            if bounded and small and tag == "replace":
                a, b = part[0]["start"], part[-1]["end"]
                for x, t in enumerate(ref[i1:i2]):
                    if n_rec == n_ref:
                        s, e, li = part[x]["start"], part[x]["end"], part[x]["line"]
                        t = _keep_sung(part[x], t)
                        if t == part[x]["text"]:
                            changed -= 1  # giữ nguyên chữ ca sĩ hát -> không tính là sửa
                    else:
                        step = (b - a) / n_ref
                        s, e = a + x * step, a + (x + 1) * step
                        li = part[min(int(x * n_rec / n_ref), n_rec - 1)]["line"]
                    out.append({"text": t, "start": round(s, 3), "end": round(e, 3), "line": li})
                changed += max(n_rec, n_ref)
            elif bounded and small and tag == "insert" and out:
                # Whisper bỏ sót chữ: chia thời lượng chữ đứng trước cho nó và các chữ bị sót
                prev = out.pop()
                words = [prev["text"], *ref[i1:i2]]
                step = (prev["end"] - prev["start"]) / len(words)
                for x, t in enumerate(words):
                    out.append({"text": t, "start": round(prev["start"] + x * step, 3),
                                "end": round(prev["start"] + (x + 1) * step, 3), "line": prev["line"]})
                changed += n_ref
            elif bounded and small and tag == "delete":
                changed += n_rec  # Whisper nghe thừa chữ (lặp/ảo giác) -> bỏ
            elif tag == "replace" and 0 < n_rec <= 4 and (
                    (k == len(ops) - 1 and k > 0 and ops[k - 1][0] == "equal") or
                    (k == 0 and len(ops) > 1 and ops[1][0] == "equal")):
                # Mép đầu/cuối clip, cạnh một đoạn khớp: lấy đúng n_rec chữ liền kề trong lời chuẩn, thay 1-1
                seg = ref[i1:i1 + n_rec] if k > 0 else ref[max(i2 - n_rec, i1):i2]
                for w, t in zip(part, seg):
                    out.append(dict(w, text=_keep_sung(w, t)))
                out.extend(part[len(seg):])
                changed += len(seg)
            elif n_rec >= 4 and depth < 4 and tag in ("replace", "delete"):
                # Đoạn dài không khớp (vd. điệp khúc hát lại): căn riêng đoạn đó với toàn bộ lời chuẩn
                out.extend(fix(part, depth + 1))
            else:
                out.extend(part)  # không chắc -> giữ nguyên chữ Whisper
        return out

    fixed = fix(rec)
    lines: list[list[Word]] = [[] for _ in recognized]
    for w in fixed:
        li = w.pop("line")
        lines[li].append(w)
    return [l for l in lines if l], changed


def to_lines(words_by_line: list[list[Word]]) -> list[dict]:
    """Định dạng mà Remotion dùng: [{start, end, words:[...]}]."""
    return [{"start": ws[0]["start"], "end": ws[-1]["end"], "words": ws} for ws in words_by_line if ws]
