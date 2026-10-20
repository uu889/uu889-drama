/**
 * FFmpeg 多镜头拼接 — 将所有生成后的镜头视频拼接为一集
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'
import { mixBackgroundMusic, type BgmOptions } from './bgm.js'
import { probeVideo } from './video-upscale.js'
import { getAbsolutePath } from '../utils/storage.js'

function toAbsPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

/**
 * 拼接一集的镜头视频。
 * 优先使用视频生成产物，兼容历史的 composedVideoUrl 数据。
 * 传入 storyboardIds 时只拼接所选镜头（仍按镜号顺序）；传入 bgm 时拼接后混入背景音乐。
 */
export async function mergeEpisodeVideos(episodeId: number, dramaId: number, storyboardIds?: number[], bgm?: BgmOptions | null): Promise<number> {
  let storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)

  if (storyboardIds?.length) {
    const allow = new Set(storyboardIds.map(Number))
    storyboards = storyboards.filter(sb => allow.has(sb.id))
  }

  // 允许部分拼接:按镜号顺序拼接已生成的镜头,未生成的跳过
  const clips = storyboards
    .map(sb => ({ sb, url: sb.videoUrl || sb.composedVideoUrl }))
    .filter(c => Boolean(c.url)) as { sb: typeof storyboards[number]; url: string }[]

  if (clips.length === 0) throw new Error('所选镜头还没有可拼接的视频')

  // 拼接前探测 ffmpeg：二进制损坏时 fluent-ffmpeg 的同步 EFTYPE 会崩掉整个进程，
  // 这里提前拦截并给出可操作的修复指引（路由层会作为 400 返回前端）
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) {
    throw new Error('本机 ffmpeg 不可用，无法拼接视频（常见于 node_modules 跨平台拷贝或 ffmpeg-static 下载损坏）。请删除 node_modules 后在本机重新 npm install，或设置 FFMPEG_BIN 指向有效的 ffmpeg 可执行文件后重启服务')
  }

  // 校验视频文件真实存在:DB 里的 video_url 可能指向已被清理的文件,
  // 直接拼会得到 ffmpeg 的 "No such file or directory" 晦涩报错
  const missing = clips.filter(c => !fs.existsSync(toAbsPath(c.url)))
  if (missing.length > 0) {
    const nums = missing.map(c => `S${c.sb.storyboardNumber}`).join('、')
    throw new Error(`镜头 ${nums} 的视频文件已丢失（本地文件不存在），请重新生成这些镜头的视频，或在拼接时取消勾选`)
  }

  const videos = clips.map(c => c.url)

  if (bgm && !fs.existsSync(getAbsolutePath(bgm.path))) {
    throw new Error('背景音乐文件不存在（可能已从曲库删除），请重新选择')
  }

  logTaskStart('MergeTask', 'episode-merge', { episodeId, dramaId, clips: videos.length, bgm: bgm?.path })

  // 创建 merge 记录
  const ts = now()
  const res = await db.insert(schema.videoMerges).values({
    episodeId,
    dramaId,
    title: bgm ? `Episode ${episodeId} Merge · BGM ${path.basename(bgm.path).replace(/^[0-9a-z]{6,}-/, '')}` : `Episode ${episodeId} Merge`,
    provider: 'ffmpeg',
    model: bgm ? 'ffmpeg-concat-h264-aac+bgm' : 'ffmpeg-concat-h264-aac',
    status: 'processing',
    scenes: JSON.stringify(videos),
    createdAt: ts,
  })
  const mergeId = getInsertId(res)

  // 异步执行
  doMerge(mergeId, episodeId, videos, bgm || null).catch(async err => {
    logTaskError('MergeTask', 'episode-merge', { mergeId, episodeId, error: err.message })
    console.error(`[Merge] Failed:`, err)
    await db.update(schema.videoMerges)
      .set({ status: 'failed', errorMsg: err.message })
      .where(eq(schema.videoMerges.id, mergeId))
  })

  return mergeId
}

async function doMerge(mergeId: number, episodeId: number, videos: string[], bgm: BgmOptions | null) {
  // 生成 concat 列表文件
  const listDir = path.join(STORAGE_ROOT, 'temp')
  fs.mkdirSync(listDir, { recursive: true })
  const listPath = path.join(listDir, `${uuid()}.txt`)

  const listContent = videos
    .map(v => `file '${toAbsPath(v)}'`)
    .join('\n')
  fs.writeFileSync(listPath, listContent, 'utf-8')

  // 输出文件
  const outputDir = path.join(STORAGE_ROOT, 'merged')
  fs.mkdirSync(outputDir, { recursive: true })
  const outputFilename = `${uuid()}.mp4`
  const outputPath = path.join(outputDir, outputFilename)
  // 要混背景音乐时先拼到临时文件，混完再写到最终位置
  const concatPath = bgm ? path.join(outputDir, `${uuid()}.concat.mp4`) : outputPath

  // 镜头分辨率 / 帧率 / 有无声音不一致（部分镜头高清化到 1080p、Wan 16fps 和 H3 24fps 混用、Wan 没有音轨）时，
  // concat 分离器会把时长和画面拼乱：改用 concat 滤镜，逐段统一尺寸 / 帧率，没声音的段补静音
  const plan = await planConcat(videos.map(toAbsPath))
  const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-movflags', '+faststart']

  await new Promise<void>((resolve, reject) => {
    const cmd: any = ffmpeg()
    if (plan) {
      for (const f of videos.map(toAbsPath)) cmd.input(f)
      cmd.complexFilter(plan.filter).outputOptions(['-map', '[v]', ...(plan.audio ? ['-map', '[a]'] : []), ...encode])
    } else {
      cmd.input(listPath).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions(['-fflags', '+genpts', ...encode])
    }
    cmd
      .output(concatPath)
      .on('end', () => resolve())
      .on('error', (err: any) => reject(err))
      .run()
  })

  // 清理临时文件
  fs.unlinkSync(listPath)

  let bgmError = ''
  if (bgm) {
    try {
      await mixBackgroundMusic(concatPath, outputPath, bgm)
      fs.rmSync(concatPath, { force: true })
    } catch (err: any) {
      // 混音失败不丢掉拼接结果：保留无背景音乐的成片并提示原因
      bgmError = err?.message || String(err)
      logTaskError('MergeTask', 'bgm-mix', { mergeId, episodeId, error: bgmError })
      fs.rmSync(outputPath, { force: true })
      fs.renameSync(concatPath, outputPath)
    }
  }

  // 获取时长
  const duration = await getVideoDuration(outputPath)

  const mergedRelative = `static/merged/${outputFilename}`

  // 成片海报帧（导出页封面用）
  await extractVideoPoster(mergedRelative)

  // 更新 merge 记录
  await db.update(schema.videoMerges)
    .set({ status: 'completed', mergedUrl: mergedRelative, duration, completedAt: now(), ...(bgmError ? { errorMsg: `成片已生成，但没有混入背景音乐：${bgmError}`, model: 'ffmpeg-concat-h264-aac' } : {}) })
    .where(eq(schema.videoMerges.id, mergeId))

  // 更新 episode
  await db.update(schema.episodes)
    .set({ videoUrl: mergedRelative, updatedAt: now() })
    .where(eq(schema.episodes.id, episodeId))

  logTaskSuccess('MergeTask', 'episode-merge', { mergeId, episodeId, output: mergedRelative, duration, clips: videos.length })
}

/**
 * 各镜头不一致时的 concat 滤镜图（输入 i 为第 i 个镜头）；尺寸、帧率、有无声音都一致时返回 null（走更快的 concat 分离器）
 */
export async function planConcat(files: string[]): Promise<{ filter: string; audio: boolean } | null> {
  const infos = await Promise.all(files.map((f) => probeVideo(f).catch(() => null)))
  if (files.length < 2 || infos.some((i) => !i)) return null
  const list = infos as Awaited<ReturnType<typeof probeVideo>>[]
  const vf = await uniformVideoFilters(files, list)
  const audioMixed = new Set(list.map((i) => i.hasAudio)).size > 1
  if (!vf.length && !audioMixed) return null
  const big = list.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
  const w = Math.round(big.width / 2) * 2
  const h = Math.round(big.height / 2) * 2
  const fps = Math.max(...list.map((i) => Math.round(i.fps * 100) / 100).filter((f) => f > 0), 24)
  const audio = list.some((i) => i.hasAudio)
  const parts: string[] = []
  const pairs: string[] = []
  list.forEach((info, i) => {
    parts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`)
    if (audio) {
      parts.push(info.hasAudio
        ? `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${info.duration.toFixed(3)}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=0:${info.duration.toFixed(3)}[a${i}]`)
    }
    pairs.push(audio ? `[v${i}][a${i}]` : `[v${i}]`)
  })
  parts.push(`${pairs.join('')}concat=n=${list.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? '[a]' : ''}`)
  return { filter: parts.join(';'), audio }
}

/** 各镜头尺寸 / 帧率不一致时的统一滤镜（一致时返回 []） */
export async function uniformVideoFilters(files: string[], probed?: Awaited<ReturnType<typeof probeVideo>>[]): Promise<string[]> {
  const infos = probed || (await Promise.all(files.map((f) => probeVideo(f).catch(() => null)))).filter(Boolean) as Awaited<ReturnType<typeof probeVideo>>[]
  if (infos.length < 2) return []
  const sizes = new Set(infos.map((i) => `${i.width}x${i.height}`))
  const fpsSet = new Set(infos.map((i) => Math.round(i.fps * 100) / 100).filter((f) => f > 0))
  const filters: string[] = []
  if (sizes.size > 1) {
    const big = infos.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    const w = Math.round(big.width / 2) * 2
    const h = Math.round(big.height / 2) * 2
    filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1')
  }
  if (fpsSet.size > 1) filters.push(`fps=${Math.max(...fpsSet)}`)
  return filters
}

function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) { resolve(0); return }
      resolve(Math.round(metadata.format.duration || 0))
    })
  })
}
