/**
 * 拼接导出时的片头（封面）：成片最前面加一段 1~5 秒的画面
 *
 * - 背景：上传的统一封面图（项目里每集共用），没有就用第一个镜头的第一帧
 * - 文字：可选的集标题（如「第 3 集 · 重逢」）和上方一行小字（如剧名），居中偏下，底部压暗一条保证看得清
 * - 画面按成片尺寸裁满（cover），开头 / 结尾各 0.3 秒淡入淡出；带一条静音音轨，拼接时和镜头统一
 * - 文字用 drawtext；字体可选本机中文字体或上传的字体（intro-fonts.ts），找不到时用 findSubtitleFont，再没有就只出封面图
 * - 文字样式：字号倍数 size、颜色 color、半透明背景条 box（只压暗文字那一块）、垂直位置 y（标题中心占画面高度的比例）
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { ffmpeg } from '../utils/ffmpeg.js'
import { getAbsolutePath } from '../utils/storage.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { filterPath } from './subtitles.js'
import { isKnownIntroFont, resolveIntroFont } from './intro-fonts.js'

export interface IntroOptions {
  /** 片头时长（秒，1~5） */
  duration: number
  /** 封面图 static/...；null = 用第一个镜头的第一帧 */
  image: string | null
  /** 大标题（空 = 不写） */
  title: string
  /** 标题上方的小字（空 = 不写） */
  subtitle: string
  /** 字体 id（intro-fonts.ts）；null = 默认中文字体 */
  font: string | null
  /** 字号倍数（0.5~2，1 = 默认大小） */
  size: number
  /** 文字颜色 #RRGGBB */
  color: string
  /** 文字后面的半透明背景条 */
  box: boolean
  /** 标题垂直位置：标题中心在画面高度的比例（0.1 顶部 ~ 0.9 底部） */
  y: number
}

export const INTRO_STYLE_DEFAULTS = { size: 1, color: '#FFFFFF', box: true, y: 0.7 }

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i

export function normalizeIntroOptions(raw: unknown): IntroOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.enabled === false) return null
  const d = Number(r.duration)
  const img = typeof r.image === 'string' ? r.image.replace(/^\/+/, '') : ''
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  return {
    duration: Number.isFinite(d) ? Math.min(5, Math.max(1, Math.round(d * 10) / 10)) : 2,
    image: img && img.startsWith('static/') && !img.includes('..') && IMAGE_EXT.test(img) ? img : null,
    title: clean(r.title, 40),
    subtitle: clean(r.subtitle, 40),
    font: typeof r.font === 'string' && isKnownIntroFont(r.font) ? r.font : null,
    size: num(r.size, 0.5, 2, INTRO_STYLE_DEFAULTS.size),
    color: typeof r.color === 'string' && /^#?[0-9a-f]{6}$/i.test(r.color) ? `#${r.color.replace('#', '').toUpperCase()}` : INTRO_STYLE_DEFAULTS.color,
    box: r.box === undefined ? INTRO_STYLE_DEFAULTS.box : r.box !== false,
    y: num(r.y, 0.1, 0.9, INTRO_STYLE_DEFAULTS.y),
  }
}

function num(v: unknown, min: number, max: number, def: number) {
  const n = Number(v)
  return v === undefined || v === null || v === '' || !Number.isFinite(n) ? def : Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

export interface IntroTarget {
  width: number
  height: number
  fps: number
}

/** 片头滤镜：裁满画面 → 底部压暗 → 小字 + 标题 → 淡入淡出（导出给测试用） */
export function buildIntroFilter(opts: IntroOptions, target: IntroTarget, text: { fontfile: string | null; titleFile?: string; subtitleFile?: string }): string {
  const { width: w, height: h, fps } = target
  const parts = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${w}:${h}`,
    'setsar=1',
    `fps=${fps}`,
  ]
  const hasText = !!text.fontfile && !!(text.titleFile || text.subtitleFile)
  if (hasText) {
    const short = Math.min(w, h)
    const titleSize = Math.max(16, Math.round(short * (h > w ? 0.075 : 0.085) * opts.size))
    const subSize = Math.max(12, Math.round(titleSize * 0.5))
    const color = `0x${opts.color.replace('#', '')}`
    // 文字块：小字在上、标题在下；y 是标题中心的位置，整块不出画面
    const gap = Math.round(subSize * 0.9)
    const blockH = (text.titleFile ? titleSize : 0) + (text.subtitleFile ? subSize : 0) + (text.titleFile && text.subtitleFile ? gap : 0)
    const pad = Math.round(Math.max(titleSize, subSize) * 0.6)
    const titleCenter = Math.round(h * opts.y)
    let top = text.titleFile ? titleCenter - Math.round(titleSize / 2) - (text.subtitleFile ? subSize + gap : 0) : titleCenter - Math.round(subSize / 2)
    top = Math.min(h - pad - blockH, Math.max(pad, top))
    if (opts.box) {
      const boxY = Math.max(0, top - pad)
      const boxH = Math.min(h - boxY, blockH + pad * 2)
      parts.push(`drawbox=x=0:y=${boxY}:w=${w}:h=${boxH}:color=black@0.45:t=fill`)
    }
    const common = (size: number) => [
      `fontfile=${filterPath(text.fontfile!)}`,
      'expansion=none',
      `fontsize=${size}`,
      'x=(w-text_w)/2',
      `borderw=${Math.max(1, Math.round(size * 0.06))}`,
      'bordercolor=black@0.7',
    ]
    if (text.subtitleFile) {
      parts.push(`drawtext=${[...common(subSize), `textfile=${filterPath(text.subtitleFile)}`, `y=${top}`, `fontcolor=${color}@0.85`].join(':')}`)
    }
    if (text.titleFile) {
      parts.push(`drawtext=${[...common(titleSize), `textfile=${filterPath(text.titleFile)}`, `y=${top + (text.subtitleFile ? subSize + gap : 0)}`, `fontcolor=${color}`].join(':')}`)
    }
  }
  const fade = Math.min(0.3, opts.duration / 4)
  parts.push(`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${(opts.duration - fade).toFixed(2)}:d=${fade}`, 'format=yuv420p')
  return parts.join(',')
}

function run(cmd: any): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve()).on('error', (err: any) => reject(err)).run()
  })
}

/**
 * 生成片头视频（绝对路径）；firstClipAbs 用来在没有封面图时取第一帧。
 * 返回 { file, warning }：warning 说明没能加文字等（不影响拼接）
 */
export async function renderIntroClip(opts: IntroOptions, target: IntroTarget, firstClipAbs: string): Promise<{ file: string; warning: string }> {
  const dir = path.join(STORAGE_ROOT, 'temp')
  fs.mkdirSync(dir, { recursive: true })
  const id = uuid()
  const temps: string[] = []
  let warning = ''
  try {
    let bg = opts.image ? getAbsolutePath(opts.image) : ''
    if (opts.image && !fs.existsSync(bg)) {
      warning = '片头封面图找不到了（可能已被删除），改用第一个镜头的画面'
      bg = ''
    }
    if (!bg) {
      bg = path.join(dir, `${id}_frame.jpg`)
      temps.push(bg)
      await run(ffmpeg(firstClipAbs).outputOptions(['-frames:v', '1', '-q:v', '2']).output(bg))
    }
    const fontfile = opts.title || opts.subtitle ? resolveIntroFont(opts.font) : null
    if ((opts.title || opts.subtitle) && !fontfile) warning = [warning, '本机没找到中文字体，片头没有加标题（可设置环境变量 SUBTITLE_FONT 指定字体文件）'].filter(Boolean).join('；')
    const writeText = (name: string, value: string) => {
      if (!value) return undefined
      const f = path.join(dir, `${id}_${name}.txt`)
      fs.writeFileSync(f, value, 'utf-8')
      temps.push(f)
      return f
    }
    const filter = buildIntroFilter(opts, target, {
      fontfile,
      titleFile: fontfile ? writeText('title', opts.title) : undefined,
      subtitleFile: fontfile ? writeText('sub', opts.subtitle) : undefined,
    })
    const out = path.join(dir, `${id}_intro.mp4`)
    await run(ffmpeg()
      .input(bg).inputOptions(['-loop', '1', '-t', String(opts.duration)])
      .input('anullsrc=r=48000:cl=stereo').inputOptions(['-f', 'lavfi', '-t', String(opts.duration)])
      .complexFilter(`[0:v]${filter}[v]`)
      .outputOptions(['-map', '[v]', '-map', '1:a', '-t', String(opts.duration), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest'])
      .output(out))
    return { file: out, warning }
  } finally {
    for (const f of temps) fs.rmSync(f, { force: true })
  }
}
