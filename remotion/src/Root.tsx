import React from 'react';
import {Composition} from 'remotion';
import {MusicVideo} from './MusicVideo';
import {videoSchema, type VideoProps} from './schema';
import {Timeline} from './timeline/Timeline';
import {timelineDuration, type TimelineProps} from './timeline/types';

const emptyTimeline: TimelineProps = {version: 1, fps: 30, width: 1080, height: 1920, background: '#000000', tracks: [], clips: [], media: []};

// Props mẫu để mở Studio khi chưa có job; job thật truyền vào bằng --props=output/<job>/props.json
const demoProps: VideoProps = {
	fps: 30,
	width: 1080,
	height: 1920,
	duration: 8,
	audio: '',
	transitionSeconds: 0.5,
	kenBurns: true,
	darken: 0.25,
	scenes: [],
	lines: [
		{
			start: 4.2,
			end: 7.2,
			words: [
				{text: 'Đây', start: 4.2, end: 4.6},
				{text: 'là', start: 4.6, end: 4.9},
				{text: 'lời', start: 4.9, end: 5.3},
				{text: 'bài', start: 5.3, end: 5.8},
				{text: 'hát', start: 5.8, end: 6.4},
				{text: 'mẫu', start: 6.4, end: 7.2},
			],
		},
	],
	subtitle: {
		mode: 'karaoke',
		lookahead: 2,
		leadIn: 0.6,
		fontFamily: 'Arial Black, Arial, sans-serif',
		fontSize: 70,
		color: '#ffffff',
		highlightColor: '#ffd23f',
		strokeColor: '#000000',
		strokeWidth: 6,
		position: 'bottom',
		uppercase: false,
	},
	title: {
		enabled: true,
		text: 'Tên Bài Hát',
		subtext: 'Ca sĩ',
		start: 0.3,
		duration: 3.5,
		fontFamily: 'Arial Black, Arial, sans-serif',
		fontSize: 120,
		color: '#ffffff',
		accentColor: '#ff4fa3',
		animation: 'zoom',
		y: 42,
	},
};

export const RemotionRoot: React.FC = () => (
	<>
	<Composition
		id="MusicVideo"
		component={MusicVideo}
		schema={videoSchema}
		defaultProps={demoProps}
		fps={30}
		width={1080}
		height={1920}
		durationInFrames={240}
		calculateMetadata={({props}) => ({
			fps: props.fps,
			width: props.width,
			height: props.height,
			durationInFrames: Math.max(1, Math.ceil(props.duration * props.fps)),
		})}
	/>
	<Composition
		id="Timeline"
		component={Timeline}
		defaultProps={emptyTimeline}
		fps={30}
		width={1080}
		height={1920}
		durationInFrames={30}
		calculateMetadata={({props}) => ({
			fps: props.fps,
			width: props.outWidth ?? props.width,
			height: props.outHeight ?? props.height,
			durationInFrames: Math.max(1, Math.ceil(timelineDuration(props) * props.fps)),
		})}
	/>
	</>
);
