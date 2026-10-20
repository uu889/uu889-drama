/**
 * 背景音乐：曲库（上传到 static/bgm）+ 拼接导出时混音
 *
 * 混音（FFmpeg）：
 * - 音乐比成片短就循环，比成片长就截断；开头淡入 1.5 秒、结尾淡出 2.5 秒（可关）
 * - 音量按百分比（默认 30%）
 * - 「说话时自动压低」：用成片原声做 sidechaincompress 的触发源，有台词 / 音效时音乐自动让位，停下后回升
 * - 成片没有声音（如 Wan 2.2 本地视频不带音轨）时直接用音乐当音轨
 * 视频流直接复制，不重新编码。
 */
import fs from 'fs'
import path from 'path'
import { ffmpeg } from '../utils/ffmpeg.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { getAbsolutePath } from '../utils/storage.js'

export const BGM_DIR = 'bgm'
export const BGM_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'])
export const BGM_MAX_BYTES = 50 * 1024 * 1024

export interface BgmOptions {
  /** static/bgm/xxx.mp3 */
  path: string
  /** 0~1，默认 0.3 */
  volume: number
  /** 有人说话时自动压低音乐 */
  duck: boolean
  /** 开头淡入 / 结尾淡出 */
  fade: boolean
}

export interface BgmItem {
  path: string
  name: string
  size: number
  duration: number
  created_at: string
}

function bgmAbsDir() {
  return path.join(STORAGE_ROOT, BGM_DIR)
}

/** 文件名前缀是时间戳（避免重名），显示时去掉 */
function displayName(file: string) {
  return file.replace(/^[0-9a-z]{6,}-/, '')
}

/** 只允许曲库目录里的文件（防止传入任意路径） */
export function isBgmPath(p: unknown): p is string {
  if (typeof p !== 'string') return false
  const rel = p.replace(/^\/+/, '')
  if (!rel.startsWith(`static/${BGM_DIR}/`)) return false
  const name = rel.slice(`static/${BGM_DIR}/`.length)
  return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('..') && BGM_EXT.has(path.extname(name).toLowerCase())
}

export function normalizeBgmOptions(raw: unknown): BgmOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const p = typeof r.path === 'string' ? r.path.replace(/^\/+/, '') : ''
  if (!isBgmPath(p)) return null
  const vol = Number(r.volume)
  return {
    path: p,
    volume: Number.isFinite(vol) ? Math.min(1.5, Math.max(0.02, vol > 1.5 ? vol / 100 : vol)) : 0.3,
    duck: r.duck !== false && r.duck !== 'false' && r.duck !== 0,
    fade: r.fade !== false && r.fade !== 'false' && r.fade !== 0,
  }
}

export function probeMedia(abs: string): Promise<{ duration: number; hasAudio: boolean; hasVideo: boolean }> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(abs, (err: any, data: any) => {
      if (err) return resolve({ duration: 0, hasAudio: false, hasVideo: false })
      const streams: any[] = data?.streams || []
      resolve({
        duration: Number(data?.format?.duration) || 0,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        hasVideo: streams.some((s) => s.codec_type === 'video'),
      })
    })
  })
}

export async function listBgm(): Promise<BgmItem[]> {
  const dir = bgmAbsDir()
  let files: string[] = []
  try { files = fs.readdirSync(dir) } catch { return [] }
  const items: BgmItem[] = []
  for (const f of files) {
    if (!BGM_EXT.has(path.extname(f).toLowerCase())) continue
    const abs = path.join(dir, f)
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { continue }
    if (!st.isFile()) continue
    const info = await probeMedia(abs)
    items.push({ path: `static/${BGM_DIR}/${f}`, name: displayName(f), size: st.size, duration: Math.round(info.duration * 10) / 10, created_at: st.mtime.toISOString() })
  }
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** 保存上传的音乐（保留原文件名，加时间戳前缀防重名）；不是能解码的音频就删掉并报错 */
export async function saveBgm(data: ArrayBuffer, originalName: string): Promise<BgmItem> {
  const ext = path.extname(originalName).toLowerCase()
  if (!BGM_EXT.has(ext)) throw new Error(`仅支持 ${[...BGM_EXT].join(' / ')} 格式的音乐文件`)
  if (data.byteLength > BGM_MAX_BYTES) throw new Error(`音乐文件不能超过 ${BGM_MAX_BYTES / 1024 / 1024}MB`)
  const base = path.basename(originalName, path.extname(originalName))
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'music'
  const file = `${Date.now().toString(36)}-${base}${ext}`
  fs.mkdirSync(bgmAbsDir(), { recursive: true })
  const abs = path.join(bgmAbsDir(), file)
  fs.writeFileSync(abs, Buffer.from(data))
  const info = await probeMedia(abs)
  if (!info.hasAudio || !(info.duration > 0)) {
    fs.rmSync(abs, { force: true })
    throw new Error('读不出这个文件里的音频，请换一个音乐文件')
  }
  const st = fs.statSync(abs)
  return { path: `static/${BGM_DIR}/${file}`, name: displayName(file), size: st.size, duration: Math.round(info.duration * 10) / 10, created_at: st.mtime.toISOString() }
}

export function deleteBgm(p: string): boolean {
  const rel = p.replace(/^\/+/, '')
  if (!isBgmPath(rel)) return false
  const abs = getAbsolutePath(rel)
  if (!fs.existsSync(abs)) return false
  fs.rmSync(abs, { force: true })
  return true
}

/** 混音滤镜图（输入 0 = 成片，输入 1 = 循环的音乐） */
export function buildBgmFilter(opts: Pick<BgmOptions, 'volume' | 'duck' | 'fade'>, duration: number, hasAudio: boolean): string {
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo'
  const d = Math.max(0.5, duration)
  const fadeIn = Math.min(1.5, d / 4)
  const fadeOut = Math.min(2.5, d / 3)
  const vol = Math.round(opts.volume * 1000) / 1000
  const bg = [`[1:a]${fmt}`, `atrim=0:${d.toFixed(3)}`, 'asetpts=N/SR/TB', `volume=${vol}`]
  if (opts.fade) bg.push(`afade=t=in:st=0:d=${fadeIn.toFixed(2)}`, `afade=t=out:st=${Math.max(0, d - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`)
  const parts = [`${bg.join(',')}[bg]`]
  if (!hasAudio) {
    parts.push('[bg]anull[aout]')
  } else if (opts.duck) {
    // 原声补静音到成片长度，再分两路：一路做压低音乐的触发源，一路混进去
    parts.push(`[0:a]${fmt},apad=whole_dur=${d.toFixed(3)},asplit=2[voice][key]`)
    parts.push('[bg][key]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=450:makeup=1[bgd]')
    parts.push('[voice][bgd]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]')
  } else {
    parts.push(`[0:a]${fmt},apad=whole_dur=${d.toFixed(3)}[voice]`)
    parts.push('[voice][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]')
  }
  return parts.join(';')
}

/** 给视频混入背景音乐，输出到 outputAbs（视频流复制） */
export async function mixBackgroundMusic(inputAbs: string, outputAbs: string, opts: BgmOptions): Promise<void> {
  const bgmAbs = getAbsolutePath(opts.path)
  if (!fs.existsSync(bgmAbs)) throw new Error('背景音乐文件不存在（可能已从曲库删除），请重新选择')
  const info = await probeMedia(inputAbs)
  if (!(info.duration > 0)) throw new Error('读不到拼接后视频的时长，无法混入背景音乐')
  const filter = buildBgmFilter(opts, info.duration, info.hasAudio)
  await new Promise<void>((resolve, reject) => {
    const cmd: any = ffmpeg()
    cmd
      .input(inputAbs)
      .input(bgmAbs)
      .inputOptions(['-stream_loop', '-1'])
      .complexFilter(filter)
      .outputOptions([
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ar', '48000',
        '-b:a', '192k',
        '-t', info.duration.toFixed(3),
        '-movflags', '+faststart',
        '-y',
      ])
      .output(outputAbs)
      .on('end', () => resolve())
      .on('error', (err: any, _stdout: string, stderr: string) => {
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ')
        reject(new Error(`混入背景音乐失败：${err?.message || err}${tail ? `（${tail}）` : ''}`))
      })
      .run()
  })
}
