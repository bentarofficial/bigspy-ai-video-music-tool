import React from 'react';
import {
	AbsoluteFill,
	interpolate,
	Loop,
	OffthreadVideo,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import {linearTiming, TransitionSeries, type TransitionPresentation} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import type {Scene} from './schema';

const DIRS = ['from-right', 'from-left', 'from-bottom', 'from-top'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentation = (kind: Scene['transition'], i: number): TransitionPresentation<any> => {
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
								timing={linearTiming({durationInFrames: tr})}
							/>
						) : null}
					</React.Fragment>
				);
			})}
		</TransitionSeries>
	);
};
