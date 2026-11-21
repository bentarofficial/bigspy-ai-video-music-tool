import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Img,
	interpolate,
	Loop,
	OffthreadVideo,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	Video,
	getRemotionEnvironment,
} from 'remotion';
import {Subtitles} from '../Subtitles';
import {TextClip} from './TextClip';
import type {Clip, TimelineProps, Track, Transition} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** URL file media: khi render dùng staticFile; trong trình duyệt editor dùng /media/... của server. */
export const mediaUrl = (src: string) =>
	/^(https?:|blob:|data:|\/)/.test(src) ? src : getRemotionEnvironment().isPlayer ? `/media/${src}` : staticFile(src);

/** Hệ số mờ vào/ra theo frame tương đối của clip. */
const useFade = (c: Clip, frames: number) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const fi = Math.round((c.fadeIn ?? 0) * fps);
	const fo = Math.round((c.fadeOut ?? 0) * fps);
	let a = 1;
	if (fi > 0) a *= interpolate(f, [0, fi], [0, 1], clamp);
	if (fo > 0) a *= interpolate(f, [frames - fo, frames], [1, 0], clamp);
	return a;
};

const Visual: React.FC<{c: Clip; frames: number; muted: boolean}> = ({c, frames, muted}) => {
	const f = useCurrentFrame();
	const {fps} = useVideoConfig();
	const fade = useFade(c, frames);
	const kb = c.kenBurns ? interpolate(f, [0, frames], [1.02, 1.15], clamp) : 1;
	const style: React.CSSProperties = {width: '100%', height: '100%', objectFit: c.fit ?? 'cover'};
	const src = mediaUrl(c.src ?? '');
	const speed = c.speed ?? 1;
	const startFrom = Math.round((c.in ?? 0) * fps);
	const vol = muted ? 0 : (c.volume ?? 1) * fade;
	const Vid = getRemotionEnvironment().isPlayer ? Video : OffthreadVideo;

	let media: React.ReactNode;
	if (c.type === 'image') {
		media = <Img src={src} style={style} />;
	} else {
		const v = (
			<Vid src={src} startFrom={startFrom} playbackRate={speed} volume={vol} muted={vol === 0} style={style} pauseWhenBuffering />
		);
		// clip dài hơn phần còn lại của file nguồn -> lặp lại
		const avail = c.srcDur ? Math.floor(((c.srcDur - (c.in ?? 0)) / speed) * fps) - 1 : 0;
		media = c.loop && avail > fps / 2 && avail < frames ? <Loop durationInFrames={avail}>{v}</Loop> : v;
	}
	// nền mờ phía sau khi clip "vừa khung" không phủ kín (giống CapCut)
	const blurBg =
		c.bgBlur && (c.fit ?? 'cover') === 'contain' ? (
			<AbsoluteFill style={{filter: `blur(${c.bgBlur}px) brightness(.7)`, transform: 'scale(1.15)'}}>
				{c.type === 'image' ? (
					<Img src={src} style={{...style, objectFit: 'cover'}} />
				) : (
					<Vid src={src} startFrom={startFrom} playbackRate={speed} muted style={{...style, objectFit: 'cover'}} pauseWhenBuffering />
				)}
			</AbsoluteFill>
		) : null;
	return (
		<AbsoluteFill style={{opacity: fade * (c.opacity ?? 1), overflow: 'hidden'}}>
			{blurBg}
			<AbsoluteFill
				style={{
					transform: `translate(${(c.x ?? 50) - 50}%, ${(c.y ?? 50) - 50}%) rotate(${c.rotation ?? 0}deg) scale(${(c.scale ?? 1) * kb})`,
				}}
			>
				{media}
			</AbsoluteFill>
			{c.dim ? <AbsoluteFill style={{backgroundColor: `rgba(0,0,0,${c.dim})`}} /> : null}
		</AbsoluteFill>
	);
};

const AudioClip: React.FC<{c: Clip; frames: number; muted: boolean}> = ({c, frames, muted}) => {
	const {fps} = useVideoConfig();
	const fade = useFade(c, frames);
	if (muted || !c.src) return null;
	return (
		<Audio
			src={mediaUrl(c.src)}
			startFrom={Math.round((c.in ?? 0) * fps)}
			playbackRate={c.speed ?? 1}
			volume={(c.volume ?? 1) * fade}
			pauseWhenBuffering
		/>
	);
};

/** Hiệu ứng chuyển cảnh: clip được vẽ sớm hơn `d` frame, đè lên clip trước và "lộ ra" theo kiểu đã chọn. */
const TransitionWrap: React.FC<{tr: Transition; d: number; children: React.ReactNode}> = ({tr, d, children}) => {
	const f = useCurrentFrame();
	if (f >= d) return <>{children}</>;
	const p = interpolate(f, [0, d], [0, 1], clamp);
	const e = 1 - Math.pow(1 - p, 3); // ease-out
	let style: React.CSSProperties = {};
	let cover: React.ReactNode = null;
	const pct = (v: number) => `${v * 100}%`;
	switch (tr.type) {
		case 'fade': style = {opacity: p}; break;
		case 'fadeblack':
		case 'fadewhite': {
			const col = tr.type === 'fadeblack' ? '0,0,0' : '255,255,255';
			// nửa đầu: phủ màu dần lên clip trước (clip này ẩn); nửa sau: clip này hiện ra từ màu đó
			style = {opacity: p < 0.5 ? 0 : 1};
			cover = <AbsoluteFill style={{backgroundColor: `rgba(${col},${p < 0.5 ? p * 2 : 2 - p * 2})`}} />;
			break;
		}
		case 'flash':
			style = {opacity: p < 0.5 ? 0 : 1};
			cover = <AbsoluteFill style={{backgroundColor: `rgba(255,255,255,${1 - Math.abs(p - 0.5) * 2})`}} />;
			break;
		case 'slide-left': style = {transform: `translateX(${pct(1 - e)})`}; break;
		case 'slide-right': style = {transform: `translateX(${pct(e - 1)})`}; break;
		case 'slide-up': style = {transform: `translateY(${pct(1 - e)})`}; break;
		case 'slide-down': style = {transform: `translateY(${pct(e - 1)})`}; break;
		case 'wipe-left': style = {clipPath: `inset(0 0 0 ${pct(1 - e)})`}; break;
		case 'wipe-right': style = {clipPath: `inset(0 ${pct(1 - e)} 0 0)`}; break;
		case 'wipe-up': style = {clipPath: `inset(${pct(1 - e)} 0 0 0)`}; break;
		case 'wipe-down': style = {clipPath: `inset(0 0 ${pct(1 - e)} 0)`}; break;
		case 'circle': style = {clipPath: `circle(${e * 75}% at 50% 50%)`}; break;
		case 'zoom-in': style = {opacity: p, transform: `scale(${1.4 - 0.4 * e})`}; break;
		case 'zoom-out': style = {opacity: p, transform: `scale(${0.6 + 0.4 * e})`}; break;
		case 'blur': style = {opacity: p, filter: `blur(${(1 - p) * 40}px)`}; break;
		case 'spin': style = {opacity: p, transform: `rotate(${(1 - e) * -180}deg) scale(${0.3 + 0.7 * e})`}; break;
	}
	return (
		<>
			<AbsoluteFill style={style}>{children}</AbsoluteFill>
			{cover}
		</>
	);
};

const ClipView: React.FC<{c: Clip; track: Track}> = ({c, track}) => {
	const {fps} = useVideoConfig();
	const start = Math.round(c.start * fps);
	const tr = c.transition && c.transition.type !== 'none' && c.type !== 'audio' ? c.transition : null;
	// chuyển cảnh: bắt đầu vẽ sớm hơn d frame (không quá đầu timeline / nửa độ dài clip)
	const d = tr ? Math.min(Math.round(tr.dur * fps), start, Math.round((c.dur * fps) / 2)) : 0;
	const from = start - d;
	const frames = Math.max(1, Math.round((c.start + c.dur) * fps) - from);
	// lùi điểm vào trong file nguồn tương ứng để hình chạy liền mạch
	const cc = d && (c.type === 'video') ? {...c, in: Math.max(0, (c.in ?? 0) - (d / fps) * (c.speed ?? 1))} : c;
	let body: React.ReactNode = null;
	if (c.type === 'video' || c.type === 'image') body = <Visual c={cc} frames={frames} muted={!!track.muted} />;
	else if (c.type === 'audio') body = <AudioClip c={c} frames={frames} muted={!!track.muted} />;
	else if (c.type === 'text') body = <TextClip c={c} frames={frames} />;
	else if (c.type === 'lyrics' && c.lines && c.subtitle) {
		// lời bài hát tính theo giờ của bài: dịch ngược "in" giây để cắt đầu clip vẫn khớp
		const off = Math.round((c.in ?? 0) * fps);
		body = (
			<Sequence from={-off} layout="none">
				<Subtitles lines={c.lines} s={c.subtitle} />
			</Sequence>
		);
	}
	if (tr && d > 0) body = <TransitionWrap tr={tr} d={d}>{body}</TransitionWrap>;
	return (
		<Sequence from={from} durationInFrames={frames} name={c.name || c.type} premountFor={fps}>
			{body}
		</Sequence>
	);
};

export const Timeline: React.FC<TimelineProps> = (p) => {
	const byId = new Map(p.tracks.map((t, i) => [t.id, {t, i}]));
	// track cuối mảng vẽ trước (nằm dưới cùng)
	const clips = p.clips
		.filter((c) => byId.has(c.track) && !(byId.get(c.track)!.t.hidden && c.type !== 'audio'))
		// cùng track: clip sau vẽ sau để chuyển cảnh đè lên clip trước
		.sort((a, b) => byId.get(b.track)!.i - byId.get(a.track)!.i || a.start - b.start);
	return (
		<AbsoluteFill style={{backgroundColor: p.background || '#000'}}>
			{clips.map((c) => (
				<ClipView key={c.id} c={c} track={byId.get(c.track)!.t} />
			))}
		</AbsoluteFill>
	);
};
