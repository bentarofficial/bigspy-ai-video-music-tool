// Gói thành server/static/editor/player.js (esbuild) để trang Editor (JS thuần) nhúng Remotion Player.
import React, {useImperativeHandle, useRef, useState, forwardRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Player, type PlayerRef} from '@remotion/player';
import {Timeline} from './Timeline';
import {FILTER_CATEGORIES, FILTER_PRESETS, gradeStyle} from '../colorFilter';
import {timelineDuration, type TimelineProps} from './types';

type Api = {
	update: (p: TimelineProps) => void;
	player: () => PlayerRef | null;
};

const Host = forwardRef<Api, {initial: TimelineProps}>(({initial}, ref) => {
	const [props, setProps] = useState(initial);
	const pref = useRef<PlayerRef>(null);
	useImperativeHandle(ref, () => ({update: (p) => setProps(p), player: () => pref.current}), []);
	return (
		<Player
			ref={pref}
			component={Timeline}
			inputProps={props}
			fps={props.fps}
			compositionWidth={props.width}
			compositionHeight={props.height}
			durationInFrames={Math.max(1, Math.ceil(timelineDuration(props) * props.fps))}
			style={{width: '100%', height: '100%'}}
			acknowledgeRemotionLicense
			numberOfSharedAudioTags={8}
		/>
	);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).TLPlayer = {
	FILTER_PRESETS,
	FILTER_CATEGORIES,
	gradeStyle,
	mount(el: HTMLElement, initial: TimelineProps): Promise<Api> {
		return new Promise((resolve) => {
			const root = createRoot(el);
			root.render(
				<Host
					initial={initial}
					ref={(api) => {
						if (api) resolve(api);
					}}
				/>,
			);
		});
	},
};
