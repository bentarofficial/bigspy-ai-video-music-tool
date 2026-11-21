import type {Line, SubtitleStyle, TitleProps} from '../schema';
import type {ColorFilter} from '../colorFilter';
export type {ColorFilter};

/** Một track trên timeline. Track đứng TRƯỚC trong mảng được vẽ ĐÈ LÊN track phía sau (như CapCut). */
export type Track = {
	id: string;
	kind: 'main' | 'mixed' | 'video' | 'audio' | 'text';
	name: string;
	muted?: boolean;
	hidden?: boolean;
	locked?: boolean;
	/** âm lượng chung của track 0..2 (nhân với âm lượng từng clip) */
	volume?: number;
};

/** Chữ: kế thừa TitleProps + các tuỳ chọn của Editor (đều không bắt buộc để tương thích dữ liệu cũ). */
export type TextStyle = TitleProps & {
	animIn?: string;
	animOut?: string;
	inDur?: number;
	outDur?: number;
	x?: number;
	align?: 'left' | 'center' | 'right';
	bold?: boolean;
	italic?: boolean;
	uppercase?: boolean;
	letterSpacing?: number;
	strokeColor?: string;
	strokeWidth?: number;
	shadow?: boolean;
	bgColor?: string;
	bgOpacity?: number;
	bgRadius?: number;
};

export const TRANSITIONS = ['none', 'dissolve-zoom', 'blur-dissolve', 'soft-push', 'light-leak', 'fade', 'fadeblack', 'fadewhite', 'flash', 'slide-left', 'slide-right', 'slide-up', 'slide-down',
	'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'circle', 'zoom-in', 'zoom-out', 'blur', 'spin',
	'whip-left', 'whip-right', 'zoom-blur', 'glitch', 'flip', 'cube-left', 'diamond', 'split', 'diag', 'burn', 'shake'] as const;
export type Transition = {type: (typeof TRANSITIONS)[number]; dur: number};

export type ClipType = 'video' | 'image' | 'audio' | 'text' | 'lyrics' | 'cover';

export type Clip = {
	id: string;
	track: string;
	type: ClipType;
	/** vị trí trên timeline (giây) */
	start: number;
	/** độ dài trên timeline (giây) */
	dur: number;
	/** điểm bắt đầu trong file nguồn (giây) – video/audio/lyrics */
	in?: number;
	/** đường dẫn tương đối trong remotion/public */
	src?: string;
	/** độ dài file nguồn (giây) */
	srcDur?: number;
	name?: string;
	volume?: number;
	speed?: number;
	loop?: boolean;
	fadeIn?: number;
	fadeOut?: number;
	// ---- hình ảnh ----
	fit?: 'cover' | 'contain';
	/** tâm khung hình, % */
	x?: number;
	y?: number;
	scale?: number;
	rotation?: number;
	opacity?: number;
	kenBurns?: boolean;
	/** chỉnh màu riêng clip này (độ sáng, tương phản, bão hoà, nhiệt độ…), không dùng preset */
	adjust?: Omit<ColorFilter, 'preset'>;
	/** lớp tối phủ lên clip 0..0.9 */
	dim?: number;
	/** độ mờ nền phía sau (px) khi fit = contain; 0 = viền màu nền */
	bgBlur?: number;
	// ---- chữ ----
	title?: TextStyle;
	/** chuyển cảnh từ clip liền trước (cùng track) sang clip này */
	transition?: Transition;
	// ---- lời bài hát ----
	lines?: Line[];
	subtitle?: SubtitleStyle;
	// ---- lớp che mờ (x, y = tâm %, w, h = % khung) ----
	w?: number;
	h?: number;
	blur?: number;
	darken?: number;
	feather?: number;
	/** nhóm: các clip cùng group được chọn / kéo cùng nhau */
	group?: string;
};

export type MediaItem = {
	id: string;
	name: string;
	src: string;
	type: 'video' | 'image' | 'audio';
	duration?: number;
	width?: number;
	height?: number;
};

export type TimelineProps = {
	version: 1;
	fps: number;
	width: number;
	height: number;
	background: string;
	tracks: Track[];
	clips: Clip[];
	media: MediaItem[];
	/** bộ lọc màu chung cho mọi clip video / ảnh */
	filter?: ColorFilter;
};

export const timelineDuration = (t: TimelineProps) =>
	Math.max(1, ...t.clips.map((c) => c.start + c.dur));
