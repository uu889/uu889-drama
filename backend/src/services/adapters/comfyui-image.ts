/**
 * 本地 ComfyUI 图片 Adapter（ComfyUI 原生 HTTP API，公共流程见 comfyui-common.ts）
 *
 * 工作流来自配置 settings.comfyui_workflow，未配置时按 settings.comfyui_template / 模型文件选择内置模板
 * （SDXL / SD1.5 / FLUX.1 dev / FLUX.1 schnell，见 comfyui-templates.ts）：
 * CheckpointLoaderSimple 的 ckpt_name 取 {{model}}，即配置「模型」列表里填的 checkpoint 文件名。
 * 没写占位符的自定义工作流会被自动绑定（comfyui-bind.ts）。
 * 占位符：{{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{steps}} {{cfg}} {{model}} {{aspect_ratio}}
 *        {{image}}（第一张参考图）{{reference_image_1..6}} —— 参考图只在自定义工作流引用时才上传使用
 * 宽高按项目尺寸换算到 settings.image_base_size²（默认 1024，SD1.5 填 512），对齐 64。
 */
import type {
  ImageProviderAdapter,
  AIConfig,
  GenerateContext,
  ProviderRequest,
  ImageGenerationRecord,
  ImagePollResponse,
  DownloadRequest,
} from './types'
import {
  ComfyUIClient,
  COMFY_MISSING_ERROR,
  comfyViewPath,
  findComfyOutput,
  parseComfyWorkflow,
  readComfyHistory,
  type ComfyPlaceholderValues,
} from './comfyui-common'
import { LOCAL_DEFAULT_NEGATIVE_PROMPT, applyPromptTemplate, explicitNumberSetting, localImageDimensions, numberSetting, textSetting } from './local-image'
import { DEFAULT_IMAGE_TEMPLATE_ID, getComfyTemplate, resolveComfyTemplate, splitModelFiles } from './comfyui-templates'

export const COMFYUI_DEFAULT_IMAGE_MODEL = 'sd_xl_base_1.0.safetensors'
const MAX_REFERENCE_IMAGES = 6
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i

/** 内置默认模板：ComfyUI 默认文生图工作流（Checkpoint + KSampler + SaveImage），SDXL / SD1.5 通用；其余见 comfyui-templates.ts */
export const COMFYUI_DEFAULT_IMAGE_WORKFLOW: Record<string, any> = getComfyTemplate('image', DEFAULT_IMAGE_TEMPLATE_ID)!.workflow

function parseRefs(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

export class ComfyUIImageAdapter extends ComfyUIClient implements ImageProviderAdapter {
  protected readonly mediaKind = 'image' as const

  async buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord, ctx?: GenerateContext): Promise<ProviderRequest> {
    const settings = config.settings || {}
    const model = (record.model || config.model || '').trim()
    // 工作流来源：自定义工作流 > 设置里选的内置模板 > 按模型文件识别（如 flux1-dev-fp8 → FLUX 模板）> SDXL 默认
    const custom = parseComfyWorkflow(settings.comfyui_workflow)
    const builtin = custom ? null : resolveComfyTemplate('image', settings.comfyui_template, model)
    const template = custom || builtin!.workflow
    const rec = builtin?.recommended || {}
    const baseSize = numberSetting(settings.image_base_size, rec.baseSize ?? 1024, 256, 2048)
    const { width, height } = localImageDimensions(record.size, baseSize)
    const refs = parseRefs(record.referenceImages).slice(0, MAX_REFERENCE_IMAGES)

    const imageSources: Record<string, string | undefined> = { image: refs[0] }
    refs.forEach((ref, i) => { imageSources[`reference_image_${i + 1}`] = ref })

    const explicitSteps = explicitNumberSetting(settings.image_steps, 1, 150)
    const explicitCfg = explicitNumberSetting(settings.image_cfg_scale, 0, 30)
    const values: ComfyPlaceholderValues = {
      prompt: applyPromptTemplate(settings.prompt_template, record.prompt || ''),
      negative_prompt: textSetting(settings.comfyui_negative_prompt, LOCAL_DEFAULT_NEGATIVE_PROMPT),
      seed: Math.floor(Math.random() * 2 ** 32),
      width,
      height,
      steps: Math.round(explicitSteps ?? rec.steps ?? 25),
      cfg: explicitCfg ?? rec.cfg ?? 7,
      // {{model}} 填 checkpoint 文件名；「模型」是 default 或模板 ID 时用模板推荐的文件
      model: model && splitModelFiles(model).length ? model : (builtin?.defaultModel || COMFYUI_DEFAULT_IMAGE_MODEL),
      aspect_ratio: `${width}:${height}`,
      frame_type: record.frameType || '',
    }
    return this.buildPromptRequest(config, template, values, imageSources, `uu889-img-${record.id}`, {
      kind: 'image',
      ctx,
      bind: {
        enabled: settings.comfyui_auto_bind !== false,
        model,
        steps: explicitSteps,
        cfg: explicitCfg,
      },
    })
  }

  parsePollResponse(result: any): ImagePollResponse {
    const history = readComfyHistory(result)
    if (history.state === 'missing') return { status: 'failed', error: COMFY_MISSING_ERROR }
    if (history.state === 'error') return { status: 'failed', error: history.error }
    if (history.state === 'running') return { status: 'processing' }
    const imageUrl = this.extractImageUrl(result)
    if (imageUrl) return { status: 'completed', imageUrl }
    return { status: 'failed', error: 'ComfyUI 工作流已完成但没有图片输出（请确认含 SaveImage 节点）' }
  }

  extractImageUrl(result: any): string | null {
    const entry: any = result && typeof result === 'object' ? Object.values(result)[0] : null
    const file = findComfyOutput(entry?.outputs, IMAGE_EXT_RE)
    return file ? comfyViewPath(file) : null
  }

  extractImageBase64(): { data: string; mimeType: string } | null {
    return null
  }

  resolveDownload(config: AIConfig, imageUrl: string): DownloadRequest {
    return this.download(config, imageUrl, '.png')
  }
}
