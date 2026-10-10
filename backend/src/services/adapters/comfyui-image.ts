/**
 * 本地 ComfyUI 图片 Adapter（ComfyUI 原生 HTTP API，公共流程见 comfyui-common.ts）
 *
 * 工作流来自配置 settings.comfyui_workflow，未配置时用内置 SDXL / SD1.5 通用文生图模板：
 * CheckpointLoaderSimple 的 ckpt_name 取 {{model}}，即配置「模型」列表里填的 checkpoint 文件名。
 * 占位符：{{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{steps}} {{cfg}} {{model}} {{aspect_ratio}}
 *        {{image}}（第一张参考图）{{reference_image_1..6}} —— 参考图只在自定义工作流引用时才上传使用
 * 宽高按项目尺寸换算到 settings.image_base_size²（默认 1024，SD1.5 填 512），对齐 64。
 */
import type {
  ImageProviderAdapter,
  AIConfig,
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
import { LOCAL_DEFAULT_NEGATIVE_PROMPT, localImageDimensions, numberSetting, textSetting } from './local-image'

export const COMFYUI_DEFAULT_IMAGE_MODEL = 'sd_xl_base_1.0.safetensors'
const MAX_REFERENCE_IMAGES = 6
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i

/** 内置模板：ComfyUI 默认文生图工作流（Checkpoint + KSampler + SaveImage），SDXL / SD1.5 通用 */
export const COMFYUI_DEFAULT_IMAGE_WORKFLOW: Record<string, any> = {
  '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}', sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{model}}' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'uu889-drama', images: ['8', 0] } },
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

export class ComfyUIImageAdapter extends ComfyUIClient implements ImageProviderAdapter {
  async buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): Promise<ProviderRequest> {
    const settings = config.settings || {}
    const template = parseComfyWorkflow(settings.comfyui_workflow) || COMFYUI_DEFAULT_IMAGE_WORKFLOW
    const { width, height } = localImageDimensions(record.size, numberSetting(settings.image_base_size, 1024, 256, 2048))
    const refs = parseRefs(record.referenceImages).slice(0, MAX_REFERENCE_IMAGES)

    const imageSources: Record<string, string | undefined> = { image: refs[0] }
    refs.forEach((ref, i) => { imageSources[`reference_image_${i + 1}`] = ref })

    const values: ComfyPlaceholderValues = {
      prompt: (record.prompt || '').trim(),
      negative_prompt: textSetting(settings.comfyui_negative_prompt, LOCAL_DEFAULT_NEGATIVE_PROMPT),
      seed: Math.floor(Math.random() * 2 ** 32),
      width,
      height,
      steps: Math.round(numberSetting(settings.image_steps, 25, 1, 150)),
      cfg: numberSetting(settings.image_cfg_scale, 7, 0, 30),
      model: record.model || config.model || COMFYUI_DEFAULT_IMAGE_MODEL,
      aspect_ratio: `${width}:${height}`,
    }
    return this.buildPromptRequest(config, template, values, imageSources, `uu889-img-${record.id}`)
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
