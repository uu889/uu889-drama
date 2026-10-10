/**
 * aiask.me Grok 视频 Adapter（通用视频任务接口，与 OpenAI Videos API 同形的异步任务）
 * 创建: POST /v1/videos            → 202 { id, object: "video", status: "in_progress" }（部分网关包在 video 字段里）
 * 轮询: GET  /v1/videos/{id}       → in_progress（排队时带 queue.position）→ completed / failed / cancelled
 * 取回: GET  /v1/videos/{id}/content（需同一个 API Key，返回 MP4）
 *
 * 参数：model、prompt、mode、duration_seconds、ratio、video_resolution（时长 / 比例 / 分辨率均必填）
 * 模式：
 * - text_to_video         无图，JSON
 * - image_to_video        multipart 文件字段 image
 * - first_last_frames     multipart 文件字段 first_frame + last_frame
 * - multimodal_reference  multipart 文件字段 reference_images（可重复，Grok Imagine Video 1.5 最多 7 张）
 * 分镜绑定的角色 / 场景 / 道具图属于"参考图"而非首帧，默认走 multimodal_reference；
 * 不支持多模态参考的模型（*-lite）退化为 image_to_video，取第一张参考图。
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
  DownloadRequest,
} from './types'
import { joinProviderUrl } from './url'
import { loadReferenceFile, parseUrlArray } from './media'
import { gatewayVideoDownload, toGrokImageRefs } from './video-common'

export const AIASK_DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5'

const VALID_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
const MAX_REFERENCE_IMAGES = 7
const DURATION_RANGE = { min: 1, max: 15 } as const

type VideosApiMode = 'text_to_video' | 'image_to_video' | 'first_last_frames' | 'multimodal_reference'

/** 只支持文生 / 图生的轻量模型（如 grok-imagine-video-1.5-lite） */
function supportsMultimodalReference(model: string): boolean {
  return !/-lite\b/i.test(model)
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
      files.push(['image', firstFrame || lastFrame])
    } else if (refImages.length) {
      if (supportsMultimodalReference(model)) {
        mode = 'multimodal_reference'
        for (const ref of refImages.slice(0, MAX_REFERENCE_IMAGES)) files.push(['reference_images', ref])
      } else {
        mode = 'image_to_video'
        files.push(['image', refImages[0]])
      }
    }

    // Grok Imagine 的多参考图用 <IMAGE_0>… 指代参考图
    const referenceCount = files.filter(([field]) => field === 'reference_images').length
    const finalPrompt = referenceCount && /^grok/i.test(model) ? toGrokImageRefs(prompt, referenceCount) : prompt

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
      const file = await loadReferenceFile(ref, `${field}-${++index}`)
      form.append(field, file.blob, file.filename)
    }
    return {
      url,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: form,
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
    if (status === 'completed' || status === 'succeeded' || status === 'done') {
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
    if (['failed', 'cancelled', 'canceled', 'expired', 'error'].includes(status)) {
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

  /** content_url 是网关相对地址且需要鉴权；外部直链（CDN 签名地址）不带 Key */
  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    return gatewayVideoDownload(config, videoUrl)
  }
}
