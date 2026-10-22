/**
 * Grok 视频 Adapter（xAI 原生接口）
 * 创建: POST /v1/videos/generations → { request_id }
 * 轮询: GET  /v1/videos/{request_id} → { status: pending | done | failed | expired, video: { url, duration } }
 * 成片: video.url —— xAI 官方为免鉴权的临时直链；aiask.me 等网关的 Grok 分组会改写成
 *       本站 /v1/videos/{id}/content（需带 API Key），下载方式与 aiask 视频共用 gatewayVideoDownload
 *
 * 参数（https://docs.x.ai/developers/model-capabilities/video/generation）：
 * - duration 1–15 秒；aspect_ratio 1:1 16:9 9:16 4:3 3:4 3:2 2:3 21:9 5:2；resolution 480p / 720p / 1080p
 * - 图生视频：image: { url }（https 或 data URI）
 * - 参考图生视频：reference_images: [{ url }]，grok-imagine-video-1.5 最多 14 张、其它 7 张；
 *   最高 720p，非 1.5 模型最长 10 秒；提示词用 <IMAGE_0>、<IMAGE_1>… 按顺序指代参考图
 * xAI 没有尾帧参数：只有尾帧时当作首帧，首尾帧同时给出时只用首帧。
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
import { parseUrlArray } from './media'
import { fitGrokPrompt, gatewayVideoDownload, toGrokImageRefs } from './video-common'

export const XAI_DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5'

const XAI_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2'] as const

export function isGrokVideo15(model: string): boolean {
  return /^grok-imagine-video-1\.5/i.test(model)
}

export function normalizeXaiRatio(ratio?: string | null): string {
  const value = String(ratio || '').trim()
  if ((XAI_RATIOS as readonly string[]).includes(value)) return value
  const [w, h] = value.split(':').map(Number)
  if (!w || !h) return '16:9'
  const target = Math.log(w / h)
  let best: string = '16:9'
  let bestDiff = Infinity
  for (const candidate of XAI_RATIOS) {
    const [cw, ch] = candidate.split(':').map(Number)
    const diff = Math.abs(Math.log(cw / ch) - target)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

export class XaiVideoAdapter implements VideoProviderAdapter {
  provider = 'xai'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || XAI_DEFAULT_VIDEO_MODEL
    let prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('Grok 视频要求必须提供提示词')

    const frame = (record.firstFrameUrl || record.imageUrl || record.lastFrameUrl || '').trim()
    const maxRefs = isGrokVideo15(model) ? 14 : 7
    const refImages = frame ? [] : parseUrlArray(record.referenceImageUrls).slice(0, maxRefs)
    const isReference = refImages.length > 0

    let duration = Math.round(Number(record.duration || 8))
    if (!Number.isFinite(duration)) duration = 8
    duration = Math.min(isReference && !isGrokVideo15(model) ? 10 : 15, Math.max(1, duration))

    const tier = String(record.resolution || '').toLowerCase()
    let resolution = tier === '480p' ? '480p' : tier === '1080p' || tier === '2k' ? '1080p' : '720p'
    if (isReference && resolution === '1080p') resolution = '720p'

    if (isReference) prompt = toGrokImageRefs(prompt, refImages.length)
    prompt = fitGrokPrompt(config, prompt)

    const body: Record<string, any> = {
      model,
      prompt,
      duration,
      aspect_ratio: normalizeXaiRatio(record.aspectRatio),
      resolution,
    }
    if (frame) body.image = { url: frame }
    if (isReference) body.reference_images = refImages.map((url) => ({ url }))

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const id = result?.request_id ?? result?.id
    if (id != null && String(id)) return { isAsync: true, taskId: String(id) }
    throw new Error('xAI 视频接口未返回 request_id')
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
    const status = String(result?.status || '').toLowerCase()
    if (status === 'done' || status === 'completed' || status === 'succeeded') {
      const videoUrl = this.extractVideoUrl(result)
      // 状态已完成但没有地址：当失败处理，避免轮询到超时
      if (!videoUrl) return { status: 'failed', error: 'xAI 视频已完成但未返回 video.url' }
      const duration = Number(result?.video?.duration)
      return { status: 'completed', videoUrl, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined }
    }
    if (['failed', 'expired', 'error', 'cancelled', 'canceled'].includes(status)) {
      const err = result?.error
      const msg = typeof err === 'string' ? err : (err?.message || err?.code || '')
      return { status: 'failed', error: msg ? `[${status}] ${msg}` : `Video generation ${status}` }
    }
    return { status: status === 'pending' || status === 'queued' ? 'pending' : 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const url = result?.video?.url ?? result?.url
    return typeof url === 'string' && url ? url : null
  }

  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    return gatewayVideoDownload(config, videoUrl)
  }
}
