/**
 * 生成视频时直接烧录字幕
 *
 * - 字幕文字：视频提示词（没写台词时用分镜描述）里的台词 / 旁白（shot-direction.ts shotDialogueLines，和「台词控制」同一套解析）
 * - 时间轴：按估算的说话时长依次排开（开场 0.5 秒、换人停顿），总长超过成片时按比例压缩
 * - 渲染：FFmpeg drawtext + 本机中文字体文件（只需要 freetype，不依赖 libass / fontconfig，各平台内置 ffmpeg 都能用）
 * - 原视频保留（<名字>.mp4），带字幕的另存为 <名字>_sub.mp4；接戏用的结尾帧取自原视频，下一镜不会带上字幕
 * - 同时写一份 SRT（<名字>_sub.srt）
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { getAbsolutePath } from '../utils/storage.js'
import { shotDialogueLines, systemNamesFor, type DialogueLine } from './shot-direction.js'

export const SUBTITLE_STYLES = ['classic', 'yellow', 'box', 'shadow', 'pink'] as const
export type SubtitleStyle = typeof SUBTITLE_STYLES[number]
export type SubtitleSize = 'small' | 'medium' | 'large'
export type SubtitlePosition = 'bottom' | 'top'

export interface SubtitleOptions {
  style: SubtitleStyle
  size: SubtitleSize
  position: SubtitlePosition
  /** 台词前加「角色名：」 */
  speaker: boolean
}

export interface SubtitleCue {
  start: number
  end: number
  /** 已按画面宽度换好行（最多两行） */
  lines: string[]
  /** 系统流的「系统」台词：用【】括起来、青蓝色 */
  system?: boolean
}

/** 系统台词的字色（各样式通用） */
export const SYSTEM_SUBTITLE_COLOR = '0x7FE8FF'

/** 请求里的 subtitle 参数 → 规范化选项；没开字幕返回 null */
export function normalizeSubtitleOptions(raw: unknown): SubtitleOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.enabled !== true && r.enabled !== 1 && r.enabled !== 'true') return null
  const style = SUBTITLE_STYLES.includes(r.style as SubtitleStyle) ? (r.style as SubtitleStyle) : 'classic'
  const size = r.size === 'small' || r.size === 'large' ? r.size : 'medium'
  const position = r.position === 'top' ? 'top' : 'bottom'
  return { style, size, position, speaker: r.speaker === true || r.speaker === 1 || r.speaker === 'true' }
}

// ─── 时间轴 ────────────────────────────────────────────────────────────────

const LEAD = 0.5
const SAME_SPEAKER_GAP = 0.3
const TURN_GAP = 0.6
const MIN_CUE = 0.8
/** 台词比镜头长、需要压缩时，每句至少显示的秒数（够读完短句） */
const MIN_READ = 1.1

const CJK_CHAR_RE = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/

/** 估算文字宽度（以字号为单位）：中日韩全角 1，拉丁 / 数字约 0.55 */
export function textWidthEm(text: string): number {
  let w = 0
  for (const ch of text) w += CJK_CHAR_RE.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55
  return w
}

/** 按最大宽度换行：优先在标点 / 空格处断，否则按字断；返回若干行 */
export function wrapText(text: string, maxEm: number): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest) {
    if (textWidthEm(rest) <= maxEm) { out.push(rest); break }
    // 找到不超过 maxEm 的最长前缀
    let cut = 0
    let w = 0
    for (const ch of rest) {
      const cw = CJK_CHAR_RE.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.55
      if (w + cw > maxEm) break
      w += cw
      cut += ch.length
    }
    cut = Math.max(1, cut)
    // 在前缀里找最后一个适合断开的位置（不让行太短）
    const head = rest.slice(0, cut)
    const breakAt = Math.max(head.lastIndexOf(' '), ...[...'，。！？、；：,.!?;:'].map((p) => head.lastIndexOf(p)))
    if (breakAt >= Math.floor(cut * 0.5)) cut = breakAt + 1
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return out.filter(Boolean)
}

/** 一句太长（超过两行）时按句读拆成几段，每段各自显示 */
function chunkLine(text: string, maxEm: number): string[][] {
  const lines = wrapText(text, maxEm)
  if (lines.length <= 2) return [lines]
  const chunks: string[][] = []
  for (let i = 0; i < lines.length; i += 2) chunks.push(lines.slice(i, i + 2))
  return chunks
}

/**
 * 台词 → 字幕时间轴。按估算说话时长依次排开；总长超过视频时整体按比例压缩，保证最后一句在视频结束前消失。
 * maxEm：一行最多能放多少个「字号宽」（由画面宽度和字号算出）。
 */
export function buildSubtitleCues(lines: DialogueLine[], videoSeconds: number, opts: Pick<SubtitleOptions, 'speaker'>, maxEm = 18): SubtitleCue[] {
  const items = lines
    .map((l) => ({
      ...l,
      text: (l.kind === 'system'
        ? `【${l.text.replace(/^【|】$/g, '')}】`
        : opts.speaker && l.kind === 'dialogue' && l.speaker ? `${l.speaker}：${l.text}` : l.text
      ).replace(/\s+/g, ' ').trim(),
    }))
    .filter((l) => l.text)
  if (!items.length || !(videoSeconds > 0)) return []
  // 原始时间轴
  const raw: Array<{ start: number; dur: number; text: string; system?: boolean }> = []
  let t = LEAD
  items.forEach((l, i) => {
    if (i > 0) t += l.speaker === items[i - 1].speaker ? SAME_SPEAKER_GAP : TURN_GAP
    const dur = Math.max(MIN_CUE, l.seconds)
    raw.push({ start: t, dur, text: l.text, ...(l.kind === 'system' ? { system: true } : {}) })
    t += dur
  })
  const usable = Math.max(0.5, videoSeconds - 0.15)
  // 放得下：按估算时长；放不下（台词比镜头长）：开场和停顿压到很短，每句至少留够阅读时间，剩下的按长短分
  let timed: Array<{ start: number; dur: number; text: string; system?: boolean }>
  if (t <= usable) {
    timed = raw
  } else {
    const lead = Math.min(LEAD, usable * 0.05)
    const gap = 0.1
    const avail = Math.max(0.1, usable - lead - gap * (raw.length - 1))
    const base = Math.min(MIN_READ, avail / raw.length)
    const rest = avail - base * raw.length
    const sum = raw.reduce((x, r) => x + r.dur, 0) || 1
    let at = lead
    timed = raw.map((r) => {
      const dur = base + (rest * r.dur) / sum
      const item = { ...r, start: at, dur }
      at += dur + gap
      return item
    })
  }
  const cues: SubtitleCue[] = []
  for (const r of timed) {
    const chunks = chunkLine(r.text, maxEm)
    const total = chunks.reduce((x, c) => x + textWidthEm(c.join('')), 0) || 1
    let at = r.start
    for (const c of chunks) {
      const d = (r.dur * textWidthEm(c.join(''))) / total
      cues.push({ start: round2(at), end: round2(Math.min(usable, at + d)), lines: c, ...(r.system ? { system: true } : {}) })
      at += d
    }
  }
  return cues.filter((c) => c.end > c.start)
}

function round2(n: number) { return Math.round(n * 100) / 100 }

// ─── SRT ───────────────────────────────────────────────────────────────────

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.lines.join('\n')}\n`).join('\n')
}

// ─── 字体 ──────────────────────────────────────────────────────────────────

const FONT_CANDIDATES: Record<string, string[]> = {
  win32: ['msyhbd.ttc', 'msyh.ttc', 'msyh.ttf', 'simhei.ttf', 'Deng.ttf', 'simsun.ttc'],
  darwin: [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ],
  linux: [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/wqy-microhei/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  ],
}
const FONT_NAME_RE = /(cjk|wqy|sourcehan|source-han|droidsansfallback|pingfang|heiti|hiragino sans gb|msyh|simhei|notosanssc|notoserifsc)/i

function scanFonts(dir: string, depth: number): string | null {
  if (depth < 0) return null
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    if (e.isFile() && /\.(ttf|ttc|otf)$/i.test(e.name) && FONT_NAME_RE.test(e.name)) return path.join(dir, e.name)
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = scanFonts(path.join(dir, e.name), depth - 1)
      if (hit) return hit
    }
  }
  return null
}

let fontCache: string | null | undefined
/** 找一个能显示中文的字体文件：SUBTITLE_FONT 环境变量 → 各系统常见中文字体 → 扫描字体目录 */
export function findSubtitleFont(): string | null {
  if (process.env.SUBTITLE_FONT && fs.existsSync(process.env.SUBTITLE_FONT)) return process.env.SUBTITLE_FONT
  if (fontCache !== undefined) return fontCache
  const platform = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux'
  const winFonts = path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'Fonts')
  const candidates = platform === 'win32' ? FONT_CANDIDATES.win32.map((f) => path.join(winFonts, f)) : FONT_CANDIDATES[platform]
  fontCache = candidates.find((f) => { try { return fs.statSync(f).size > 0 } catch { return false } }) || null
  if (!fontCache) {
    const dirs = platform === 'win32' ? [winFonts]
      : platform === 'darwin' ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local/share/fonts')]
    for (const d of dirs) { fontCache = scanFonts(d, 3); if (fontCache) break }
  }
  return fontCache || null
}

// ─── drawtext ──────────────────────────────────────────────────────────────

/** filtergraph 里的路径值：反斜杠改正斜杠，冒号转义，单引号包起来（Windows 的 C:\ 也能用） */
export function filterPath(p: string): string {
  return `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`
}

const SIZE_RATIO: Record<SubtitleSize, number> = { small: 0.045, medium: 0.056, large: 0.07 }

interface StyleSpec {
  color: string
  border?: { ratio: number; color: string }
  box?: { color: string; padRatio: number }
  shadow?: { ratio: number; color: string }
}

const STYLE_SPECS: Record<SubtitleStyle, StyleSpec> = {
  classic: { color: 'white', border: { ratio: 0.08, color: 'black' } },
  yellow: { color: '0xFFD84D', border: { ratio: 0.08, color: 'black' } },
  box: { color: 'white', box: { color: 'black@0.55', padRatio: 0.3 } },
  shadow: { color: 'white', border: { ratio: 0.025, color: 'black@0.6' }, shadow: { ratio: 0.07, color: 'black@0.75' } },
  pink: { color: 'white', border: { ratio: 0.12, color: '0xFF3D7F' } },
}

export interface DrawtextLayout {
  width: number
  height: number
  fontfile: string
  /** 每行文字写进的文本文件（drawtext textfile，避免转义问题） */
  textFile: (cueIndex: number, lineIndex: number, text: string) => string
}

/** 字号（像素）：按画面短边 */
export function subtitleFontSize(width: number, height: number, size: SubtitleSize): number {
  return Math.max(14, Math.round(Math.min(width, height) * SIZE_RATIO[size]))
}

/** 一行最多放几个字号宽（画面宽 88%） */
export function subtitleMaxEm(width: number, height: number, size: SubtitleSize): number {
  return Math.max(6, Math.floor((width * 0.88) / subtitleFontSize(width, height, size)))
}

/** 字幕 → drawtext 滤镜链（每条字幕的每一行一个 drawtext，水平居中，按时间显示） */
export function buildDrawtextFilter(cues: SubtitleCue[], opts: SubtitleOptions, layout: DrawtextLayout): string {
  const fs = subtitleFontSize(layout.width, layout.height, opts.size)
  const lineH = Math.round(fs * 1.35)
  const vertical = layout.height > layout.width
  const margin = Math.round(layout.height * (opts.position === 'top' ? 0.07 : vertical ? 0.13 : 0.07))
  const spec = STYLE_SPECS[opts.style]
  const parts: string[] = []
  cues.forEach((cue, ci) => {
    const n = cue.lines.length
    cue.lines.forEach((text, li) => {
      const y = opts.position === 'top' ? margin + li * lineH : layout.height - margin - (n - li) * lineH
      const o: string[] = [
        `fontfile=${filterPath(layout.fontfile)}`,
        `textfile=${filterPath(layout.textFile(ci, li, text))}`,
        'expansion=none',
        `fontsize=${fs}`,
        `fontcolor=${cue.system ? SYSTEM_SUBTITLE_COLOR : spec.color}`,
        'x=(w-text_w)/2',
        `y=${y}`,
      ]
      if (spec.border) o.push(`borderw=${Math.max(1, Math.round(fs * spec.border.ratio))}`, `bordercolor=${spec.border.color}`)
      if (spec.box) o.push('box=1', `boxcolor=${spec.box.color}`, `boxborderw=${Math.max(2, Math.round(fs * spec.box.padRatio))}`)
      if (spec.shadow) {
        const d = Math.max(1, Math.round(fs * spec.shadow.ratio))
        o.push(`shadowcolor=${spec.shadow.color}`, `shadowx=${d}`, `shadowy=${d}`)
      }
      o.push(`enable='between(t,${cue.start},${cue.end})'`)
      parts.push(`drawtext=${o.join(':')}`)
    })
  })
  return parts.join(',')
}

// ─── 烧录 ──────────────────────────────────────────────────────────────────

function probe(abs: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(abs, (err: any, data: any) => {
      if (err) return reject(err)
      const v = (data?.streams || []).find((s: any) => s.codec_type === 'video') || {}
      const duration = Number(data?.format?.duration) || Number(v.duration) || 0
      resolve({ duration, width: Number(v.width) || 0, height: Number(v.height) || 0 })
    })
  })
}

/** 带字幕视频的相对路径：static/videos/x.mp4 → static/videos/x_sub.mp4 */
export function subtitledPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_sub.mp4')
}

export interface BurnResult {
  /** 带字幕视频（相对路径） */
  video: string
  /** SRT（相对路径） */
  srt: string
  cues: number
}

/**
 * 把台词烧进视频。没有台词返回 null（不生成带字幕版本）；找不到中文字体 / ffmpeg 不可用时抛出可读错误。
 */
export async function burnSubtitles(relativeVideo: string, lines: DialogueLine[], opts: SubtitleOptions): Promise<BurnResult | null> {
  if (!lines.length) return null
  const { ffmpeg: ffmpegOk, ffprobe: ffprobeOk } = await checkFfmpegSuite()
  if (!ffmpegOk || !ffprobeOk) throw new Error('本机 ffmpeg / ffprobe 不可用，无法烧录字幕')
  const fontfile = findSubtitleFont()
  if (!fontfile) throw new Error('没有找到能显示中文的字体（Linux 可安装 fonts-noto-cjk 或 fonts-wqy-microhei），也可以用环境变量 SUBTITLE_FONT 指定字体文件')
  const inputAbs = getAbsolutePath(relativeVideo)
  const info = await probe(inputAbs)
  if (!info.width || !info.height) throw new Error('读不到视频尺寸')
  const cues = buildSubtitleCues(lines, info.duration || 5, opts, subtitleMaxEm(info.width, info.height, opts.size))
  if (!cues.length) return null

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-sub-'))
  try {
    const filter = buildDrawtextFilter(cues, opts, {
      width: info.width,
      height: info.height,
      fontfile,
      textFile: (ci, li, text) => {
        const f = path.join(tmp, `c${ci}_${li}.txt`)
        fs.writeFileSync(f, text, 'utf8')
        return f
      },
    })
    const outRel = subtitledPathFor(relativeVideo)
    const outAbs = getAbsolutePath(outRel)
    const partAbs = `${outAbs}.part.mp4`
    await new Promise<void>((resolve, reject) => {
      const cmd: any = ffmpeg(inputAbs)
      cmd
        .videoFilters(filter)
        .outputOptions(['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-y'])
        .output(partAbs)
        .on('end', () => resolve())
        .on('error', (err: any, _stdout: string, stderr: string) => {
          const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ')
          reject(new Error(`${err?.message || err}${tail ? `（${tail}）` : ''}`))
        })
        .run()
    })
    fs.renameSync(partAbs, outAbs)
    const srtRel = outRel.replace(/\.mp4$/, '.srt')
    fs.writeFileSync(getAbsolutePath(srtRel), cuesToSrt(cues), 'utf8')
    return { video: outRel, srt: srtRel, cues: cues.length }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** 分镜描述 / 视频提示词 + 角色名 → 台词（传入开启的系统音时，系统的台词标成 system） */
export function storyboardDialogue(
  description: string | null | undefined,
  characterNames: string[],
  systemVoice?: { enabled?: boolean; name?: string } | null,
  videoPrompt?: string | null,
): DialogueLine[] {
  // 和生成视频时的【台词控制】同一来源：视频提示词写了台词就用它，否则用分镜描述
  return shotDialogueLines(description, videoPrompt, characterNames, { systemNames: systemNamesFor(systemVoice), systemLabel: systemVoice?.name }).lines
}
