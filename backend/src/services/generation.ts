/**
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 下载落盘 → 回写业务表
 */
import { ensureStyleModelsForTask } from './model-installer/index.js'
import { db, getInsertId, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, fetchImageAsCompressedDataUrl, generateImageThumb, readImageAsCompressedDataUrl, readImageAsDataUrl, saveBase64Image } from '../utils/storage.js'
import { extractVideoEndFrame, extractVideoPoster } from '../utils/video-poster.js'
import { getImageAdapter, getVideoAdapter } from './adapters/registry'
import type { AIConfig, GenerateContext, ImageProviderAdapter, ProviderRequest, VideoProviderAdapter } from './adapters/types'
import { formatBytes, formatEta, setTaskProgress, stagePercent, type TaskProgressPatch } from './task-progress.js'
import { maybeTranslatePrompt, needsTranslation, shouldTranslatePrompt } from './prompt-translate.js'
import { getDramaStyleKey } from './style-preset.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'

type TaskType = 'image' | 'video'

const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s×300
const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: 300, intervalMs: 10_000, maxDurationMs: null },
}

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  referenceFileUrl?: string
  referenceLinkUrl?: string
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  configId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置，避免生成被旧引用卡死
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('image')
    : await getActiveConfig('image')
  if (!config) throw new Error('未配置图片模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages: params.referenceImages,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('video')
    : await getActiveConfig('video')
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    referenceMode: params.referenceMode || 'reference',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    referenceFileUrl: params.referenceFileUrl,
    referenceLinkUrl: params.referenceLinkUrl,
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    // 统一存为项目内部格式，各适配器再转换为官方大小写与枚举。
    resolution: normalizeStoredVideoResolution(params.resolution),
    seed: params.seed,
    promptExtend: params.promptExtend,
    watermark: params.watermark,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'reference',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
  },
  params: Record<string, unknown>,
): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.sysTask).values({
    type,
    ...fields,
    provider: config.provider,
    params: JSON.stringify(params),
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  })

  const id = getInsertId(res)
  setTaskProgress(id, { stage: 'preparing', message: `已创建任务，准备参考素材（${config.provider}）` })
  processTask(id, config).catch(err => {
    logTaskError(taskLabel(type), 'process', { id, error: err.message })
    console.error(`${taskLabel(type)} ${id} failed:`, err)
  })
  return id
}

function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

async function processTask(id: number, config: AIConfig) {
  try {
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    const type = record.type as TaskType
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)
    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown
    let request: ProviderRequest
    // 适配器构建请求时（上传参考图、连接进度通道等）上报进度
    const ctx: GenerateContext = { report: (patch) => { setTaskProgress(id, patch) } }

    // 项目视觉风格：本地服务据此切换风格模型（Checkpoint / LoRA）
    const dramaStyle = await getDramaStyleKey(record.dramaId)
    // 开启「自动下载缺少的风格模型」时：缺文件先下载（进度显示在任务里），下完再生成
    await ensureStyleModelsForTask(config, type === 'image' ? 'image' : 'video', dramaStyle, (patch) => { setTaskProgress(id, patch) })

    // 本地 SD 系模型只认英文：按设置把中文提示词先翻译成英文（只影响发给上游的提示词）
    let prompt = record.prompt
    if (needsTranslation(prompt) && shouldTranslatePrompt(config.provider, type, config.settings)) {
      setTaskProgress(id, { stage: 'preparing', percent: 1, message: '用文字模型把提示词翻译成英文（SD / SDXL / FLUX 只认英文）' })
      prompt = await maybeTranslatePrompt(prompt || '', (message) => {
        setTaskProgress(id, { stage: 'preparing', message: `提示词翻译失败，改用原文：${message}` })
      })
      if (prompt !== record.prompt) logTaskPayload(label, 'translated prompt', { id, prompt })
    }

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const resolvedReferenceImages = await normalizeReferenceImages(params.referenceImages)
      setTaskProgress(id, {
        stage: 'preparing',
        percent: 2,
        message: resolvedReferenceImages.length ? `已读取 ${resolvedReferenceImages.length} 张参考图，构建请求` : '构建生成请求',
      })
      request = await adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
        style: dramaStyle,
      }, ctx)
      ;({ url, method, headers, body } = request)
    } else {
      const adapter = getVideoAdapter(config.provider)
      const resolvedImageUrl = await normalizeVideoReferenceUrl(params.imageUrl)
      const resolvedFirstFrameUrl = await normalizeVideoReferenceUrl(params.firstFrameUrl)
      const resolvedLastFrameUrl = await normalizeVideoReferenceUrl(params.lastFrameUrl)
      const resolvedReferenceImageUrls = await normalizeVideoReferenceUrls(params.referenceImageUrls)
      // 参考视频/音频文件较大，不适合 dataURL 内联，需解析为公网可访问 URL
      const resolvedReferenceVideoUrls = resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
      const resolvedReferenceAudioUrls = resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
      const resolvedReferenceFileUrl = resolvePublicMediaUrl(params.referenceFileUrl, 'file')
      const imageCount = [resolvedImageUrl, resolvedFirstFrameUrl, resolvedLastFrameUrl].filter(Boolean).length + resolvedReferenceImageUrls.length
      setTaskProgress(id, {
        stage: 'preparing',
        percent: 2,
        message: imageCount ? `已读取 ${imageCount} 张首尾帧 / 参考图，构建请求` : '构建生成请求（纯文生视频）',
      })
      request = await adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt,
        referenceMode: params.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls.length ? JSON.stringify(resolvedReferenceImageUrls) : null,
        referenceVideoUrls: resolvedReferenceVideoUrls.length ? JSON.stringify(resolvedReferenceVideoUrls) : null,
        referenceAudioUrls: resolvedReferenceAudioUrls.length ? JSON.stringify(resolvedReferenceAudioUrls) : null,
        referenceFileUrl: resolvedReferenceFileUrl,
        referenceLinkUrl: params.referenceLinkUrl,
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        seed: params.seed,
        promptExtend: params.promptExtend,
        watermark: params.watermark,
        style: dramaStyle,
      }, ctx)
      ;({ url, method, headers, body } = request)
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })

    const isMultipart = body instanceof FormData
    logTaskPayload(label, 'request payload', {
      id, method, url, headers,
      // multipart 表单（如 OpenAI /v1/images/edits）无法 JSON 化，记录字段摘要
      body: isMultipart ? `[multipart/form-data: ${[...(body as FormData).keys()].join(', ')}]` : body,
    })

    const mediaAdapter = type === 'video' ? getVideoAdapter(config.provider) : getImageAdapter(config.provider)
    const submitPatch: TaskProgressPatch = { stage: 'submitting', message: `提交生成请求到 ${config.provider}` }
    setTaskProgress(id, submitPatch)
    // 同步接口（如 SD WebUI）请求会阻塞到出图：期间另行查询进度
    const stopSyncProgress = mediaAdapter.trackSyncProgress?.(config, request, (patch) => { setTaskProgress(id, patch) })
    let resp: Response
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: isMultipart ? (body as FormData) : JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      })
    } finally {
      stopSyncProgress?.()
    }

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(mediaAdapter.describeError?.(resp.status, text) || formatUpstreamError(resp.status, text))
    }
    const result = await resp.json() as any
    logTaskPayload(label, 'response payload', { id, provider: config.provider, result })

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        setTaskProgress(id, { stage: 'downloading', message: '生成完成，下载图片' })
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, config, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      await markPolling(id, taskId)
      adapter.onSubmitted?.(config, taskId!, request, (patch) => { setTaskProgress(id, patch) })
      pollTask(record, config, taskId!, request)
      return
    }

    const adapter = getVideoAdapter(config.provider)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      setTaskProgress(id, { stage: 'downloading', message: '生成完成，下载视频' })
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, config, videoUrl, params.duration)
      return
    }

    await markPolling(id, taskId)
    adapter.onSubmitted?.(config, taskId!, request, (patch) => { setTaskProgress(id, patch) })
    pollTask(record, config, taskId!, request)
  } catch (err: any) {
    await failTask(id, err.message)
  }
}

async function markPolling(id: number, taskId: string | undefined) {
  await db.update(schema.sysTask)
    .set({ taskId, status: 'processing', updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  setTaskProgress(id, { stage: 'queued', message: `已提交，上游任务 ID：${taskId}，等待开始处理` })
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

async function failTask(id: number, message: string) {
  setTaskProgress(id, { stage: 'failed', message })
  logTaskError('SysTask', 'failed', { id, error: message })
  await db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: message, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
}

type SysTaskRecord = typeof schema.sysTask.$inferSelect

/** 上游错误响应 → 可读文案：优先取 JSON 里的 error.message，否则截断原文 */
function formatUpstreamError(status: number, text: string): string {
  let detail = ''
  try {
    const body = JSON.parse(text)
    detail = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : '')
  } catch { /* 非 JSON */ }
  return `API error ${status}: ${String(detail || text).replace(/\s+/g, ' ').trim().slice(0, 500)}`
}

// 轮询时连续出现即判定为终态的客户端错误（鉴权失效、任务不存在等），不再空等到超时
const TERMINAL_POLL_STATUS = new Set([400, 401, 403, 404, 410, 422])
const TERMINAL_POLL_THRESHOLD = 3

/** 结果下载/落盘：短暂重试（网络抖动），仍失败则抛出 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 3000): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastErr
}

/**
 * 同一台机器上同一服务商的其他启用配置（如生图、生视频各用一个 ComfyUI 端口）：
 * 显存不足时一起释放。按主机名判断，127.0.0.1 / localhost 视为同一台。
 */
async function sameHostPeers(config: AIConfig): Promise<AIConfig[]> {
  const hostOf = (u: string) => {
    try {
      const h = new URL(u).hostname.toLowerCase()
      return ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(h) ? 'local' : h
    } catch { return '' }
  }
  const norm = (u: string) => String(u || '').trim().replace(/\/+$/, '')
  const host = hostOf(config.baseUrl)
  if (!host) return []
  try {
    const rows = await db.select().from(schema.aiServiceConfigs)
    const seen = new Set([norm(config.baseUrl)])
    const out: AIConfig[] = []
    for (const r of rows) {
      if (!r.isActive || r.provider !== config.provider || hostOf(r.baseUrl) !== host || seen.has(norm(r.baseUrl))) continue
      seen.add(norm(r.baseUrl))
      out.push({ provider: r.provider || '', baseUrl: r.baseUrl, apiKey: r.apiKey, model: '' })
    }
    return out
  } catch {
    return []
  }
}

async function pollTask(record: SysTaskRecord, config: AIConfig, initialTaskId: string, request?: ProviderRequest) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  // 图片 / 视频适配器的可选钩子（轮询节奏、自定义取状态、取消、失败后重试）签名一致
  const hooks = adapter as Pick<VideoProviderAdapter, 'pollProfile' | 'fetchPollResult' | 'cancel' | 'describeProgress' | 'onFinished' | 'onSubmitted' | 'prepareRetry'>
  const profile = { ...POLL_PROFILES[type], ...(hooks.pollProfile || {}) }
  const startedAt = Date.now()
  let clientErrors = 0
  let taskId = initialTaskId
  let retries = 0
  const report = (patch: TaskProgressPatch) => { setTaskProgress(record.id, patch) }

  /** 上游执行失败：适配器能处理（如 ComfyUI 显存不足先释放显存）就用同一个请求重新提交，继续轮询新任务 */
  const retryAfterFailure = async (error: string): Promise<boolean> => {
    if (!hooks.prepareRetry || !request || request.body instanceof FormData) return false
    try {
      const peers = await sameHostPeers(config)
      const ok = await hooks.prepareRetry(config, { taskId, error, attempt: retries, peers, report })
      if (!ok) return false
      const resp = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(120_000),
      })
      if (!resp.ok) throw new Error(adapter.describeError?.(resp.status, await resp.text()) || `HTTP ${resp.status}`)
      const parsed = adapter.parseGenerateResponse(await resp.json())
      if (!parsed.isAsync || !parsed.taskId) throw new Error('重新提交后没有拿到任务 ID')
      hooks.onFinished?.(config, taskId)
      retries++
      logTaskWarn(label, 'retry-after-failure', { id: record.id, oldTaskId: taskId, taskId: parsed.taskId, attempt: retries, error: error.slice(0, 200) })
      taskId = parsed.taskId
      await db.update(schema.sysTask).set({ taskId, updatedAt: now() }).where(eq(schema.sysTask.id, record.id))
      hooks.onSubmitted?.(config, taskId, request, report)
      report({ stage: 'queued', message: `已重新提交（第 ${retries} 次自动重试），上游任务 ID：${taskId}` })
      return true
    } catch (err: any) {
      logTaskWarn(label, 'retry-after-failure-error', { id: record.id, taskId, error: err?.message })
      return false
    }
  }

  const giveUp = async (message: string) => {
    // 放弃前尽量取消上游任务（如 ComfyUI 队列），失败不影响落库
    await hooks.cancel?.(config, taskId).catch(() => {})
    await failTask(record.id, message)
  }

  try {
    await pollLoop()
  } finally {
    hooks.onFinished?.(config, taskId)
  }

  async function pollLoop() {

  for (let i = 0; i < profile.attempts; i++) {
    if (profile.maxDurationMs && Date.now() - startedAt >= profile.maxDurationMs) {
      await giveUp(`Timeout: Polling exceeded ${Math.round(profile.maxDurationMs / 60_000)} minutes`)
      return
    }
    await new Promise(r => setTimeout(r, profile.intervalMs))

    let result: any
    try {
      if (hooks.fetchPollResult) {
        logTaskProgress(label, 'poll-request', { id: record.id, taskId, provider: config.provider, attempt: i + 1 })
        result = await hooks.fetchPollResult(config, taskId)
      } else {
        const { url, method, headers } = adapter.buildPollRequest(config, taskId)
        logTaskProgress(label, 'poll-request', {
          id: record.id,
          taskId,
          provider: config.provider,
          method,
          url: redactUrl(url),
          attempt: i + 1,
        })
        const remainingMs = profile.maxDurationMs
          ? Math.max(1_000, profile.maxDurationMs - (Date.now() - startedAt))
          : 600_000
        const resp = await fetch(url, {
          method,
          headers,
          signal: AbortSignal.timeout(remainingMs),
        })
        if (!resp.ok) {
          const text = await resp.text().catch(() => '')
          if (TERMINAL_POLL_STATUS.has(resp.status) && ++clientErrors >= TERMINAL_POLL_THRESHOLD) {
            await failTask(record.id, `轮询失败，${formatUpstreamError(resp.status, text)}`)
            return
          }
          logTaskWarn(label, 'poll-http-error', { id: record.id, taskId, attempt: i + 1, status: resp.status })
          continue
        }
        clientErrors = 0
        result = await resp.json() as any
      }
    } catch (err: any) {
      const exhausted = i === profile.attempts - 1
        || (profile.maxDurationMs != null && Date.now() - startedAt >= profile.maxDurationMs)
      if (exhausted) {
        await giveUp(`Timeout: ${err.message}`)
        return
      }
      logTaskWarn(label, 'poll-retry', { id: record.id, taskId, attempt: i + 1, error: err.message })
      continue
    }

    // 图片/视频 PollResponse 结构不同，这里统一按 any 取值后按 type 分支
    const pollResp: any = adapter.parsePollResponse(result)

    if (pollResp.status === 'pending' || pollResp.status === 'processing') {
      // 细粒度进度（ComfyUI 节点 / 采样步数、Fooocus 百分比）；没有时显示已等待时长
      let patch: TaskProgressPatch | null = null
      try { patch = hooks.describeProgress?.(config, taskId, result) ?? null } catch { patch = null }
      const waited = formatEta((Date.now() - startedAt) / 1000)
      if (patch) setTaskProgress(record.id, patch)
      else {
        setTaskProgress(record.id, {
          stage: pollResp.status === 'pending' ? 'queued' : 'running',
          message: `${pollResp.status === 'pending' ? '上游排队中' : '上游生成中'}（${config.provider}，已等待 ${waited || '0 秒'}，第 ${i + 1} 次查询状态）`,
          detail: { poll_count: i + 1 },
        })
      }
    }

    if (pollResp.status === 'failed') {
      const error = pollResp.error || 'Generation failed'
      // 适配器能处理的失败（如 ComfyUI 显存不足）：处理后重新提交，继续轮询
      if (await retryAfterFailure(error)) continue
      // 上游明确失败（如内容审核拦截）属终态：立即落库，不等待超时
      await failTask(record.id, retries ? `自动重试 ${retries} 次后仍失败。${error}` : error)
      return
    }
    if (pollResp.status !== 'completed') continue

    // 已完成：下载落盘。失败只做短暂重试后终止，不能混进轮询重试里每 10 秒重下一遍直到超时
    setTaskProgress(record.id, {
      stage: 'downloading',
      message: `${config.provider} 已生成完成（用时 ${formatEta((Date.now() - startedAt) / 1000) || '不到 1 秒'}），开始下载结果`,
    })
    try {
      if (type === 'image') {
        if (pollResp.imageUrl) {
          logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, imageUrl: pollResp.imageUrl })
          await withRetry(() => handleImageComplete(record, config, pollResp.imageUrl))
          return
        }
        // 部分厂商（Gemini、OpenAI 兼容网关）完成结果只有 base64
        const b64 = (adapter as ImageProviderAdapter).extractImageBase64(result)
        if (!b64) {
          await failTask(record.id, '上游返回完成但没有图片结果')
          return
        }
        logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
        await withRetry(() => handleImageCompleteBase64(record, b64.data, b64.mimeType))
        return
      }
      if (!pollResp.videoUrl) {
        await failTask(record.id, '上游返回完成但没有视频地址')
        return
      }
      logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, videoUrl: pollResp.videoUrl })
      await withRetry(() => handleVideoComplete(record, config, pollResp.videoUrl, pollResp.duration))
    } catch (err: any) {
      await failTask(record.id, `结果下载失败：${err.message}`)
    }
    return
  }
  await giveUp('Timeout: polling attempts exhausted')
  }
}

async function handleImageComplete(record: SysTaskRecord, config: AIConfig, imageUrl: string) {
  // 结果图地址可能需要补全或鉴权（如 ComfyUI /view），由适配器给出下载方式
  const download = getImageAdapter(config.provider).resolveDownload?.(config, imageUrl) ?? { url: imageUrl }
  const localPath = await downloadFile(download.url, 'images', {
    headers: download.headers,
    fallbackExt: download.fallbackExt,
    onProgress: downloadReporter(record.id, '图片'),
  })
  setTaskProgress(record.id, { stage: 'saving', message: '图片已下载，生成缩略图并写回分镜 / 资产' })
  // 列表页缩略图（前端按命名约定推导地址，失败不影响主流程）
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ resultUrl: imageUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })

  await writeBackImageAssets(record, localPath)
  setTaskProgress(record.id, { stage: 'completed', percent: 100, message: '图片已生成并保存' })
}

async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  setTaskProgress(record.id, {
    stage: 'saving',
    message: `收到图片数据（${formatBytes(Math.round(base64Data.length * 0.75))}），保存并生成缩略图`,
  })
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  await generateImageThumb(localPath)

  await db.update(schema.sysTask)
    .set({ localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })

  await writeBackImageAssets(record, localPath)
  setTaskProgress(record.id, { stage: 'completed', percent: 100, message: '图片已生成并保存' })
}

// 图片完成后回写业务表：分镜(按 frameType)、角色、场景、道具
async function writeBackImageAssets(record: SysTaskRecord, localPath: string) {
  const params = parseTaskParams(record.params)
  if (record.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (params.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (params.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    await db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId))
  }
  if (record.characterId) {
    await db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId))
  }
  if (record.sceneId) {
    await db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId))
  }
  if (record.propId) {
    await db.update(schema.props).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.props.id, record.propId))
  }
}

async function handleVideoComplete(record: SysTaskRecord, config: AIConfig, videoUrl: string, duration: number | null | undefined) {
  // 成片地址可能需要鉴权或补全（aiask /v1/videos/{id}/content、ComfyUI /view），由适配器给出下载方式
  const adapter = getVideoAdapter(config.provider)
  const download = adapter.resolveDownload?.(config, videoUrl) ?? { url: videoUrl }
  const localPath = await downloadFile(download.url, 'videos', {
    headers: download.headers,
    fallbackExt: download.fallbackExt,
    onProgress: downloadReporter(record.id, '视频'),
  })
  setTaskProgress(record.id, { stage: 'saving', message: '视频已下载，提取封面帧并写回分镜' })
  // 海报帧供列表/封面展示，避免前端为显示首帧缓冲整个视频
  await extractVideoPoster(localPath)
  // 结尾帧供同场景下一个镜头接戏（作为首帧 / 参考图）
  await extractVideoEndFrame(localPath)
  await db.update(schema.sysTask)
    .set({ resultUrl: videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, localPath, storyboardId: record.storyboardId, duration })

  if (record.storyboardId) {
    await db.update(schema.storyboards)
      .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, record.storyboardId))
  }
  setTaskProgress(record.id, { stage: 'completed', percent: 100, message: '视频已生成并保存到本地' })
}

/** 下载进度 → 任务进度（下载阶段占整体 90%~98%） */
function downloadReporter(id: number, label: string) {
  const started = Date.now()
  return (downloaded: number, total: number | null) => {
    const seconds = (Date.now() - started) / 1000
    const speed = seconds > 0.5 ? downloaded / seconds : 0
    const eta = total && speed ? (total - downloaded) / speed : null
    setTaskProgress(id, {
      stage: 'downloading',
      percent: total ? stagePercent('downloading', downloaded / total) : undefined,
      message: total
        ? `下载${label}回 UU889-Drama：${formatBytes(downloaded)} / ${formatBytes(total)}（${Math.round((downloaded / total) * 100)}%）${speed ? `，${formatBytes(speed)}/s` : ''}${eta && eta > 1 ? `，约 ${formatEta(eta)}` : ''}`
        : `下载${label}回 UU889-Drama：已接收 ${formatBytes(downloaded)}`,
      detail: { downloaded_bytes: downloaded, total_bytes: total ?? undefined, eta_seconds: eta ? Math.round(eta) : undefined },
      replaceDetail: true,
    })
  }
}

// ─── 参考素材归一化 ───────────────────────────────────────────────

async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('static/') || value.startsWith('/static/')) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    // 远程 URL：下载压缩为 data URL，保证 multipart 上传（OpenAI edits）/ inline_data（Gemini）都可用
    if (/^https?:\/\//.test(value)) {
      try {
        return await fetchImageAsCompressedDataUrl(value, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-fetch-failed', { url: value, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      // 视频参考图直接编码原文件，保留原始尺寸、格式、透明通道和画质。
      return readImageAsDataUrl(localPath)
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

/**
 * 将参考视频/音频解析为 Seedance API 可访问的 URL。
 * http(s)/dataURL 直通；本地 static 路径需要 PUBLIC_BASE_URL 拼成公网地址，
 * 未配置时抛出可操作的中文错误（落入 catch 写入 error_msg 供前端展示）。
 */
function resolvePublicMediaUrl(value: string | null | undefined, kind: 'video' | 'audio' | 'file'): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
      const label = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
      throw new Error(
        `参考${label}为本地路径 ${raw}，但后端未配置 PUBLIC_BASE_URL，上游视频生成 API 无法访问内网地址。` +
        `请在 backend/.env 配置 PUBLIC_BASE_URL（如 https://your-domain.com）后重试，或改用公网 URL。`,
      )
    }
    const p = raw.startsWith('/') ? raw : `/${raw}`
    return `${base}${p}`
  }
  return raw
}

function resolvePublicMediaUrls(refs: string[] | null | undefined, kind: 'video' | 'audio'): string[] {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  return items.map((item) => resolvePublicMediaUrl(item, kind)).filter((item): item is string => !!item)
}

function normalizeStoredVideoResolution(resolution: string | null | undefined): string | undefined {
  const value = String(resolution || '').trim().toLowerCase()
  if (value === '480p' || value === '720p' || value === '1080p') return value
  if (value === '2k') return '2K'
  return undefined
}
