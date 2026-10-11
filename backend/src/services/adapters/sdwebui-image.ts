/**
 * Stable Diffusion WebUI 图片 Adapter（AUTOMATIC1111 / Forge / reForge 等兼容 /sdapi/v1 的实现）
 * 启动时需加 --api（开启鉴权：--api-auth 用户名:密码，配置里 API Key 填「用户名:密码」）
 * 文生图: POST /sdapi/v1/txt2img → { images: [base64 PNG], parameters, info }（同步返回）
 *
 * - 模型：配置「模型」填 checkpoint 名（/sdapi/v1/sd-models 的 title 或 model_name），
 *   填 default 则沿用 WebUI 当前加载的模型；否则经 override_settings.sd_model_checkpoint 临时切换
 * - 尺寸：项目尺寸按 settings.image_base_size²（默认 1024，SD1.5 填 512）换算，对齐 64
 * - 参考图暂不使用（WebUI 的 ControlNet / IP-Adapter 插件参数各异）；需要参考图时请用 ComfyUI 自定义工作流
 * - 提示词模板 settings.prompt_template：「masterpiece, {{prompt}}, cinematic」，{{prompt}} 处插入 UU889-Drama 的提示词
 * - 进度：请求带 force_task_id，出图期间轮询 POST /internal/progress { id_task }（排队位置、进度、ETA）；
 *   老版本没有该接口时退回 GET /sdapi/v1/progress（全局进度：采样步数 / ETA）
 */
import { randomBytes } from 'node:crypto'
import type {
  ImageProviderAdapter,
  AIConfig,
  ProviderRequest,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { formatEta, stagePercent, type ProgressReporter } from '../task-progress'
import {
  LOCAL_DEFAULT_NEGATIVE_PROMPT,
  applyPromptTemplate,
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
      prompt: applyPromptTemplate(settings.prompt_template, record.prompt || ''),
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
      // 自定义任务 ID：出图期间凭它查询排队位置与进度（WebUI 1.6+；老版本忽略该字段）
      force_task_id: `task(uu889-${record.id}-${randomBytes(3).toString('hex')})`,
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

  /** txt2img 阻塞期间每 1.5 秒查一次进度 */
  trackSyncProgress(config: AIConfig, request: ProviderRequest, report: ProgressReporter): () => void {
    const taskId = String(request?.body?.force_task_id || '')
    const headers = { 'Content-Type': 'application/json', ...localAuthHeaders(config.apiKey) }
    let stopped = false
    let useInternal = !!taskId
    let seenActive = false
    // 请求刚发出时 WebUI 可能还没登记这个任务 ID：连续 3 次查不到才判定为老版本，改查全局进度
    let unknownCount = 0

    const tick = async () => {
      if (stopped) return
      try {
        if (useInternal) {
          const resp = await fetch(localUrl(config.baseUrl, DEFAULT_BASE, '/internal/progress'), {
            method: 'POST',
            headers,
            body: JSON.stringify({ id_task: taskId, id_live_preview: -1, live_preview: false }),
            signal: AbortSignal.timeout(5000),
          })
          if (resp.ok) {
            const data = await resp.json() as any
            if (stopped) return
            if (data?.active) {
              seenActive = true
              const progress = Number(data.progress) || 0
              const eta = Number(data.eta)
              report({
                stage: 'running',
                percent: stagePercent('running', progress),
                message: `Stable Diffusion WebUI 出图中：${Math.round(progress * 100)}%${Number.isFinite(eta) && eta > 0 ? `，预计还需 ${formatEta(eta)}` : ''}`,
                detail: { eta_seconds: Number.isFinite(eta) ? Math.round(eta) : undefined, provider_status: data.textinfo || undefined },
                replaceDetail: true,
              })
              return
            }
            if (data?.queued) {
              const m = String(data.textinfo || '').match(/(\d+)\s*\/\s*(\d+)/)
              const ahead = m ? Math.max(0, Number(m[1]) - 1) : undefined
              report({
                stage: 'queued',
                message: ahead != null ? `Stable Diffusion WebUI 排队中：前面还有 ${ahead} 个任务` : 'Stable Diffusion WebUI 排队中',
                detail: { queue_ahead: ahead, queue_total: m ? Number(m[2]) : undefined },
              })
              return
            }
            // 既不在执行也不在排队：可能还没登记，或老版本不认 force_task_id（连续多次后改查全局进度）
            if (data?.completed || seenActive) return
            if (++unknownCount < 3) {
              report({ stage: 'running', message: 'Stable Diffusion WebUI 已收到请求，准备出图' })
              return
            }
            useInternal = false
          } else if (resp.status === 404) {
            useInternal = false
          }
        }
        const resp = await fetch(localUrl(config.baseUrl, DEFAULT_BASE, '/sdapi/v1/progress?skip_current_image=true'), {
          headers: localAuthHeaders(config.apiKey),
          signal: AbortSignal.timeout(5000),
        })
        if (!resp.ok || stopped) return
        const data = await resp.json() as any
        const state = data?.state || {}
        const step = Number(state.sampling_step)
        const steps = Number(state.sampling_steps)
        const progress = Number(data?.progress) || 0
        const eta = Number(data?.eta_relative)
        if (progress <= 0 && !step) {
          report({ stage: 'running', message: 'Stable Diffusion WebUI 处理中（加载模型或等待其他任务）' })
          return
        }
        report({
          stage: 'running',
          percent: stagePercent('running', progress),
          message: `Stable Diffusion WebUI 采样中：第 ${step || 0}/${steps || '?'} 步${Number.isFinite(eta) && eta > 0 ? `，预计还需 ${formatEta(eta)}` : ''}`,
          detail: { step: step || undefined, steps: steps || undefined, eta_seconds: Number.isFinite(eta) ? Math.round(eta) : undefined },
          replaceDetail: true,
        })
      } catch { /* 查进度失败不影响出图 */ }
    }

    const timer = setInterval(() => { void tick() }, 1500)
    timer.unref?.()
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
