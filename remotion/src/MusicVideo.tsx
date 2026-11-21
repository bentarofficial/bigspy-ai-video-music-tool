import React from 'react';
import {AbsoluteFill, Audio, staticFile} from 'remotion';
import {Scenes} from './Scenes';
import {ColorGrade} from './colorFilter';
import {Subtitles} from './Subtitles';
import {TitleText} from './TitleText';
import type {VideoProps} from './schema';

export const MusicVideo: React.FC<VideoProps> = (p) => (
	<AbsoluteFill style={{backgroundColor: '#000'}}>
		<ColorGrade f={p.colorFilter}>
			<Scenes scenes={p.scenes} transitionSeconds={p.transitionSeconds} kenBurns={p.kenBurns} />
		</ColorGrade>
		{/* lớp tối nhẹ giúp phụ đề dễ đọc trên mọi nền */}
		<AbsoluteFill style={{backgroundColor: `rgba(0,0,0,${p.darken})`}} />
		<Subtitles lines={p.lines} s={p.subtitle} />
		{p.title.enabled && p.title.text ? <TitleText {...p.title} /> : null}
		{p.audio ? <Audio src={staticFile(p.audio)} /> : null}
	</AbsoluteFill>
);
