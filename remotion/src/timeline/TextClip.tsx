import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Clip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const TEXT_IN = ['none', 'fade', 'zoom', 'pop', 'typewriter', 'bounce', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'blur', 'glow'] as const;
export const TEXT_OUT = ['none', 'fade', 'zoom-out', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'blur'] as const;

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

	// ---- vào ----
	const p = interpolate(f, [0, inF], [0, 1], clamp);
	const sp = spring({frame: f, fps, config: {damping: 14}, durationInFrames: inF});
	let opacity = 1;
	let tx = 0, ty = 0, sc = 1, blur = 0;
	let text = t.text;
	let glow = '';
	const D = width * 0.25;
	switch (animIn) {
		case 'fade': opacity *= p; break;
		case 'zoom': opacity *= p; sc *= interpolate(sp, [0, 1], [0.3, 1]); break;
		case 'pop': sc *= spring({frame: f, fps, config: {damping: 8, stiffness: 160}}); break;
		case 'bounce': ty -= (1 - spring({frame: f, fps, config: {damping: 6, stiffness: 120}})) * D * 1.5; break;
		case 'slide-up': opacity *= sp; ty += (1 - sp) * D; break;
		case 'slide-down': opacity *= sp; ty -= (1 - sp) * D; break;
		case 'slide-left': opacity *= sp; tx += (1 - sp) * D; break;
		case 'slide-right': opacity *= sp; tx -= (1 - sp) * D; break;
		case 'blur': opacity *= p; blur += (1 - p) * 30; break;
		case 'typewriter': {
			const chars = Array.from(t.text);
			const per = t.inDur ? (t.inDur * fps) / Math.max(1, chars.length) : fps * 0.07;
			text = chars.slice(0, Math.floor(f / per) + 1).join('');
			break;
		}
		case 'glow': {
			opacity *= interpolate(f, [0, fps * 0.5], [0, 1], clamp);
			const g = 20 + 14 * Math.sin(f / 5);
			glow = `0 0 ${g}px ${t.accentColor}, 0 0 ${g * 2}px ${t.accentColor}`;
			break;
		}
	}
	// ---- ra ----
	const q = interpolate(f, [frames - outF, frames], [0, 1], clamp);
	switch (animOut) {
		case 'fade': opacity *= 1 - q; break;
		case 'zoom-out': opacity *= 1 - q; sc *= 1 - q * 0.7; break;
		case 'slide-up': opacity *= 1 - q; ty -= q * D; break;
		case 'slide-down': opacity *= 1 - q; ty += q * D; break;
		case 'slide-left': opacity *= 1 - q; tx -= q * D; break;
		case 'slide-right': opacity *= 1 - q; tx += q * D; break;
		case 'blur': opacity *= 1 - q; blur += q * 30; break;
	}

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
					transform: `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${sc}) rotate(${c.rotation ?? 0}deg)`,
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
