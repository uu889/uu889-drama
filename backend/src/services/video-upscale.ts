/**
 * 视频高清化：把分镜视频（如 480p / 768p / 720p）放大到 768p / 1080p（或 1440p / 4K）
 *
 * 两种方式：
 * - AI 超分（ComfyUI）：用 ComfyUI 里的放大模型（models/upscale_models，如 RealESRGAN x2）逐帧超分，再缩放到目标分辨率。
 *   为了不把内存撑爆，先用 FFmpeg 把视频切成约 2 秒一段，逐段交给 ComfyUI（走本地显卡排队，和生成视频一个一个来），
 *   再拼回去、配上原视频的声音。需要 ComfyUI 自带的 LoadVideo / CreateVideo / SaveVideo 节点（较新版本）。
 * - 快速放大（FFmpeg）：Lanczos 放大 + 轻微锐化，几秒钟出结果，不需要显卡；清晰度提升有限。
 * - 自动：有可用的 ComfyUI 和放大模型就用 AI 超分，否则（或 AI 失败）用快速放大。
 *
 * 结果作为这个分镜的一条新视频记录（sys_task，provider = upscale）保存为 <原名>_1080p.mp4，并设为当前视频；
 * 原视频保留在历史视频里，随时可以切回去。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { getAbsolutePath } from '../utils/storage.js'
import { extractVideoEndFrame, extractVideoPoster } from '../utils/video-poster.js'
import { parseConfigSettings, type AIConfig } from './ai.js'
import { setTaskProgress } from './task-progress.js'
import { assertNotCancelled, isTaskCancelled } from './task-cancel.js'
import { acquireGpuLane, gpuLaneKey, laneLimit, releaseGpuLane } from './gpu-queue.js'
import { comfyAuthHeaders, comfyUrl, findComfyOutput, comfyViewPath, readComfyHistory, summarizeComfyNodeErrors, waitComfyAlive } from './adapters/comfyui-common.js'
import { logTaskError, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'

export type UpscaleEngine = 'auto' | 'ai' | 'fast'
export const UPSCALE_TARGETS: Record<string, number> = { '768p': 768, '1080p': 1080, '1440p': 1440, '2160p': 2160 }

export interface UpscaleOptions {
  engine: UpscaleEngine
  target: keyof typeof UPSCALE_TARGETS | string
}

export function normalizeUpscaleOptions(raw: any): UpscaleOptions {
  const engine = ['auto', 'ai', 'fast'].includes(raw?.engine) ? raw.engine : 'auto'
  const target = UPSCALE_TARGETS[raw?.target] ? raw.target : '1080p'
  return { engine, target }
}

/** 放大后的尺寸：短边 = 目标，长边按比例，都取偶数 */
export function upscaleDimensions(width: number, height: number, targetShort: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  if (width >= height) return { width: even((width * targetShort) / height), height: even(targetShort) }
  return { width: even(targetShort), height: even((height * targetShort) / width) }
}

/** <名>.mp4 → <名>_1080p.mp4（已经带分辨率后缀的先去掉，避免 x_1080p_1440p） */
export function upscaledPathFor(relativePath: string, target: string): string {
  return relativePath.replace(/(_(?:768p|1080p|1440p|2160p))?\.[^./]+$/, `_${target}.mp4`)
}

/** 从放大模型列表里挑：优先 2x（速度快、内存小），其次 4x，再其次随便一个 */
export function pickUpscaleModel(models: string[]): string | null {
  if (!models.length) return null
  return models.find((m) => /(^|[^0-9])(x2|2x)([^0-9]|$)/i.test(m))
    || models.find((m) => /(^|[^0-9])(x4|4x)([^0-9]|$)/i.test(m))
    || models[0]
}

export function probeVideo(abs: string): Promise<{ width: number; height: number; duration: number; fps: number; hasAudio: boolean }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(abs, (err: any, data: any) => {
      if (err) return reject(new Error(`读不出视频信息：${err.message || err}`))
      const streams: any[] = data?.streams || []
      const v = streams.find((s) => s.codec_type === 'video') || {}
      const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number)
      resolve({
        width: Number(v.width) || 0,
        height: Number(v.height) || 0,
        duration: Number(data?.format?.duration) || Number(v.duration) || 0,
        fps: d ? n / d : 0,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
      })
    })
  })
}

function runFfmpeg(build: (cmd: any) => any, onPercent?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd: any = build(ffmpeg())
    cmd
      .on('progress', (p: any) => { if (onPercent && Number.isFinite(p?.percent)) onPercent(Math.min(100, Math.max(0, p.percent))) })
      .on('end', () => resolve())
      .on('error', (err: any, _o: string, stderr: string) => {
        const tail = String(stderr || '').trim().split('\n').slice(-3).join(' ')
        reject(new Error(`${err?.message || err}${tail ? `（${tail}）` : ''}`))
      })
      .run()
  })
}

// ─── 快速放大（FFmpeg） ───────────────────────────────────────────────────

export async function upscaleWithFfmpeg(inputAbs: string, outputAbs: string, dims: { width: number; height: number }, onPercent?: (p: number) => void) {
  const part = `${outputAbs}.part.mp4`
  await runFfmpeg((c) => c
    .input(inputAbs)
    .videoFilters([`scale=${dims.width}:${dims.height}:flags=lanczos`, 'unsharp=5:5:0.6:5:5:0'])
    .outputOptions(['-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-y'])
    .output(part), onPercent)
  fs.renameSync(part, outputAbs)
}

// ─── AI 超分（ComfyUI） ──────────────────────────────────────────────────

export class UpscaleUnavailable extends Error {}

/** 一段视频的超分工作流（ComfyUI 自带节点） */
export function buildUpscaleWorkflow(file: string, model: string, dims: { width: number; height: number }, prefix: string): Record<string, any> {
  return {
    '1': { class_type: 'LoadVideo', inputs: { file }, _meta: { title: '读取视频片段' } },
    '2': { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] }, _meta: { title: '拆成帧' } },
    '3': { class_type: 'UpscaleModelLoader', inputs: { model_name: model }, _meta: { title: '放大模型' } },
    '4': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['3', 0], image: ['2', 0] }, _meta: { title: 'AI 超分' } },
    '5': { class_type: 'ImageScale', inputs: { image: ['4', 0], upscale_method: 'lanczos', width: dims.width, height: dims.height, crop: 'disabled' }, _meta: { title: '缩放到目标分辨率' } },
    '6': { class_type: 'CreateVideo', inputs: { images: ['5', 0], fps: ['2', 2] }, _meta: { title: '合成视频' } },
    '7': { class_type: 'SaveVideo', inputs: { video: ['6', 0], filename_prefix: prefix, format: 'mp4', codec: 'h264' }, _meta: { title: '保存' } },
  }
}

async function comfyJson(config: AIConfig, p: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(comfyUrl(config, p), { ...init, headers: { ...comfyAuthHeaders(config), ...(init?.headers || {}) }, signal: AbortSignal.timeout(120_000) })
  const text = await resp.text()
  if (!resp.ok) {
    let detail = text.slice(0, 300)
    try {
      const body = JSON.parse(text)
      const missing = body?.error?.type === 'missing_node_type' ? body?.error?.extra_info?.class_type || '' : ''
      if (missing || /LoadVideo|CreateVideo|SaveVideo|GetVideoComponents/.test(text) && /not found|does not exist/i.test(text)) {
        throw new UpscaleUnavailable(`ComfyUI 版本太旧，缺少视频节点 ${missing || 'LoadVideo / CreateVideo'}：请把 ComfyUI 更新到最新版`)
      }
      detail = [body?.error?.message, summarizeComfyNodeErrors(body?.node_errors)].filter(Boolean).join(' — ') || detail
    } catch (e) {
      if (e instanceof UpscaleUnavailable) throw e
    }
    throw new Error(`ComfyUI ${p} HTTP ${resp.status}：${detail}`)
  }
  return text ? JSON.parse(text) : {}
}

/** ComfyUI 里能用的放大模型（models/upscale_models） */
export async function listComfyUpscaleModels(config: AIConfig): Promise<string[]> {
  const info = await comfyJson(config, '/object_info/UpscaleModelLoader')
  return comboOptions(info?.UpscaleModelLoader?.input?.required?.model_name)
}

/**
 * /object_info 里下拉框（COMBO）输入的可选值。两种格式都要认：
 * 老节点 [["a.pth", "b.pth"], {…}]；新版 ComfyUI 改成 V3 写法的节点（UpscaleModelLoader 已改）是 ["COMBO", { options: ["a.pth", …] }]
 */
export function comboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return []
  if (Array.isArray(spec[0])) return spec[0].map(String)
  const opts = (spec[1] as any)?.options
  return Array.isArray(opts) ? opts.map((o: any) => String(typeof o === 'object' && o ? o.value ?? o.name ?? '' : o)).filter(Boolean) : []
}

export const UPSCALE_MODEL_HINT = '把放大模型放到 ComfyUI/models/upscale_models/ 后重启 ComfyUI，推荐 RealESRGAN_x2plus.pth（真人 / 通用，约 64MB）：https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth ；动漫风格可用 RealESRGAN_x4plus_anime_6B.pth（同一页面）'

async function upscaleWithComfy(
  config: AIConfig,
  taskId: number,
  inputAbs: string,
  outputAbs: string,
  info: { duration: number; hasAudio: boolean },
  dims: { width: number; height: number },
  report: (message: string, fraction: number) => void,
) {
  const models = await listComfyUpscaleModels(config)
  const model = pickUpscaleModel(models)
  if (!model) throw new UpscaleUnavailable(`ComfyUI 里没有放大模型。${UPSCALE_MODEL_HINT}`)

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-up-'))
  try {
    // 1. 切成约 2 秒一段（重新编码保证每段从关键帧开始、帧数准确）
    const seg = 2
    report(`用 ${model} 超分：先把视频切成 ${seg} 秒一段，逐段交给 ComfyUI（避免一次性占满内存）`, 0.02)
    await runFfmpeg((c) => c
      .input(inputAbs)
      .outputOptions(['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', '-force_key_frames', `expr:gte(t,n_forced*${seg})`, '-f', 'segment', '-segment_time', String(seg), '-reset_timestamps', '1', '-y'])
      .output(path.join(tmp, 'in_%03d.mp4')))
    const chunks = fs.readdirSync(tmp).filter((f) => /^in_\d+\.mp4$/.test(f)).sort()
    if (!chunks.length) throw new Error('视频切段失败')

    const outs: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const base = (i + 0.05) / chunks.length
      report(`AI 超分第 ${i + 1}/${chunks.length} 段（${model}，→ ${dims.width}×${dims.height}）`, 0.05 + 0.85 * base)
      // 上传
      const form = new FormData()
      const name = `uu889_upscale_${taskId}_${i}.mp4`
      form.append('image', new Blob([fs.readFileSync(path.join(tmp, chunks[i]))], { type: 'video/mp4' }), name)
      form.append('type', 'input')
      form.append('overwrite', 'true')
      const up = await comfyJson(config, '/upload/image', { method: 'POST', body: form })
      const file = up?.subfolder ? `${up.subfolder}/${up.name}` : String(up?.name || name)
      // 提交
      const sub = await comfyJson(config, '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: buildUpscaleWorkflow(file, model, dims, `uu889-upscale/t${taskId}_${i}`), client_id: 'uu889-drama' }),
      })
      const promptId = String(sub?.prompt_id || '')
      if (!promptId) throw new Error('ComfyUI 没有返回任务 ID')
      // 等这一段跑完（每段最多 30 分钟）
      const started = Date.now()
      let entry: any = null
      while (!entry) {
        if (Date.now() - started > 30 * 60_000) throw new Error(`第 ${i + 1} 段超分超过 30 分钟没有完成`)
        await new Promise((r) => setTimeout(r, 2000))
        let history: any
        try {
          history = await comfyJson(config, `/history/${encodeURIComponent(promptId)}`)
        } catch (err: any) {
          if (!(await waitComfyAlive(config, 10 * 60_000, (m) => report(m, 0.05 + 0.85 * base)))) throw err
          throw new Error('ComfyUI 中途退出了（可能是内存 / 显存不足），超分没有完成；可以换「快速放大」，或换 2x 的放大模型后重试')
        }
        if (!history || !Object.keys(history).length) continue
        const state = readComfyHistory(history)
        if (state.state === 'error') throw new Error(`ComfyUI 超分失败：${state.error}`)
        if (state.state === 'finished') entry = state.entry
      }
      const out = findComfyOutput(entry.outputs, /\.(mp4|webm|mov|mkv)$/i)
      if (!out) throw new Error(`第 ${i + 1} 段超分没有输出视频`)
      const resp = await fetch(comfyUrl(config, comfyViewPath(out)), { headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(300_000) })
      if (!resp.ok) throw new Error(`下载超分结果失败（HTTP ${resp.status}）`)
      const local = path.join(tmp, `out_${String(i).padStart(3, '0')}.mp4`)
      fs.writeFileSync(local, Buffer.from(await resp.arrayBuffer()))
      outs.push(local)
    }

    // 2. 拼回去，配上原视频的声音
    report('拼接各段，配回原视频的声音', 0.93)
    const list = path.join(tmp, 'list.txt')
    fs.writeFileSync(list, outs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
    const part = `${outputAbs}.part.mp4`
    await runFfmpeg((c) => {
      c.input(list).inputOptions(['-f', 'concat', '-safe', '0'])
      if (info.hasAudio) c.input(inputAbs)
      return c
        .outputOptions([
          '-map', '0:v:0', ...(info.hasAudio ? ['-map', '1:a:0'] : []),
          // ComfyUI 的输出编码各版本不同：统一转一次 H.264，保证能拼接、能播放
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
          ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
          '-t', info.duration.toFixed(3), '-movflags', '+faststart', '-y',
        ])
        .output(part)
    })
    fs.renameSync(part, outputAbs)
    return model
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** 选哪个 ComfyUI 做超分：本集锁定的视频配置是 ComfyUI 就用它，否则任一启用的 ComfyUI（视频优先） */
export async function findComfyConfig(episodeId?: number | null): Promise<AIConfig | null> {
  const rows = (await db.select().from(schema.aiServiceConfigs)).filter((r) => r.isActive && r.provider === 'comfyui')
  if (!rows.length) return null
  let pick = rows.find((r) => r.serviceType === 'video')
  if (episodeId) {
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    const locked = rows.find((r) => r.id === ep?.videoConfigId)
    if (locked) pick = locked
  }
  pick ||= rows[0]
  return { provider: 'comfyui', baseUrl: pick.baseUrl, apiKey: pick.apiKey, model: '', settings: parseConfigSettings(pick.settings) }
}

// ─── 任务 ────────────────────────────────────────────────────────────────

/**
 * 给一个分镜的当前视频建高清化任务，返回任务 ID；已经达到目标分辨率时抛错（错误信息给用户看）。
 */
export async function startUpscale(storyboardId: number, raw: any): Promise<number> {
  const opts = normalizeUpscaleOptions(raw)
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!sb) throw new Error('分镜不存在')
  const source = sb.videoUrl || sb.composedVideoUrl
  if (!source) throw new Error('这个分镜还没有视频')
  const sourceAbs = getAbsolutePath(source)
  if (!fs.existsSync(sourceAbs)) throw new Error('视频文件不存在，请重新生成')
  const suite = await checkFfmpegSuite()
  if (!suite.ffmpeg || !suite.ffprobe) throw new Error('本机 ffmpeg 不可用，无法高清化')
  const info = await probeVideo(sourceAbs)
  const targetShort = UPSCALE_TARGETS[opts.target]
  if (Math.min(info.width, info.height) >= targetShort) {
    throw new Error(`这个视频已经是 ${info.width}×${info.height}，不低于 ${opts.target}，不用高清化`)
  }
  const [ep] = sb.episodeId ? await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)) : []
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type: 'video',
    storyboardId,
    dramaId: ep?.dramaId,
    provider: 'upscale',
    prompt: `高清化 ${info.width}×${info.height} → ${opts.target}`,
    model: opts.engine === 'fast' ? 'ffmpeg-lanczos' : opts.engine === 'ai' ? 'comfyui-upscale' : 'auto',
    params: JSON.stringify({ upscale: { ...opts, source } }),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })
  const id = getInsertId(res)
  setTaskProgress(id, { stage: 'preparing', message: `准备高清化：${info.width}×${info.height} → ${opts.target}` })
  logTaskStart('UpscaleTask', 'enqueue', { id, storyboardId, source, ...opts })
  runUpscale(id, storyboardId, source, sb.episodeId, opts, info).catch(() => {})
  return id
}

async function runUpscale(
  id: number,
  storyboardId: number,
  source: string,
  episodeId: number | null,
  opts: UpscaleOptions,
  info: Awaited<ReturnType<typeof probeVideo>>,
) {
  const report = (message: string, fraction: number) => setTaskProgress(id, { stage: 'running', percent: Math.round(5 + 90 * fraction), message })
  const dims = upscaleDimensions(info.width, info.height, UPSCALE_TARGETS[opts.target])
  const outRel = upscaledPathFor(source, opts.target)
  const outAbs = getAbsolutePath(outRel)
  const sourceAbs = getAbsolutePath(source)
  let usedLane: string | null = null
  try {
    let method = ''
    let note = ''
    const comfy = opts.engine === 'fast' ? null : await findComfyConfig(episodeId)
    if (opts.engine === 'ai' && !comfy) throw new Error('没有启用的 ComfyUI 配置，无法 AI 超分；可以改用「快速放大」')
    if (comfy) {
      // 和生成视频共用本地显卡排队
      usedLane = gpuLaneKey(comfy)
      if (usedLane) {
        await acquireGpuLane(usedLane, id, {
          limit: laneLimit(comfy),
          kind: 'upscale',
          onPosition: (p) => setTaskProgress(id, { stage: 'queued', message: `本机排队中：前面还有 ${p} 个任务，轮到后开始 AI 超分`, detail: { queue_ahead: p } }),
        })
      }
      try {
        if (!(await waitComfyAlive(comfy, opts.engine === 'ai' ? 10 * 60_000 : 5_000, (m) => setTaskProgress(id, { stage: 'queued', message: m })))) {
          throw new UpscaleUnavailable('ComfyUI 没有运行')
        }
        const model = await upscaleWithComfy(comfy, id, sourceAbs, outAbs, info, dims, report)
        method = `AI 超分（${model}）`
      } catch (err: any) {
        if (opts.engine === 'ai' || isTaskCancelled(id)) throw err
        // 自动模式：AI 超分用不了或中途失败，都退回快速放大，结果里说明原因
        note = `AI 超分没有完成（${String(err?.message || err).slice(0, 160)}），已改用快速放大。`
        logTaskWarn('UpscaleTask', 'fallback-fast', { id, reason: err.message })
      } finally {
        if (usedLane) releaseGpuLane(id)
        usedLane = null
      }
    }
    assertNotCancelled(id)
    if (!method) {
      // FFmpeg 也排队（同时只编一个，避免 CPU 被几个 4K 编码挤满）
      await acquireGpuLane('cpu:ffmpeg', id, { kind: 'upscale', onPosition: (p) => setTaskProgress(id, { stage: 'queued', message: `${note}排队中：前面还有 ${p} 个高清化任务` }) })
      usedLane = 'cpu:ffmpeg'
      report(`${note}快速放大（FFmpeg Lanczos + 锐化）→ ${dims.width}×${dims.height}`, 0)
      await upscaleWithFfmpeg(sourceAbs, outAbs, dims, (p) => report(`${note}快速放大 ${Math.round(p)}%（→ ${dims.width}×${dims.height}）`, p / 100))
      method = '快速放大（FFmpeg）'
    }

    setTaskProgress(id, { stage: 'saving', message: '生成封面和接戏用的结尾帧' })
    await extractVideoPoster(outRel)
    await extractVideoEndFrame(outRel)
    assertNotCancelled(id)
    const ts = now()
    await db.update(schema.sysTask)
      .set({ status: 'completed', localPath: outRel, model: method, errorMsg: note || null, completedAt: ts, updatedAt: ts })
      .where(eq(schema.sysTask.id, id))
    // 设为当前视频（分镜还指向原视频时；期间用户换了别的视频就不动）
    await db.update(schema.storyboards)
      .set({ videoUrl: outRel, updatedAt: ts })
      .where(and(eq(schema.storyboards.id, storyboardId), eq(schema.storyboards.videoUrl, source)))
    setTaskProgress(id, { stage: 'completed', percent: 100, message: `高清化完成：${dims.width}×${dims.height}，${method}` })
    logTaskSuccess('UpscaleTask', 'done', { id, output: outRel, method, ...dims })
  } catch (err: any) {
    fs.rmSync(`${outAbs}.part.mp4`, { force: true })
    // 手动取消：状态已经落库
    if (isTaskCancelled(id)) return
    const message = `高清化失败：${err?.message || err}`
    setTaskProgress(id, { stage: 'failed', message })
    logTaskError('UpscaleTask', 'failed', { id, error: err?.message })
    await db.update(schema.sysTask).set({ status: 'failed', errorMsg: message, updatedAt: now() }).where(eq(schema.sysTask.id, id))
    fs.rmSync(`${outAbs}.part.mp4`, { force: true })
  } finally {
    if (usedLane) releaseGpuLane(id)
  }
}

/** 批量：本集所有有视频、且低于目标分辨率的分镜（或指定的分镜） */
export async function startEpisodeUpscale(episodeId: number, raw: any, storyboardIds?: number[]) {
  const rows = (await db.select().from(schema.storyboards).where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt))))
    .filter((sb) => (sb.videoUrl || sb.composedVideoUrl) && (!storyboardIds?.length || storyboardIds.includes(sb.id)))
    .sort((a, b) => a.storyboardNumber - b.storyboardNumber)
  const created: Array<{ storyboard_id: number; task_id: number }> = []
  const skipped: Array<{ storyboard_id: number; reason: string }> = []
  for (const sb of rows) {
    try {
      created.push({ storyboard_id: sb.id, task_id: await startUpscale(sb.id, raw) })
    } catch (err: any) {
      skipped.push({ storyboard_id: sb.id, reason: err?.message || String(err) })
    }
  }
  return { created, skipped }
}

/** 设置弹窗用：AI 超分是否可用、有哪些放大模型 */
export async function upscaleInfo(episodeId?: number | null) {
  const comfy = await findComfyConfig(episodeId)
  if (!comfy) return { comfy: false, reachable: false, models: [] as string[], model: null, hint: UPSCALE_MODEL_HINT }
  try {
    const models = await listComfyUpscaleModels(comfy)
    return { comfy: true, reachable: true, base_url: comfy.baseUrl, models, model: pickUpscaleModel(models), hint: UPSCALE_MODEL_HINT }
  } catch {
    return { comfy: true, reachable: false, base_url: comfy.baseUrl, models: [] as string[], model: null, hint: UPSCALE_MODEL_HINT }
  }
}
