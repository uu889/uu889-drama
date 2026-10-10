/**
 * Stable Diffusion WebUI 图片 Adapter（AUTOMATIC1111 / Forge / reForge 等兼容 /sdapi/v1 的实现）
 * 启动时需加 --api（开启鉴权：--api-auth 用户名:密码，配置里 API Key 填「用户名:密码」）
 * 文生图: POST /sdapi/v1/txt2img → { images: [base64 PNG], parameters, info }（同步返回）
 *
 * - 模型：配置「模型」填 checkpoint 名（/sdapi/v1/sd-models 的 title 或 model_name），
 *   填 default 则沿用 WebUI 当前加载的模型；否则经 override_settings.sd_model_checkpoint 临时切换
 * - 尺寸：项目尺寸按 settings.image_base_size²（默认 1024，SD1.5 填 512）换算，对齐 64
 * - 参考图暂不使用（WebUI 的 ControlNet / IP-Adapter 插件参数各异）；需要参考图时请用 ComfyUI 自定义工作流
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
  localImageDimensions,
  localUrl,
  numberSetting,
  stripDataPrefix,
  textSetting,
} from './local-image'

const DEFAULT_BASE = 'http://127.0.0.1:7860'

export class SdWebuiImageAdapter implements ImageProviderAdapter {
  provider = 'sdwebui'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const settings = config.settings || {}
    const { width, height } = localImageDimensions(record.size, numberSetting(settings.image_base_size, 1024, 256, 2048))
    const body: Record<string, any> = {
      prompt: (record.prompt || '').trim(),
      negative_prompt: textSetting(settings.image_negative_prompt, LOCAL_DEFAULT_NEGATIVE_PROMPT),
      width,
      height,
      steps: Math.round(numberSetting(settings.image_steps, 25, 1, 150)),
      cfg_scale: numberSetting(settings.image_cfg_scale, 7, 0, 30),
      seed: -1,
      batch_size: 1,
      n_iter: 1,
      send_images: true,
      save_images: false,
    }
    const sampler = textSetting(settings.image_sampler)
    if (sampler) body.sampler_name = sampler
    const model = record.model || config.model
    if (!isDefaultModel(model)) body.override_settings = { sd_model_checkpoint: model }

    return {
      url: localUrl(config.baseUrl, DEFAULT_BASE, '/sdapi/v1/txt2img'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...localAuthHeaders(config.apiKey) },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    if (Array.isArray(result?.images) && result.images[0]) return { isAsync: false, imageUrl: undefined }
    throw new Error(`Stable Diffusion WebUI 未返回图片${result?.error ? `：${result.error} ${result.detail || ''}`.trimEnd() : ''}`)
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const first = Array.isArray(result?.images) ? result.images[0] : null
    return typeof first === 'string' && first ? { data: stripDataPrefix(first), mimeType: 'image/png' } : null
  }

  extractImageUrl(): string | null {
    return null
  }

  /** WebUI 的错误体：{ error, detail, body, errors }（如模型名不存在、显存不足） */
  describeError(status: number, bodyText: string): string | null {
    try {
      const body = JSON.parse(bodyText)
      const detail = [body?.error, typeof body?.detail === 'string' ? body.detail : '', body?.errors].filter(Boolean).join(' — ')
      return detail ? `Stable Diffusion WebUI 报错（HTTP ${status}）：${detail}`.slice(0, 500) : null
    } catch {
      return status === 404 ? 'Stable Diffusion WebUI 没有开启 API：请用 --api 参数启动 WebUI' : null
    }
  }

  // 同步接口，不会进入轮询
  buildPollRequest(config: AIConfig): ProviderRequest {
    return { url: localUrl(config.baseUrl, DEFAULT_BASE, '/sdapi/v1/progress'), method: 'GET', headers: localAuthHeaders(config.apiKey), body: undefined }
  }

  parsePollResponse(): ImagePollResponse {
    return { status: 'failed', error: 'Stable Diffusion WebUI 为同步接口，不支持轮询' }
  }
}
