import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Clip} from './types';
import {ANIM_IN, ANIM_OUT, applyIn, applyOut, fxTransform, noFx} from '../anim';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const TEXT_IN = ANIM_IN.map((a) => a[0]);
export const TEXT_OUT = ANIM_OUT.map((a) => a[0]);

const hexA = (h: string, a: number) => {
	const n = parseInt((h || '#000000').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
	return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Chữ trên timeline: hiệu ứng vào/ra riêng, vị trí X/Y, nền hộp, viền, bóng. */
export const TextClip: React.FC<{c: Clip; frames: number}> = ({c, frames}) => {
	const f = useCurrentFrame();
	const {fps, width} = useVideoConfig();
	const t = c.title;
	if (!t) return null;
	const animIn = t.animIn ?? t.animation ?? 'fade';
	const animOut = t.animOut ?? 'fade';
	const inF = Math.max(1, Math.round((t.inDur ?? (animIn === 'typewriter' ? 0 : 0.5)) * fps));
	const outF = Math.max(1, Math.round((t.outDur ?? 0.5) * fps));

	// ---- vào / ra (dùng chung anim.ts) ----
	const D = width * 0.25;
	let text = t.text;
	const fx = noFx();
	if (animIn === 'typewriter') {
		const chars = Array.from(t.text);
		const per = t.inDur ? (t.inDur * fps) / Math.max(1, chars.length) : fps * 0.07;
		text = chars.slice(0, Math.floor(f / per) + 1).join('');
	} else applyIn(fx, animIn, f, inF, fps, D);
	applyOut(fx, animOut, frames - f, outF, D);
	const g = 20 + 14 * Math.sin(f / 5);
	const glow = fx.glow ? `0 0 ${g}px ${t.accentColor}, 0 0 ${g * 2}px ${t.accentColor}` : '';
	const {opacity, blur} = fx;

	const sub = interpolate(f, [fps * 0.5, fps * 1.1], [0, 1], clamp);
	const shadow = [glow, t.shadow === false ? '' : '0 6px 24px rgba(0,0,0,.55)'].filter(Boolean).join(', ') || 'none';
	const bg = t.bgColor && (t.bgOpacity ?? 0) > 0 ? hexA(t.bgColor, t.bgOpacity ?? 0.6) : 'transparent';
	const pad = t.fontSize * 0.3;
	return (
		<AbsoluteFill style={{opacity: (c.opacity ?? 1) * opacity}}>
			<div
				style={{
					position: 'absolute',
					left: `${t.x ?? 50}%`,
					top: `${t.y}%`,
					maxWidth: '92%',
					transform: `translate(-50%, -50%) ${fxTransform(fx)} rotate(${c.rotation ?? 0}deg)`,
					textAlign: t.align ?? 'center',
					fontFamily: t.fontFamily,
					filter: blur ? `blur(${blur}px)` : undefined,
					background: bg,
					padding: bg === 'transparent' ? 0 : `${pad * 0.5}px ${pad}px`,
					borderRadius: t.bgRadius ?? pad * 0.5,
					whiteSpace: 'pre-wrap',
				}}
			>
				<div
					style={{
						fontSize: t.fontSize,
						fontWeight: t.bold === false ? 400 : 900,
						fontStyle: t.italic ? 'italic' : undefined,
						lineHeight: 1.15,
						letterSpacing: (t.letterSpacing ?? 0) * t.fontSize * 0.01,
						color: t.color,
						textShadow: shadow,
						WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth}px ${t.strokeColor ?? '#000'}` : undefined,
						paintOrder: 'stroke fill',
						textTransform: t.uppercase ? 'uppercase' : undefined,
					}}
				>
					{text}
				</div>
				{t.subtext ? (
					<div
						style={{
							marginTop: t.fontSize * 0.25,
							fontSize: t.fontSize * 0.38,
							fontWeight: 700,
							letterSpacing: t.fontSize * 0.04,
							color: t.accentColor,
							opacity: sub,
							textShadow: '0 4px 16px rgba(0,0,0,.6)',
						}}
					>
						{t.subtext}
					</div>
				) : null}
			</div>
		</AbsoluteFill>
	);
};
