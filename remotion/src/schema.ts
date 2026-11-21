import {z} from 'zod';
import {zColor} from '@remotion/zod-types';

export const wordSchema = z.object({text: z.string(), start: z.number(), end: z.number()});

export const lineSchema = z.object({
	start: z.number(),
	end: z.number(),
	words: z.array(wordSchema),
});

export const sceneSchema = z.object({
	src: z.string(),
	start: z.number(),
	end: z.number(),
	clipDuration: z.number(),
	query: z.string(),
	transition: z.enum(['fade', 'slide', 'wipe', 'none']),
	credit: z.string().optional(),
});

export const subtitleSchema = z.object({
	/** karaoke: tô màu chữ đang hát | preview: hiện trước N chữ | full: hiện cả câu + câu kế tiếp */
	mode: z.enum(['karaoke', 'preview', 'full']),
	lookahead: z.number().int().min(0).max(6),
	leadIn: z.number().min(0).max(3),
	fontFamily: z.string(),
	fontSize: z.number().min(12).max(200),
	color: zColor(),
	highlightColor: zColor(),
	strokeColor: zColor(),
	strokeWidth: z.number().min(0).max(16),
	position: z.enum(['bottom', 'center', 'top']),
	uppercase: z.boolean(),
});

export const titleSchema = z.object({
	enabled: z.boolean(),
	text: z.string(),
	subtext: z.string(),
	start: z.number().min(0),
	duration: z.number().min(0.5),
	fontFamily: z.string(),
	fontSize: z.number().min(12).max(400),
	color: zColor(),
	accentColor: zColor(),
	animation: z.enum(['fade', 'zoom', 'typewriter', 'bounce', 'slide-up', 'glow']),
	/** vị trí dọc, % chiều cao khung hình */
	y: z.number().min(0).max(100),
});

export const videoSchema = z.object({
	fps: z.number().int().min(1).max(60),
	width: z.number().int(),
	height: z.number().int(),
	duration: z.number().min(0.1),
	audio: z.string(),
	transitionSeconds: z.number().min(0).max(2),
	kenBurns: z.boolean(),
	darken: z.number().min(0).max(0.9),
	scenes: z.array(sceneSchema),
	lines: z.array(lineSchema),
	subtitle: subtitleSchema,
	title: titleSchema,
});

export type VideoProps = z.infer<typeof videoSchema>;
export type Line = z.infer<typeof lineSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SubtitleStyle = z.infer<typeof subtitleSchema>;
export type TitleProps = z.infer<typeof titleSchema>;
