// Hiệu ứng xuất hiện / biến mất dùng chung cho tiêu đề, khối chữ và phụ đề.
import {interpolate, spring} from 'remotion';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** [id, tên hiển thị] – thứ tự hiện trong menu */
export const ANIM_IN: [string, string][] = [
	['none', 'Không'], ['fade', 'Mờ dần'], ['zoom', 'Phóng to'], ['pop', 'Bật nảy'], ['bounce', 'Rơi nảy'],
	['drop', 'Rơi xuống'], ['rise', 'Trồi lên'], ['slide-up', 'Trượt lên'], ['slide-down', 'Trượt xuống'],
	['slide-left', 'Trượt từ phải'], ['slide-right', 'Trượt từ trái'], ['blur', 'Hiện từ mờ'], ['spin', 'Xoay vào'],
	['flip', 'Lật'], ['stretch', 'Kéo giãn'], ['swing', 'Đung đưa'], ['glitch', 'Nhiễu (glitch)'], ['shake', 'Rung'],
	['glow', 'Phát sáng'], ['typewriter', 'Đánh máy'],
	// riêng phụ đề: từng chữ lần lượt hiện
	['word-pop', 'Từng chữ bật'], ['word-rise', 'Từng chữ trồi'], ['word-fade', 'Từng chữ mờ dần'],
];
export const ANIM_OUT: [string, string][] = [
	['none', 'Không'], ['fade', 'Mờ dần'], ['zoom-out', 'Thu nhỏ'], ['zoom-in', 'Phóng to biến mất'],
	['slide-up', 'Trượt lên'], ['slide-down', 'Trượt xuống'], ['slide-left', 'Trượt sang trái'], ['slide-right', 'Trượt sang phải'],
	['blur', 'Tan mờ'], ['spin', 'Xoay ra'], ['flip', 'Lật'], ['drop', 'Rơi xuống'], ['glitch', 'Nhiễu (glitch)'],
];

export type Fx = {opacity: number; tx: number; ty: number; sc: number; sx: number; rot: number; ry: number; blur: number; glow: number};
export const noFx = (): Fx => ({opacity: 1, tx: 0, ty: 0, sc: 1, sx: 1, rot: 0, ry: 0, blur: 0, glow: 0});

/** Áp hiệu ứng VÀO. f: khung đã trôi qua kể từ lúc bắt đầu hiện, n: số khung của hiệu ứng, D: quãng trượt (px). */
export function applyIn(fx: Fx, name: string, f: number, n: number, fps: number, D: number): Fx {
	n = Math.max(1, n);
	const p = interpolate(f, [0, n], [0, 1], clamp);
	const sp = spring({frame: f, fps, config: {damping: 14}, durationInFrames: n});
	switch (name) {
		case 'fade': fx.opacity *= p; break;
		case 'zoom': fx.opacity *= p; fx.sc *= interpolate(sp, [0, 1], [0.3, 1]); break;
		case 'pop': fx.opacity *= Math.min(1, p * 3); fx.sc *= spring({frame: f, fps, config: {damping: 8, stiffness: 160}}); break;
		case 'bounce': fx.ty -= (1 - spring({frame: f, fps, config: {damping: 6, stiffness: 120}})) * D * 1.5; break;
		case 'drop': fx.opacity *= p; fx.ty -= (1 - sp) * D * 0.6; break;
		case 'rise': fx.opacity *= p; fx.ty += (1 - sp) * D * 0.35; fx.sc *= interpolate(sp, [0, 1], [0.85, 1]); break;
		case 'slide-up': fx.opacity *= sp; fx.ty += (1 - sp) * D; break;
		case 'slide-down': fx.opacity *= sp; fx.ty -= (1 - sp) * D; break;
		case 'slide-left': fx.opacity *= sp; fx.tx += (1 - sp) * D; break;
		case 'slide-right': fx.opacity *= sp; fx.tx -= (1 - sp) * D; break;
		case 'blur': fx.opacity *= p; fx.blur += (1 - p) * 30; break;
		case 'spin': fx.opacity *= p; fx.rot += (1 - sp) * -180; fx.sc *= interpolate(sp, [0, 1], [0.2, 1]); break;
		case 'flip': fx.opacity *= p; fx.ry += (1 - sp) * 90; break;
		case 'stretch': fx.opacity *= p; fx.sx *= interpolate(sp, [0, 1], [2.2, 1]); fx.sc *= interpolate(sp, [0, 1], [0.6, 1]); break;
		case 'swing': fx.opacity *= p; fx.rot += Math.sin(f / 3) * 12 * (1 - p); break;
		case 'shake': fx.opacity *= Math.min(1, p * 3); fx.tx += Math.sin(f * 2.1) * 18 * (1 - p); break;
		case 'glitch': {
			fx.opacity *= f < n ? (Math.floor(f / 2) % 2 ? 0.35 : 1) : 1;
			if (f < n) { fx.tx += (((f * 37) % 11) - 5) * 6; fx.sx *= 1 + (((f * 13) % 7) - 3) * 0.03; }
			break;
		}
		case 'glow': fx.opacity *= interpolate(f, [0, fps * 0.5], [0, 1], clamp); fx.glow = 1; break;
	}
	return fx;
}

/** Áp hiệu ứng RA. r: số khung còn lại tới lúc biến mất hẳn (0 = đã biến mất). */
export function applyOut(fx: Fx, name: string, r: number, n: number, D: number): Fx {
	n = Math.max(1, n);
	const q = interpolate(r, [n, 0], [0, 1], clamp);
	switch (name) {
		case 'fade': fx.opacity *= 1 - q; break;
		case 'zoom-out': fx.opacity *= 1 - q; fx.sc *= 1 - q * 0.7; break;
		case 'zoom-in': fx.opacity *= 1 - q; fx.sc *= 1 + q * 0.8; break;
		case 'slide-up': fx.opacity *= 1 - q; fx.ty -= q * D; break;
		case 'slide-down': fx.opacity *= 1 - q; fx.ty += q * D; break;
		case 'slide-left': fx.opacity *= 1 - q; fx.tx -= q * D; break;
		case 'slide-right': fx.opacity *= 1 - q; fx.tx += q * D; break;
		case 'blur': fx.opacity *= 1 - q; fx.blur += q * 30; break;
		case 'spin': fx.opacity *= 1 - q; fx.rot += q * 180; fx.sc *= 1 - q * 0.8; break;
		case 'flip': fx.opacity *= 1 - q; fx.ry -= q * 90; break;
		case 'drop': fx.opacity *= 1 - q; fx.ty += q * q * D * 1.2; fx.rot += q * 8; break;
		case 'glitch': if (q > 0) { fx.opacity *= q >= 1 ? 0 : Math.floor(r / 2) % 2 ? 0.3 : 1; fx.tx += (((r * 37) % 11) - 5) * 6 * q; } break;
	}
	return fx;
}

export const fxTransform = (fx: Fx) =>
	`translate(${fx.tx}px, ${fx.ty}px) perspective(800px) rotateY(${fx.ry}deg) rotate(${fx.rot}deg) scale(${fx.sc * fx.sx}, ${fx.sc})`;
