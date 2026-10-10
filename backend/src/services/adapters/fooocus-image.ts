/**
 * Fooocus 图片 Adapter（Fooocus-API：https://github.com/mrhan1993/Fooocus-API，默认端口 8888）
 * 文生图:     POST /v1/generation/text-to-image
 * 参考图生图: POST /v2/generation/text-to-image-with-ip（image_prompts：Fooocus「图片提示」/ IP-Adapter，最多 4 张）
 * 均以 async_process 异步提交 → { job_id }，轮询 GET /v1/generation/query-job?job_id= →
 *   { job_stage: WAITING | RUNNING | SUCCESS | ERROR, job_result: [{ base64, url, seed, finish_reason }] }
 *
 * - 尺寸：aspect_ratios_selection 只能取 Fooocus 内置的 SDXL 比例，按项目尺寸取最接近的一档
 * - 模型：配置「模型」填 checkpoint 文件名（/v1/engines/all-models 的 model_filenames），填 default 沿用 Fooocus 默认
 * - settings.fooocus_performance（Speed / Quality / Extreme Speed / Lightning / Hyper-SD）、
 *   settings.fooocus_styles（逗号分隔，留空用 Fooocus 默认风格）
 * - 开启 --apikey 时配置里 API Key 填同一个值（以 X-API-KEY 头发送）
 */
import type {
  ImageProviderAdapter,
  AIConfig,
  ProviderRequest,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import {
  LOCAL_DEFAULT_NEGATIVE_PROMPT,
  isDefaultModel,
  localAuthHeaders,
  localUrl,
  stripDataPrefix,
  textSetting,
  toRawBase64OrUrl,
} from './local-image'

const DEFAULT_BASE = 'http://127.0.0.1:8888'
const MAX_IMAGE_PROMPTS = 4

/** Fooocus 内置的 SDXL 出图尺寸（宽*高） */
export const FOOOCUS_ASPECT_RATIOS = [
  '704*1408', '704*1344', '768*1344', '768*1280', '832*1216', '832*1152', '896*1152', '896*1088', '960*1088',
  '960*1024', '1024*1024', '1024*960', '1088*960', '1088*896', '1152*896', '1152*832', '1216*832', '1280*768',
  '1344*768', '1344*704', '1408*704', '1472*704', '1536*640', '1600*640', '1664*576', '1728*576',
] as const

export function fooocusAspectRatio(size?: string | null): string {
  const [w, h] = String(size || '').toLowerCase().split('x').map(Number)
  if (!w || !h) return '1024*1024'
  const target = Math.log(w / h)
  let best = '1024*1024'
  let bestDiff = Infinity
  for (const candidate of FOOOCUS_ASPECT_RATIOS) {
    const [cw, ch] = candidate.split('*').map(Number)
    const diff = Math.abs(Math.log(cw / ch) - target)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

function parseRefs(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

/** 同步结果是数组，异步 query-job 结果在 job_result 里 */
function firstResult(result: any): any {
  if (Array.isArray(result)) return result[0]
  if (Array.isArray(result?.job_result)) return result.job_result[0]
  if (result && (result.base64 || result.url)) return result
  return null
}

export class FooocusImageAdapter implements ImageProviderAdapter {
  provider = 'fooocus'
  // 本地 GPU 排队出图：轮询上限 1 小时
  pollProfile = { attempts: 720, intervalMs: 5_000, maxDurationMs: null }

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const settings = config.settings || {}
    const refs = parseRefs(record.referenceImages).slice(0, MAX_IMAGE_PROMPTS)
    const body: Record<string, any> = {
      prompt: (record.prompt || '').trim(),
      negative_prompt: textSetting(settings.image_negative_prompt, LOCAL_DEFAULT_NEGATIVE_PROMPT),
      aspect_ratios_selection: fooocusAspectRatio(record.size),
      performance_selection: textSetting(settings.fooocus_performance, 'Speed'),
      image_number: 1,
      image_seed: -1,
      require_base64: true,
      async_process: true,
    }
    const styles = textSetting(settings.fooocus_styles).split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (styles.length) body.style_selections = styles
    const model = record.model || config.model
    if (!isDefaultModel(model)) body.base_model_name = model
    if (refs.length) {
      body.image_prompts = refs.map((ref) => ({ cn_img: toRawBase64OrUrl(ref), cn_stop: 0.5, cn_weight: 1.0, cn_type: 'ImagePrompt' }))
    }

    return {
      url: localUrl(config.baseUrl, DEFAULT_BASE, refs.length ? '/v2/generation/text-to-image-with-ip' : '/v1/generation/text-to-image'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...localAuthHeaders(config.apiKey) },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const first = firstResult(result)
    if (first) {
      if (first.finish_reason && first.finish_reason !== 'SUCCESS') throw new Error(`Fooocus 生成失败：${first.finish_reason}`)
      return { isAsync: false, imageUrl: first.base64 ? undefined : first.url }
    }
    if (result?.job_id) return { isAsync: true, taskId: String(result.job_id) }
    throw new Error(`Fooocus 未返回任务 ID${result?.detail ? `：${JSON.stringify(result.detail).slice(0, 200)}` : ''}`)
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: localUrl(config.baseUrl, DEFAULT_BASE, `/v1/generation/query-job?job_id=${encodeURIComponent(taskId)}&require_step_preview=false`),
      method: 'GET',
      headers: localAuthHeaders(config.apiKey),
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const stage = String(result?.job_stage || '').toUpperCase()
    if (stage === 'ERROR') {
      return { status: 'failed', error: `Fooocus 生成失败：${result?.job_error || result?.job_status || 'ERROR'}` }
    }
    if (stage === 'SUCCESS') {
      const first = firstResult(result)
      if (!first) return { status: 'failed', error: 'Fooocus 任务完成但没有返回图片' }
      if (first.finish_reason && first.finish_reason !== 'SUCCESS') {
        return { status: 'failed', error: `Fooocus 生成失败：${first.finish_reason}` }
      }
      // base64 优先（generation.ts 走 extractImageBase64），否则下载 url
      return { status: 'completed', imageUrl: first.base64 ? undefined : first.url }
    }
    return { status: stage === 'WAITING' ? 'pending' : 'processing' }
  }

  extractImageUrl(result: any): string | null {
    const first = firstResult(result)
    return typeof first?.url === 'string' && first.url ? first.url : null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const first = firstResult(result)
    return typeof first?.base64 === 'string' && first.base64 ? { data: stripDataPrefix(first.base64), mimeType: 'image/png' } : null
  }

  describeError(status: number, bodyText: string): string | null {
    try {
      const body = JSON.parse(bodyText)
      const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
      return `Fooocus-API 报错（HTTP ${status}）：${detail}`.slice(0, 500)
    } catch {
      return status === 404 ? 'Fooocus-API 没有这个接口：请确认运行的是 Fooocus-API（默认端口 8888），而不是 Fooocus 网页版' : null
    }
  }
}
