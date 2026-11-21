import React from 'react';
import {AbsoluteFill, Audio, Img, staticFile, useVideoConfig} from 'remotion';
import {Scenes} from './Scenes';
import {ColorGrade} from './colorFilter';
import {Subtitles} from './Subtitles';
import {TitleText} from './TitleText';
import type {VideoProps} from './schema';

/** Logo kênh (PNG nền trong suốt) ở góc khung hình, hiện suốt video. */
const Logo: React.FC<{l: NonNullable<VideoProps['logo']>}> = ({l}) => {
	const {width, height} = useVideoConfig();
	const base = Math.min(width, height);
	const m = (base * l.margin) / 100;
	const [v, h] = l.position.split('-');
	return (
		<Img
			src={staticFile(l.src)}
			style={{position: 'absolute', width: (base * l.size) / 100, height: 'auto', opacity: l.opacity,
				[v]: m, [h]: m, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.35))'}}
		/>
	);
};

export const MusicVideo: React.FC<VideoProps> = (p) => (
	<AbsoluteFill style={{backgroundColor: '#000'}}>
		<ColorGrade f={p.colorFilter}>
			<Scenes scenes={p.scenes} transitionSeconds={p.transitionSeconds} kenBurns={p.kenBurns} />
		</ColorGrade>
		{/* lớp tối nhẹ giúp phụ đề dễ đọc trên mọi nền */}
		<AbsoluteFill style={{backgroundColor: `rgba(0,0,0,${p.darken})`}} />
		<Subtitles lines={p.lines} s={p.subtitle} />
		{p.title.enabled && p.title.text ? <TitleText {...p.title} /> : null}
		{p.logo?.src ? <Logo l={p.logo} /> : null}
		{p.audio ? <Audio src={staticFile(p.audio)} /> : null}
	</AbsoluteFill>
);
