/**
 * aiask.me 图片 Adapter（OpenAI Images 兼容网关）
 * 文生图: POST /v1/images/generations
 * 参考图: POST /v1/images/edits
 *
 * 按模型族调整请求：
 * - gpt-image-*      与 OpenAI 官方一致（size 归一化，参考图 multipart image[]）
 * - grok-imagine-*   xAI 语义：aspect_ratio 代替 size，b64_json 返回，参考图用 JSON 形式的 edits
 * - 其它（gemini-*-image、seedream、flux…）size 原样透传，参考图 multipart
 * 网关可能同步返回 url / b64_json，也可能返回异步任务 id —— 先看 data 再看 id。
 */
import type { ProviderRequest, AIConfig, ImageGenerationRecord, ImageGenResponse } from './types'
import { OpenAIImageAdapter } from './openai-image'
import { joinProviderUrl } from './url'

export const AIASK_DEFAULT_IMAGE_MODEL = 'gpt-image-2'

const GROK_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2'] as const

/** 1920x1080 之类的尺寸 → 最接近的 Grok 支持比例 */
export function sizeToGrokAspectRatio(size?: string | null): string {
  const [w, h] = String(size || '').toLowerCase().split('x').map(Number)
  if (!w || !h) return '1:1'
  const target = Math.log(w / h)
  let best: string = '1:1'
  let bestDiff = Infinity
  for (const candidate of GROK_RATIOS) {
    const [cw, ch] = candidate.split(':').map(Number)
    const diff = Math.abs(Math.log(cw / ch) - target)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

export class AiaskImageAdapter extends OpenAIImageAdapter {
  provider = 'aiask'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || AIASK_DEFAULT_IMAGE_MODEL
    if (model.startsWith('gpt-image-')) {
      return super.buildGenerateRequest(config, { ...record, model })
    }

    const refs = this.parseReferenceImages(record.referenceImages)
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    }

    if (/^grok-imagine/i.test(model)) {
      const body: any = {
        model,
        prompt: record.prompt,
        n: 1,
        aspect_ratio: sizeToGrokAspectRatio(record.size),
        response_format: 'b64_json',
      }
      if (!refs.length) {
        return { url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'), method: 'POST', headers, body }
      }
      if (refs.length === 1) body.image = { type: 'image_url', url: refs[0] }
      else body.images = refs.map((url) => ({ type: 'image_url', url }))
      return { url: joinProviderUrl(config.baseUrl, '/v1', '/images/edits'), method: 'POST', headers, body }
    }

    const size = record.size || '1024x1024'
    if (refs.length) return this.buildEditsRequest(config, model, record.prompt, size, refs)
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers,
      body: { model, prompt: record.prompt, size, n: 1 },
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const first = result?.data?.[0]
    if (first?.url) return { isAsync: false, imageUrl: first.url }
    if (first?.b64_json) return { isAsync: false, imageUrl: undefined }
    if (result?.url) return { isAsync: false, imageUrl: result.url }
    const taskId = result?.task_id || result?.id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    throw new Error('No image URL in response')
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result?.data?.[0]?.b64_json
    if (!b64) return null
    const format = String(result?.output_format || 'png').toLowerCase().replace('jpg', 'jpeg')
    return { data: b64, mimeType: `image/${format}` }
  }
}
