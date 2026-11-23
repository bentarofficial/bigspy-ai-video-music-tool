import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Line, SubtitleStyle} from './schema';
import {applyIn, applyOut, fxTransform, noFx, type Fx} from './anim';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const HOLD = 0.4; // giữ câu thêm chút sau chữ cuối

type W = Line['words'][number];

/** Một chữ: lớp màu thường + lớp màu highlight được "quét" từ trái sang phải theo tiến độ hát. */
const ease = (x: number) => x * x * (3 - 2 * x); // smoothstep

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3); // ease-out cubic: nhanh lúc đầu, đáp rất êm
const ramp = (t: number, from: number, dur: number) => easeOut(interpolate(t, [from, from + dur], [0, 1], clamp));

/** Kiểu chill (chữ chảy / sáng dần / sương mờ): hiệu ứng chạy theo TỪNG KÝ TỰ, ký tự sau trễ hơn ký tự trước
 *  -> mắt thấy một dòng chảy liên tục thay vì từng chữ bật ra (giống cách CapCut làm). */
const CharWord: React.FC<{w: W; t: number; s: SubtitleStyle; reveal: [number, number] | null; wfx?: Fx}> = ({w, t, s, reveal, wfx}) => {
	const text = (s.uppercase ? w.text.toUpperCase() : w.text).normalize('NFC');
	const chars = Array.from(text);
	const n = chars.length || 1;
	const dw = Math.max(w.end - w.start, 0.15);
	const stroke: React.CSSProperties = {WebkitTextStroke: `${s.strokeWidth}px ${s.strokeColor}`, paintOrder: 'stroke fill'};
	return (
		<span
			style={{
				display: 'inline-block',
				whiteSpace: 'nowrap',
				margin: `0 ${s.fontSize * 0.14}px`,
				transform: wfx ? fxTransform(wfx) : undefined,
				opacity: wfx ? wfx.opacity : 1,
				filter: wfx?.blur ? `blur(${wfx.blur}px)` : undefined,
			}}
		>
			{chars.map((ch, j) => {
				const f = j / n;
				let k = 1, op = 1, blur = 0, ty = 0, sc = 1, glow = 0, sung = 0;
				if (s.mode === 'preview' && reveal) {
					const [a, b] = reveal;
					k = ramp(t, a + (b - a) * f * 0.85, Math.max(0.3, (b - a) * 0.55));
					op = k; blur = (1 - k) * 5; ty = (1 - k) * 0.14;
					sung = ramp(t, w.start + dw * f, 0.22);
				} else if (s.mode === 'glow') {
					k = ramp(t, w.start + dw * f - 0.05, 0.55);
					op = 0.4 + 0.6 * k; glow = k;
				} else if (s.mode === 'mist') {
					k = ramp(t, w.start + dw * f - 0.3, 0.8);
					op = k; blur = (1 - k) * 9; sc = 1 + (1 - k) * 0.18;
				}
				return (
					<span
						key={j}
						style={{
							position: 'relative',
							display: 'inline-block',
							opacity: op,
							transform: ty || sc !== 1 ? `translateY(${ty}em) scale(${sc})` : undefined,
							filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
							textShadow: glow > 0.01 ? `0 0 ${s.fontSize * 0.25 * glow}px ${s.highlightColor}` : undefined,
						}}
					>
						<span style={{color: s.color, ...stroke}}>{ch}</span>
						{sung > 0.01 ? (
							<span style={{position: 'absolute', left: 0, top: 0, color: s.highlightColor, opacity: sung, ...stroke}}>{ch}</span>
						) : null}
					</span>
				);
			})}
		</span>
	);
};

const Word: React.FC<{w: W; t: number; s: SubtitleStyle; reveal: [number, number] | null; wfx?: Fx}> = (props) => {
	const {w, t, s, wfx} = props;
	if (s.mode === 'preview' || s.mode === 'glow' || s.mode === 'mist') return <CharWord {...props} />;
	const progress = interpolate(t, [w.start, Math.max(w.end, w.start + 0.05)], [0, 1], clamp);
	const hump = t >= w.start && t <= w.end ? Math.sin(Math.PI * progress) : 0;
	const scale = s.mode === 'karaoke' ? 1 + 0.05 * hump : 1; // karaoke: phồng rất nhẹ, lên xuống êm
	const text = s.uppercase ? w.text.toUpperCase() : w.text;
	const stroke: React.CSSProperties = {
		WebkitTextStroke: `${s.strokeWidth}px ${s.strokeColor}`,
		paintOrder: 'stroke fill',
	};
	return (
		<span
			style={{
				position: 'relative',
				display: 'inline-block',
				margin: `0 ${s.fontSize * 0.14}px`,
				transform: `${wfx ? fxTransform(wfx) + ' ' : ''}scale(${scale})`,
				filter: wfx?.blur ? `blur(${wfx.blur}px)` : undefined,
				opacity: wfx ? wfx.opacity : 1,
			}}
		>
			<span style={{color: s.color, ...stroke}}>{text}</span>
			<span
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					color: s.highlightColor,
					...stroke,
					clipPath: `inset(-20% ${100 - progress * 100}% -20% -5%)`,
				}}
			>
				{text}
			</span>
		</span>
	);
};

const LineView: React.FC<{line: Line; t: number; s: SubtitleStyle; scale?: number; dim?: boolean; until: number}> = ({
	line,
	t,
	s,
	scale = 1,
	dim,
	until,
}) => {
	const shownAt = line.start - s.leadIn;
	// giữ câu trên màn hình tới khi câu kế tiếp xuất hiện (phụ đề xuyên suốt)
	const hideAt = Math.max(until, line.end + HOLD);
	const {fps, width} = useVideoConfig();
	const D = width * 0.12;
	const animIn = s.animIn, animOut = s.animOut ?? 'fade';
	const inF = Math.round((s.inDur ?? 0.3) * fps), outF = Math.round((s.outDur ?? (s.animOut ? 0.3 : 0.15)) * fps);
	const fIn = (t - shownAt) * fps, rOut = Number.isFinite(hideAt) ? (hideAt - t) * fps : 1e9;
	const perWord = !!animIn?.startsWith('word-');
	// cả câu: hiệu ứng vào/ra (chưa chọn hiệu ứng = kiểu cũ: mờ dần + trồi nhẹ)
	const fx = noFx();
	if (!animIn) {
		fx.opacity = interpolate(t, [shownAt, shownAt + 0.45], [0, 1], clamp);
		fx.ty = interpolate(fx.opacity, [0, 1], [20, 0]);
	} else if (!perWord) applyIn(fx, animIn, fIn, inF, fps, D);
	applyOut(fx, animOut, rOut, outF, D);
	const opacity = fx.opacity;
	const stagger = Math.max(1, Math.round(fps * 0.07));
	const wordFx = (i: number) => (perWord ? applyIn(noFx(), {'word-pop': 'pop', 'word-rise': 'rise', 'word-fade': 'fade'}[animIn!] ?? 'fade', fIn - i * stagger, inF, fps, D) : undefined);
	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				justifyContent: 'center',
				maxWidth: '88%',
				lineHeight: 1.25,
				fontFamily: s.fontFamily,
				fontSize: s.fontSize * scale,
				fontWeight: 900,
				opacity: opacity * (dim ? 0.55 : 1),
				transform: fxTransform({...fx, opacity: 1}),
				filter: fx.blur ? `blur(${fx.blur}px)` : undefined,
				textAlign: 'center',
			}}
		>
			{line.words.map((w, i) => {
				// preview: chữ i lộ dần trong lúc chữ (i - N) đang được hát -> dòng chữ chảy liên tục
				let reveal: [number, number] | null = null;
				if (s.mode === 'preview') {
					const k = i - s.lookahead;
					if (k < 0) reveal = [shownAt, shownAt + 0.6];
					else {
						const src = line.words[k];
						const a = src.start - 0.06;
						const nx = line.words[k + 1];
						const b = Math.max(a + 0.4, Math.min(nx ? nx.start : src.end, src.end + 0.1, a + 0.9));
						reveal = [a, b];
					}
				}
				return <Word key={i} w={w} t={dim ? -1 : t} s={s} reveal={reveal} wfx={wordFx(i)} />;
			})}
		</div>
	);
};

export const Subtitles: React.FC<{lines: Line[]; s: SubtitleStyle}> = ({lines, s}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const t = frame / fps;
	if (!lines.length) return null;

	// câu hiện tại = câu cuối cùng đã bắt đầu hiện (tính cả thời gian hiện trước)
	let idx = -1;
	lines.forEach((l, i) => {
		if (t >= l.start - s.leadIn) idx = i;
	});
	// trước câu đầu tiên: hiện sẵn câu đầu (mờ dần vào) để màn hình không trống phụ đề
	if (idx < 0) idx = 0;
	const line = lines[idx];
	const next = lines[idx + 1];
	const until = next ? next.start - s.leadIn : Infinity;
	const visible = true;

	const justify = s.position === 'top' ? 'flex-start' : s.position === 'center' ? 'center' : 'flex-end';
	return (
		<AbsoluteFill
			style={{
				justifyContent: justify,
				alignItems: 'center',
				padding: s.position === 'center' ? 0 : '12% 0',
				gap: s.fontSize * 0.3,
			}}
		>
			{visible ? <LineView key={idx} line={line} t={t} s={s} until={until} /> : null}
			{/* full: hiện trước cả câu tiếp theo (mờ, nhỏ hơn) */}
			{s.mode === 'full' && visible && next ? (
				<LineView key={`n${idx}`} line={{...next, start: line.start, end: line.end}} t={t} s={s} scale={0.75} dim until={until} />
			) : null}
		</AbsoluteFill>
	);
};
