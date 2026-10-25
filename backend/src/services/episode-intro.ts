/**
 * 拼接导出时的片头（封面）：成片最前面加一段 1~5 秒的画面
 *
 * - 背景：上传的统一封面图（项目里每集共用），没有就用第一个镜头的第一帧
 * - 文字：可选的集标题（如「第 3 集 · 重逢」）和上方一行小字（如剧名），居中偏下，底部压暗一条保证看得清
 * - 画面按成片尺寸裁满（cover），开头 / 结尾各 0.3 秒淡入淡出；带一条静音音轨，拼接时和镜头统一
 * - 文字用 drawtext + 本机中文字体（findSubtitleFont）；找不到字体时只出封面图，不加文字
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { ffmpeg } from '../utils/ffmpeg.js'
import { getAbsolutePath } from '../utils/storage.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { filterPath, findSubtitleFont } from './subtitles.js'

export interface IntroOptions {
  /** 片头时长（秒，1~5） */
  duration: number
  /** 封面图 static/...；null = 用第一个镜头的第一帧 */
  image: string | null
  /** 大标题（空 = 不写） */
  title: string
  /** 标题上方的小字（空 = 不写） */
  subtitle: string
}

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
  }
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
    const titleSize = Math.max(20, Math.round(short * (h > w ? 0.075 : 0.085)))
    const subSize = Math.max(14, Math.round(titleSize * 0.5))
    const titleY = Math.round(h * (h > w ? 0.7 : 0.66))
    parts.push(`drawbox=x=0:y=${Math.round(h * 0.55)}:w=${w}:h=${h - Math.round(h * 0.55)}:color=black@0.45:t=fill`)
    const common = (size: number) => [
      `fontfile=${filterPath(text.fontfile!)}`,
      'expansion=none',
      `fontsize=${size}`,
      'fontcolor=white',
      'x=(w-text_w)/2',
      `borderw=${Math.max(1, Math.round(size * 0.06))}`,
      'bordercolor=black@0.7',
    ]
    if (text.subtitleFile) {
      parts.push(`drawtext=${[...common(subSize), `textfile=${filterPath(text.subtitleFile)}`, `y=${titleY - Math.round(subSize * 1.9)}`, 'fontcolor=white@0.85'].join(':')}`)
    }
    if (text.titleFile) {
      parts.push(`drawtext=${[...common(titleSize), `textfile=${filterPath(text.titleFile)}`, `y=${titleY}`].join(':')}`)
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
    const fontfile = opts.title || opts.subtitle ? findSubtitleFont() : null
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
