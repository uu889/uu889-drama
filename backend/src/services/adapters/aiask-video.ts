/**
 * aiask.me Grok 视频 Adapter（通用视频任务接口，与 OpenAI Videos API 同形的异步任务）
 * 创建: POST /v1/videos            → 202 { id, object: "video", status: "in_progress" }（部分网关包在 video 字段里）
 * 轮询: GET  /v1/videos/{id}       → in_progress（排队时带 queue.position）→ completed / failed / cancelled
 * 取回: GET  /v1/videos/{id}/content（需同一个 API Key，返回 MP4）
 *
 * 参数：model、prompt、mode、duration_seconds、ratio、video_resolution（时长 / 比例 / 分辨率均必填）
 * 模式：
 * - text_to_video         无图，JSON
 * - image_to_video        multipart 文件字段 image[]（wokey 官方客户端写法）
 * - first_last_frames     multipart 文件字段 first_frame + last_frame
 * - multimodal_reference  multipart 文件字段 image[]（可重复，与 wokey 官方 Video Studio 一致；Grok Imagine Video 1.5 最多 7 张）
 * 分镜绑定的角色 / 场景 / 道具图属于"参考图"而非首帧，默认走 multimodal_reference（1.5 和 1.5-lite 都是）；
 * 上游拒绝多参考图时 fallbackRequest 退回 image_to_video（第一张图做首帧），并记住该模型。
 *
 * 状态接口不太稳（偶尔 5xx / 404，或先报 failed 随后又成功，wokey.ai 上看其实已经生成好了）：
 * 判失败之前 confirmFailure 隔一会儿复查几次状态，并直接试取 /content，取得到就当成功下载。
 * 上游并发数有限：generation.ts 按 gpu-queue 的云端队列（默认同时 2 个）提交，繁忙时自动重交。
 */
import type {
  FailureContext,
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
  DownloadRequest,
} from './types'
import { joinProviderUrl } from './url'
import { loadReferenceFile, parseUrlArray, shrinkReferenceFile } from './media'
import { fitGrokPrompt, gatewayVideoDownload, toGrokImageRefs } from './video-common'
import { stagePercent, type TaskProgressPatch } from '../task-progress'

export const AIASK_DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5-lite'

const COMPLETED_STATUSES = ['completed', 'succeeded', 'success', 'succeed', 'done', 'finished', 'complete']
const FAILED_STATUSES = ['failed', 'failure', 'cancelled', 'canceled', 'expired', 'error']

/** 判失败前复查的间隔（毫秒），总共约 2 分钟；AIASK_VIDEO_CONFIRM_MS 调整基数（测试用） */
function confirmDelays(): number[] {
  const base = Number(process.env.AIASK_VIDEO_CONFIRM_MS) || 10_000
  return [1, 2, 3, 6].map((n) => n * base)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const VALID_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
const MAX_REFERENCE_IMAGES = 7
const DURATION_RANGE = { min: 1, max: 15 } as const

type VideosApiMode = 'text_to_video' | 'image_to_video' | 'first_last_frames' | 'multimodal_reference'

/**
 * 上游拒绝过多参考图的模型（本次运行内记住，之后直接走单图图生视频）。
 * grok-imagine-video-1.5 / -lite 都按多参考图提交（xAI 的 Grok Imagine 参考图生视频所有型号都支持，1.5 以外最多 7 张）；
 * 某个网关 / 模型不接受时由 fallbackRequest 退回单图，并在任务里说明。
 */
const noMultiRefModels = new Set<string>()
function supportsMultimodalReference(model: string): boolean {
  return !noMultiRefModels.has(model.toLowerCase())
}

/** 上游的拒绝是不是「不支持这种模式 / 多参考图」（而不是提示词、鉴权等别的问题） */
export function isReferenceModeRejected(status: number, text: string): boolean {
  if (status < 400 || status >= 500 || status === 401 || status === 403 || status === 429) return false
  const s = String(text || '')
  if (/提示词|prompt|余额|balance|quota|moderation|审核|key/i.test(s) && !/mode|reference|multimodal|image\[\]/i.test(s)) return false
  return /multimodal|reference|\bmode\b|image\[\]|too many (images|files)|unsupported|not support|不支持|参考图|多图/i.test(s)
}

/** 单图图生视频时去掉 @图片N 标记，只留名字（模型只拿到一张图，编号没有意义） */
export function stripImageTags(prompt: string): string {
  return prompt.replace(/@图片\d+/g, '')
}

export function normalizeAiaskRatio(ratio?: string | null): string {
  const value = String(ratio || '').trim()
  if ((VALID_RATIOS as readonly string[]).includes(value)) return value
  const [w, h] = value.split(':').map(Number)
  if (!w || !h) return '16:9'
  const target = w / h
  let best: string = '16:9'
  let bestDiff = Infinity
  for (const candidate of VALID_RATIOS) {
    const [cw, ch] = candidate.split(':').map(Number)
    const diff = Math.abs(Math.log(cw / ch) - Math.log(target))
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

export function normalizeAiaskDuration(duration?: number | null): number {
  const parsed = Math.round(Number(duration || 5))
  if (!Number.isFinite(parsed)) return 5
  return Math.min(DURATION_RANGE.max, Math.max(DURATION_RANGE.min, parsed))
}

/** 项目内部 480p/720p/1080p/2K → 上游 480p/720p/1080p；1080p 只支持文生 / 图生，其余模式收敛到 720p */
export function normalizeAiaskResolution(resolution: string | null | undefined, mode: VideosApiMode): string {
  const value = String(resolution || '').trim().toLowerCase()
  const tier = value === '480p' ? '480p' : value === '1080p' || value === '2k' ? '1080p' : '720p'
  if (tier === '1080p' && (mode === 'first_last_frames' || mode === 'multimodal_reference')) return '720p'
  return tier
}

/**
 * 有的网关把任务包在 video 字段里（如创建响应 { video: { id, status } }），
 * 有的顶层就是任务、video 只是成片信息（{ status: 'done', video: { url } }）：
 * 只有顶层没有 status 时才取内层，否则顶层的状态会被忽略、任务一直轮询到超时
 */
function unwrapVideo(result: any): any {
  const inner = result?.video
  if (result?.status == null && inner && typeof inner === 'object' && !Array.isArray(inner)) return inner
  return result
}

export class AiaskVideoAdapter implements VideoProviderAdapter {
  provider = 'aiask'

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): Promise<ProviderRequest> {
    const model = record.model || config.model || AIASK_DEFAULT_VIDEO_MODEL
    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('aiask 视频要求必须提供提示词')

    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()
    const refImages = parseUrlArray(record.referenceImageUrls)

    let mode: VideosApiMode = 'text_to_video'
    const files: Array<[field: string, ref: string]> = []
    if (firstFrame && lastFrame) {
      mode = 'first_last_frames'
      files.push(['first_frame', firstFrame], ['last_frame', lastFrame])
    } else if (firstFrame || lastFrame) {
      mode = 'image_to_video'
      files.push(['image[]', firstFrame || lastFrame])
    } else if (refImages.length) {
      if (supportsMultimodalReference(model)) {
        mode = 'multimodal_reference'
        // 上游只认 image / first_frame / last_frame / video / audio（多文件用 image[]），
        // 其它字段名会被拒绝：A reference file uses an unsupported multipart field name
        for (const ref of refImages.slice(0, MAX_REFERENCE_IMAGES)) files.push(['image[]', ref])
      } else {
        // 不支持多参考图：第一张（接戏帧或场景图）做首帧
        mode = 'image_to_video'
        files.push(['image[]', refImages[0]])
      }
    }
    const usedPrompt = mode === 'image_to_video' && refImages.length && !firstFrame && !lastFrame ? stripImageTags(prompt) : prompt

    // Grok Imagine 的多参考图用 <IMAGE_0>… 指代参考图
    const referenceCount = mode === 'multimodal_reference' ? files.length : 0
    const grok = /^grok/i.test(model)
    const withRefs = referenceCount && grok ? toGrokImageRefs(usedPrompt, referenceCount) : usedPrompt
    // Grok 最多 4096 字节：<IMAGE_n> 比 @图片N 长，换完再量一次
    const finalPrompt = grok ? fitGrokPrompt(config, withRefs) : withRefs

    const fields: Record<string, string | number> = {
      model,
      prompt: finalPrompt,
      mode,
      duration_seconds: normalizeAiaskDuration(record.duration),
      ratio: normalizeAiaskRatio(record.aspectRatio),
      video_resolution: normalizeAiaskResolution(record.resolution, mode),
    }
    const url = joinProviderUrl(config.baseUrl, '/v1', '/videos')

    if (!files.length) {
      return {
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: fields,
      }
    }

    // 带媒体的模式必须 multipart/form-data 上传文件；边界由 fetch 生成，不手填 Content-Type
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
    let index = 0
    for (const [field, ref] of files) {
      // 大图转成 2048 像素以内的 JPEG：上游下载参考图时不容易断线
      const file = await shrinkReferenceFile(await loadReferenceFile(ref, `${field}-${++index}`))
      form.append(field, file.blob, file.filename)
    }
    return {
      url,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: form,
    }
  }

  /** 多参考图被拒（模式 / 字段不支持）：记住这个模型，改成单图图生视频再交一次 */
  async fallbackRequest(config: AIConfig, record: VideoGenerationRecord, status: number, bodyText: string) {
    const model = record.model || config.model || AIASK_DEFAULT_VIDEO_MODEL
    const refs = parseUrlArray(record.referenceImageUrls)
    const hasFrames = Boolean(record.firstFrameUrl || record.imageUrl || record.lastFrameUrl)
    if (hasFrames || refs.length < 1 || !supportsMultimodalReference(model) || !isReferenceModeRejected(status, bodyText)) return null
    noMultiRefModels.add(model.toLowerCase())
    return {
      request: await this.buildGenerateRequest(config, record),
      note: `${model} 不接受多张参考图（上游：${String(bodyText).slice(0, 120)}），已改为只用第 1 张图做首帧的图生视频；角色一致性要靠首帧和提示词`,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const video = unwrapVideo(result)
    const id = video?.id ?? video?.task_id ?? result?.id ?? result?.task_id
    if (id != null && String(id)) return { isAsync: true, taskId: String(id) }
    throw new Error('aiask 视频接口未返回任务 ID')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/videos/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const video = unwrapVideo(result)
    const status = String(video?.status || '').toLowerCase()
    if (COMPLETED_STATUSES.includes(status)) {
      const videoUrl = this.extractVideoUrl(result)
      // 已完成却拿不到成片地址：直接失败，避免轮询到超时
      if (!videoUrl) return { status: 'failed', error: '视频已完成但上游没有返回成片地址' }
      const duration = Number(video?.duration_seconds ?? video?.duration ?? video?.video?.duration)
      return {
        status: 'completed',
        videoUrl,
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      }
    }
    if (FAILED_STATUSES.includes(status)) {
      const err = video?.error ?? result?.error
      const msg = typeof err === 'string' ? err : (err?.message || err?.code || '')
      return { status: 'failed', error: msg ? `[${status}] ${msg}` : `Video generation ${status}` }
    }
    return { status: status === 'queued' || status === 'pending' ? 'pending' : 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const video = unwrapVideo(result)
    const direct = video?.content_url || video?.video?.url || video?.video_url || video?.url
    if (typeof direct === 'string' && direct) return direct
    return video?.id != null ? `/v1/videos/${encodeURIComponent(String(video.id))}/content` : null
  }

  /** 轮询间隔：默认 10 秒；AIASK_VIDEO_POLL_MS 可调（测试用） */
  get pollProfile() {
    const intervalMs = Number(process.env.AIASK_VIDEO_POLL_MS) || 10_000
    return { attempts: Math.ceil(3_600_000 / intervalMs), intervalMs, maxDurationMs: null }
  }

  /** 上游排队位置 / 生成百分比（有就显示，没有用通用的「生成中」） */
  describeProgress(_config: AIConfig, _taskId: string, result: any): TaskProgressPatch | null {
    const video = unwrapVideo(result)
    const status = String(video?.status || '').toLowerCase()
    const position = Number(video?.queue?.position ?? video?.queue_position)
    if (Number.isFinite(position) && position > 0 && (status === 'queued' || status === 'pending' || status === 'in_progress')) {
      return { stage: 'queued', message: `aiask.me 上游排队中：前面还有 ${position} 个任务`, detail: { queue_ahead: position, provider_status: status } }
    }
    let pct = Number(video?.progress ?? video?.progress_percent ?? video?.percent)
    if (!Number.isFinite(pct) || pct <= 0) return null
    if (pct <= 1) pct *= 100
    pct = Math.min(99, Math.round(pct))
    return { stage: 'running', percent: stagePercent('running', pct / 100), message: `aiask.me 上游生成中：${pct}%`, detail: { provider_status: status } }
  }

  /**
   * 判失败前复查：隔一会儿再查状态，并直接试取成片。
   * 状态变成功 / 成片取得到 → completed；状态回到生成中 → processing（接着轮询）；一直失败 → null
   */
  async confirmFailure(config: AIConfig, taskId: string, _failure: FailureContext): Promise<VideoPollResponse | null> {
    let last: VideoPollResponse | null = null
    for (const delay of confirmDelays()) {
      await sleep(delay)
      try {
        const { url, method, headers } = this.buildPollRequest(config, taskId)
        const resp = await fetch(url, { method, headers, signal: AbortSignal.timeout(30_000) })
        if (resp.ok) {
          const parsed = this.parsePollResponse(await resp.json())
          if (parsed.status !== 'failed') return parsed
          last = parsed
        }
      } catch { /* 状态接口还是不通：再试成片 */ }
      if (await this.contentReady(config, taskId)) {
        return { status: 'completed', videoUrl: `/v1/videos/${encodeURIComponent(taskId)}/content` }
      }
    }
    return last
  }

  /** /v1/videos/{id}/content 能取到视频（只取开头 1 KB 判断） */
  async contentReady(config: AIConfig, taskId: string): Promise<boolean> {
    const { url, headers } = gatewayVideoDownload(config, `/v1/videos/${encodeURIComponent(taskId)}/content`)
    try {
      const resp = await fetch(url, { headers: { ...headers, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(30_000) })
      const type = String(resp.headers.get('content-type') || '').toLowerCase()
      await resp.body?.cancel().catch(() => {})
      return resp.ok && !type.includes('json') && !type.startsWith('text/')
    } catch {
      return false
    }
  }

  /** content_url 是网关相对地址且需要鉴权；外部直链（CDN 签名地址）不带 Key */
  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    return gatewayVideoDownload(config, videoUrl)
  }
}
