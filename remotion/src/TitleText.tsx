import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {TitleProps} from './schema';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const TitleText: React.FC<TitleProps> = (p) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	const f = frame - Math.round(p.start * fps);
	const total = Math.round(p.duration * fps);
	if (f < 0 || f > total) return null;

	const enter = spring({frame: f, fps, config: {damping: 14}});
	const exit = interpolate(f, [total - fps * 0.5, total], [1, 0], clamp);

	let opacity = exit;
	let transform = '';
	let text = p.text;
	let textShadow = `0 6px 24px rgba(0,0,0,.55)`;

	switch (p.animation) {
		case 'fade':
			opacity *= interpolate(f, [0, fps * 0.7], [0, 1], clamp);
			break;
		case 'zoom':
			opacity *= interpolate(f, [0, fps * 0.25], [0, 1], clamp);
			transform = `scale(${interpolate(enter, [0, 1], [0.3, 1])})`;
			break;
		case 'bounce': {
			const b = spring({frame: f, fps, config: {damping: 6, stiffness: 120}});
			transform = `translateY(${(1 - b) * -400}px)`;
			break;
		}
		case 'slide-up':
			opacity *= enter;
			transform = `translateY(${(1 - enter) * 220}px)`;
			break;
		case 'typewriter': {
			const chars = Array.from(p.text);
			text = chars.slice(0, Math.floor(f / (fps * 0.07)) + 1).join('');
			break;
		}
		case 'glow': {
			opacity *= interpolate(f, [0, fps * 0.5], [0, 1], clamp);
			const g = 20 + 14 * Math.sin(f / 5);
			textShadow = `0 0 ${g}px ${p.accentColor}, 0 0 ${g * 2}px ${p.accentColor}`;
			break;
		}
	}

	const sub = interpolate(f, [fps * 0.5, fps * 1.1], [0, 1], clamp);
	return (
		<AbsoluteFill style={{alignItems: 'center'}}>
			<div
				style={{
					position: 'absolute',
					top: `${p.y}%`,
					width: '90%',
					transform: 'translateY(-50%)',
					textAlign: 'center',
					fontFamily: p.fontFamily,
				}}
			>
				<div
					style={{
						fontSize: p.fontSize,
						fontWeight: 900,
						lineHeight: 1.1,
						color: p.color,
						opacity,
						transform,
						textShadow,
					}}
				>
					{text}
				</div>
				{p.subtext ? (
					<div
						style={{
							marginTop: p.fontSize * 0.25,
							fontSize: p.fontSize * 0.38,
							fontWeight: 700,
							letterSpacing: p.fontSize * 0.04,
							color: p.accentColor,
							opacity: sub * exit,
							textShadow: '0 4px 16px rgba(0,0,0,.6)',
						}}
					>
						{p.subtext}
					</div>
				) : null}
			</div>
		</AbsoluteFill>
	);
};
