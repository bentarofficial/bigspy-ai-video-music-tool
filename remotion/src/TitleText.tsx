import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {applyIn, applyOut, fxTransform, noFx} from './anim';
import type {TitleProps} from './schema';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const TitleText: React.FC<TitleProps> = (p) => {
	const frame = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	const f = frame - Math.round(p.start * fps);
	const total = Math.round(p.duration * fps);
	if (f < 0 || f > total) return null;

	const D = width * 0.25;
	const fx = noFx();
	let text = p.text;
	if (p.animation === 'typewriter') {
		text = Array.from(p.text).slice(0, Math.floor(f / (fps * 0.07)) + 1).join('');
	} else applyIn(fx, p.animation, f, Math.round(fps * 0.6), fps, D);
	applyOut(fx, p.animOut ?? 'fade', total - f, Math.round(fps * 0.5), D);
	const exit = applyOut(noFx(), p.animOut ?? 'fade', total - f, Math.round(fps * 0.5), D).opacity;
	const {opacity} = fx;
	const transform = fxTransform(fx);
	const g = 20 + 14 * Math.sin(f / 5);
	const textShadow = fx.glow ? `0 0 ${g}px ${p.accentColor}, 0 0 ${g * 2}px ${p.accentColor}` : `0 6px 24px rgba(0,0,0,.55)`;

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
						filter: fx.blur ? `blur(${fx.blur}px)` : undefined,
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
