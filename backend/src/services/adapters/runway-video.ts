/**
 * Runway 视频 Adapter（https://docs.dev.runwayml.com，请求头 X-Runway-Version: 2024-11-06）
 * 图生视频: POST /v1/image_to_video { model, promptImage, promptText, ratio, duration }
 * 文生视频: POST /v1/text_to_video  { model, promptText, ratio, duration }
 * 轮询:     GET  /v1/tasks/{id} → { status: PENDING | THROTTLED | RUNNING | SUCCEEDED | FAILED | CANCELLED, output: [url] }
 *
 * 各模型约束（与 Runway 官方 SDK 类型一致）：
 * - gen4.5：时长 2–10 秒；图生 6 种比例，文生只有 1280:720 / 720:1280
 * - gen4_turbo：只能图生视频
 * - veo3.1 / veo3.1_fast：时长 4 / 6 / 8；支持首帧 + 尾帧；1080p 用 1920:1080 / 1080:1920
 * promptImage 可以是 https 地址或 base64 data URI（≤ 5 MB，超过时压缩为 JPEG）；promptText ≤ 1000 字符。
 * 分镜绑定的参考图只取第一张作为首帧（Runway 这几款模型不支持多参考图）。
 */
import sharp from 'sharp'
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { parseUrlArray } from './media'
import { parseDataUrl } from '../../utils/storage.js'

export const RUNWAY_DEFAULT_MODEL = 'gen4.5'
const RUNWAY_VERSION = '2024-11-06'
const DEFAULT_BASE = 'https://api.dev.runwayml.com'
const MAX_DATA_URI_BYTES = 5 * 1024 * 1024

const GEN4_I2V_RATIOS = ['1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672']
const VEO_RATIOS_720 = ['1280:720', '720:1280']
const VEO_RATIOS_1080 = ['1920:1080', '1080:1920']

interface RunwayModelSpec {
  i2vRatios: string[]
  t2vRatios: string[] | null
  durations: 'range2to10' | number[]
  lastFrame: boolean
}

function modelSpec(model: string, hd: boolean): RunwayModelSpec {
  const m = model.toLowerCase()
  if (m.startsWith('veo3')) {
    const ratios = hd ? VEO_RATIOS_1080 : VEO_RATIOS_720
    return { i2vRatios: ratios, t2vRatios: ratios, durations: [4, 6, 8], lastFrame: true }
  }
  if (m === 'gen4_turbo') return { i2vRatios: GEN4_I2V_RATIOS, t2vRatios: null, durations: [5, 10], lastFrame: false }
  // gen4.5 与其它未知模型：按 gen4.5 规则
  return { i2vRatios: GEN4_I2V_RATIOS, t2vRatios: ['1280:720', '720:1280'], durations: 'range2to10', lastFrame: false }
}

export function nearestRunwayRatio(aspectRatio: string | null | undefined, allowed: string[]): string {
  const [w, h] = String(aspectRatio || '16:9').split(':').map(Number)
  const target = w > 0 && h > 0 ? Math.log(w / h) : Math.log(16 / 9)
  let best = allowed[0]
  let bestDiff = Infinity
  for (const candidate of allowed) {
    const [cw, ch] = candidate.split(':').map(Number)
    const diff = Math.abs(Math.log(cw / ch) - target)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

function runwayDuration(duration: number | null | undefined, rule: RunwayModelSpec['durations']): number {
  const d = Math.round(Number(duration || 5)) || 5
  if (rule === 'range2to10') return Math.min(10, Math.max(2, d))
  return rule.reduce((best, v) => (Math.abs(v - d) < Math.abs(best - d) ? v : best), rule[0])
}

/** base64 data URI 超过 5 MB 时缩放 + 转 JPEG；https 地址原样返回 */
export async function fitPromptImage(ref: string): Promise<string> {
  const parsed = parseDataUrl(ref)
  if (!parsed) return ref
  if (Buffer.byteLength(parsed.data, 'base64') <= MAX_DATA_URI_BYTES) return ref
  const out = await sharp(Buffer.from(parsed.data, 'base64'))
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}

function runwayHeaders(config: AIConfig, json = true): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    'Authorization': `Bearer ${config.apiKey}`,
    'X-Runway-Version': RUNWAY_VERSION,
  }
}

function runwayUrl(config: AIConfig, path: string): string {
  return `${(config.baseUrl || DEFAULT_BASE).replace(/\/+$/, '').replace(/\/v1$/, '')}${path}`
}

/** promptText 上限 1000 个 UTF-16 码元 */
function clipPrompt(text: string): string {
  return text.length > 1000 ? text.slice(0, 1000) : text
}

export class RunwayVideoAdapter implements VideoProviderAdapter {
  provider = 'runway'

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): Promise<ProviderRequest> {
    const model = record.model || config.model || RUNWAY_DEFAULT_MODEL
    const prompt = (record.prompt || '').trim()
    const tier = String(record.resolution || '').toLowerCase()
    const spec = modelSpec(model, tier === '1080p' || tier === '2k')

    const first = (record.firstFrameUrl || record.imageUrl || parseUrlArray(record.referenceImageUrls)[0] || '').trim()
    const last = (record.lastFrameUrl || '').trim()
    const duration = runwayDuration(record.duration, spec.durations)

    if (first || last) {
      const image = await fitPromptImage(first || last)
      const promptImage = spec.lastFrame && first && last
        ? [{ uri: image, position: 'first' }, { uri: await fitPromptImage(last), position: 'last' }]
        : image
      const body: Record<string, any> = {
        model,
        promptImage,
        ratio: nearestRunwayRatio(record.aspectRatio, spec.i2vRatios),
        duration,
      }
      if (prompt) body.promptText = clipPrompt(prompt)
      return { url: runwayUrl(config, '/v1/image_to_video'), method: 'POST', headers: runwayHeaders(config), body }
    }

    if (!spec.t2vRatios) throw new Error(`Runway ${model} 只支持图生视频：请先为分镜绑定参考图，或改用 gen4.5 / veo3.1`)
    if (!prompt) throw new Error('Runway 文生视频要求必须提供提示词')
    return {
      url: runwayUrl(config, '/v1/text_to_video'),
      method: 'POST',
      headers: runwayHeaders(config),
      body: { model, promptText: clipPrompt(prompt), ratio: nearestRunwayRatio(record.aspectRatio, spec.t2vRatios), duration },
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result?.id) return { isAsync: true, taskId: String(result.id) }
    throw new Error(`Runway 未返回任务 ID${result?.error ? `：${result.error}` : ''}`)
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return { url: runwayUrl(config, `/v1/tasks/${encodeURIComponent(taskId)}`), method: 'GET', headers: runwayHeaders(config, false), body: undefined }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result?.status || '').toUpperCase()
    if (status === 'SUCCEEDED') {
      const videoUrl = this.extractVideoUrl(result)
      return videoUrl ? { status: 'completed', videoUrl } : { status: 'failed', error: 'Runway 任务成功但没有返回视频' }
    }
    if (status === 'FAILED') {
      const code = result?.failureCode ? `[${result.failureCode}] ` : ''
      return { status: 'failed', error: `Runway 生成失败：${code}${result?.failure || 'FAILED'}` }
    }
    if (status === 'CANCELLED') return { status: 'failed', error: 'Runway 任务已取消' }
    return { status: status === 'RUNNING' ? 'processing' : 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    const url = Array.isArray(result?.output) ? result.output[0] : null
    return typeof url === 'string' && url ? url : null
  }

  describeError(status: number, bodyText: string): string | null {
    try {
      const body = JSON.parse(bodyText)
      const issues = Array.isArray(body?.issues) ? body.issues.map((i: any) => i?.message).filter(Boolean).join('; ') : ''
      const detail = [body?.error, issues].filter(Boolean).join(' — ')
      return detail ? `Runway 报错（HTTP ${status}）：${detail}`.slice(0, 500) : null
    } catch {
      return null
    }
  }
}
