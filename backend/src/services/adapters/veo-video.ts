/**
 * Google Veo 视频 Adapter（Gemini API：https://ai.google.dev/gemini-api/docs/veo）
 * 创建: POST /v1beta/models/{model}:predictLongRunning → { name: "models/.../operations/xxx" }
 * 轮询: GET  /v1beta/{name} → { done, response.generateVideoResponse.generatedSamples[].video.uri, error }
 * 成片: video.uri 需带同一个 Key（x-goog-api-key）下载
 *
 * 参数：aspectRatio 16:9 / 9:16；resolution 720p / 1080p（1080p 只能 8 秒）；durationSeconds 4 / 6 / 8
 * 图片：首帧 image、尾帧 lastFrame（inlineData base64）；分镜参考图 referenceImages（最多 3 张，
 * referenceType "asset"，只能 8 秒）。Veo 3.1 Lite 不支持参考图和尾帧，参考图退化为首帧。
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

export const VEO_DEFAULT_MODEL = 'veo-3.1-generate-preview'
const MAX_REFERENCE_IMAGES = 3

async function inlineData(ref: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const file = await loadReferenceFile(ref, 'veo')
  return { inlineData: { mimeType: file.mimeType, data: Buffer.from(await file.blob.arrayBuffer()).toString('base64') } }
}

export function veoDuration(duration: number | null | undefined, forceEight: boolean): number {
  if (forceEight) return 8
  const d = Number(duration || 8)
  // 取最接近的档位；距离相同取更长的一档，避免截掉分镜计划的动作
  return [4, 6, 8].reduce((best, v) => (Math.abs(v - d) <= Math.abs(best - d) ? v : best), 8)
}

export function veoAspectRatio(ratio?: string | null): '16:9' | '9:16' {
  const [w, h] = String(ratio || '16:9').split(':').map(Number)
  return w > 0 && h > 0 && w < h ? '9:16' : '16:9'
}

function googleHeaders(config: AIConfig, json = true): Record<string, string> {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), 'x-goog-api-key': config.apiKey }
}

export class VeoVideoAdapter implements VideoProviderAdapter {
  provider = 'veo'

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): Promise<ProviderRequest> {
    const model = record.model || config.model || VEO_DEFAULT_MODEL
    const lite = /lite/i.test(model)
    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('Veo 要求必须提供提示词')

    const first = (record.firstFrameUrl || record.imageUrl || '').trim()
    const last = (record.lastFrameUrl || '').trim()
    const refs = parseUrlArray(record.referenceImageUrls)

    const instance: Record<string, any> = { prompt }
    let usesReferences = false
    if (first) {
      instance.image = await inlineData(first)
      if (last && !lite) instance.lastFrame = await inlineData(last)
    } else if (refs.length) {
      if (lite) {
        instance.image = await inlineData(refs[0])
      } else {
        instance.referenceImages = await Promise.all(refs.slice(0, MAX_REFERENCE_IMAGES).map(async (ref) => ({
          image: await inlineData(ref),
          referenceType: 'asset',
        })))
        usesReferences = true
      }
    } else if (last) {
      instance.image = await inlineData(last)
    }

    const tier = String(record.resolution || '').toLowerCase()
    const resolution = tier === '1080p' || tier === '2k' ? '1080p' : '720p'
    const parameters = {
      aspectRatio: veoAspectRatio(record.aspectRatio),
      resolution,
      // 1080p 与参考图模式都只支持 8 秒
      durationSeconds: veoDuration(record.duration, usesReferences || resolution === '1080p'),
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1beta', `/models/${model}:predictLongRunning`),
      method: 'POST',
      headers: googleHeaders(config),
      body: { instances: [instance], parameters },
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (typeof result?.name === 'string' && result.name) return { isAsync: true, taskId: result.name }
    throw new Error(`Veo 未返回任务名${result?.error?.message ? `：${result.error.message}` : ''}`)
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    // taskId 形如 models/veo-3.1-generate-preview/operations/xxxx，斜杠是路径的一部分
    return {
      url: joinProviderUrl(config.baseUrl, '/v1beta', `/${taskId.replace(/^\/+/, '')}`),
      method: 'GET',
      headers: googleHeaders(config, false),
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    if (result?.error) {
      return { status: 'failed', error: `Veo 生成失败：${result.error.message || result.error.status || JSON.stringify(result.error)}` }
    }
    if (!result?.done) return { status: 'processing' }
    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { status: 'completed', videoUrl }
    const reasons = result?.response?.generateVideoResponse?.raiMediaFilteredReasons
    if (Array.isArray(reasons) && reasons.length) {
      return { status: 'failed', error: `Veo 内容审核未通过：${reasons.join('; ')}` }
    }
    return { status: 'failed', error: 'Veo 任务已完成但没有返回视频' }
  }

  extractVideoUrl(result: any): string | null {
    const samples = result?.response?.generateVideoResponse?.generatedSamples ?? result?.response?.generatedVideos
    const uri = samples?.[0]?.video?.uri
    return typeof uri === 'string' && uri ? uri : null
  }

  /** 成片地址在 Gemini API 域名下，需要同一个 Key；其它域名不带 Key */
  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    let sameHost = false
    try { sameHost = new URL(videoUrl).host === new URL(config.baseUrl || 'https://generativelanguage.googleapis.com').host } catch { /* 按第三方处理 */ }
    return { url: videoUrl, headers: sameHost ? googleHeaders(config, false) : undefined, fallbackExt: '.mp4' }
  }

  describeError(status: number, bodyText: string): string | null {
    try {
      const body = JSON.parse(bodyText)
      const message = body?.error?.message
      return message ? `Google Veo 报错（HTTP ${status}）：${message}`.slice(0, 500) : null
    } catch {
      return null
    }
  }
}
