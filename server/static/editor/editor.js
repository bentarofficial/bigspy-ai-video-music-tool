/* Editor timeline kiểu CapCut / Camtasia – JS thuần, xem trước bằng Remotion Player (player.js). */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const JOB = new URLSearchParams(location.search).get('id');
const RULER_H = 26;

let TL = null;               // timeline đang dựng
let META = {};
let api = null;              // Remotion Player API
let T = 0;                   // thời điểm đầu phát (giây)
let playing = false;
let pps = 60;                // pixel / giây
let snapOn = true;
let rippleOn = false;
let safeOn = false;
let sel = new Set();
const hist = [], fut = [];
let lastSnap = '';

/* ---------- tiện ích ---------- */
async function apiCall(url, opt = {}) {
  const r = await fetch(url, opt);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
  return r.json();
}
function toast(m, ms = 2400) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }
function fmt(s, frames = true) {
  s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${(frames ? r.toFixed(2) : Math.floor(r).toString()).padStart(frames ? 5 : 2, '0')}`;
}
const fps = () => TL.fps;
const q = (t) => Math.round(t * fps()) / fps();          // làm tròn theo khung hình
const duration = () => Math.max(1, ...TL.clips.map((c) => c.start + c.dur));
const track = (id) => TL.tracks.find((t) => t.id === id);
const clip = (id) => TL.clips.find((c) => c.id === id);
const KIND_OF = {video: 'video', image: 'video', audio: 'audio', text: 'text', lyrics: 'text'};
const fits = (c, tr) => !!tr && (tr.kind !== 'main' || c.type === 'video' || c.type === 'image');
// dự án cũ: track video đầu tiên -> Video chính, các track còn lại -> track chung
function migrateTracks() {
  if (TL.tracks.some((t) => t.kind === 'main' || t.kind === 'mixed')) return;
  const v = TL.tracks.find((t) => t.kind === 'video');
  for (const t of TL.tracks) {
    if (t === v) { t.kind = 'main'; if (/^Video( \d+)?$/.test(t.name)) t.name = 'Video chính'; }
    else t.kind = 'mixed';
  }
  // clip ảnh/video không thể ở track khác -> giữ nguyên; clip khác lỡ nằm trên Video chính -> sang track chung
  for (const c of TL.clips) if (!fits(c, track(c.track))) c.track = newTrack('mixed', 0).id;
}
const hasSrcLimit = (c) => (c.type === 'video' || c.type === 'audio') && !c.loop && c.srcDur;
const LABEL = {video: 'Video', image: 'Ảnh', audio: 'Âm thanh', text: 'Chữ', lyrics: 'Câu lời', cover: 'Lớp che mờ'};

/* ---------- căn điểm chuyển cảnh theo câu hát ---------- */
// Điểm nối giữa 2 clip trên Video chính mà rơi vào giữa một câu hát -> dời ra khoảng nghỉ gần nhất
function alignScenesToLyrics() {
  const MIN = 1.2;
  const lines = [];
  for (const c of TL.clips) if (c.type === 'lyrics' && !track(c.track)?.hidden) lines.push([c.start, c.start + c.dur]);
  lines.sort((a, b) => a[0] - b[0]);
  if (!lines.length) return toast('Dự án chưa có câu lời nào');
  const main = TL.tracks.find((t) => t.kind === 'main');
  const vs = TL.clips.filter((c) => c.track === main?.id).sort((a, b) => a.start - b.start);
  if (vs.length < 2) return toast('Video chính cần ít nhất 2 cảnh');
  const end = vs[vs.length - 1].start + vs[vs.length - 1].dur;
  const cuts = vs.slice(1).map((c) => c.start);
  // điểm cắt hợp lệ: khoảng nghỉ giữa các câu (giữa khoảng nghỉ, tối đa 0.2s trước câu sau)
  const gaps = [];
  for (let i = 0; i < lines.length; i++) {
    const lo = i ? lines[i - 1][1] : 0, hi = lines[i][0];
    if (hi >= lo - 0.05) gaps.push(Math.min(hi, Math.max(lo, Math.min((lo + hi) / 2, hi - 0.2))));
  }
  gaps.push(lines[lines.length - 1][1] + 0.2);
  const inLine = (t) => lines.some(([a, b]) => t > a + 0.05 && t < b - 0.05);
  let moved = 0;
  // 2 lượt (xuôi rồi ngược) để điểm cắt này không bị điểm cắt kế bên chặn
  const order = [...cuts.keys(), ...[...cuts.keys()].reverse()];
  for (const i of order) {
    if (!inLine(cuts[i])) continue;
    const prev = i ? cuts[i - 1] : vs[0].start, next = i + 1 < cuts.length ? cuts[i + 1] : end;
    const ok = gaps.filter((g) => g - prev >= MIN && next - g >= MIN).sort((a, b) => Math.abs(a - cuts[i]) - Math.abs(b - cuts[i]));
    if (ok.length) { cuts[i] = ok[0]; moved++; }
  }
  if (!moved) return toast('Không có điểm chuyển cảnh nào rơi giữa câu hát');
  const bounds = [vs[0].start, ...cuts, end];
  vs.forEach((c, i) => { c.start = +bounds[i].toFixed(3); c.dur = +Math.max(0.1, bounds[i + 1] - bounds[i]).toFixed(3); });
  commit();
  const left = cuts.filter(inLine).length;
  toast(`Đã dời ${moved} điểm chuyển cảnh ra khoảng nghỉ giữa câu` + (left ? ` (còn ${left} chỗ không dời được)` : ''), 3500);
}

/* ---------- lịch sử & lưu ---------- */
const snap = () => JSON.stringify({tracks: TL.tracks, clips: TL.clips, media: TL.media, width: TL.width, height: TL.height, background: TL.background});
function commit() {
  if (TL) { explodeLyrics(); syncLyrics(); }
  hist.push(lastSnap); if (hist.length > 200) hist.shift();
  fut.length = 0; lastSnap = snap();
  changed();
}
function restore(s) { Object.assign(TL, JSON.parse(s)); lastSnap = s; sel = new Set([...sel].filter(clip)); changed(); }
function undo() { if (!hist.length) return; fut.push(lastSnap); restore(hist.pop()); }
function redo() { if (!fut.length) return; hist.push(lastSnap); restore(fut.pop()); }
let saveT;
function changed() {
  renderTimeline(); renderProps(); renderSide(); pushPlayer();
  $('#undo').disabled = !hist.length; $('#redo').disabled = !fut.length;
  $('#saved').textContent = 'Đang lưu…';
  clearTimeout(saveT); saveT = setTimeout(save, 700);
}
async function save() {
  try { await apiCall(`/api/jobs/${JOB}/timeline`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(TL)}); $('#saved').textContent = 'Đã lưu'; }
  catch (e) { $('#saved').textContent = '⚠ Lỗi lưu: ' + e.message; }
}

/* ---------- player ---------- */
let pushT;
function pushPlayer() {
  clearTimeout(pushT);
  pushT = setTimeout(() => {
    if (api) {
      api.update(JSON.parse(JSON.stringify(TL)));
      // Player cập nhật thời lượng sau 1 nhịp render -> tua lại để không bị kẹp về độ dài cũ
      if (!playing) setTimeout(() => P()?.seekTo(Math.round(T * fps())), 60);
    }
    $('#total').textContent = fmt(duration());
  }, 30);
}
const P = () => api && api.player();
function seek(t) {
  T = clamp(q(t), 0, duration());
  P()?.seekTo(Math.round(T * fps()));
  updatePlayhead();
}
function togglePlay() { const p = P(); if (!p) return; if (p.isPlaying()) p.pause(); else { if (T >= duration() - 0.05) seek(0); p.play(); } }

/* ---------- timeline: vẽ ---------- */
function laneTop(i) { return RULER_H + (i + 1) * trackH(); } // +1: hàng "Thả vào track mới" ở trên cùng
function trackH() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--trackh')) || 36; }

function renderRuler(width) {
  const r = $('#ruler'); const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const major = steps.find((s) => s * pps >= 80) || 600;
  const minor = major / (major >= 1 ? 5 : 2);
  let h = '';
  const end = width / pps;
  for (let t = 0; t <= end; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    h += `<div class="tk ${isMajor ? 'big' : 'sm'}" style="left:${t * pps}px"></div>`;
    if (isMajor) h += `<div class="lb" style="left:${t * pps}px">${fmt(t, major < 1)}</div>`;
  }
  r.innerHTML = h;
}

function clipHTML(c) {
  const left = c.start * pps, w = Math.max(4, c.dur * pps);
  const fx = [c.group ? '🔗' : '', c.speed && c.speed !== 1 ? c.speed + 'x' : '', c.fadeIn ? '◢' : '', c.fadeOut ? '◣' : '', c.loop ? '↻' : '', c.kenBurns ? 'KB' : ''].filter(Boolean).join(' ');
  const m = c.src && TL.media.find((x) => x.src === c.src);
  const bg = c.type === 'image' && c.src ? `background-image:url('/media/${encodeURI(c.src)}')` : m && m.thumb ? `background-image:url('${m.thumb}')` : '';
  const name = c.type === 'text' ? c.title?.text : c.name;
  const trz = c.transition && c.transition.type !== 'none' ? `<div class="trz" style="width:${Math.min(w / 2, c.transition.dur * pps)}px"></div>` : '';
  return `<div class="clip ${c.type} ${bg ? 'thumb' : ''} ${sel.has(c.id) ? 'sel' : ''}" data-id="${c.id}" style="left:${left}px;width:${w}px;${bg}">
    ${trz}<div class="h l" data-h="l"></div><span class="cn">${esc(name || LABEL[c.type])}</span><span class="fx">${fx}</span><div class="h r" data-h="r"></div></div>`;
}

function renderTimeline() {
  const width = Math.max($('#scroller').clientWidth, (duration() + 30) * pps);
  $('#canvas').style.width = width + 'px';
  renderRuler(width);
  const icon = {main: '🎞', mixed: '≡'};
  const col = {main: 'var(--cv)', mixed: 'var(--mute)'};
  $('#heads').innerHTML = `<div class="head newzone">＋ Thả vào track mới</div>` + TL.tracks.map((t) => `<div class="head" data-t="${t.id}">
    <span class="kind" style="background:${col[t.kind]}"></span>
    <span class="tn" title="Nhấp đúp để đổi tên">${icon[t.kind]} ${esc(t.name)}</span>
    ${true ? `<button class="ib ${t.hidden ? 'off' : ''}" data-act="hidden" title="Ẩn/hiện">${t.hidden ? '◌' : '👁'}</button>` : ''}
    ${true ? `<button class="ib ${t.muted ? 'off' : ''}" data-act="muted" title="Tắt/bật tiếng">${t.muted ? '🔇' : '🔊'}</button>` : ''}
    <button class="ib ${t.locked ? 'off' : ''}" data-act="locked" title="Khoá">${t.locked ? '🔒' : '🔓'}</button>
  </div>`).join('');
  $('#lanes').innerHTML = `<div class="lane newzone"></div>` + TL.tracks.map((t) => `<div class="lane ${t.locked ? 'locked' : ''} ${t.muted ? 'muted' : ''} ${t.hidden ? 'hidden' : ''}" data-t="${t.id}">
    ${TL.clips.filter((c) => c.track === t.id).map(clipHTML).join('')}${joints(t).map((c) => `<div class="tb ${c.transition && c.transition.type !== 'none' ? 'on' : ''}" data-tr="${c.id}" style="left:${c.start * pps}px" title="Chuyển cảnh${c.transition && c.transition.type !== 'none' ? ': ' + trName(c.transition.type) : ' (nhấp để chọn)'}"></div>`).join('')}</div>`).join('');
  $('#canvas').style.height = RULER_H + (TL.tracks.length + 1) * trackH() + 'px';
  $('#heads').scrollTop = $('#scroller').scrollTop;
  updatePlayhead();
}
function updatePlayhead() {
  if (!playing) drawOverlay();
  $('#playhead').style.left = T * pps + 'px';
  $('#tc').textContent = fmt(T);
}

/* ---------- thao tác clip ---------- */
function overlaps(trackId, s, e, ignore) {
  return TL.clips.some((c) => c.track === trackId && !ignore.has(c.id) && s < c.start + c.dur - 1e-4 && e > c.start + 1e-4);
}
function newTrack(kind = 'mixed', at = 0) {
  if (kind !== 'main') kind = 'mixed';
  const n = TL.tracks.filter((t) => t.kind === 'mixed').length + 1;
  const t = {id: 'k' + uid(), kind, name: kind === 'main' ? 'Video chính' : `Track ${n}`};
  TL.tracks.splice(clamp(at ?? 0, 0, TL.tracks.length), 0, t);
  return t;
}
/** Track còn trống trong [s, e) cho loại khối `type`; video/ảnh ưu tiên Video chính. Không có thì tạo track chung mới. */
function freeTrack(type, s, e, ignore = new Set()) {
  const ok = (t) => fits({type}, t) && !t.locked && !overlaps(t.id, s, e, ignore);
  const main = TL.tracks.find((t) => t.kind === 'main');
  if ((type === 'video' || type === 'image') && main && ok(main)) return main;
  return TL.tracks.find((t) => t.kind !== 'main' && ok(t)) || newTrack('mixed', type === 'audio' ? TL.tracks.length : 0);
}
function gcTracks() {   // bỏ track chung rỗng thừa (giữ ít nhất 1); không bao giờ bỏ Video chính
  const ts = TL.tracks.filter((t) => t.kind !== 'main');
  let keep = ts.length;
  for (const t of ts) if (keep > 1 && !t.locked && !TL.clips.some((c) => c.track === t.id)) { TL.tracks.splice(TL.tracks.indexOf(t), 1); keep--; }
}

function addMedia(m, at = T, trackId = null) {
  const dur = m.type === 'image' ? 4 : m.duration || 5;
  let tr = trackId && track(trackId);
  if (!tr || !fits(m, tr) || tr.locked || overlaps(tr.id, at, at + dur, new Set())) tr = freeTrack(m.type, at, at + dur);
  const c = {id: uid(), track: tr.id, type: m.type, src: m.src, name: m.name, start: q(at), dur: q(dur), in: 0,
             srcDur: m.duration, fit: 'contain', volume: 1};
  const first = !TL.clips.length;
  TL.clips.push(c); sel = new Set([c.id]); commit();
  if (first) setTimeout(zoomFit, 50);
}
const TEXT_PRESETS = [
  {name: 'Tiêu đề', sub: 'Phóng to', st: {animIn: 'zoom', fontSize: 120}},
  {name: 'Chữ mờ dần', sub: 'Mờ vào / mờ ra', st: {animIn: 'fade', fontSize: 90}},
  {name: 'Gõ chữ', sub: 'Máy đánh chữ', st: {animIn: 'typewriter', fontSize: 80, inDur: 1.2}},
  {name: 'Nảy', sub: 'Nảy lên', st: {animIn: 'pop', fontSize: 100}},
  {name: 'Trượt lên', sub: 'Trượt vào / trượt ra', st: {animIn: 'slide-up', animOut: 'slide-up', fontSize: 90}},
  {name: 'Neon', sub: 'Phát sáng', st: {animIn: 'glow', fontSize: 110, color: '#ffffff', accentColor: '#22d3ee'}},
  {name: 'Hộp đen', sub: 'Chữ trên nền hộp', st: {animIn: 'fade', fontSize: 70, bold: false, bgColor: '#000000', bgOpacity: 0.7, shadow: false, y: 80}},
  {name: 'Viền dày', sub: 'Kiểu phụ đề TikTok', st: {animIn: 'pop', fontSize: 90, strokeColor: '#000000', strokeWidth: 10, color: '#ffe14d', y: 70}},
  {name: 'Nhãn màu', sub: 'Hộp hồng bo góc', st: {animIn: 'slide-right', animOut: 'slide-left', fontSize: 64, bgColor: '#ec4899', bgOpacity: 1, bgRadius: 40, shadow: false, x: 30, y: 15}},
  {name: 'Mờ ảo', sub: 'Hiện từ mờ', st: {animIn: 'blur', animOut: 'blur', fontSize: 100, italic: true}},
];
function addText(p, at = T, trackId = null) {
  let tr = trackId && track(trackId);
  if (!tr || !fits({type: 'text'}, tr) || tr.locked || overlaps(tr.id, at, at + 3, new Set())) tr = freeTrack('text', at, at + 3);
  const c = {id: uid(), track: tr.id, type: 'text', start: q(at), dur: 3, name: p.name, title: {
    enabled: true, text: p.name, subtext: '', start: 0, duration: 3, fontFamily: 'Arial Black, Arial, sans-serif',
    color: '#ffffff', accentColor: '#ff4fa3', animation: 'fade', animOut: 'fade', y: 50, x: 50, ...p.st,
    fontSize: Math.round(p.st.fontSize * Math.min(TL.width, TL.height) / 1080)}};
  TL.clips.push(c); sel = new Set([c.id]); commit();
}

function splitAt(t = T) {
  let targets = TL.clips.filter((c) => sel.has(c.id) && t > c.start + 0.02 && t < c.start + c.dur - 0.02);
  if (!targets.length) targets = TL.clips.filter((c) => !track(c.track).locked && t > c.start + 0.02 && t < c.start + c.dur - 0.02);
  if (!targets.length) return toast('Không có clip nào tại đầu phát');
  const nsel = new Set();
  for (const c of targets) {
    const cut = q(t - c.start);
    const b = JSON.parse(JSON.stringify(c));
    b.id = uid(); b.start = q(c.start + cut); b.dur = q(c.dur - cut);
    b.in = (c.in || 0) + cut * (c.speed || 1); b.fadeIn = 0;
    if (c.type === 'lyrics' && c.lines?.length === 1) splitLyricClip(c, b, (c.in || 0) + cut);
    c.dur = cut; c.fadeOut = 0;
    TL.clips.push(b); nsel.add(b.id);
  }
  sel = nsel; commit();
}
function deleteSel(ripple = rippleOn) {
  if (!sel.size) return;
  if (ripple) {   // các clip phía sau cùng track lùi lại lấp chỗ trống
    const dels = TL.clips.filter((c) => sel.has(c.id) && !track(c.track).locked).sort((a, b) => b.start - a.start);
    for (const d of dels) for (const x of TL.clips) if (x.track === d.track && !sel.has(x.id) && x.start >= d.start + d.dur - 1e-4) x.start = q(Math.max(0, x.start - d.dur));
  }
  TL.clips = TL.clips.filter((c) => !sel.has(c.id) || track(c.track).locked);
  sel.clear(); gcTracks(); commit();
}
function duplicateSel() {
  const src = TL.clips.filter((c) => sel.has(c.id)); if (!src.length) return;
  const nsel = new Set();
  for (const c of src) {
    const b = JSON.parse(JSON.stringify(c)); b.id = uid();
    b.start = c.start + c.dur;
    if (overlaps(c.track, b.start, b.start + b.dur, new Set())) b.track = freeTrack(c.type, b.start, b.start + b.dur).id;
    TL.clips.push(b); nsel.add(b.id);
  }
  sel = nsel; commit();
}

/* ---------- kéo / cắt mép / hút dính ---------- */
function snapPoints(ignore) {
  const pts = [0, T];
  for (const c of TL.clips) if (!ignore.has(c.id)) pts.push(c.start, c.start + c.dur);
  return pts;
}
function snapTo(t, pts) {
  if (!snapOn) return {t, hit: null};
  let best = null, bd = 8 / pps;
  for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best == null ? {t, hit: null} : {t: best, hit: best};
}
function showSnap(x) { const s = $('#snapline'); if (x == null) s.hidden = true; else { s.hidden = false; s.style.left = x * pps + 'px'; } }
function laneAtY(clientY) {
  const r = $('#lanes').getBoundingClientRect();
  const i = Math.floor((clientY - r.top) / trackH()) - 1; // hàng 0 là vùng track mới
  return {i, t: TL.tracks[i]};
}
function timeAtX(clientX) { const r = $('#canvas').getBoundingClientRect(); return Math.max(0, (clientX - r.left) / pps); }

function dragLoop(move, up) {
  const mm = (e) => move(e), mu = (e) => { removeEventListener('pointermove', mm); removeEventListener('pointerup', mu); showSnap(null); up(e); };
  addEventListener('pointermove', mm); addEventListener('pointerup', mu);
}

function startClipDrag(e, c, handle) {
  if (track(c.track).locked) return;
  const x0 = e.clientX, y0 = e.clientY;
  const group = TL.clips.filter((x) => sel.has(x.id) && !track(x.track).locked);
  const orig = new Map(group.map((x) => [x.id, {...x}]));
  const ids = new Set(group.map((x) => x.id));
  const pts = snapPoints(ids);
  const tracksIdx = new Map(TL.tracks.map((t, i) => [t.id, i]));
  const baseIdx = tracksIdx.get(c.track);
  let moved = false;
  dragLoop((ev) => {
    const dx = (ev.clientX - x0) / pps;
    if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
    moved = true;
    if (handle) {      // cắt mép (trim)
      const o = orig.get(c.id); const sp = c.speed || 1;
      if (handle === 'l') {
        let ns = snapTo(o.start + dx, pts); let s = ns.t;
        let minS = Math.max(0, o.start + o.dur - 50000);
        if (hasSrcLimit(c)) minS = Math.max(minS, o.start - (o.in || 0) / sp);
        s = clamp(s, minS, o.start + o.dur - 1 / fps());
        c.start = q(s); c.dur = q(o.start + o.dur - c.start);
        if (c.type !== 'text' && c.type !== 'image') c.in = Math.max(0, (o.in || 0) + (c.start - o.start) * sp);
        showSnap(ns.hit);
      } else {
        let ne = snapTo(o.start + o.dur + dx, pts); let e2 = ne.t;
        let maxE = Infinity;
        if (hasSrcLimit(c)) maxE = o.start + (c.srcDur - (o.in || 0)) / sp;
        e2 = clamp(e2, o.start + 1 / fps(), maxE);
        c.dur = q(e2 - o.start); showSnap(ne.hit);
      }
      // không đè lên clip khác cùng track
      const others = TL.clips.filter((x) => x.track === c.track && x.id !== c.id);
      for (const x of others) {
        if (handle === 'l' && x.start + x.dur <= o.start + 1e-4 && c.start < x.start + x.dur) { c.start = x.start + x.dur; c.dur = q(o.start + o.dur - c.start); if (c.type !== 'text' && c.type !== 'image') c.in = Math.max(0, (o.in || 0) + (c.start - o.start) * sp); }
        if (handle === 'r' && x.start >= o.start + o.dur - 1e-4 && c.start + c.dur > x.start) c.dur = q(x.start - c.start);
      }
    } else {           // di chuyển (có thể nhiều clip)
      const minStart = Math.min(...group.map((x) => orig.get(x.id).start));
      let d = Math.max(dx, -minStart);
      // hút dính theo mép đầu/cuối của clip đang nắm
      const o = orig.get(c.id);
      const a = snapTo(o.start + d, pts), b = snapTo(o.start + o.dur + d, pts);
      let hit = null;
      if (a.hit != null && (b.hit == null || Math.abs(a.t - o.start - d) <= Math.abs(b.t - o.start - o.dur - d))) { d = a.t - o.start; hit = a.hit; }
      else if (b.hit != null) { d = b.t - o.start - o.dur; hit = b.hit; }
      showSnap(hit);
      const lane = laneAtY(ev.clientY);
      const di = lane.t ? lane.i - baseIdx : 0;
      for (const x of group) {
        const ox = orig.get(x.id);
        x.start = q(Math.max(0, ox.start + d));
        const ti = tracksIdx.get(ox.track) + di;
        const nt = TL.tracks[ti];
        x.track = nt && fits(x, nt) && !nt.locked ? nt.id : ox.track;
      }
      $$('.lane').forEach((l) => l.classList.toggle('drop-ok', !!lane.t && l.dataset.t === lane.t.id && fits(c, lane.t)));
      // vùng "Thả vào track mới" trên cùng -> sẽ tạo track mới
      c._newTrack = !lane.t && lane.i < 0;
      $$('.lane.newzone').forEach((l) => l.classList.toggle('drop-ok', !!c._newTrack));
    }
    renderTimeline(); renderProps();
  }, () => {
    $$('.lane').forEach((l) => l.classList.remove('drop-ok'));
    if (!moved) return;
    if (!handle) {
      const newT = c._newTrack; delete c._newTrack;
      if (newT) { const t = newTrack('mixed', 0); for (const x of group) x.track = t.id; }
      // va chạm -> chuyển những clip bị đè sang track mới (như CapCut)
      for (const x of group) {
        if (overlaps(x.track, x.start, x.start + x.dur, ids)) {
          const idx = TL.tracks.findIndex((t) => t.id === x.track);
          const t = newTrack('mixed', TL.tracks[idx]?.kind === 'main' ? idx : idx + 1);
          x.track = t.id;
        }
      }
      gcTracks();
    }
    commit();
  });
}

/* ---------- sự kiện timeline ---------- */
function bindTimeline() {
  const lanes = $('#lanes');
  lanes.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const tb = e.target.closest('.tb');
    if (tb) { sel = new Set([tb.dataset.tr]); renderTimeline(); renderProps(); showTab('trans'); trPopover(tb.dataset.tr, e.clientX, e.clientY); return; }
    const el = e.target.closest('.clip');
    if (!el) {   // kéo khung chọn nhiều clip
      if (!(e.ctrlKey || e.shiftKey)) { sel.clear(); renderTimeline(); renderProps(); }
      return marquee(e);
    }
    const c = clip(el.dataset.id);
    if (e.ctrlKey || e.metaKey || e.shiftKey) { sel.has(c.id) ? sel.delete(c.id) : (sel.add(c.id), withGroups(sel)); renderTimeline(); renderProps(); return; }
    if (!sel.has(c.id)) { sel = withGroups(new Set([c.id])); renderTimeline(); renderProps(); }
    startClipDrag(e, c, e.target.dataset.h);
  });
  lanes.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.clip'); if (!el) return;
    e.preventDefault();
    if (!sel.has(el.dataset.id)) { sel = new Set([el.dataset.id]); renderTimeline(); renderProps(); }
    ctxMenu(e.clientX, e.clientY, [
      ['✂ Tách tại đầu phát', 'S', () => splitAt()],
      ['⧉ Nhân bản', 'Ctrl+D', duplicateSel],
      ['⇤ Đưa về đầu phát', '', () => { for (const c of TL.clips) if (sel.has(c.id)) c.start = T; commit(); }],
      ...(clip(el.dataset.id).type === 'video' ? [['♪⇣ Tách âm thanh', '', detachAudio]] : []),
      ['⇄ Chuyển cảnh…', '', () => showTab('trans')],
      ['🗑 Xoá', 'Del', () => deleteSel(), 'danger'],
      ['🗑⇤ Xoá và dồn', 'Shift+Del', () => deleteSel(true), 'danger'],
    ]);
  });
  // tua bằng thước
  $('#ruler').addEventListener('pointerdown', (e) => {
    const go = (ev) => seek(timeAtX(ev.clientX)); go(e); P()?.pause();
    dragLoop(go, () => {});
  });
  $('#playhead i').addEventListener('pointerdown', (e) => { e.stopPropagation(); P()?.pause(); dragLoop((ev) => seek(timeAtX(ev.clientX)), () => {}); });
  // đầu track
  $('#heads').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const t = track(b.closest('.head').dataset.t); t[b.dataset.act] = !t[b.dataset.act]; commit();
  });
  $('#heads').addEventListener('dblclick', (e) => {
    const n = e.target.closest('.tn'); if (!n) return;
    const t = track(n.closest('.head').dataset.t);
    const v = prompt('Tên track', t.name); if (v && v.trim()) { t.name = v.trim(); commit(); }
  });
  $('#heads').addEventListener('contextmenu', (e) => {
    const h = e.target.closest('.head'); if (!h || !h.dataset.t) return; e.preventDefault();
    const t = track(h.dataset.t), i = TL.tracks.indexOf(t);
    ctxMenu(e.clientX, e.clientY, [
      ['↑ Chuyển lên', '', () => { if (i > 0) { TL.tracks.splice(i, 1); TL.tracks.splice(i - 1, 0, t); commit(); } }],
      ['↓ Chuyển xuống', '', () => { if (i < TL.tracks.length - 1) { TL.tracks.splice(i, 1); TL.tracks.splice(i + 1, 0, t); commit(); } }],
      ['🗑 Xoá track', '', () => {
        if (TL.clips.some((c) => c.track === t.id) && !confirm('Xoá track và mọi clip trong đó?')) return;
        TL.clips = TL.clips.filter((c) => c.track !== t.id); TL.tracks.splice(i, 1); commit();
      }, 'danger'],
    ]);
  });
  $('#scroller').addEventListener('scroll', () => { $('#heads').scrollTop = $('#scroller').scrollTop; });
  // Ctrl + lăn chuột = zoom quanh con trỏ
  $('#scroller').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return; e.preventDefault();
    const tAt = timeAtX(e.clientX), sx = e.clientX - $('#scroller').getBoundingClientRect().left;
    setZoom(pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
    $('#scroller').scrollLeft = tAt * pps - sx;
  }, {passive: false});
  // thả media / chữ từ thư viện
  const sc = $('#scroller');
  sc.addEventListener('dragover', (e) => {
    e.preventDefault();
    const {t, i} = laneAtY(e.clientY);
    $$('.lane').forEach((l) => l.classList.toggle('drop-ok', l.classList.contains('newzone') ? i < 0 : !!t && l.dataset.t === t.id));
  });
  sc.addEventListener('dragleave', () => $$('.lane').forEach((l) => l.classList.remove('drop-ok')));
  sc.addEventListener('drop', (e) => {
    e.preventDefault(); $$('.lane').forEach((l) => l.classList.remove('drop-ok'));
    if (e.dataTransfer.files.length) return importFiles(e.dataTransfer.files);
    const at = q(timeAtX(e.clientX)), lane = laneAtY(e.clientY);
    let t = lane.t;
    const trn = e.dataTransfer.getData('x-tr');
    if (trn) {   // thả chuyển cảnh: chọn chỗ nối gần nhất
      const tAt = timeAtX(e.clientX); let best = null, bd = 1.5;
      for (const tr of TL.tracks) for (const c of joints(tr)) { const d = Math.abs(c.start - tAt); if (d < bd) { bd = d; best = c; } }
      if (!best) return toast('Thả gần chỗ nối giữa 2 clip (nút ◆)');
      best.transition = {type: trn, dur: trDur()}; sel = new Set([best.id]); return commit();
    }
    const mid = e.dataTransfer.getData('x-media'), tp = e.dataTransfer.getData('x-text');
    if ((mid || tp) && lane.i < 0) t = newTrack('mixed', 0); // thả lên vùng "track mới" trên cùng
    if (mid) addMedia(TL.media.find((m) => m.id === mid), at, t?.id);
    else if (tp) addText(TEXT_PRESETS[+tp], at, t?.id);
  });
}
function marquee(e) {
  const cv = $('#canvas').getBoundingClientRect();
  const x0 = e.clientX - cv.left, y0 = e.clientY - cv.top;
  const box = document.createElement('div'); box.className = 'marquee'; $('#canvas').append(box);
  const base = new Set(sel);
  let moved = false;
  dragLoop((ev) => {
    const r = $('#canvas').getBoundingClientRect();
    const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 4) moved = true;
    const L = Math.min(x0, x1), Tp = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
    Object.assign(box.style, {left: L + 'px', top: Tp + 'px', width: W + 'px', height: H + 'px'});
    sel = new Set(base);
    TL.clips.forEach((c) => {
      const i = TL.tracks.findIndex((t) => t.id === c.track);
      const cy = laneTop(i), cx = c.start * pps, cw = c.dur * pps;
      if (cx < L + W && cx + cw > L && cy < Tp + H && cy + trackH() > Tp) sel.add(c.id);
    });
    $$('.clip').forEach((el) => el.classList.toggle('sel', sel.has(el.dataset.id)));
  }, (ev) => {
    box.remove();
    if (!moved) { seek(timeAtX(ev.clientX)); }
    renderTimeline(); renderProps();
  });
}
/** Bảng chỉnh chuyển cảnh bật ngay tại nút ◆: chọn kiểu, độ dài, bỏ hiệu ứng. */
function trPopover(id, x, y) {
  $$('.ctx').forEach((m) => m.remove());
  const c = clip(id); if (!c) return;
  const cur = c.transition?.type || 'none', dur = c.transition?.dur ?? 0.5;
  const m = document.createElement('div'); m.className = 'ctx trpop';
  m.innerHTML = `<div class="trp-h">Chuyển cảnh tại ${c.start.toFixed(2)}s</div>
    <div class="trp-grid">${TRANS.map(([k, ic, n]) => `<button data-k="${k}" class="${k === cur ? 'on' : ''}" title="${n}"><i>${ic}</i><small>${n}</small></button>`).join('')}</div>
    <label class="trp-d">Thời lượng <input type="range" min="0.1" max="2" step="0.1" value="${dur}"><b>${dur.toFixed(1)}s</b></label>
    <div class="trp-f"><button data-all>Áp dụng cho mọi chỗ nối</button></div>`;
  const rng = m.querySelector('input');
  const set = (k) => { c.transition = k === 'none' ? undefined : {type: k, dur: parseFloat(rng.value)}; commit(); };
  m.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
    m.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); set(b.dataset.k);
  }));
  rng.oninput = () => { m.querySelector('b').textContent = (+rng.value).toFixed(1) + 's'; if (c.transition) { c.transition.dur = +rng.value; pushPlayer(); } };
  rng.onchange = () => { if (c.transition) commit(); };
  m.querySelector('[data-all]').onclick = () => {
    const k = c.transition?.type || 'none';
    for (const t of TL.tracks) for (const j of joints(t)) j.transition = k === 'none' ? undefined : {type: k, dur: +rng.value};
    commit(); toast(`Đã áp dụng "${trName(k)}" cho mọi chỗ nối`); m.remove();
  };
  document.body.append(m);
  m.style.left = Math.max(8, Math.min(x - m.offsetWidth / 2, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, y - m.offsetHeight - 14) + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off); } }), 0);
}
function ctxMenu(x, y, items) {
  $$('.ctx').forEach((m) => m.remove());
  const m = document.createElement('div'); m.className = 'ctx';
  items.forEach(([label, key, fn, cls]) => {
    const b = document.createElement('button'); b.className = cls || '';
    b.innerHTML = `<span>${label}</span><small>${key}</small>`;
    b.onclick = () => { m.remove(); fn(); }; m.append(b);
  });
  document.body.append(m);
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off); } }), 0);
}
function setZoom(v) {
  pps = clamp(v, 4, 600);
  $('#zoom').value = Math.round(Math.log(pps / 4) / Math.log(150) * 100);
  renderTimeline();
}
function zoomFit() { setZoom(($('#scroller').clientWidth - 40) / duration()); $('#scroller').scrollLeft = 0; }

/* ---------- thư viện media ---------- */
function probe(file) {   // đọc thời lượng/kích thước + ảnh thu nhỏ ngay trong trình duyệt
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const type = file.type.split('/')[0];
    if (type === 'image') { const i = new Image(); i.onload = () => res({width: i.naturalWidth, height: i.naturalHeight}); i.onerror = () => res({}); i.src = url; return; }
    const el = document.createElement(type === 'video' ? 'video' : 'audio');
    el.preload = 'metadata'; el.muted = true; el.src = url;
    el.onerror = () => res({});
    el.onloadedmetadata = () => {
      const info = {duration: Math.round(el.duration * 1000) / 1000, width: el.videoWidth, height: el.videoHeight};
      if (type !== 'video') return res(info);
      el.currentTime = Math.min(1, el.duration / 3);
      el.onseeked = () => {
        try { const c = document.createElement('canvas'); c.height = 72; c.width = Math.round(72 * el.videoWidth / el.videoHeight) || 128; c.getContext('2d').drawImage(el, 0, 0, c.width, c.height); info.thumb = c.toDataURL('image/jpeg', 0.6); } catch {}
        res(info);
      };
    };
  });
}
async function importFiles(files) {
  for (const f of files) {
    const type = f.type.split('/')[0];
    if (!['video', 'image', 'audio'].includes(type)) { toast('Bỏ qua: ' + f.name); continue; }
    const ph = {id: 'up' + uid(), name: f.name, type, loading: true};
    TL.media.push(ph); renderMedia();
    try {
      const [info, up] = await Promise.all([probe(f), (() => { const fd = new FormData(); fd.append('file', f); return apiCall(`/api/jobs/${JOB}/media`, {method: 'POST', body: fd}); })()]);
      Object.assign(ph, up, info, {loading: false});
      delete ph.loading;
      // dự án trống: lấy khung hình theo video đầu tiên
      if (!TL.clips.length && type === 'video' && info.width && TL.media.filter((m) => m.type === 'video' && !m.loading).length === 1) {
        if (confirm(`Đặt khung hình dự án theo video này (${info.width}×${info.height})?`)) { TL.width = info.width - info.width % 2; TL.height = info.height - info.height % 2; }
      }
    } catch (e) { TL.media.splice(TL.media.indexOf(ph), 1); toast('Lỗi tải lên ' + f.name + ': ' + e.message, 4000); }
    renderMedia(); commit();
  }
}
function renderMedia() {
  $('#mgrid').innerHTML = TL.media.map((m) => `<div class="mi ${m.loading ? 'loading' : ''}" draggable="${!m.loading}" data-id="${m.id}" title="${esc(m.name)}">
    ${m.type === 'image' && m.src ? `<img src="/media/${encodeURI(m.src)}">` : m.type === 'video' ? (m.thumb ? `<img src="${m.thumb}">` : m.src ? `<video src="/media/${encodeURI(m.src)}#t=1" preload="metadata" muted></video>` : '<div class="aud">🎞</div>') : '<div class="aud">♪</div>'}
    ${m.duration ? `<span class="mdur">${fmt(m.duration, false)}</span>` : ''}
    ${m.loading ? '' : '<button class="madd" title="Thêm vào timeline tại đầu phát">+</button>'}
    <span class="mname">${m.loading ? '⏳ ' : ''}${esc(m.name)}</span></div>`).join('') || '<p style="color:var(--dim);grid-column:span 2;text-align:center">Chưa có media</p>';
}
function bindLibrary() {
  $$('.tabs button').forEach((b) => b.onclick = () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tabbody').forEach((x) => x.hidden = x.dataset.body !== b.dataset.tab);
  });
  $('#file').onchange = (e) => { importFiles(e.target.files); e.target.value = ''; };
  const d = $('#drop');
  d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); importFiles(e.dataTransfer.files); };
  $('#mgrid').addEventListener('dragstart', (e) => { const mi = e.target.closest('.mi'); if (mi) e.dataTransfer.setData('x-media', mi.dataset.id); });
  $('#mgrid').addEventListener('click', (e) => { if (e.target.classList.contains('madd')) addMedia(TL.media.find((m) => m.id === e.target.closest('.mi').dataset.id)); });
  $('#mgrid').addEventListener('contextmenu', (e) => {
    const mi = e.target.closest('.mi'); if (!mi) return; e.preventDefault();
    const m = TL.media.find((x) => x.id === mi.dataset.id);
    ctxMenu(e.clientX, e.clientY, [
      ['+ Thêm tại đầu phát', '', () => addMedia(m)],
      ['🗑 Bỏ khỏi thư viện', '', () => {
        const used = TL.clips.filter((c) => c.src === m.src).length;
        if (used && !confirm(`Media đang dùng trong ${used} clip. Xoá cả các clip đó?`)) return;
        TL.clips = TL.clips.filter((c) => c.src !== m.src); TL.media.splice(TL.media.indexOf(m), 1); renderMedia(); commit();
      }, 'danger'],
    ]);
  });
  $('#tpresets').innerHTML = TEXT_PRESETS.map((p, i) => `<div class="tp" draggable="true" data-i="${i}"><span class="demo" style="color:${p.st.color || '#fff'};${p.st.bgColor ? `background:${p.st.bgColor};padding:1px 8px;border-radius:${p.st.bgRadius ? 12 : 3}px;` : ''}${p.st.strokeWidth ? `-webkit-text-stroke:2px ${p.st.strokeColor};paint-order:stroke fill;` : ''}${p.st.italic ? 'font-style:italic;' : ''}${p.st.accentColor && p.st.animIn === 'glow' ? `text-shadow:0 0 8px ${p.st.accentColor};` : ''}">${p.name}</span><small>${p.sub} · nhấp để thêm</small></div>`).join('');
  $('#tpresets').addEventListener('dragstart', (e) => { const t = e.target.closest('.tp'); if (t) e.dataTransfer.setData('x-text', t.dataset.i); });
  $('#tpresets').addEventListener('click', (e) => { const t = e.target.closest('.tp'); if (t) addText(TEXT_PRESETS[+t.dataset.i]); });
}

/* ---------- bảng thuộc tính ---------- */
const FONTS = ['Arial Black, Arial, sans-serif', 'Arial, sans-serif', 'Impact, sans-serif', 'Georgia, serif', 'Times New Roman, serif', 'Segoe UI, sans-serif', 'Tahoma, sans-serif', 'Verdana, sans-serif', 'Trebuchet MS, sans-serif', 'Palatino Linotype, serif', 'Courier New, monospace', 'Comic Sans MS, cursive', 'Be Vietnam Pro, sans-serif', 'Montserrat, sans-serif', 'Roboto, sans-serif', 'Open Sans, sans-serif', 'Nunito, sans-serif', 'Lexend, sans-serif', 'Josefin Sans, sans-serif', 'Quicksand, sans-serif', 'Comfortaa, cursive', 'Oswald, sans-serif', 'Anton, sans-serif', 'Baloo 2, cursive', 'Playfair Display, serif', 'Merriweather, serif', 'Noto Serif, serif', 'Lobster, cursive', 'Pacifico, cursive', 'Dancing Script, cursive', 'Great Vibes, cursive', 'Charm, cursive', 'Pattaya, sans-serif', 'Patrick Hand, cursive', 'Sigmar, cursive'];
const RATIOS = [['16:9', 1920, 1080], ['9:16', 1080, 1920], ['1:1', 1080, 1080], ['4:5', 1080, 1350], ['4:3', 1440, 1080], ['21:9', 2560, 1080]];
function field(label, key, type, opt = {}) {   // key dạng 'volume' hoặc 'title.fontSize'
  return {label, key, type, ...opt};
}
function getK(o, k) { return k.split('.').reduce((a, p) => a?.[p], o); }
function setK(o, k, v) { const ps = k.split('.'); const last = ps.pop(); const t = ps.reduce((a, p) => (a[p] ??= {}), o); t[last] = v; }
function rowHTML(f, v) {
  const id = 'f_' + f.key.replace('.', '_');
  let ctl = '';
  if (f.type === 'range') ctl = `<input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v ?? f.def}" data-k="${f.key}" data-n><input type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${v ?? f.def}" data-k="${f.key}" data-n>`;
  else if (f.type === 'number') ctl = `<input type="number" step="${f.step || 0.01}" min="${f.min ?? ''}" value="${v ?? f.def ?? 0}" data-k="${f.key}" data-n>`;
  else if (f.type === 'color') ctl = `<input type="color" value="${v ?? f.def}" data-k="${f.key}"><span style="color:var(--dim);font-size:11px">${v ?? f.def}</span>`;
  else if (f.type === 'check') ctl = `<input type="checkbox" ${v ?? f.def ? 'checked' : ''} data-k="${f.key}" data-b>`;
  else if (f.type === 'select') ctl = `<select data-k="${f.key}">${f.opts.map(([a, b]) => `<option value="${esc(a)}" ${f.key.endsWith('fontFamily') ? `style="font-family:${esc(a)}"` : ''} ${String(v ?? f.def) === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') ctl = `<textarea rows="2" data-k="${f.key}">${esc(v ?? '')}</textarea>`;
  else ctl = `<input type="text" value="${esc(v ?? '')}" data-k="${f.key}">`;
  return `<div class="row"><label for="${id}">${f.label}</label><div class="ctl">${ctl}</div></div>`;
}
function groupHTML(title, fields, obj) { return `<h4>${title}</h4>` + fields.map((f) => rowHTML(f, getK(obj, f.key))).join(''); }

function renderProps() {
  const box = $('#props');
  drawOverlay();
  const cs = TL.clips.filter((c) => sel.has(c.id));
  if (document.activeElement && box.contains(document.activeElement) && box._for === [...sel].join()) return; // đang gõ -> không vẽ lại
  box._for = [...sel].join();
  if (cs.length > 1) {
    box.innerHTML = `<h3>${cs.length} clip đã chọn</h3><div class="btnrow"><button class="ghost" data-do="split">✂ Tách</button><button class="ghost" data-do="dup">⧉ Nhân bản</button><button class="ghost danger" data-do="del">🗑 Xoá</button></div>
      <p class="hint">Kéo một clip để di chuyển cả nhóm. Ctrl/Shift + nhấp để thêm/bớt.</p>`;
    // chỉnh phông / màu cho cả loạt khối chữ & câu lời đang chọn (Ctrl+A hoặc quét chọn)
    const tx = cs.filter((c) => c.type === 'text'), ly = cs.filter((c) => c.type === 'lyrics');
    if (tx.length) box.innerHTML += groupHTML(`Chữ – áp dụng cho ${tx.length} khối chữ`, [
      field('Phông', 'title.fontFamily', 'select', {opts: FONTS.map((f) => [f, f.split(',')[0]])}),
      field('Cỡ chữ', 'title.fontSize', 'range', {min: 12, max: 400, step: 1}),
      field('Màu chữ', 'title.color', 'color'), field('Màu nhấn', 'title.accentColor', 'color'),
      field('Màu viền', 'title.strokeColor', 'color', {def: '#000000'}), field('Độ dày viền', 'title.strokeWidth', 'range', {min: 0, max: 30, step: 1, def: 0}),
    ], tx[0]);
    if (ly.length) box.innerHTML += groupHTML('Phụ đề – áp dụng cho mọi câu lời', [
      field('Phông', 'subtitle.fontFamily', 'select', {opts: FONTS.map((f) => [f, f.split(',')[0]])}),
      field('Cỡ chữ', 'subtitle.fontSize', 'range', {min: 12, max: 200, step: 1}),
      field('Màu chữ', 'subtitle.color', 'color'), field('Màu tô', 'subtitle.highlightColor', 'color'),
      field('Màu viền', 'subtitle.strokeColor', 'color'), field('Độ dày viền', 'subtitle.strokeWidth', 'range', {min: 0, max: 16, step: 1}),
    ], ly[0]);
    return;
  }
  if (!cs.length) {
    const rk = RATIOS.find((r) => r[1] === TL.width && r[2] === TL.height);
    box.innerHTML = `<h3>Dự án</h3>` + rowHTML(field('Khung hình', '_ratio', 'select', {opts: [...RATIOS.map((r) => [r[0], `${r[0]} (${r[1]}×${r[2]})`]), ...(rk ? [] : [['', `Tuỳ chỉnh ${TL.width}×${TL.height}`]])]}), rk ? rk[0] : '')
      + rowHTML(field('Màu nền', 'background', 'color'), TL.background)
      + rowHTML(field('FPS', 'fps', 'select', {opts: [[24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']]}), TL.fps)
      + `<p class="hint">Thời lượng: ${fmt(duration())} · ${TL.clips.length} clip · ${TL.tracks.length} track</p>
      <p class="hint">Mẹo: kéo media vào timeline, nhấp clip để chỉnh. Nhấn <b>S</b> để tách, <b>Del</b> để xoá, <b>Space</b> để phát.</p>`;
    return;
  }
  const c = cs[0];
  let h = `<h3>${esc(c.name || LABEL[c.type])} <span class="badge">${LABEL[c.type]}</span></h3>`;
  h += groupHTML('Thời gian', [field('Bắt đầu (s)', 'start', 'number', {min: 0}), field('Độ dài (s)', 'dur', 'number', {min: 0.05}),
    ...(c.type === 'video' || c.type === 'audio' ? [field('Tốc độ', 'speed', 'select', {def: 1, opts: [[0.25, '0.25x'], [0.5, '0.5x'], [0.75, '0.75x'], [1, '1x'], [1.25, '1.25x'], [1.5, '1.5x'], [2, '2x'], [3, '3x'], [4, '4x']]}), field('Lặp lại', 'loop', 'check')] : [])], c);
  if (c.type === 'video' || c.type === 'audio') h += groupHTML('Âm thanh', [field('Âm lượng', 'volume', 'range', {min: 0, max: 2, step: 0.05, def: 1})], c);
  if (c.type !== 'lyrics' && c.type !== 'text') h += groupHTML('Mờ vào / ra', [field('Mờ vào (s)', 'fadeIn', 'range', {min: 0, max: 5, step: 0.1, def: 0}), field('Mờ ra (s)', 'fadeOut', 'range', {min: 0, max: 5, step: 0.1, def: 0})], c);
  if (c.type === 'video' || c.type === 'image') h += groupHTML('Hình ảnh', [
    field('Kiểu khớp', 'fit', 'select', {def: 'cover', opts: [['cover', 'Phủ kín (cắt viền)'], ['contain', 'Vừa khung (viền đen)']]}),
    field('Phóng to', 'scale', 'range', {min: 0.1, max: 4, step: 0.01, def: 1}),
    field('Vị trí X %', 'x', 'range', {min: -50, max: 150, step: 0.5, def: 50}),
    field('Vị trí Y %', 'y', 'range', {min: -50, max: 150, step: 0.5, def: 50}),
    field('Xoay °', 'rotation', 'range', {min: -180, max: 180, step: 1, def: 0}),
    field('Độ trong', 'opacity', 'range', {min: 0, max: 1, step: 0.01, def: 1}),
    field('Làm tối', 'dim', 'range', {min: 0, max: 0.9, step: 0.01, def: 0}),
    field('Ken Burns', 'kenBurns', 'check'),
    ...((c.fit ?? 'cover') === 'contain' ? [field('Nền mờ', 'bgBlur', 'range', {min: 0, max: 80, step: 1, def: 0})] : []),
  ], c) + `<div class="btnrow"><button class="ghost" data-do="reset-tf">↺ Đặt lại vị trí</button></div>`;
  if (c.type === 'video' || c.type === 'image') h += groupHTML('Chỉnh màu clip này', [
    field('Độ sáng', 'adjust.brightness', 'range', {min: -100, max: 100, step: 1, def: 0}),
    field('Tương phản', 'adjust.contrast', 'range', {min: -100, max: 100, step: 1, def: 0}),
    field('Bão hoà', 'adjust.saturation', 'range', {min: -100, max: 100, step: 1, def: 0}),
    field('Nhiệt độ màu', 'adjust.temperature', 'range', {min: -100, max: 100, step: 1, def: 0}),
    field('Sắc độ', 'adjust.tint', 'range', {min: -100, max: 100, step: 1, def: 0}),
    field('Xoay tông', 'adjust.hue', 'range', {min: -180, max: 180, step: 1, def: 0}),
    field('Phai màu', 'adjust.fade', 'range', {min: 0, max: 100, step: 1, def: 0}),
    field('Tối viền', 'adjust.vignette', 'range', {min: 0, max: 100, step: 1, def: 0}),
  ], c) + `<div class="btnrow"><button class="ghost" data-do="adj-reset">↺ Đặt lại màu</button><button class="ghost" data-do="adj-all">Áp màu này cho mọi clip</button></div>
    <p class="hint">Cộng thêm vào bộ lọc chung của cả video (tab Bộ lọc).</p>`;
  if (c.type === 'text') {
    const ti = c.title;
    h += groupHTML('Chữ', [
      field('Nội dung', 'title.text', 'textarea'), field('Dòng phụ', 'title.subtext', 'text'),
      field('Phông', 'title.fontFamily', 'select', {opts: FONTS.map((f) => [f, f.split(',')[0]])}),
      field('Cỡ chữ', 'title.fontSize', 'range', {min: 12, max: 400, step: 1}),
      field('Màu chữ', 'title.color', 'color'), field('Màu nhấn', 'title.accentColor', 'color'),
      field('Căn lề', 'title.align', 'select', {def: 'center', opts: [['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']]}),
      field('In đậm', 'title.bold', 'check', {def: true}), field('In nghiêng', 'title.italic', 'check'), field('VIẾT HOA', 'title.uppercase', 'check'),
      field('Giãn chữ', 'title.letterSpacing', 'range', {min: -10, max: 50, step: 1, def: 0}),
    ], c);
    h += groupHTML('Viền · bóng · nền', [
      field('Màu viền', 'title.strokeColor', 'color', {def: '#000000'}), field('Độ dày viền', 'title.strokeWidth', 'range', {min: 0, max: 30, step: 1, def: 0}),
      field('Đổ bóng', 'title.shadow', 'check', {def: true}),
      field('Màu nền', 'title.bgColor', 'color', {def: '#000000'}), field('Độ đậm nền', 'title.bgOpacity', 'range', {min: 0, max: 1, step: 0.05, def: 0}),
      field('Bo góc', 'title.bgRadius', 'range', {min: 0, max: 200, step: 1, def: Math.round(ti.fontSize * 0.15)}),
    ], c);
    h += groupHTML('Vị trí', [
      field('Ngang X %', 'title.x', 'range', {min: 0, max: 100, step: 0.5, def: 50}),
      field('Dọc Y %', 'title.y', 'range', {min: 0, max: 100, step: 0.5}),
      field('Xoay °', 'rotation', 'range', {min: -180, max: 180, step: 1, def: 0}),
      field('Độ trong', 'opacity', 'range', {min: 0, max: 1, step: 0.01, def: 1}),
    ], c) + '<p class="hint">Mẹo: kéo khung chữ ngay trên màn hình xem trước để di chuyển.</p>';
    h += groupHTML('Hiệu ứng', [
      field('Vào', 'title.animIn', 'select', {def: ti.animation || 'fade', opts: ANIM_IN.filter((a) => !a[0].startsWith('word-'))}),
      field('Thời lượng vào', 'title.inDur', 'range', {min: 0.1, max: 3, step: 0.1, def: 0.5}),
      field('Ra', 'title.animOut', 'select', {def: 'fade', opts: ANIM_OUT}),
      field('Thời lượng ra', 'title.outDur', 'range', {min: 0.1, max: 3, step: 0.1, def: 0.5}),
    ], c);
  }
  if (c.type === 'cover') h += groupHTML('Lớp che mờ', [
    field('Độ mờ', 'blur', 'range', {min: 0, max: 60, step: 1, def: 14}),
    field('Độ tối', 'darken', 'range', {min: 0, max: 0.9, step: 0.01, def: 0.15}),
    field('Mềm viền', 'feather', 'range', {min: 0, max: 1, step: 0.02, def: 0.3}),
    field('Tâm X %', 'x', 'range', {min: 0, max: 100, step: 0.5, def: 50}), field('Tâm Y %', 'y', 'range', {min: 0, max: 100, step: 0.5, def: 85}),
    field('Rộng %', 'w', 'range', {min: 2, max: 100, step: 0.5, def: 80}), field('Cao %', 'h', 'range', {min: 2, max: 100, step: 0.5, def: 14}),
  ], c) + `<div class="btnrow"><button class="ghost" data-do="cover-all">⛶ Phủ cả khung</button><button class="ghost" data-do="cover-full">↔ Kéo dài hết video</button></div>
    <p class="hint">Kéo khung trên màn hình xem trước để di chuyển, chấm góc để đổi kích thước. Dùng để che phụ đề / logo có sẵn trong clip.</p>`;
  if (c.type === 'lyrics') h += groupHTML('Phụ đề lời bài hát', [
    field('Kiểu', 'subtitle.mode', 'select', {opts: [['karaoke', 'Karaoke (tô màu)'], ['preview', 'Hiện dần từng chữ'], ['full', 'Cả câu']]}),
    field('Phông', 'subtitle.fontFamily', 'select', {opts: FONTS.map((f) => [f, f.split(',')[0]])}),
    field('Cỡ chữ', 'subtitle.fontSize', 'range', {min: 12, max: 200, step: 1}),
    field('Màu chữ', 'subtitle.color', 'color'), field('Màu tô', 'subtitle.highlightColor', 'color'),
    field('Màu viền', 'subtitle.strokeColor', 'color'), field('Độ dày viền', 'subtitle.strokeWidth', 'range', {min: 0, max: 16, step: 1}),
    field('Vị trí', 'subtitle.position', 'select', {opts: [['bottom', 'Dưới'], ['center', 'Giữa'], ['top', 'Trên']]}),
    field('Viết hoa', 'subtitle.uppercase', 'check'),
    field('Hiệu ứng vào', 'subtitle.animIn', 'select', {def: '', opts: [['', 'Mặc định (trồi nhẹ)'], ...ANIM_IN.filter((a) => a[0] !== 'typewriter' && a[0] !== 'none'), ['none', 'Không']]}),
    field('Thời lượng vào', 'subtitle.inDur', 'range', {min: 0.1, max: 2, step: 0.05, def: 0.3}),
    field('Hiệu ứng ra', 'subtitle.animOut', 'select', {def: 'fade', opts: ANIM_OUT}),
    field('Thời lượng ra', 'subtitle.outDur', 'range', {min: 0.1, max: 2, step: 0.05, def: 0.15}),
    
  ], c) + lyricsEditorHTML(c);
  if (c.type !== 'audio' && c.type !== 'lyrics') {
    h += groupHTML('Chuyển cảnh vào', [field('Kiểu', 'transition.type', 'select', {def: 'none', opts: TRANS.map(([k, , n]) => [k, n])}),
      field('Thời lượng', 'transition.dur', 'range', {min: 0.1, max: 2, step: 0.1, def: 0.5})], c);
    if (!prevOf(c)) h += '<p class="hint">Clip này không nối liền clip trước – chuyển cảnh sẽ hiện ra từ nền.</p>';
  }
  h += `<div class="btnrow" style="margin-top:14px"><button class="ghost" data-do="split">✂ Tách</button><button class="ghost" data-do="dup">⧉ Nhân bản</button><button class="ghost danger" data-do="del">🗑 Xoá</button></div>`;
  box.innerHTML = h;
}
/* ---------- lời bài hát: MỖI CÂU LÀ 1 CLIP riêng (giống phụ đề của Reup Studio) ----------
   Clip câu: type 'lyrics', lines = [1 câu]. Giờ câu tính theo "giờ nguồn" in..in+dur của clip,
   nên kéo clip = dời câu, kéo mép = co giãn câu (giờ từng chữ karaoke co giãn theo). */
const lyClip = () => TL.clips.find((x) => sel.has(x.id) && x.type === 'lyrics');
const r2 = (v) => Math.round(v * 100) / 100;
const lineText = (l) => (l?.words || []).map((w) => w.text).join(' ');
function rescale(l, s, e) {     // co giãn giờ từng chữ theo khoảng mới
  const os = l.start, k = (e - s) / Math.max(0.01, l.end - os);
  for (const w of l.words) { w.start = r2(s + (w.start - os) * k); w.end = r2(s + (w.end - os) * k); }
  l.start = r2(s); l.end = r2(e);
}
function setWords(l, text) {
  const ws = text.split(/\s+/).filter(Boolean);
  if (ws.length === l.words.length) { ws.forEach((t, i) => (l.words[i].text = t)); return; }
  const tot = ws.reduce((a, t) => a + t.length + 1, 0); let t0 = l.start;
  l.words = ws.map((t) => { const d = (l.end - l.start) * (t.length + 1) / tot; const w = {text: t, start: r2(t0), end: r2(t0 + d)}; t0 += d; return w; });
}
// clip lời nhiều câu (dự án cũ) -> mỗi câu 1 clip
function explodeLyrics() {
  const out = [];
  for (const c of TL.clips) {
    if (c.type !== 'lyrics' || (c.lines?.length || 0) <= 1) { out.push(c); continue; }
    const a = c.in || 0, b = a + c.dur;
    for (const l0 of c.lines) {
      const s = Math.max(l0.start, a), e = Math.min(l0.end, b);
      if (e - s < 0.05 || !l0.words?.length) continue;
      const l = JSON.parse(JSON.stringify(l0));
      out.push({...JSON.parse(JSON.stringify(c)), id: uid(), start: q(c.start + s - a), dur: q(e - s), in: s, lines: [l], name: lineText(l)});
    }
  }
  TL.clips = out;
}
// giữ câu khớp đúng khung clip sau mọi thao tác kéo / cắt mép / sửa số
function syncLyrics() {
  for (const c of TL.clips) {
    if (c.type !== 'lyrics' || c.lines?.length !== 1) continue;
    const l = c.lines[0], a = c.in || 0, b = a + c.dur;
    if (Math.abs(l.start - a) > 0.005 || Math.abs(l.end - b) > 0.005) rescale(l, a, b);
    c.name = lineText(l);
  }
}
// tách 1 clip câu tại giờ nguồn st: chia chữ theo giờ hát
function splitLyricClip(c, b, st) {
  const l = c.lines[0], ws = l.words;
  let n = ws.findIndex((w) => (w.start + w.end) / 2 >= st);
  if (n <= 0) n = Math.round(ws.length * (st - l.start) / Math.max(0.01, l.end - l.start));
  n = clamp(n, ws.length > 1 ? 1 : 0, ws.length > 1 ? ws.length - 1 : 1);
  const right = {start: r2(st), end: l.end, words: ws.slice(n)};
  l.words = ws.slice(0, n); l.end = r2(st);
  if (!l.words.length) l.words = [{text: '…', start: l.start, end: l.end}];
  if (!right.words.length) right.words = [{text: '…', start: right.start, end: right.end}];
  l.words.at(-1).end = Math.min(l.words.at(-1).end, st); right.words[0].start = Math.max(right.words[0].start, st);
  b.lines = [right];
}
function lyricsEditorHTML(c) {
  return `<h4>Nội dung câu</h4>
    <textarea rows="3" style="width:100%;box-sizing:border-box" data-lf="text">${esc(lineText(c.lines?.[0]))}</textarea>
    <div class="btnrow"><button class="ghost" data-ly="add">＋ Thêm câu tại đầu phát</button></div>
    <p class="hint">Mỗi câu là 1 khối trên track lời: kéo để dời, kéo 2 mép để đổi giờ bắt đầu/kết thúc, <b>S</b> để tách câu tại đầu phát, <b>Del</b> để xoá. Kiểu chữ đổi ở đây áp dụng cho mọi câu.</p>`;
}
function lyricsField(el) {
  const c = lyClip(); if (!c) return;
  const v = el.value.trim();
  if (!v) { TL.clips = TL.clips.filter((x) => x !== c); sel.clear(); }
  else setWords(c.lines[0], v);
  $('#props')._for = null; commit();
}
function lyricsAction(a) {
  const c = lyClip(); if (!c || a !== 'add') return;
  const busy = TL.clips.some((x) => x.track === c.track && T >= x.start && T < x.start + x.dur - 0.01);
  if (busy) return toast('Đầu phát đang nằm trên một câu – dời đầu phát ra khoảng trống trên track lời');
  const nx = TL.clips.filter((x) => x.track === c.track && x.start > T).sort((x, y) => x.start - y.start)[0];
  const dur = q(Math.min(2, nx ? nx.start - T : 2));
  if (dur < 0.2) return toast('Khoảng trống quá ngắn để thêm câu');
  const s = r2(T), m = r2(T + dur / 2), e = r2(T + dur);
  const n = {...JSON.parse(JSON.stringify(c)), id: uid(), start: q(T), dur, in: s,
    lines: [{start: s, end: e, words: [{text: 'Lời', start: s, end: m}, {text: 'mới', start: m, end: e}]}]};
  TL.clips.push(n); sel = new Set([n.id]); $('#props')._for = null; commit();
}
/* ---------- công cụ kiểu Reup Studio: nhóm, + câu lời, + lớp che mờ, tab Phụ đề / Âm lượng / Khung hình ---------- */
const DEF_SUB = {mode: 'karaoke', lookahead: 2, leadIn: 0.6, fontFamily: 'Arial Black, Arial, sans-serif', fontSize: 70, color: '#ffffff',
  highlightColor: '#ffd23f', strokeColor: '#000000', strokeWidth: 6, position: 'bottom', uppercase: false};
function withGroups(ids) {      // mở rộng lựa chọn ra cả nhóm
  const gs = new Set(TL.clips.filter((c) => ids.has(c.id) && c.group).map((c) => c.group));
  if (gs.size) TL.clips.forEach((c) => { if (c.group && gs.has(c.group)) ids.add(c.id); });
  return ids;
}
function groupSel() {
  if (sel.size < 2) return toast('Ctrl/Shift + nhấp để chọn từ 2 khối trở lên rồi bấm Nhóm');
  const g = 'g' + uid(); TL.clips.forEach((c) => { if (sel.has(c.id)) c.group = g; });
  commit(); toast(`🔗 Đã nhóm ${sel.size} khối – kéo 1 khối là cả nhóm đi theo`);
}
function ungroupSel() {
  let n = 0; TL.clips.forEach((c) => { if (sel.has(c.id) && c.group) { delete c.group; n++; } });
  if (!n) return toast('Khối đang chọn không thuộc nhóm nào');
  commit(); toast('⛓ Đã bỏ nhóm');
}
function addLyricLine() {
  const ref = TL.clips.find((c) => c.type === 'lyrics');
  const tr = ref && !overlaps(ref.track, T, T + 2, new Set()) && !track(ref.track).locked ? track(ref.track) : freeTrack('lyrics', T, T + 2);
  const nx = TL.clips.filter((x) => x.track === tr.id && x.start > T).sort((a, b) => a.start - b.start)[0];
  const dur = q(Math.min(2, nx ? nx.start - T : 2)); if (dur < 0.2) return toast('Khoảng trống quá ngắn để thêm câu');
  const s = r2(T), m = r2(T + dur / 2), e = r2(T + dur);
  const c = {id: uid(), track: tr.id, type: 'lyrics', start: q(T), dur, in: s, name: 'Lời mới',
    subtitle: JSON.parse(JSON.stringify(ref?.subtitle || DEF_SUB)),
    lines: [{start: s, end: e, words: [{text: 'Lời', start: s, end: m}, {text: 'mới', start: m, end: e}]}]};
  TL.clips.push(c); sel = new Set([c.id]); showRTab('props'); commit();
}
function addCover() {
  const tr = TL.tracks.find((t) => t.kind !== 'main' && !t.locked && !overlaps(t.id, T, T + 3, new Set()) && TL.tracks.indexOf(t) < TL.tracks.findIndex((x) => x.kind === 'main')) || newTrack('mixed', 0);
  const c = {id: uid(), track: tr.id, type: 'cover', start: q(T), dur: 3, name: 'Lớp che mờ', x: 50, y: 85, w: 80, h: 14, blur: 14, darken: 0.15, feather: 0.3};
  TL.clips.push(c); sel = new Set([c.id]); showRTab('props'); commit();
  toast('Kéo khung trên màn hình xem trước để di chuyển, chấm góc để đổi kích thước');
}

/* ---- tab bên phải ---- */
let rtab = 'props';
function showRTab(n) {
  rtab = n;
  $$('.rtabs button').forEach((b) => b.classList.toggle('on', b.dataset.rtab === n));
  $('#props').hidden = n !== 'props';
  $$('.rbody').forEach((b) => (b.hidden = b.dataset.rbody !== n));
  renderSide(true);
}
function renderSide(force) {
  if (rtab === 'props') return;
  const box = $(`.rbody[data-rbody="${rtab}"]`);
  if (!force && box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
  let h = '';
  if (rtab === 'style') {
    const ly = TL.clips.filter((c) => c.type === 'lyrics');
    if (!ly.length) h = `<p class="hint">Chưa có câu lời nào. Bấm <b>＋ Câu lời</b> trên thanh công cụ để thêm.</p>`;
    else h = `<h3>Kiểu phụ đề <span class="badge">${ly.length} câu</span></h3>` + groupHTML('Chữ', [
      field('Kiểu', 'subtitle.mode', 'select', {opts: [['karaoke', 'Karaoke (tô màu)'], ['preview', 'Hiện dần từng chữ'], ['full', 'Cả câu']]}),
      field('Phông', 'subtitle.fontFamily', 'select', {opts: FONTS.map((f) => [f, f.split(',')[0]])}),
      field('Cỡ chữ', 'subtitle.fontSize', 'range', {min: 12, max: 200, step: 1}),
      field('Viết hoa', 'subtitle.uppercase', 'check'),
    field('Hiệu ứng vào', 'subtitle.animIn', 'select', {def: '', opts: [['', 'Mặc định (trồi nhẹ)'], ...ANIM_IN.filter((a) => a[0] !== 'typewriter' && a[0] !== 'none'), ['none', 'Không']]}),
    field('Thời lượng vào', 'subtitle.inDur', 'range', {min: 0.1, max: 2, step: 0.05, def: 0.3}),
    field('Hiệu ứng ra', 'subtitle.animOut', 'select', {def: 'fade', opts: ANIM_OUT}),
    field('Thời lượng ra', 'subtitle.outDur', 'range', {min: 0.1, max: 2, step: 0.05, def: 0.15}),
    
    ], ly[0]) + groupHTML('Màu', [
      field('Màu chữ', 'subtitle.color', 'color'), field('Màu tô', 'subtitle.highlightColor', 'color'),
      field('Màu viền', 'subtitle.strokeColor', 'color'), field('Độ dày viền', 'subtitle.strokeWidth', 'range', {min: 0, max: 16, step: 1}),
    ], ly[0]) + groupHTML('Vị trí', [
      field('Vị trí', 'subtitle.position', 'select', {opts: [['bottom', 'Dưới'], ['center', 'Giữa'], ['top', 'Trên']]}),
    ], ly[0]) + `<p class="hint">Áp dụng cho mọi câu lời. Muốn che phụ đề gốc của video, thêm <b>＋ Lớp che mờ</b>.</p>`;
  } else if (rtab === 'audio') {
    const ts = TL.tracks.filter((t) => TL.clips.some((c) => c.track === t.id && (c.type === 'audio' || c.type === 'video')));
    h = `<h3>Âm lượng</h3>` + (ts.length ? ts.map((t) => `<div class="row"><label title="${esc(t.name)}">${esc(t.name)}</label><div class="ctl">
        <input type="range" min="0" max="2" step="0.05" value="${t.volume ?? 1}" data-tv="${t.id}"><span class="vpct">${Math.round((t.volume ?? 1) * 100)}%</span>
        <button class="ib ${t.muted ? 'off' : ''}" data-tm="${t.id}" title="Tắt/bật tiếng">${t.muted ? '🔇' : '🔊'}</button></div></div>`).join('')
      : '<p class="hint">Chưa có track nào có âm thanh.</p>')
      + `<div class="btnrow"><button class="ghost" data-av="mutevid">🔇 Tắt tiếng mọi clip video</button><button class="ghost" data-av="reset">↺ Đặt lại 100%</button></div>
      <p class="hint">Âm lượng track nhân với âm lượng riêng của từng clip (chỉnh ở tab Thuộc tính).</p>`;
  } else if (rtab === 'canvas') {
    const vis = TL.clips.filter((c) => c.type === 'video' || c.type === 'image'), c0 = vis[0] || {};
    const fit = (c0.fit ?? 'cover') === 'cover' ? 'fill' : c0.bgBlur ? 'blur' : 'black';
    const icon = (w, h) => { const k = 26 / Math.max(w, h); return `<i style="width:${w * k}px;height:${h * k}px"></i>`; };
    h = `<h3>Khung hình video xuất</h3><div class="ratios">${RATIOS.map(([n, w, hh]) => `<button class="${TL.width === w && TL.height === hh ? 'on' : ''}" data-ratio="${n}">${icon(w, hh)}<b>${n}</b><small>${w}×${hh}</small></button>`).join('')}</div>
      <h4>Cách lấp khung</h4><div class="seg3">${[['blur', 'Nền mờ'], ['black', 'Viền đen'], ['fill', 'Phóng đầy']].map(([k, v]) => `<button class="${fit === k ? 'on' : ''}" data-fit="${k}">${v}</button>`).join('')}</div>
      <div class="row"><label>Phóng to</label><div class="ctl"><input type="range" min="50" max="300" step="1" value="${Math.round((c0.scale ?? 1) * 100)}" data-cv="scale"><span class="vpct">${Math.round((c0.scale ?? 1) * 100)}%</span></div></div>
      <div class="row"><label>Dịch ngang</label><div class="ctl"><input type="range" min="-50" max="50" step="0.5" value="${(c0.x ?? 50) - 50}" data-cv="x"><span class="vpct">${((c0.x ?? 50) - 50).toFixed(1)}%</span></div></div>
      <div class="row"><label>Dịch dọc</label><div class="ctl"><input type="range" min="-50" max="50" step="0.5" value="${(c0.y ?? 50) - 50}" data-cv="y"><span class="vpct">${((c0.y ?? 50) - 50).toFixed(1)}%</span></div></div>
      <div class="btnrow"><button class="ghost" data-cv-reset>↺ Đặt lại vị trí</button></div>
      <p class="hint">Áp dụng cho mọi clip video / ảnh (${vis.length} clip). Muốn chỉnh riêng 1 clip: chọn clip đó rồi dùng tab Thuộc tính hoặc kéo trực tiếp trên khung xem trước.</p>`;
  } else if (rtab === 'filter') {
    const F = TL.filter || {preset: 'none'}, P = window.TLPlayer?.FILTER_PRESETS || {}, gs = window.TLPlayer?.gradeStyle || (() => null);
    const m = TL.media.find((x) => x.type === 'image' || x.thumb) || TL.media.find((x) => x.type === 'video' && x.src);
    const img = m ? (m.type === 'image' ? `/media/${encodeURI(m.src)}` : m.thumb || '') : '';
    const vid = !img && m ? `/media/${encodeURI(m.src)}#t=1` : '';
    const thumb = (id, sw) => {
      const g = gs({preset: id, intensity: F.preset === id ? (F.intensity ?? 1) : 1});
      const fs = `filter:${g ? g.filter : 'none'}`;
      const base = img ? `<img src="${img}" style="${fs}">` : vid ? `<video src="${vid}" muted preload="metadata" style="${fs}"></video>` : `<span style="background:${sw}"></span>`;
      return base + ((img || vid) && g ? g.layers.map((l) => `<em style="${Object.entries(l).map(([k, v]) => k.replace(/[A-Z]/g, (x) => '-' + x.toLowerCase()) + ':' + v).join(';')}"></em>`).join('') : '');
    };
    const sl = (k, lb, min, max) => `<div class="row"><label>${lb}</label><div class="ctl"><input type="range" min="${min}" max="${max}" step="1" value="${F[k] ?? 0}" data-fx="${k}"><span class="vpct">${F[k] ?? 0}</span></div></div>`;
    h = `<h3>Bộ lọc màu toàn video</h3>${(window.TLPlayer?.FILTER_CATEGORIES || ['']).map((cat) => `<h4 class="fcat">${cat}</h4><div class="fgrid">${Object.entries(P).filter(([, p]) => !cat || p.cat === cat).map(([id, p]) => `<button class="${(F.preset || 'none') === id ? 'on' : ''}" data-fp="${id}"><div class="fth">${thumb(id, p.swatch)}</div><b>${p.name}</b></button>`).join('')}</div>`).join('')}
      ${F.preset && F.preset !== 'none' ? `<div class="row"><label>Cường độ</label><div class="ctl"><input type="range" min="0" max="100" step="1" value="${Math.round((F.intensity ?? 1) * 100)}" data-fx="intensity"><span class="vpct">${Math.round((F.intensity ?? 1) * 100)}%</span></div></div>` : ''}
      <h4>Tinh chỉnh thủ công</h4>
      ${sl('brightness', 'Độ sáng', -100, 100)}${sl('contrast', 'Tương phản', -100, 100)}${sl('saturation', 'Bão hoà', -100, 100)}
      ${sl('temperature', 'Nhiệt độ màu', -100, 100)}${sl('tint', 'Sắc độ (xanh ↔ hồng)', -100, 100)}${sl('vignette', 'Tối viền', 0, 100)}${sl('hue', 'Xoay tông màu', -180, 180)}${sl('fade', 'Phai màu', 0, 100)}
      <div class="btnrow"><button class="ghost" data-fx-reset>↺ Đặt lại tinh chỉnh</button><button class="ghost danger" data-fp="none">Bỏ bộ lọc</button></div>
      <p class="hint">Áp dụng đồng đều cho mọi clip video / ảnh để các cảnh quay từ nhiều máy khác nhau có màu đồng điệu. Chữ và phụ đề giữ nguyên màu.</p>`;
  }
  box.innerHTML = h;
}
function bindSide() {
  $$('.rtabs button').forEach((b) => (b.onclick = () => showRTab(b.dataset.rtab)));
  const vis = () => TL.clips.filter((c) => c.type === 'video' || c.type === 'image');
  const live = (final) => { if (final) commit(); else { pushPlayer(); drawOverlay(); } };
  const onInput = (e, final) => {
    const el = e.target, sp = el.parentElement.querySelector('.vpct');
    if (el.dataset.k?.startsWith('subtitle.')) {
      let v = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.n !== undefined) v = parseFloat(v);
      TL.clips.forEach((c) => { if (c.type === 'lyrics') { c.subtitle ??= {...DEF_SUB}; setK(c, el.dataset.k, v); } });
      $$(`[data-k="${el.dataset.k}"]`, el.closest('.rbody')).forEach((x) => { if (x !== el && x.type !== 'checkbox') x.value = v; });
      return live(final);
    }
    if (el.dataset.fx) {
      TL.filter ??= {preset: 'none'};
      const v = +el.value;
      if (el.dataset.fx === 'intensity') { TL.filter.intensity = v / 100; if (sp) sp.textContent = v + '%'; }
      else { TL.filter[el.dataset.fx] = v; if (sp) sp.textContent = v; }
      if (final && el.dataset.fx === 'intensity') setTimeout(() => renderSide(true), 0);
      return live(final);
    }
    if (el.dataset.tv) { const t = track(el.dataset.tv); t.volume = +el.value; if (sp) sp.textContent = Math.round(t.volume * 100) + '%'; return live(final); }
    if (el.dataset.cv) {
      const v = +el.value;
      vis().forEach((c) => { if (el.dataset.cv === 'scale') c.scale = v / 100; else c[el.dataset.cv] = 50 + v; });
      if (sp) sp.textContent = el.dataset.cv === 'scale' ? v + '%' : v.toFixed(1) + '%';
      return live(final);
    }
  };
  $$('.rbody').forEach((box) => {
    box.addEventListener('input', (e) => onInput(e, false));
    box.addEventListener('change', (e) => onInput(e, true));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.fp) {
        if (b.dataset.fp === 'none') delete TL.filter;
        else TL.filter = {...(TL.filter || {}), preset: b.dataset.fp, intensity: TL.filter?.intensity ?? 0.8};
        renderSide(true); return commit();
      }
      if (b.dataset.fxReset !== undefined) {
        if (TL.filter) ['brightness', 'contrast', 'saturation', 'temperature', 'tint', 'vignette', 'hue', 'fade'].forEach((k) => delete TL.filter[k]);
        renderSide(true); return commit();
      }
      if (b.dataset.tm) { const t = track(b.dataset.tm); t.muted = !t.muted; return commit(); }
      if (b.dataset.av === 'reset') { TL.tracks.forEach((t) => { t.volume = 1; t.muted = false; }); return commit(); }
      if (b.dataset.av === 'mutevid') { TL.clips.forEach((c) => { if (c.type === 'video') c.volume = 0; }); toast('Đã tắt tiếng gốc của mọi clip video'); return commit(); }
      if (b.dataset.ratio) { const r = RATIOS.find((x) => x[0] === b.dataset.ratio); TL.width = r[1]; TL.height = r[2]; return commit(); }
      if (b.dataset.fit) {
        vis().forEach((c) => { if (b.dataset.fit === 'fill') { c.fit = 'cover'; } else { c.fit = 'contain'; c.bgBlur = b.dataset.fit === 'blur' ? 40 : 0; } });
        return commit();
      }
      if (b.dataset.cvReset !== undefined) { vis().forEach((c) => Object.assign(c, {x: 50, y: 50, scale: 1, rotation: 0})); return commit(); }
    });
  });
  $('#tbGroup').onclick = groupSel; $('#tbUngroup').onclick = ungroupSel;
  $('#tbAlignScenes').onclick = alignScenesToLyrics;
  $('#tbAddLyric').onclick = addLyricLine; $('#tbAddCover').onclick = addCover;
  $('#tbAddText').onclick = () => addText(TEXT_PRESETS[0]);
}
function bindProps() {
  const box = $('#props');
  let pending = false;
  const apply = (el, final) => {
    const k = el.dataset.k;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.n !== undefined) { v = parseFloat(v); if (isNaN(v)) return; }
    if (k === 'speed' || k === 'fps') v = parseFloat(v);
    if (k === 'fit') setTimeout(() => { box._for = null; renderProps(); }, 0);
    const picked = TL.clips.filter((x) => sel.has(x.id));
    const want = k.startsWith('title.') ? 'text' : k.startsWith('subtitle.') ? 'lyrics' : null;
    const c = (want && picked.find((x) => x.type === want)) || picked[0];
    // chọn nhiều khối chữ -> phông/màu/cỡ áp cho tất cả khối cùng loại
    if (c && picked.length > 1 && k.startsWith('title.') && k !== 'title.text')
      picked.forEach((x) => { if (x !== c && x.type === c.type) setK(x, k, v); });
    if (!c) {   // thuộc tính dự án
      if (k === '_ratio') { const r = RATIOS.find((x) => x[0] === v); if (r) { TL.width = r[1]; TL.height = r[2]; } }
      else TL[k] = v;
    } else {
      if (k === 'speed') {   // giữ nguyên đoạn nguồn -> đổi độ dài trên timeline
        const old = c.speed || 1; c.dur = q(c.dur * old / v);
      }
      if (k === 'dur' && hasSrcLimit(c)) v = Math.min(v, (c.srcDur - (c.in || 0)) / (c.speed || 1));
      setK(c, k, v);
      if (k.startsWith('subtitle.')) TL.clips.forEach((x) => { if (x.type === 'lyrics' && x !== c) setK(x, k, v); });
      if (k === 'transition.type' && c.transition.dur == null) c.transition.dur = 0.5;
      if (k === 'transition.dur' && !c.transition.type) c.transition.type = 'fade';
      if (k === 'title.text') c.name = v.split('\n')[0];
    }
    // đồng bộ cặp range/number
    $$(`[data-k="${k}"]`, box).forEach((x) => { if (x !== el && x.type !== 'checkbox') x.value = v; if (x.nextElementSibling?.tagName === 'SPAN' && x.type === 'color') x.nextElementSibling.textContent = v; });
    if (final) { pending = false; commit(); }
    else { pending = true; renderTimeline(); pushPlayer(); }
  };
  box.addEventListener('input', (e) => { if (e.target.dataset.k) apply(e.target, false); });
  box.addEventListener('change', (e) => { if (e.target.dataset.lf) lyricsField(e.target); });
  box.addEventListener('change', (e) => { if (e.target.dataset.k) { apply(e.target, true); box._for = null; renderProps(); } });
  box.addEventListener('click', (e) => {
    const ly = e.target.closest('[data-ly]'); if (ly && ly.tagName === 'BUTTON') return lyricsAction(ly.dataset.ly);
    const d = e.target.closest('[data-do]')?.dataset.do; if (!d) return;
    if (d === 'split') splitAt(); else if (d === 'dup') duplicateSel(); else if (d === 'del') deleteSel();
    else if (d === 'cover-all') { const c = TL.clips.find((x) => sel.has(x.id)); Object.assign(c, {x: 50, y: 50, w: 100, h: 100}); box._for = null; commit(); }
    else if (d === 'cover-full') { const c = TL.clips.find((x) => sel.has(x.id)); c.start = 0; c.dur = q(duration()); box._for = null; commit(); }
    else if (d === 'adj-reset') { const c = TL.clips.find((x) => sel.has(x.id)); delete c.adjust; box._for = null; commit(); }
    else if (d === 'adj-all') {
      const c = TL.clips.find((x) => sel.has(x.id));
      TL.clips.forEach((x) => { if ((x.type === 'video' || x.type === 'image') && x !== c) { if (c.adjust) x.adjust = {...c.adjust}; else delete x.adjust; } });
      commit(); toast('Đã áp chỉnh màu cho mọi clip video / ảnh');
    }
    else if (d === 'reset-tf') { const c = TL.clips.find((x) => sel.has(x.id)); Object.assign(c, {x: 50, y: 50, scale: 1, rotation: 0}); box._for = null; commit(); }
  });
  void pending;
}

/* ---------- xuất video ---------- */
function modal(html) { $('#mbox').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
async function exportVideo(opts) {
  if (!TL.clips.length) return toast('Timeline đang trống');
  P()?.pause();
  modal(`<h3>⬆ Xuất video</h3><p>${TL.width}×${TL.height} · ${TL.fps} fps · ${fmt(duration())}</p>
    <div class="bar"><i id="xbar"></i></div><p id="xmsg" style="color:var(--mute)">Đang khởi động Remotion…</p>
    <div class="btnrow" id="xbtns"><button class="ghost" id="xclose">Ẩn</button></div>`);
  $('#xclose').onclick = closeModal;
  try { await save(); await apiCall(`/api/jobs/${JOB}/export`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({timeline: TL, options: opts})}); }
  catch (e) { $('#xmsg').textContent = '⚠ ' + e.message; return; }
  const poll = async () => {
    let j; try { j = await apiCall(`/api/jobs/${JOB}`); } catch { return setTimeout(poll, 2000); }
    const tail = j.log.slice(j.log.lastIndexOf('Xuất video từ Editor'));
    const m = [...tail.matchAll(/Rendered (\d+)\/(\d+)/g)].pop() || [...tail.matchAll(/(\d+)\/(\d+)/g)].pop();
    if (m && $('#xbar')) $('#xbar').style.width = (100 * m[1] / m[2]).toFixed(1) + '%';
    if (j.status === 'running') { if ($('#xmsg')) $('#xmsg').textContent = m ? `Đang render khung ${m[1]}/${m[2]}…` : 'Đang chuẩn bị…'; return setTimeout(poll, 1500); }
    if (!$('#xmsg')) { toast(j.status === 'done' ? '✅ Xuất video xong' : '⚠ Xuất video lỗi'); return; }
    if (j.status === 'done' && j.lastExport) {
      $('#modal').hidden = false; $('#xbar').style.width = '100%';
      $('#xmsg').innerHTML = '✅ Xong! Video đã lưu vào dự án.';
      $('#xmsg').innerHTML = `✅ Xong! Đã lưu <b>${esc(j.lastExport || '')}</b> vào thư mục exports.`;
      $('#xbtns').innerHTML = `<a class="primary" style="text-decoration:none" href="/api/jobs/${JOB}/export-file?t=${Date.now()}" download>⬇ Tải xuống</a><button class="ghost" id="xopen">📂 Mở thư mục</button><button class="ghost" id="xclose2">Đóng</button>`;
      $('#xopen').onclick = () => apiCall(`/api/jobs/${JOB}/open-export`, {method: 'POST'}).catch((e) => toast(e.message));
      $('#xclose2').onclick = closeModal;
    } else {
      $('#modal').hidden = false;
      $('#xmsg').innerHTML = `⚠ Xuất lỗi (${esc(j.status)}). <pre style="white-space:pre-wrap;max-height:200px;overflow:auto;font-size:11px">${esc(tail.slice(-1500))}</pre>`;
    }
  };
  setTimeout(poll, 1500);
}
function showHelp() {
  const k = [['Space', 'Phát / dừng'], ['S hoặc Ctrl+B', 'Tách clip tại đầu phát'], ['Delete / Backspace', 'Xoá clip đã chọn'], ['Shift+Delete', 'Xoá và dồn clip phía sau'], ['Ctrl+D', 'Nhân bản'], ['Ctrl+G / Ctrl+Shift+G', 'Nhóm / bỏ nhóm'], ['Ctrl+Z / Ctrl+Y', 'Hoàn tác / Làm lại'],
    ['Ctrl+A', 'Chọn tất cả'], ['Esc', 'Bỏ chọn'], ['← / →', 'Lùi / tới 1 khung (Shift: 1 giây)'], ['Home / End', 'Về đầu / cuối'], ['+ / −', 'Phóng to / thu nhỏ timeline'],
    ['Ctrl + lăn chuột', 'Zoom timeline'], ['N', 'Bật/tắt hút dính'], ['Ctrl/Shift + nhấp', 'Chọn nhiều clip'], ['Kéo trên vùng trống', 'Khoanh chọn nhiều clip'], ['Chuột phải', 'Menu clip / track']];
  modal(`<h3>⌨ Phím tắt</h3><table>${k.map(([a, b]) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`).join('')}</table><div class="btnrow" style="margin-top:12px"><button class="ghost" onclick="document.getElementById('modal').hidden=true">Đóng</button></div>`);
}

/* ---------- phím tắt & nút ---------- */
function bindKeys() {
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 1 : 1 / fps();
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (ctrl && k.toLowerCase() === 'b' || (!ctrl && k.toLowerCase() === 's')) { e.preventDefault(); splitAt(); }
    else if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
    else if (ctrl && k.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); }
    else if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(TL.clips.map((c) => c.id)); renderTimeline(); renderProps(); }
    else if (ctrl && k.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(e.shiftKey || rippleOn); }
    else if (k === 'Escape') { sel.clear(); renderTimeline(); renderProps(); closeModal(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); P()?.pause(); seek(T - step); }
    else if (k === 'ArrowRight') { e.preventDefault(); P()?.pause(); seek(T + step); }
    else if (k === 'Home') seek(0);
    else if (k === 'End') seek(duration());
    else if (k === '+' || k === '=') setZoom(pps * 1.25);
    else if (k === '-') setZoom(pps / 1.25);
    else if (k.toLowerCase() === 'n') { snapOn = !snapOn; $('#snap').classList.toggle('on', snapOn); toast('Hút dính: ' + (snapOn ? 'bật' : 'tắt')); }
  });
  $('#play').onclick = togglePlay;
  $('#toStart').onclick = () => seek(0);
  $('#toEnd').onclick = () => seek(duration());
  $('#back1').onclick = () => seek(T - 1 / fps());
  $('#fwd1').onclick = () => seek(T + 1 / fps());
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#split').onclick = () => splitAt(); $('#del').onclick = deleteSel; $('#dup').onclick = duplicateSel;
  $('#snap').onclick = () => { snapOn = !snapOn; $('#snap').classList.toggle('on', snapOn); };
  $('#zin').onclick = () => setZoom(pps * 1.25); $('#zout').onclick = () => setZoom(pps / 1.25); $('#zfit').onclick = zoomFit;
  $('#zoom').oninput = (e) => setZoom(4 * Math.pow(150, e.target.value / 100));
  $('#addtrack').onclick = (e) => ctxMenu(e.clientX, e.clientY + 10, [
    ['＋ Track mới ở trên', '', () => { newTrack('mixed', 0); commit(); }],
    ['＋ Track mới ở dưới', '', () => { newTrack('mixed', TL.tracks.length); commit(); }],
  ]);
  $('#export').onclick = exportDialog;
  $('#help').onclick = showHelp;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  $('#ptitle').onchange = async (e) => { try { await apiCall(`/api/jobs/${JOB}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: e.target.value})}); document.title = e.target.value + ' – Editor'; } catch (er) { toast(er.message); } };
  // kéo thanh chia để đổi chiều cao timeline
  $('#hsplit').addEventListener('pointerdown', (e) => {
    const h0 = $('.tlwrap').offsetHeight, y0 = e.clientY;
    dragLoop((ev) => { document.documentElement.style.setProperty('--tlh', clamp(h0 - (ev.clientY - y0), 140, innerHeight - 250) + 'px'); }, () => { try { localStorage.setItem('ed.tlh', $('.tlwrap').offsetHeight); } catch {} renderTimeline(); });
  });
  try { const h = localStorage.getItem('ed.tlh'); if (h) document.documentElement.style.setProperty('--tlh', h + 'px'); } catch {}
  addEventListener('resize', renderTimeline);
}

/* ---------- khởi động ---------- */
async function init() {
  if (!JOB) { document.body.innerHTML = '<p style="padding:40px">Thiếu ?id= dự án. <a href="/" style="color:#e6e6e9">Về trang chính</a></p>'; return; }
  try { [TL, META] = await Promise.all([apiCall(`/api/jobs/${JOB}/timeline`), apiCall(`/api/jobs/${JOB}`)]); }
  catch (e) { document.body.innerHTML = `<p style="padding:40px">⚠ ${esc(e.message)} <a href="/" style="color:#e6e6e9">Về trang chính</a></p>`; return; }
  TL.media ??= []; TL.background ??= '#000000';
  migrateTracks();
  explodeLyrics(); syncLyrics();
  $('#ptitle').value = META.title || JOB; document.title = (META.title || JOB) + ' – Editor';
  lastSnap = snap();
  bindTimeline(); bindLibrary(); bindProps(); bindKeys(); bindPhase2(); bindSide();
  renderMedia(); renderTimeline(); renderProps();
  $('#undo').disabled = $('#redo').disabled = true;
  $('#total').textContent = fmt(duration());
  api = await window.TLPlayer.mount($('#player'), JSON.parse(JSON.stringify(TL)));
  const hook = () => {
    const p = P(); if (!p) return setTimeout(hook, 50);
    p.addEventListener('frameupdate', (e) => { T = e.detail.frame / fps(); updatePlayhead(); drawOverlay(); if (playing) follow(); });
    p.addEventListener('play', () => { playing = true; $('#play').textContent = '❚❚'; });
    p.addEventListener('pause', () => { playing = false; $('#play').textContent = '▶'; });
    p.addEventListener('ended', () => { playing = false; $('#play').textContent = '▶'; });
  };
  hook();
  setTimeout(zoomFit, 50);
  // timeline do AI tạo chưa từng lưu -> lưu lần đầu để giữ id clip ổn định
  save();
}
function follow() {
  const sc = $('#scroller'), x = T * pps;
  if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = x - 80;
}
init();

/* ================= Giai đoạn 2: chuyển cảnh, khung xem tương tác, panel, xuất ================= */
/** hiệu ứng xuất hiện / biến mất – giống remotion/src/anim.ts */
const ANIM_IN = [
	['none', 'Không'], ['fade', 'Mờ dần'], ['zoom', 'Phóng to'], ['pop', 'Bật nảy'], ['bounce', 'Rơi nảy'],
	['drop', 'Rơi xuống'], ['rise', 'Trồi lên'], ['slide-up', 'Trượt lên'], ['slide-down', 'Trượt xuống'],
	['slide-left', 'Trượt từ phải'], ['slide-right', 'Trượt từ trái'], ['blur', 'Hiện từ mờ'], ['spin', 'Xoay vào'],
	['flip', 'Lật'], ['stretch', 'Kéo giãn'], ['swing', 'Đung đưa'], ['glitch', 'Nhiễu (glitch)'], ['shake', 'Rung'],
	['glow', 'Phát sáng'], ['typewriter', 'Đánh máy'],
	['word-pop', 'Từng chữ bật'], ['word-rise', 'Từng chữ trồi'], ['word-fade', 'Từng chữ mờ dần'],
];
const ANIM_OUT = [
	['none', 'Không'], ['fade', 'Mờ dần'], ['zoom-out', 'Thu nhỏ'], ['zoom-in', 'Phóng to biến mất'],
	['slide-up', 'Trượt lên'], ['slide-down', 'Trượt xuống'], ['slide-left', 'Trượt sang trái'], ['slide-right', 'Trượt sang phải'],
	['blur', 'Tan mờ'], ['spin', 'Xoay ra'], ['flip', 'Lật'], ['drop', 'Rơi xuống'], ['glitch', 'Nhiễu (glitch)'],
];
const TRANS = [
  ['none', '⊘', 'Không'], ['fade', '◐', 'Mờ chéo'], ['fadeblack', '●', 'Qua đen'], ['fadewhite', '○', 'Qua trắng'], ['flash', '✦', 'Chớp sáng'],
  ['slide-left', '⇠', 'Trượt trái'], ['slide-right', '⇢', 'Trượt phải'], ['slide-up', '⇡', 'Trượt lên'], ['slide-down', '⇣', 'Trượt xuống'],
  ['wipe-left', '◧', 'Quét trái'], ['wipe-right', '◨', 'Quét phải'], ['wipe-up', '⬒', 'Quét lên'], ['wipe-down', '⬓', 'Quét xuống'],
  ['circle', '◎', 'Vòng tròn'], ['zoom-in', '⊕', 'Phóng vào'], ['zoom-out', '⊖', 'Thu ra'], ['blur', '≋', 'Làm mờ'], ['spin', '↻', 'Xoay'],
  ['whip-left', '⇇', 'Lướt nhanh trái'], ['whip-right', '⇉', 'Lướt nhanh phải'], ['zoom-blur', '◉', 'Phóng nhoè'], ['glitch', '▦', 'Nhiễu'],
  ['flip', '⇋', 'Lật'], ['cube-left', '❒', 'Khối 3D'], ['diamond', '◇', 'Kim cương'], ['split', '⫴', 'Mở giữa'],
  ['diag', '◸', 'Quét chéo'], ['burn', '☀', 'Cháy sáng'], ['shake', '≈', 'Rung'],
];
const trName = (k) => (TRANS.find((x) => x[0] === k) || [, , k])[2];
const trDur = () => parseFloat($('#trDur').value) || 0.5;
/** clip liền trước (cùng track, nối sát) */
function prevOf(c) { return TL.clips.find((x) => x.track === c.track && x.id !== c.id && Math.abs(x.start + x.dur - c.start) < 1.5 / fps()); }
/** các clip có thể đặt chuyển cảnh: nối sát clip trước trên track video/chữ */
function joints(t) { return TL.clips.filter((c) => c.track === t.id && prevOf(c)); }
function showTab(name) { $$('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name)); $$('.tabbody').forEach((x) => (x.hidden = x.dataset.body !== name)); $('.work').classList.remove('col-l'); }
function applyTransition(type, targets) {
  if (!targets.length) return toast('Chọn clip (hoặc nhấp nút ◆ chỗ nối) trước');
  for (const c of targets) c.transition = type === 'none' ? undefined : {type, dur: trDur()};
  commit(); toast(type === 'none' ? 'Đã bỏ chuyển cảnh' : `Chuyển cảnh: ${trName(type)} (${targets.length} chỗ)`);
}
function detachAudio() {
  const vs = TL.clips.filter((c) => sel.has(c.id) && c.type === 'video');
  if (!vs.length) return toast('Chọn clip video để tách âm thanh');
  for (const v of vs) {
    const tr = freeTrack('audio', v.start, v.start + v.dur);
    TL.clips.push({id: uid(), track: tr.id, type: 'audio', src: v.src, name: '♪ ' + (v.name || ''), start: v.start, dur: v.dur, in: v.in || 0, srcDur: v.srcDur, speed: v.speed, volume: v.volume ?? 1, loop: v.loop});
    v.volume = 0;
  }
  commit(); toast('Đã tách âm thanh sang track riêng');
}

/* ---- khung xem: chọn & kéo trực tiếp ---- */
function compRect() {   // vùng khung hình thật bên trong #player (Player tự co giãn giữ tỉ lệ)
  const pr = $('#player').getBoundingClientRect(), sr = $('#stage').getBoundingClientRect();
  const k = Math.min(pr.width / TL.width, pr.height / TL.height);
  const w = TL.width * k, h = TL.height * k;
  return {left: pr.left - sr.left + (pr.width - w) / 2, top: pr.top - sr.top + (pr.height - h) / 2, w, h, k};
}
function activeAt(c, t = T) { return t >= c.start - 1e-3 && t < c.start + c.dur; }
/** khung bao của clip trong toạ độ khung hình (px gốc) */
function boxOf(c) {
  const W = TL.width, H = TL.height;
  if (c.type === 'cover') return {cx: (c.x ?? 50) / 100 * W, cy: (c.y ?? 85) / 100 * H, w: (c.w ?? 80) / 100 * W, h: (c.h ?? 14) / 100 * H};
  if (c.type === 'text') {
    const t = c.title, lines = String(t.text || ' ').split('\n');
    const fs = t.fontSize, ww = Math.min(W * 0.92, Math.max(...lines.map((l) => l.length)) * fs * 0.62 + (t.bgOpacity ? fs * 0.6 : 0));
    const hh = lines.length * fs * 1.15 + (t.subtext ? fs * 0.65 : 0) + (t.bgOpacity ? fs * 0.3 : 0);
    return {cx: (t.x ?? 50) / 100 * W, cy: t.y / 100 * H, w: ww, h: hh};
  }
  const m = TL.media.find((x) => x.src === c.src) || {};
  let w = W, h = H;
  if ((c.fit ?? 'cover') === 'contain' && m.width && m.height) { const a = m.width / m.height; if (a > W / H) h = W / a; else w = H * a; }
  const s = c.scale ?? 1;
  return {cx: (c.x ?? 50) / 100 * W, cy: (c.y ?? 50) / 100 * H, w: w * s, h: h * s};
}
function drawOverlay() {
  const o = $('#ovl'); if (!o || !TL) return;
  const r = compRect();
  Object.assign(o.style, {left: r.left + 'px', top: r.top + 'px', width: r.w + 'px', height: r.h + 'px'});
  let h = '';
  if (safeOn) {
    const portrait = TL.height > TL.width;
    h += `<div class="safe">${portrait ? '<div style="left:0;right:0;top:0;height:11%"></div><div style="left:0;right:0;bottom:0;height:22%"></div><div style="right:0;top:11%;bottom:22%;width:14%"></div>' : '<div style="left:0;right:0;top:0;height:6%"></div><div style="left:0;right:0;bottom:0;height:12%"></div>'}</div>`;
  }
  const c = sel.size === 1 && clip([...sel][0]);
  if (c && (c.type === 'text' || c.type === 'video' || c.type === 'image' || c.type === 'cover') && activeAt(c) && !track(c.track).locked) {
    const b = boxOf(c);
    h += `<div class="box" data-id="${c.id}" style="left:${(b.cx - b.w / 2) * r.k}px;top:${(b.cy - b.h / 2) * r.k}px;width:${b.w * r.k}px;height:${b.h * r.k}px;transform:rotate(${c.rotation || 0}deg)"><div class="hd" title="Kéo để phóng to / thu nhỏ"></div></div>`;
  }
  if (o._h !== h) { o.innerHTML = h; o._h = h; }
}
function bindOverlay() {
  $('#stage').addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = compRect(), sr = $('#stage').getBoundingClientRect();
    const px = (e.clientX - sr.left - r.left) / r.k, py = (e.clientY - sr.top - r.top) / r.k;
    let c = e.target.closest('.box') && clip(e.target.closest('.box').dataset.id);
    if (!c) {   // nhấp vào khung xem -> chọn lớp trên cùng dưới con trỏ
      const order = new Map(TL.tracks.map((t, i) => [t.id, i]));
      const hits = TL.clips.filter((x) => (x.type === 'text' || x.type === 'video' || x.type === 'image' || x.type === 'cover') && activeAt(x) && !track(x.track).hidden && !track(x.track).locked)
        .filter((x) => { const b = boxOf(x); return Math.abs(px - b.cx) <= b.w / 2 && Math.abs(py - b.cy) <= b.h / 2; })
        .sort((a, b) => order.get(a.track) - order.get(b.track) || b.start - a.start);
      if (!hits.length) return;
      c = hits[0]; sel = new Set([c.id]); showRTab('props'); renderTimeline(); renderProps();
    }
    e.preventDefault();
    const resize = e.target.classList.contains('hd');
    const isT = c.type === 'text';
    const isC = c.type === 'cover';
    const o = {x: isT ? c.title.x ?? 50 : c.x ?? 50, y: isT ? c.title.y : c.y ?? (isC ? 85 : 50), s: isT ? c.title.fontSize : c.scale ?? 1, w: c.w ?? 80, h: c.h ?? 14};
    const b0 = boxOf(c), x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    dragLoop((ev) => {
      const dx = (ev.clientX - x0) / r.k, dy = (ev.clientY - y0) / r.k;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      if (resize && isC) {   // lớp che: kéo góc đổi rộng / cao độc lập
        c.w = Math.round(clamp(o.w + dx / TL.width * 200, 2, 100) * 10) / 10; c.h = Math.round(clamp(o.h + dy / TL.height * 200, 2, 100) * 10) / 10;
      } else if (resize) {
        const f = Math.max(0.05, (b0.w / 2 + dx) / (b0.w / 2));
        if (isT) c.title.fontSize = Math.round(clamp(o.s * f, 8, 600)); else c.scale = Math.round(clamp(o.s * f, 0.05, 10) * 100) / 100;
      } else {
        let nx = o.x + dx / TL.width * 100, ny = o.y + dy / TL.height * 100;
        if (snapOn) { if (Math.abs(nx - 50) < 1.2) nx = 50; if (Math.abs(ny - 50) < 1.2) ny = 50; }   // hút vào tâm
        nx = Math.round(nx * 10) / 10; ny = Math.round(ny * 10) / 10;
        if (isT) { c.title.x = nx; c.title.y = ny; } else { c.x = nx; c.y = ny; }
      }
      drawOverlay(); pushPlayer();
    }, () => { if (moved) { $('#props')._for = null; commit(); } });
  });
}

/* ---- panel: đổi độ rộng, thu gọn ---- */
function bindPanels() {
  const work = $('.work'), DEF = {l: 300, r: 320};
  const load = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  for (const s of ['l', 'r']) {
    work.style.setProperty('--w' + s, load('ed.w' + s, DEF[s]) + 'px');
    if (load('ed.col' + s, '0') === '1') work.classList.add('col-' + s);
  }
  $$('.vsplit').forEach((sp) => {
    const s = sp.dataset.side;
    sp.addEventListener('pointerdown', (e) => {
      if (work.classList.contains('col-' + s)) return;
      const w0 = $(s === 'l' ? '#paneL' : '#paneR').offsetWidth, x0 = e.clientX;
      dragLoop((ev) => { const w = clamp(w0 + (s === 'l' ? 1 : -1) * (ev.clientX - x0), 200, 560); work.style.setProperty('--w' + s, w + 'px'); drawOverlay(); },
        () => { store('ed.w' + s, $(s === 'l' ? '#paneL' : '#paneR').offsetWidth); drawOverlay(); });
    });
    sp.addEventListener('dblclick', () => { work.style.setProperty('--w' + s, DEF[s] + 'px'); store('ed.w' + s, DEF[s]); drawOverlay(); });
  });
  $$('.collapse').forEach((b) => b.onclick = () => {
    const s = b.dataset.col; work.classList.toggle('col-' + s);
    store('ed.col' + s, work.classList.contains('col-' + s) ? '1' : '0'); setTimeout(drawOverlay, 30);
  });
  new ResizeObserver(() => drawOverlay()).observe($('#player'));
}

/* ---- hộp thoại xuất (theo RDY) ---- */
const XPRESETS = {
  tiktok: {height: 1080, quality: 'high', fps: 30, format: 'mp4', speed: 'balanced', abr: 192},
  youtube: {height: 1080, quality: 'best', fps: 0, format: 'mp4', speed: 'balanced', abr: 320},
  reels: {height: 1080, quality: 'medium', fps: 30, format: 'mp4', speed: 'balanced', abr: 192},
  zalo: {height: 720, quality: 'low', fps: 30, format: 'mp4', speed: 'fast', abr: 128},
};
function exportDialog() {
  if (!TL.clips.length) return toast('Timeline đang trống');
  P()?.pause();
  let last = {}; try { last = JSON.parse(localStorage.getItem('ed.export') || '{}'); } catch {}
  const o = {height: 0, quality: 'high', fps: 0, format: 'mp4', speed: 'balanced', abr: 192, ...last};
  const sel_ = (id, opts, v) => `<select id="${id}">${opts.map(([a, b]) => `<option value="${a}" ${String(v) === String(a) ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
  const short = Math.min(TL.width, TL.height);
  modal(`<h3>⬆ Xuất video</h3>
    <div class="ratios" id="xpre">${[['tiktok', '📱 TikTok', '1080p · 30fps'], ['youtube', '▶ YouTube', '1080p · cao'], ['reels', '📘 Reels', '1080p · vừa'], ['zalo', '💬 Gửi Zalo', '720p · nhẹ']].map(([k, a, b]) => `<button type="button" data-p="${k}">${a}<small>${b}</small></button>`).join('')}</div>
    <label class="full">Tên file <input id="xname" maxlength="80" value="${esc($('#ptitle').value)}"></label>
    <div class="xgrid">
      <label>Độ phân giải ${sel_('xh', [[0, `Giữ nguyên (${short}p)`], [480, '480p'], [720, '720p'], [1080, '1080p'], [1440, '2K'], [2160, '4K']], o.height)}</label>
      <label>Chất lượng ${sel_('xq', [['low', 'Thấp'], ['medium', 'Vừa'], ['high', 'Cao'], ['best', 'Rất cao']], o.quality)}</label>
      <label>FPS ${sel_('xf', [[0, `Giữ nguyên (${TL.fps})`], [24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']], o.fps)}</label>
      <label>Định dạng ${sel_('xfmt', [['mp4', 'MP4 (H.264)'], ['hevc', 'MP4 (H.265, nhẹ hơn)'], ['webm', 'WebM'], ['mp3', 'Chỉ âm thanh (MP3)']], o.format)}</label>
      <label>Tốc độ mã hoá ${sel_('xs', [['fast', 'Nhanh'], ['balanced', 'Cân bằng'], ['small', 'Nén tốt (chậm)']], o.speed)}</label>
      <label>Âm thanh ${sel_('xa', [[128, '128 kbps'], [192, '192 kbps'], [320, '320 kbps']], o.abr)}</label>
    </div>
    <p class="hint" id="xest"></p>
    <div class="btnrow" style="justify-content:flex-end"><button class="ghost" id="xcancel">Huỷ</button><button class="primary" id="xgo">Xuất</button></div>`);
  const read = () => ({name: $('#xname').value.trim(), height: +$('#xh').value, quality: $('#xq').value, fps: +$('#xf').value, format: $('#xfmt').value, speed: $('#xs').value, abr: +$('#xa').value});
  const est = () => {   // ước tính dung lượng thô theo bitrate
    const v = read(), hgt = v.height || short, mbps = {low: 2.5, medium: 5, high: 8, best: 14}[v.quality] * Math.pow(hgt / 1080, 1.6) * (v.format === 'hevc' ? 0.6 : 1);
    const sizeMB = ((v.format === 'mp3' ? 0 : mbps) + v.abr / 1000) * duration() / 8;
    $('#xest').textContent = `Ước tính ≈ ${sizeMB < 1 ? sizeMB.toFixed(2) : sizeMB.toFixed(1)} MB · ${fmt(duration())}`;
  };
  $$('#mbox select').forEach((x) => (x.onchange = est)); est();
  $('#xpre').onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const p = XPRESETS[b.dataset.p]; $$('#xpre button').forEach((x) => x.classList.toggle('on', x === b));
    $('#xh').value = p.height; $('#xq').value = p.quality; $('#xf').value = p.fps; $('#xfmt').value = p.format; $('#xs').value = p.speed; $('#xa').value = p.abr; est();
  };
  $('#xcancel').onclick = closeModal;
  $('#xgo').onclick = () => { const v = read(); try { localStorage.setItem('ed.export', JSON.stringify({...v, name: undefined})); } catch {} exportVideo(v); };
}

function bindPhase2() {
  $('#trgrid').innerHTML = TRANS.map(([k, i, n]) => `<div class="tr" draggable="${k !== 'none'}" data-k="${k}"><i>${i}</i>${n}</div>`).join('');
  $('#trgrid').addEventListener('dragstart', (e) => { const t = e.target.closest('.tr'); if (t) e.dataTransfer.setData('x-tr', t.dataset.k); });
  $('#trgrid').addEventListener('click', (e) => { const t = e.target.closest('.tr'); if (t) applyTransition(t.dataset.k, TL.clips.filter((c) => sel.has(c.id) && c.type !== 'audio' && c.type !== 'lyrics')); });
  $('#trDur').oninput = () => ($('#trDurLb').textContent = trDur() + 's');
  const allJ = () => TL.tracks.flatMap(joints);
  $('#trAll').onclick = () => { const c = TL.clips.find((x) => sel.has(x.id) && x.transition); applyTransition(c ? c.transition.type : 'fade', allJ()); };
  $('#trRand').onclick = () => { const js = allJ(); if (!js.length) return toast('Chưa có chỗ nối nào'); js.forEach((c) => (c.transition = {type: TRANS[2 + Math.floor(Math.random() * (TRANS.length - 2))][0], dur: trDur()})); commit(); toast(`Đã đặt ngẫu nhiên ${js.length} chỗ nối`); };
  $('#trNone').onclick = () => applyTransition('none', TL.clips.filter((c) => c.transition));
  $('#ripple').onclick = () => { rippleOn = !rippleOn; $('#ripple').classList.toggle('on', rippleOn); try { localStorage.setItem('ed.ripple', rippleOn ? '1' : '0'); } catch {} };
  try { rippleOn = localStorage.getItem('ed.ripple') === '1'; } catch {}
  $('#ripple').classList.toggle('on', rippleOn);
  $('#detach').onclick = detachAudio;
  $('#safe').onclick = () => { safeOn = !safeOn; $('#safe').classList.toggle('on', safeOn); drawOverlay(); };
  bindOverlay(); bindPanels();
}
