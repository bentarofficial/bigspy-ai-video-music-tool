// Bộ lọc màu phủ xuyên suốt video: làm đồng điệu màu các cảnh quay từ nhiều ống kính khác nhau.
import React from 'react';
import {AbsoluteFill} from 'remotion';

export type ColorFilter = {
	/** id bộ lọc có sẵn (FILTER_PRESETS) */
	preset: string;
	/** cường độ bộ lọc 0..1 */
	intensity?: number;
	/** tinh chỉnh thủ công, -100..100 (vignette 0..100) */
	brightness?: number;
	contrast?: number;
	saturation?: number;
	temperature?: number;
	tint?: number;
	vignette?: number;
	/** xoay tông màu -180..180 (độ) */
	hue?: number;
	/** phai màu (nâng vùng tối) 0..100 */
	fade?: number;
};

type Preset = {
	name: string;
	/** nhóm hiển thị trong giao diện */
	cat: string;
	b?: number; c?: number; s?: number; sepia?: number; gray?: number; hue?: number;
	/** lớp màu phủ (soft-light) */
	color?: string; alpha?: number;
	/** lớp màu thứ 2 cho vùng sáng (screen) – tách tông */
	hi?: string; hiA?: number;
	/** nâng vùng tối (phai màu) 0..1 */
	fade?: number;
	vig?: number;
	/** màu mẫu cho nút chọn khi chưa có khung hình */
	swatch: string;
};

const sw = (a: string, b: string) => `linear-gradient(135deg,${a},${b})`;

export const FILTER_CATEGORIES = ['Cơ bản', 'Điện ảnh', 'Ấm', 'Lạnh', 'Retro', 'Tươi sáng', 'Tâm trạng', 'Đen trắng'];

export const FILTER_PRESETS: Record<string, Preset> = {
	none: {name: 'Gốc', cat: 'Cơ bản', swatch: sw('#555', '#999')},
	natural: {name: 'Tự nhiên', cat: 'Cơ bản', b: 1.02, c: 1.06, s: 1.06, swatch: sw('#4f7a52', '#c9b48a')},
	clear: {name: 'Trong trẻo', cat: 'Cơ bản', b: 1.05, c: 1.1, s: 1.1, swatch: sw('#3aa0d8', '#f2f2f2')},
	soft: {name: 'Dịu nhẹ', cat: 'Cơ bản', b: 1.04, c: 0.9, s: 0.95, fade: 0.08, swatch: sw('#b9a89a', '#efe6dc')},
	crisp: {name: 'Sắc nét', cat: 'Cơ bản', c: 1.22, s: 1.08, swatch: sw('#222', '#d9d9d9')},
	matte: {name: 'Mờ lì', cat: 'Cơ bản', c: 0.92, s: 0.9, fade: 0.15, swatch: sw('#4b4b52', '#bdb6ad')},

	cinematic: {name: 'Điện ảnh', cat: 'Điện ảnh', c: 1.15, s: 0.88, color: '#0e5a72', alpha: 0.35, hi: '#ffb070', hiA: 0.08, vig: 0.3, swatch: sw('#0e4f63', '#e0904a')},
	tealorange: {name: 'Teal & Cam', cat: 'Điện ảnh', c: 1.18, s: 1.05, color: '#007a80', alpha: 0.4, hi: '#ff9a40', hiA: 0.14, vig: 0.25, swatch: sw('#006d73', '#ff9a40')},
	blockbuster: {name: 'Bom tấn', cat: 'Điện ảnh', c: 1.25, s: 0.95, b: 0.97, color: '#12384f', alpha: 0.4, hi: '#ffc27a', hiA: 0.1, vig: 0.4, swatch: sw('#0b2233', '#ffc27a')},
	noir: {name: 'Noir xanh', cat: 'Điện ảnh', c: 1.3, s: 0.5, b: 0.92, color: '#183a52', alpha: 0.45, vig: 0.55, swatch: sw('#0a1520', '#4f6d82')},
	scifi: {name: 'Viễn tưởng', cat: 'Điện ảnh', c: 1.15, s: 0.85, hue: -10, color: '#00a88f', alpha: 0.35, vig: 0.35, swatch: sw('#003b33', '#5fe0c8')},
	desert: {name: 'Sa mạc', cat: 'Điện ảnh', c: 1.12, s: 0.9, sepia: 0.25, color: '#d98c3a', alpha: 0.35, vig: 0.3, swatch: sw('#7a4b1d', '#f0c27a')},
	western: {name: 'Viễn Tây', cat: 'Điện ảnh', c: 1.2, s: 0.75, sepia: 0.4, color: '#b86a2a', alpha: 0.3, vig: 0.45, swatch: sw('#4a2c14', '#d9a066')},

	warm: {name: 'Ấm áp', cat: 'Ấm', s: 1.1, sepia: 0.15, color: '#ff9a3c', alpha: 0.3, swatch: sw('#c2541b', '#ffc46b')},
	golden: {name: 'Giờ vàng', cat: 'Ấm', s: 1.15, sepia: 0.1, b: 1.03, color: '#ffb347', alpha: 0.4, swatch: sw('#d9822b', '#ffe08a')},
	sunset: {name: 'Hoàng hôn', cat: 'Ấm', s: 1.2, c: 1.08, color: '#ff6a3d', alpha: 0.35, hi: '#ffd08a', hiA: 0.1, vig: 0.2, swatch: sw('#c2304a', '#ffb35c')},
	autumn: {name: 'Mùa thu', cat: 'Ấm', s: 1.1, c: 1.05, hue: -8, sepia: 0.2, color: '#c8641e', alpha: 0.35, swatch: sw('#8a3b12', '#e8a84a')},
	honey: {name: 'Mật ong', cat: 'Ấm', b: 1.04, s: 1.05, sepia: 0.25, color: '#f0b030', alpha: 0.3, swatch: sw('#b07a1a', '#ffe6a0')},
	peach: {name: 'Đào', cat: 'Ấm', b: 1.06, c: 0.95, color: '#ff9e8a', alpha: 0.35, swatch: sw('#e8806a', '#ffd9c9')},
	cozy: {name: 'Ấm cúng', cat: 'Ấm', b: 0.98, c: 1.05, sepia: 0.2, color: '#e07a30', alpha: 0.35, vig: 0.35, swatch: sw('#6b3415', '#e8a060')},

	cool: {name: 'Lạnh', cat: 'Lạnh', s: 0.95, c: 1.05, color: '#3c8cff', alpha: 0.3, swatch: sw('#1d3f8a', '#8fd0ff')},
	winter: {name: 'Mùa đông', cat: 'Lạnh', b: 1.06, s: 0.75, c: 1.05, color: '#8ab8ff', alpha: 0.35, swatch: sw('#6a8fbf', '#f0f6ff')},
	ocean: {name: 'Đại dương', cat: 'Lạnh', s: 1.15, c: 1.08, color: '#0090c0', alpha: 0.35, swatch: sw('#005a7a', '#4fd6ff')},
	mint: {name: 'Bạc hà', cat: 'Lạnh', b: 1.05, s: 0.95, color: '#5fe0b0', alpha: 0.3, swatch: sw('#2a9a7a', '#c9fff0')},
	midnight: {name: 'Nửa đêm', cat: 'Lạnh', b: 0.88, c: 1.15, s: 0.85, color: '#1a2a80', alpha: 0.45, vig: 0.45, swatch: sw('#0a0f33', '#4060c0')},
	nordic: {name: 'Bắc Âu', cat: 'Lạnh', b: 1.04, c: 0.95, s: 0.7, color: '#7aa0c0', alpha: 0.3, fade: 0.08, swatch: sw('#5a7080', '#dfe8ee')},

	vintage: {name: 'Hoài cổ', cat: 'Retro', b: 1.03, c: 0.92, s: 0.8, sepia: 0.35, color: '#e8c99b', alpha: 0.3, fade: 0.08, vig: 0.3, swatch: sw('#8a6a45', '#e8d3a8')},
	film: {name: 'Phim nhựa', cat: 'Retro', c: 1.1, s: 0.82, sepia: 0.1, color: '#ffd9a0', alpha: 0.18, fade: 0.05, vig: 0.4, swatch: sw('#3d3a2e', '#d8c08f')},
	kodak: {name: 'Kodak', cat: 'Retro', c: 1.08, s: 1.12, sepia: 0.12, color: '#ffc060', alpha: 0.25, hi: '#fff0c0', hiA: 0.08, swatch: sw('#b0602a', '#ffe0a0')},
	fuji: {name: 'Fuji', cat: 'Retro', c: 1.05, s: 1.05, hue: 6, color: '#40b090', alpha: 0.22, hi: '#ffe8d0', hiA: 0.06, swatch: sw('#2a7060', '#f0e0c8')},
	polaroid: {name: 'Polaroid', cat: 'Retro', b: 1.06, c: 0.88, s: 0.85, sepia: 0.15, color: '#b0e0d0', alpha: 0.2, fade: 0.15, swatch: sw('#80b0a8', '#fff3dc')},
	seventies: {name: 'Thập niên 70', cat: 'Retro', c: 0.95, s: 0.9, sepia: 0.4, hue: -10, color: '#d07a30', alpha: 0.3, fade: 0.12, vig: 0.3, swatch: sw('#8a4a1a', '#e8b878')},
	vhs: {name: 'VHS', cat: 'Retro', b: 1.04, c: 0.9, s: 1.2, hue: 8, color: '#a040c0', alpha: 0.2, fade: 0.1, vig: 0.35, swatch: sw('#40205a', '#ff80b0')},
	faded: {name: 'Bạc màu', cat: 'Retro', b: 1.05, c: 0.85, s: 0.65, fade: 0.2, swatch: sw('#6a6a6a', '#d0ccc4')},

	vivid: {name: 'Rực rỡ', cat: 'Tươi sáng', c: 1.12, s: 1.4, swatch: sw('#e6197a', '#19c2e6')},
	pastel: {name: 'Pastel', cat: 'Tươi sáng', b: 1.08, c: 0.88, s: 0.8, color: '#ffd6e8', alpha: 0.3, fade: 0.06, swatch: sw('#f7b6d2', '#b6e3f7')},
	dreamy: {name: 'Mơ màng', cat: 'Tươi sáng', b: 1.06, c: 0.9, s: 1.1, color: '#c9a0ff', alpha: 0.25, hi: '#ffffff', hiA: 0.08, swatch: sw('#8f6fe0', '#ffc1e3')},
	spring: {name: 'Mùa xuân', cat: 'Tươi sáng', b: 1.06, s: 1.2, hue: -5, color: '#a0e070', alpha: 0.2, swatch: sw('#6ac04a', '#ffc0d8')},
	tropical: {name: 'Nhiệt đới', cat: 'Tươi sáng', c: 1.1, s: 1.35, color: '#00c0a0', alpha: 0.2, hi: '#ffd060', hiA: 0.1, swatch: sw('#00a080', '#ffd060')},
	candy: {name: 'Kẹo ngọt', cat: 'Tươi sáng', b: 1.05, s: 1.3, color: '#ff70c0', alpha: 0.25, swatch: sw('#ff4fa3', '#ffd0f0')},
	neon: {name: 'Neon', cat: 'Tươi sáng', c: 1.2, s: 1.5, color: '#a020ff', alpha: 0.3, hi: '#00e0ff', hiA: 0.1, vig: 0.3, swatch: sw('#7a00ff', '#00e0ff')},
	bright: {name: 'Sáng bừng', cat: 'Tươi sáng', b: 1.12, c: 1.02, s: 1.1, hi: '#ffffff', hiA: 0.06, swatch: sw('#ffd0a0', '#ffffff')},

	moody: {name: 'Trầm buồn', cat: 'Tâm trạng', b: 0.9, c: 1.2, s: 0.7, color: '#1e3a5a', alpha: 0.4, vig: 0.45, swatch: sw('#0f1c2b', '#5d7a8f')},
	dark: {name: 'U tối', cat: 'Tâm trạng', b: 0.82, c: 1.25, s: 0.8, vig: 0.6, swatch: sw('#050505', '#5a5a5a')},
	forest: {name: 'Rừng sâu', cat: 'Tâm trạng', b: 0.94, c: 1.12, s: 0.85, color: '#2a6a3a', alpha: 0.4, vig: 0.4, swatch: sw('#14301c', '#7aa070')},
	rainy: {name: 'Ngày mưa', cat: 'Tâm trạng', b: 0.95, c: 0.95, s: 0.6, color: '#5a7a90', alpha: 0.35, fade: 0.08, vig: 0.3, swatch: sw('#3a4a55', '#a8b8c0')},
	lonely: {name: 'Cô đơn', cat: 'Tâm trạng', b: 0.95, c: 1.08, s: 0.45, color: '#506a8a', alpha: 0.3, vig: 0.5, swatch: sw('#2a3340', '#9aa6b5')},
	romance: {name: 'Lãng mạn', cat: 'Tâm trạng', b: 1.03, c: 0.95, s: 1.05, color: '#ff7aa0', alpha: 0.3, hi: '#ffe0e8', hiA: 0.08, vig: 0.25, swatch: sw('#c04070', '#ffd0dc')},
	nostalgia: {name: 'Kỷ niệm', cat: 'Tâm trạng', b: 1.02, c: 0.9, s: 0.75, sepia: 0.3, color: '#f0b080', alpha: 0.25, fade: 0.12, vig: 0.35, swatch: sw('#7a5a40', '#f0d0b0')},

	bw: {name: 'Đen trắng', cat: 'Đen trắng', gray: 1, c: 1.15, swatch: sw('#111', '#eee')},
	bwsoft: {name: 'Trắng đen dịu', cat: 'Đen trắng', gray: 1, c: 0.9, b: 1.05, fade: 0.12, swatch: sw('#555', '#eee')},
	bwhigh: {name: 'Tương phản cao', cat: 'Đen trắng', gray: 1, c: 1.45, vig: 0.3, swatch: sw('#000', '#fff')},
	sepia: {name: 'Nâu đỏ', cat: 'Đen trắng', gray: 1, sepia: 0.8, c: 1.05, vig: 0.3, swatch: sw('#3a2614', '#e0c090')},
	selenium: {name: 'Xanh thép', cat: 'Đen trắng', gray: 1, c: 1.15, color: '#3a5a80', alpha: 0.45, swatch: sw('#141c26', '#b0c0d0')},
};

const lerp = (from: number, to: number, k: number) => from + (to - from) * k;
const isActive = (f?: ColorFilter | null) =>
	!!f && ((f.preset && f.preset !== 'none' && (f.intensity ?? 1) > 0) ||
		!!(f.brightness || f.contrast || f.saturation || f.temperature || f.tint || f.vignette || f.hue || f.fade));

/** CSS filter + các lớp phủ của bộ lọc (dùng chung cho render và editor). */
export const gradeStyle = (f?: ColorFilter | null) => {
	if (!isActive(f)) return null;
	const g = f!;
	const P = FILTER_PRESETS[g.preset] ?? FILTER_PRESETS.none;
	const k = Math.max(0, Math.min(1, g.intensity ?? 1));
	const b = lerp(1, P.b ?? 1, k) * (1 + (g.brightness ?? 0) / 250);
	const c = lerp(1, P.c ?? 1, k) * (1 + (g.contrast ?? 0) / 200);
	const s = lerp(1, P.s ?? 1, k) * (1 + (g.saturation ?? 0) / 100);
	const parts = [`brightness(${b.toFixed(3)})`, `contrast(${c.toFixed(3)})`, `saturate(${Math.max(0, s).toFixed(3)})`];
	if (P.sepia) parts.push(`sepia(${(P.sepia * k).toFixed(3)})`);
	if (P.gray) parts.push(`grayscale(${(P.gray * k).toFixed(3)})`);
	const hue = (P.hue ?? 0) * k + (g.hue ?? 0);
	if (hue) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
	const layers: React.CSSProperties[] = [];
	if (P.color && P.alpha) layers.push({backgroundColor: P.color, opacity: P.alpha * k, mixBlendMode: 'soft-light'});
	if (P.hi && P.hiA) layers.push({backgroundColor: P.hi, opacity: P.hiA * k, mixBlendMode: 'screen'});
	const fd = Math.min(0.5, (P.fade ?? 0) * k + (g.fade ?? 0) / 250);
	if (fd > 0) layers.push({backgroundColor: '#7a7a7a', opacity: fd, mixBlendMode: 'lighten'});
	const t = g.temperature ?? 0;
	if (t) layers.push({backgroundColor: t > 0 ? '#ff8a1e' : '#1e7bff', opacity: (Math.abs(t) / 100) * 0.45, mixBlendMode: 'soft-light'});
	const ti = g.tint ?? 0;
	if (ti) layers.push({backgroundColor: ti > 0 ? '#e01ee0' : '#1ee05a', opacity: (Math.abs(ti) / 100) * 0.3, mixBlendMode: 'soft-light'});
	const v = Math.min(1, (P.vig ?? 0) * k + (g.vignette ?? 0) / 100);
	if (v > 0) layers.push({background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${(v * 0.85).toFixed(3)}) 100%)`});
	return {filter: parts.join(' '), layers};
};

/** Bọc phần hình (video/ảnh) để áp bộ lọc; chữ / phụ đề nên nằm ngoài để giữ nguyên màu. */
export const ColorGrade: React.FC<{f?: ColorFilter | null; children: React.ReactNode}> = ({f, children}) => {
	const g = gradeStyle(f);
	if (!g) return <>{children}</>;
	return (
		<AbsoluteFill style={{isolation: 'isolate'}}>
			<AbsoluteFill style={{filter: g.filter}}>{children}</AbsoluteFill>
			{g.layers.map((st, i) => (
				<AbsoluteFill key={i} style={st} />
			))}
		</AbsoluteFill>
	);
};
