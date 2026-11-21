import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Line, SubtitleStyle} from './schema';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const HOLD = 0.4; // giữ câu thêm chút sau chữ cuối

type W = Line['words'][number];

/** Một chữ: lớp màu thường + lớp màu highlight được "quét" từ trái sang phải theo tiến độ hát. */
const Word: React.FC<{w: W; t: number; s: SubtitleStyle; visible: boolean; appearAt: number}> = ({
	w,
	t,
	s,
	visible,
	appearAt,
}) => {
	const progress = interpolate(t, [w.start, Math.max(w.end, w.start + 0.05)], [0, 1], clamp);
	const active = t >= w.start && t < w.end;
	const pop = interpolate(t, [appearAt, appearAt + 0.18], [0, 1], clamp);
	const scale = (active ? 1.08 : 1) * (s.mode === 'preview' ? 0.6 + 0.4 * pop : 1);
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
				transform: `scale(${scale})`,
				opacity: visible ? (s.mode === 'preview' ? pop : 1) : 0,
				transition: 'none',
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
	const opacity =
		interpolate(t, [shownAt, shownAt + 0.2], [0, 1], clamp) *
		(Number.isFinite(hideAt) ? interpolate(t, [hideAt - 0.15, hideAt], [1, 0], clamp) : 1);
	// chỉ số chữ đang/đã hát gần nhất
	let current = -1;
	line.words.forEach((w, i) => {
		if (t >= w.start) current = i;
	});
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
				transform: `translateY(${interpolate(opacity, [0, 1], [20, 0])}px)`,
				textAlign: 'center',
			}}
		>
			{line.words.map((w, i) => {
				// preview: chỉ hiện các chữ đã hát + N chữ kế tiếp
				const visible = s.mode !== 'preview' || i <= current + s.lookahead;
				const trigger = i - s.lookahead - 1;
				const appearAt = trigger < 0 ? shownAt : line.words[trigger].start;
				return <Word key={i} w={w} t={dim ? -1 : t} s={s} visible={visible} appearAt={appearAt} />;
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
