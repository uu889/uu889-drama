/**
 * 创作会话的剪辑合成（render_video）：
 * 每个镜头先规整成同尺寸 / 30fps / 带音轨的片段（视频裁切到统一画幅、图片做推拉动效、镜头字幕、镜头旁白压低原声），
 * 再无损拼接，最后可加片头标题卡与背景音乐（自动在人声处压低）。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { ffmpeg, checkFfmpegSuite } from '../../utils/ffmpeg.js'
import { STORAGE_ROOT } from '../../utils/paths.js'
import { getAbsolutePath } from '../../utils/storage.js'
import { extractVideoPoster } from '../../utils/video-poster.js'
import { mixBackgroundMusic, probeMedia } from '../bgm.js'
import { renderIntroClip, INTRO_STYLE_DEFAULTS } from '../episode-intro.js'
import { buildDrawtextFilter, findSubtitleFont, subtitleMaxEm, wrapText, type SubtitleCue, type SubtitleOptions } from '../subtitles.js'

export interface RenderScene {
  /** 素材本地路径（static/...）与类型 */
  path: string
  type: 'video' | 'image'
  trim_start?: number
  duration?: number
  keep_audio?: boolean
  motion?: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'none'
  caption?: string
  voiceover?: { path: string; offset?: number } | null
}

export interface RenderInput {
  scenes: RenderScene[]
  aspect_ratio: string
  resolution: string
  title?: { text: string; subtitle?: string; duration?: number } | null
  music?: { path: string; volume?: number; duck?: boolean } | null
  subtitle_style?: SubtitleOptions['style']
  fade?: boolean
}

export interface RenderResult {
  path: string
  duration: number
  warnings: string[]
}

const FPS = 30

/** 画幅 + 分辨率 → 像素（短边 = 480 / 720 / 1080，偶数） */
export function targetSize(ratio: string, resolution: string): { width: number; height: number } {
  const short = resolution === '1080p' ? 1080 : resolution === '480p' ? 480 : 720
  const [a, b] = (ratio.match(/^(\d+):(\d+)$/) ? ratio.split(':').map(Number) : [16, 9])
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return a >= b
    ? { width: even((short * a) / b), height: short }
    : { width: short, height: even((short * b) / a) }
}

/** 镜头字幕：按时长一条，放在片段里（换好行） */
export function captionCue(text: string, duration: number, width: number, height: number): SubtitleCue | null {
  const t = String(text || '').trim()
  if (!t) return null
  const lines = wrapText(t, subtitleMaxEm(width, height, 'medium')).slice(0, 2)
  return { start: 0.15, end: Math.max(0.5, duration - 0.1), lines }
}

/** 图片推拉摇移（zoompan）：d 帧，输出 w×h */
export function motionFilter(motion: RenderScene['motion'], frames: number, w: number, h: number): string {
  const d = Math.max(1, frames)
  const base = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2}`
  switch (motion) {
    case 'none': return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},loop=loop=${d}:size=1:start=0`
    case 'zoom_out': return `${base},zoompan=z='1.15-0.15*on/${d}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:s=${w}x${h}:fps=${FPS}`
    case 'pan_left': return `${base},zoompan=z=1.12:x='(iw-iw/zoom)*(1-on/${d})':y='ih/2-(ih/zoom/2)':d=${d}:s=${w}x${h}:fps=${FPS}`
    case 'pan_right': return `${base},zoompan=z=1.12:x='(iw-iw/zoom)*on/${d}':y='ih/2-(ih/zoom/2)':d=${d}:s=${w}x${h}:fps=${FPS}`
    default: return `${base},zoompan=z='1+0.15*on/${d}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${d}:s=${w}x${h}:fps=${FPS}`
  }
}

function run(cmd: any, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve())
      .on('error', (err: any, _o: string, stderr: string) => {
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ')
        reject(new Error(`${label}失败：${err?.message || err}${tail ? `（${tail}）` : ''}`))
      })
      .run()
  })
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k']

async function renderSegment(scene: RenderScene, i: number, size: { width: number; height: number }, tmp: string, opts: { font: string | null; subtitle: SubtitleOptions; warnings: string[] }): Promise<{ file: string; duration: number }> {
  const { width: w, height: h } = size
  const abs = getAbsolutePath(scene.path)
  if (!fs.existsSync(abs)) throw new Error(`第 ${i + 1} 个镜头的素材文件不存在：${scene.path}`)
  const info = await probeMedia(abs).catch(() => ({ duration: 0, hasAudio: false, hasVideo: true }))
  const voice = scene.voiceover?.path ? getAbsolutePath(scene.voiceover.path) : ''
  if (voice && !fs.existsSync(voice)) throw new Error(`第 ${i + 1} 个镜头的旁白文件不存在`)
  const voiceInfo = voice ? await probeMedia(voice).catch(() => ({ duration: 0, hasAudio: true, hasVideo: false })) : null
  const offset = Math.max(0, scene.voiceover?.offset ?? 0.2)

  const trim = Math.max(0, scene.trim_start || 0)
  let duration = scene.type === 'image'
    ? (scene.duration || 4)
    : Math.max(0.5, Math.min(scene.duration || Infinity, (info.duration || 5) - trim))
  // 镜头没写时长、旁白比画面长：延长到旁白说完（视频最后一帧定格）
  const needed = voiceInfo?.duration ? offset + voiceInfo.duration + 0.3 : 0
  const pad = !scene.duration && needed > duration ? needed - duration : 0
  duration += pad

  const vf: string[] = []
  if (scene.type === 'image') {
    vf.push(motionFilter(scene.motion || 'zoom_in', Math.round(duration * FPS), w, h))
  } else {
    vf.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, `fps=${FPS}`)
    if (pad > 0) vf.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`)
  }
  vf.push('setsar=1', 'format=yuv420p')
  const cue = scene.caption ? captionCue(scene.caption, duration, w, h) : null
  if (cue) {
    if (opts.font) {
      vf.push(buildDrawtextFilter([cue], opts.subtitle, {
        width: w,
        height: h,
        fontfile: opts.font,
        textFile: (ci, li, text) => {
          const f = path.join(tmp, `cap${i}_${ci}_${li}.txt`)
          fs.writeFileSync(f, text, 'utf8')
          return f
        },
      }))
    } else if (!opts.warnings.includes('nofont')) {
      opts.warnings.push('nofont')
    }
  }

  const cmd: any = ffmpeg()
  if (scene.type === 'image') cmd.input(abs).inputOptions(['-loop', '1'])
  else cmd.input(abs).inputOptions(trim > 0 ? ['-ss', trim.toFixed(3)] : [])
  cmd.input('anullsrc=channel_layout=stereo:sample_rate=48000').inputOptions(['-f', 'lavfi'])
  if (voice) cmd.input(voice)

  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo'
  const keep = scene.type === 'video' && scene.keep_audio !== false && info.hasAudio
  const d = duration.toFixed(3)
  const parts = [`[0:v]${vf.join(',')},trim=0:${d},setpts=PTS-STARTPTS[v]`]
  const base = keep ? `[0:a]${fmt},apad,atrim=0:${d},asetpts=PTS-STARTPTS` : `[1:a]${fmt},atrim=0:${d}`
  if (voice) {
    // 旁白在前、原声压低到约 30%（不完全去掉环境声）
    parts.push(`${base},volume=${keep ? 0.3 : 1}[bed]`)
    parts.push(`[2:a]${fmt},adelay=${Math.round(offset * 1000)}|${Math.round(offset * 1000)},apad,atrim=0:${d}[vo]`)
    parts.push(`[bed][vo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`)
  } else {
    parts.push(`${base}[a]`)
  }
  const file = path.join(tmp, `seg${String(i).padStart(3, '0')}.mp4`)
  cmd.complexFilter(parts.join(';')).outputOptions(['-map', '[v]', '-map', '[a]', ...ENCODE, '-t', d, '-y']).output(file)
  await run(cmd, `第 ${i + 1} 个镜头处理`)
  return { file, duration }
}

export async function renderStudioVideo(input: RenderInput): Promise<RenderResult> {
  if (!input.scenes.length) throw new Error('没有可合成的镜头')
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) throw new Error('本机 ffmpeg 不可用，无法合成成片')
  const size = targetSize(input.aspect_ratio, input.resolution)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-studio-'))
  const warnings: string[] = []
  const font = findSubtitleFont()
  const subtitle: SubtitleOptions = { style: input.subtitle_style || 'shadow', size: 'medium', position: 'bottom', speaker: false }
  try {
    const segs: Array<{ file: string; duration: number }> = []
    for (let i = 0; i < input.scenes.length; i++) segs.push(await renderSegment(input.scenes[i], i, size, tmp, { font, subtitle, warnings }))

    let files = segs.map(s => s.file)
    if (input.title?.text) {
      try {
        const intro = await renderIntroClip({
          duration: Math.min(5, Math.max(1, input.title.duration || 2.5)),
          image: null,
          title: input.title.text.slice(0, 40),
          subtitle: (input.title.subtitle || '').slice(0, 40),
          font: null,
          ...INTRO_STYLE_DEFAULTS,
        }, { ...size, fps: FPS }, files[0])
        if (intro.warning) warnings.push(intro.warning)
        // 片头编码参数与镜头不同：重编码一遍再拼
        const norm = path.join(tmp, 'intro.mp4')
        const cmd: any = ffmpeg().input(intro.file).input('anullsrc=channel_layout=stereo:sample_rate=48000').inputOptions(['-f', 'lavfi'])
        const info = await probeMedia(intro.file)
        cmd.complexFilter(`[0:v]scale=${size.width}:${size.height},setsar=1,fps=${FPS},format=yuv420p[v]`)
          .outputOptions(['-map', '[v]', '-map', '1:a', ...ENCODE, '-t', String(info.duration || 2.5), '-y']).output(norm)
        await run(cmd, '片头')
        fs.rmSync(intro.file, { force: true })
        files = [norm, ...files]
      } catch (err: any) {
        warnings.push(`片头没有生成：${err?.message || err}`)
      }
    }

    const listPath = path.join(tmp, 'list.txt')
    fs.writeFileSync(listPath, files.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
    const outDir = path.join(STORAGE_ROOT, 'studio')
    fs.mkdirSync(outDir, { recursive: true })
    const name = `${uuid()}.mp4`
    const outAbs = path.join(outDir, name)
    const concatAbs = input.music || input.fade ? path.join(tmp, 'concat.mp4') : outAbs
    await run(ffmpeg().input(listPath).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions(['-c', 'copy', '-movflags', '+faststart', '-y']).output(concatAbs), '拼接')

    let current = concatAbs
    if (input.fade) {
      const info = await probeMedia(current)
      const total = info.duration || 1
      const faded = path.join(tmp, 'faded.mp4')
      const out = Math.max(0, total - 0.8).toFixed(2)
      await run(ffmpeg().input(current)
        .videoFilters([`fade=t=in:st=0:d=0.5`, `fade=t=out:st=${out}:d=0.8`])
        .audioFilters([`afade=t=in:st=0:d=0.5`, `afade=t=out:st=${out}:d=0.8`])
        .outputOptions([...ENCODE, '-movflags', '+faststart', '-y']).output(input.music ? faded : outAbs), '淡入淡出')
      current = input.music ? faded : outAbs
    }
    if (input.music) {
      try {
        await mixBackgroundMusic(current, outAbs, { path: input.music.path, volume: Math.min(1, Math.max(0.05, input.music.volume ?? 0.3)), duck: input.music.duck !== false, fade: true })
      } catch (err: any) {
        warnings.push(`没有混入背景音乐：${err?.message || err}`)
        fs.copyFileSync(current, outAbs)
      }
    }
    const rel = `static/studio/${name}`
    await extractVideoPoster(rel)
    const info = await probeMedia(outAbs)
    const notes = warnings.map(w => (w === 'nofont' ? '没有找到中文字体，镜头字幕没有烧进画面（Linux 可安装 fonts-noto-cjk，或设置环境变量 SUBTITLE_FONT）' : w))
    return { path: rel, duration: Math.round((info.duration || 0) * 10) / 10, warnings: notes }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
