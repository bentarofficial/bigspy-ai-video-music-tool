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
	transition: z.enum(['fade', 'slide', 'wipe', 'none', 'dissolve-zoom', 'blur-dissolve', 'soft-push', 'light-leak']),
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
	/** hiệu ứng xuất hiện / biến mất của mỗi câu (id trong anim.ts) */
	animIn: z.string().optional(),
	animOut: z.string().optional(),
	inDur: z.number().min(0.05).max(3).optional(),
	outDur: z.number().min(0.05).max(3).optional(),
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
	/** hiệu ứng xuất hiện (id trong anim.ts) */
	animation: z.string(),
	animOut: z.string().optional(),
	/** vị trí dọc, % chiều cao khung hình */
	y: z.number().min(0).max(100),
});

export const logoSchema = z.object({
	/** đường dẫn trong remotion/public (ảnh PNG nền trong suốt) */
	src: z.string(),
	position: z.enum(['top-right', 'top-left', 'bottom-right', 'bottom-left']),
	/** chiều rộng logo, % cạnh ngắn của khung hình */
	size: z.number().min(3).max(50),
	opacity: z.number().min(0).max(1),
	/** khoảng cách tới mép, % cạnh ngắn */
	margin: z.number().min(0).max(20),
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
	colorFilter: z
		.object({
			preset: z.string(),
			intensity: z.number().min(0).max(1).optional(),
			brightness: z.number().optional(),
			contrast: z.number().optional(),
			saturation: z.number().optional(),
			temperature: z.number().optional(),
			tint: z.number().optional(),
			vignette: z.number().optional(),
			hue: z.number().optional(),
			fade: z.number().optional(),
		})
		.optional(),
	logo: logoSchema.optional(),
});

export type VideoProps = z.infer<typeof videoSchema>;
export type Line = z.infer<typeof lineSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type SubtitleStyle = z.infer<typeof subtitleSchema>;
export type TitleProps = z.infer<typeof titleSchema>;
