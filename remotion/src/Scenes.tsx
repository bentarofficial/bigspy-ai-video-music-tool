import React from 'react';
import {
	AbsoluteFill,
	Easing,
	interpolate,
	Loop,
	OffthreadVideo,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {
	linearTiming,
	TransitionSeries,
	type TransitionPresentation,
	type TransitionPresentationComponentProps,
} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import type {Scene} from './schema';

const DIRS = ['from-right', 'from-left', 'from-bottom', 'from-top'] as const;

type SmoothKind = 'dissolve-zoom' | 'blur-dissolve' | 'soft-push' | 'light-leak';
const SMOOTH = new Set<string>(['dissolve-zoom', 'blur-dissolve', 'soft-push', 'light-leak']);

/** Chuyển cảnh kết hợp: CẢ cảnh cũ lẫn cảnh mới cùng chuyển động (mờ chéo + zoom / nhoè / đẩy / ánh sáng)
 *  nên mắt không thấy điểm cắt -> mượt, không khựng. */
const SmoothComp: React.FC<TransitionPresentationComponentProps<{kind: SmoothKind; dir: number}>> = ({
	children,
	presentationDirection,
	presentationProgress: p,
	passedProps: {kind, dir},
}) => {
	const enter = presentationDirection === 'entering';
	const peak = 1 - Math.abs(p - 0.5) * 2; // 0 -> 1 (giữa) -> 0
	let style: React.CSSProperties = {};
	let glow: React.ReactNode = null;
	switch (kind) {
		case 'dissolve-zoom':
			style = enter ? {opacity: p, transform: `scale(${1.08 - 0.08 * p})`} : {transform: `scale(${1 + 0.08 * p})`};
			break;
		case 'blur-dissolve':
			style = enter ? {opacity: p, filter: `blur(${(1 - p) * 14}px)`} : {filter: `blur(${p * 14}px)`};
			break;
		case 'soft-push':
			style = enter
				? {opacity: p, transform: `translateX(${dir * (1 - p) * 18}%) scale(${1.04 - 0.04 * p})`}
				: {transform: `translateX(${-dir * p * 18}%) scale(${1 + 0.04 * p})`, filter: `blur(${p * 6}px)`};
			break;
		case 'light-leak':
			style = enter ? {opacity: p} : {filter: `brightness(${1 + p * 0.6})`};
			if (enter) {
				glow = (
					<AbsoluteFill
						style={{background: 'radial-gradient(ellipse at 70% 30%, rgba(255,214,150,.95), rgba(255,140,60,.45) 45%, transparent 75%)',
							opacity: peak * 0.85, mixBlendMode: 'screen'}}
					/>
				);
			}
			break;
	}
	return (
		<AbsoluteFill>
			<AbsoluteFill style={style}>{children}</AbsoluteFill>
			{glow}
		</AbsoluteFill>
	);
};
const smooth = (kind: SmoothKind, dir: number): TransitionPresentation<{kind: SmoothKind; dir: number}> => ({
	component: SmoothComp,
	props: {kind, dir},
});
const EASE = Easing.inOut(Easing.cubic);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentation = (kind: Scene['transition'], i: number): TransitionPresentation<any> => {
	if (SMOOTH.has(kind)) return smooth(kind as SmoothKind, i % 2 ? -1 : 1);
	if (kind === 'slide') return slide({direction: DIRS[i % DIRS.length]});
	if (kind === 'wipe') return wipe({direction: DIRS[(i + 1) % DIRS.length]});
	return fade();
};

const SceneClip: React.FC<{scene: Scene; frames: number; kenBurns: boolean; index: number}> = ({
	scene,
	frames,
	kenBurns,
	index,
}) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	// Ken Burns: zoom chậm, xen kẽ phóng to / thu nhỏ để cảnh có chuyển động
	const [from, to] = index % 2 ? [1.15, 1.02] : [1.02, 1.15];
	const scale = kenBurns ? interpolate(frame, [0, frames], [from, to]) : 1;

	if (!scene.src) {
		return <AbsoluteFill style={{background: 'linear-gradient(135deg,#1d1b4b,#5b2a86,#b0306a)'}} />;
	}
	// clip ngắn hơn cảnh -> lặp lại
	const clipFrames = Math.max(fps, Math.floor(scene.clipDuration * fps) - 2);
	return (
		<AbsoluteFill style={{transform: `scale(${scale})`}}>
			<Loop durationInFrames={clipFrames}>
				<OffthreadVideo
					src={staticFile(scene.src)}
					muted
					style={{width: '100%', height: '100%', objectFit: 'cover'}}
				/>
			</Loop>
		</AbsoluteFill>
	);
};

export const Scenes: React.FC<{scenes: Scene[]; transitionSeconds: number; kenBurns: boolean}> = ({
	scenes,
	transitionSeconds,
	kenBurns,
}) => {
	const {fps} = useVideoConfig();
	if (!scenes.length) {
		return <AbsoluteFill style={{background: 'linear-gradient(135deg,#1d1b4b,#5b2a86,#b0306a)'}} />;
	}
	const T = Math.round(transitionSeconds * fps);
	const len = (s: Scene) => Math.round(s.end * fps) - Math.round(s.start * fps);

	// Mỗi cảnh được kéo dài thêm đúng bằng thời lượng chuyển cảnh phía sau nó, nên tổng thời
	// lượng không đổi và điểm cắt vẫn khớp beat của bài hát.
	return (
		<TransitionSeries>
			{scenes.map((s, i) => {
				const next = scenes[i + 1];
				const tr =
					next && next.transition !== 'none'
						? Math.min(T, Math.floor(len(s) / 2), Math.floor(len(next) / 2))
						: 0;
				const frames = len(s) + tr;
				return (
					<React.Fragment key={i}>
						<TransitionSeries.Sequence durationInFrames={Math.max(1, frames)}>
							<SceneClip scene={s} frames={frames} kenBurns={kenBurns} index={i} />
						</TransitionSeries.Sequence>
						{tr > 0 ? (
							<TransitionSeries.Transition
								presentation={presentation(next.transition, i)}
								timing={linearTiming({durationInFrames: tr, easing: EASE})}
							/>
						) : null}
					</React.Fragment>
				);
			})}
		</TransitionSeries>
	);
};
