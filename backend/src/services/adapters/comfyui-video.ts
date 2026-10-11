/**
 * 本地 ComfyUI 视频 Adapter（ComfyUI 原生 HTTP API，公共流程见 comfyui-common.ts）
 *
 * 工作流来自配置 settings.comfyui_workflow（ComfyUI「导出 (API)」得到的 JSON），未配置时按
 * settings.comfyui_template / 「模型」选择内置模板（comfyui-templates.ts，默认 Wan 2.2 TI2V 5B）。
 * 没写占位符的工作流会被自动绑定（comfyui-bind.ts）：提示词、首尾帧 / 参考图、种子、宽高帧数、FPS、模型文件。
 * 占位符：
 *   {{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{duration}} {{fps}} {{frames}}
 *   {{aspect_ratio}} {{resolution}} {{model}} {{steps}} {{cfg}}
 *   {{image}}（首帧，无首帧时取第一张参考图）{{first_frame}} {{last_frame}} {{reference_image_1..9}}
 * 图片占位符没有对应素材时自动裁剪相关节点 —— 图生视频工作流里可选的 start_image 因此可以同时跑文生视频。
 */
import type {
  VideoProviderAdapter,
  AIConfig,
  GenerateContext,
  ProviderRequest,
  VideoGenerationRecord,
  VideoPollResponse,
  DownloadRequest,
} from './types'
import { parseUrlArray } from './media'
import { applyPromptTemplate, explicitNumberSetting, textSetting } from './local-image'
import { DEFAULT_VIDEO_TEMPLATE_ID, getComfyTemplate, isMiniMaxH3Workflow, modelOverrideFiles, resolveComfyTemplate } from './comfyui-templates'
import {
  ComfyUIClient,
  COMFY_MISSING_ERROR,
  comfyViewPath,
  findComfyOutput,
  parseComfyWorkflow,
  readComfyHistory,
  type ComfyOutputFile,
  type ComfyPlaceholderValues,
} from './comfyui-common'

export {
  parseComfyWorkflow,
  renderComfyWorkflow,
  classesWithDroppedLinks,
  summarizeComfyNodeErrors,
  type ComfyPlaceholderValues,
  type ComfyRequiredInputs,
} from './comfyui-common'

export const COMFYUI_DEFAULT_MODEL = DEFAULT_VIDEO_TEMPLATE_ID
export const COMFYUI_DEFAULT_FPS = 24
const MAX_REFERENCE_IMAGES = 9

/** Wan 官方推荐的负向提示词 */
export const COMFYUI_DEFAULT_NEGATIVE_PROMPT = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'

/**
 * 内置默认模板：ComfyUI 官方 Wan 2.2 TI2V 5B（文生 / 图生二合一）。
 * 其余模板（Wan 2.2 14B 图生 / 首尾帧 / 文生）见 comfyui-templates.ts。
 */
export const COMFYUI_DEFAULT_WORKFLOW: Record<string, any> = getComfyTemplate('video', DEFAULT_VIDEO_TEMPLATE_ID)!.workflow

// 只认浏览器 <video> 与 FFmpeg 拼接都能处理的容器；动图（gif / 动态 webp）单独提示
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i
const ANIMATED_IMAGE_EXT_RE = /\.(gif|webp)$/i

/** 宽高：短边按档位（480/720/1080），长边按画面比例，均对齐到 32 的倍数（Wan 系 VAE 要求） */
export function comfyDimensions(aspectRatio?: string | null, resolution?: string | null): { width: number; height: number } {
  const tier = String(resolution || '').toLowerCase()
  const shortSide = tier === '480p' ? 480 : tier === '1080p' || tier === '2k' ? 1080 : 720
  const [rw, rh] = String(aspectRatio || '16:9').split(':').map(Number)
  const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9
  const align = (v: number, round: (x: number) => number) => Math.max(32, round(v / 32) * 32)
  const short = align(shortSide, Math.floor)
  const long = align(short * Math.max(ratio, 1 / ratio), Math.round)
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long }
}

/** 帧数：时长 × fps，对齐到 step·n+1（Wan 系时间维压缩 4 倍；LTX-Video 为 8 倍） */
export function comfyFrameCount(durationSeconds: number, fps: number, step = 4): number {
  const n = Math.max(1, Math.round((durationSeconds * fps) / step))
  return n * step + 1
}

/**
 * MiniMax H3 画布：短边 480p 档为 480、其余档位为 768（模型原生 768p），长边按比例取 32 的倍数，
 * 总面积不超过官方上限 768×1344（16:9 → 1344×768，9:16 → 768×1344，1:1 → 768×768）
 */
export function minimaxH3Dimensions(aspectRatio?: string | null, resolution?: string | null): { width: number; height: number } {
  const short = String(resolution || '').toLowerCase() === '480p' ? 480 : 768
  const [rw, rh] = String(aspectRatio || '16:9').split(':').map(Number)
  const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9
  const maxLong = Math.floor((768 * 1344) / short / 32) * 32
  const long = Math.min(maxLong, Math.max(short, Math.round((short * Math.max(ratio, 1 / ratio)) / 32) * 32))
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long }
}

/** MiniMax H3 帧数：24fps 下的时长换算，向上取整到 17k+5（官方模板同一公式，5 秒 = 124 帧） */
export function minimaxH3FrameCount(durationSeconds: number): number {
  const base = Math.max(5, Math.round(durationSeconds * 24))
  return base + ((((5 - (base % 17)) % 17) + 17) % 17)
}

/** 工作流自带的 fps（CreateVideo.fps / VHS_VideoCombine.frame_rate …），没有返回 null */
export function detectWorkflowFps(workflow: Record<string, any>): number | null {
  for (const node of Object.values(workflow)) {
    const inputs = node?.inputs || {}
    for (const key of ['fps', 'frame_rate']) {
      const v = inputs[key]
      if (typeof v === 'number' && v > 0 && /video|webp|png|webm|conditioning|create/i.test(String(node?.class_type || ''))) return v
    }
  }
  return null
}

/** 在 history 节点输出里找成片：优先 output 目录、mp4 */
export function findComfyVideoOutput(outputs: Record<string, any> | null | undefined): ComfyOutputFile | null {
  return findComfyOutput(outputs, VIDEO_EXT_RE, (c) =>
    (c.type === 'output' ? 4 : 0) + (/\.mp4$/i.test(c.filename) ? 2 : 0) + (/\.(webm|mov|mkv)$/i.test(c.filename) ? 1 : 0))
}

export class ComfyUIVideoAdapter extends ComfyUIClient implements VideoProviderAdapter {
  protected readonly mediaKind = 'video' as const

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord, ctx?: GenerateContext): Promise<ProviderRequest> {
    const settings = config.settings || {}
    const model = (record.model || config.model || '').trim()
    // 工作流来源：自定义工作流 > 设置里选的内置模板 > 「模型」对应的内置模板 > 默认 Wan 2.2 TI2V 5B
    const custom = parseComfyWorkflow(settings.comfyui_workflow)
    const builtin = custom ? null : resolveComfyTemplate('video', settings.comfyui_template, model)
    const template = custom || builtin!.workflow

    // MiniMax H3：模型按 24fps、17k+5 帧、768p 画布训练，宽高 / 帧数 / FPS 按它的规则换算
    const h3 = isMiniMaxH3Workflow(template)
    const fpsSetting = Number(settings.comfyui_fps)
    const fps = Number.isFinite(fpsSetting) && fpsSetting > 0
      ? Math.round(fpsSetting)
      : (builtin?.recommended.fps ?? (custom ? detectWorkflowFps(custom) : null) ?? (h3 ? 24 : COMFYUI_DEFAULT_FPS))
    const durationRaw = Math.round(Number(record.duration || 5))
    const duration = Number.isFinite(durationRaw) ? Math.min(60, Math.max(1, durationRaw)) : 5
    const { width, height } = h3
      ? minimaxH3Dimensions(record.aspectRatio, record.resolution)
      : comfyDimensions(record.aspectRatio, record.resolution)
    const frameStep = /LTXV/i.test(JSON.stringify(template)) ? 8 : 4
    const frames = h3 ? minimaxH3FrameCount(duration) : comfyFrameCount(duration, fps, frameStep)
    const seed = Number.isFinite(Number(record.seed)) && record.seed != null
      ? Number(record.seed)
      : Math.floor(Math.random() * 2 ** 32)

    const firstFrame = (record.firstFrameUrl || record.imageUrl || '').trim()
    const lastFrame = (record.lastFrameUrl || '').trim()
    const refImages = parseUrlArray(record.referenceImageUrls).slice(0, MAX_REFERENCE_IMAGES)

    const imageSources: Record<string, string | undefined> = {
      image: firstFrame || refImages[0],
      first_frame: firstFrame || undefined,
      last_frame: lastFrame || undefined,
    }
    refImages.forEach((ref, i) => { imageSources[`reference_image_${i + 1}`] = ref })

    const steps = explicitNumberSetting(settings.comfyui_steps, 1, 200)
    const cfg = explicitNumberSetting(settings.comfyui_cfg, 0, 30)
    const values: ComfyPlaceholderValues = {
      prompt: applyPromptTemplate(settings.prompt_template, record.prompt || ''),
      negative_prompt: textSetting(settings.comfyui_negative_prompt, COMFYUI_DEFAULT_NEGATIVE_PROMPT),
      seed,
      width,
      height,
      duration,
      fps,
      frames,
      length: frames,
      aspect_ratio: record.aspectRatio || '16:9',
      resolution: record.resolution || '720p',
      model: model || builtin?.defaultModel || COMFYUI_DEFAULT_MODEL,
      // 只有手写了 {{steps}} / {{cfg}} 的工作流才用到
      steps: Math.round(steps ?? 20),
      cfg: cfg ?? 5,
    }
    return this.buildPromptRequest(config, template, values, imageSources, `uu889-${record.id}`, {
      kind: 'video',
      ctx,
      bind: {
        enabled: settings.comfyui_auto_bind !== false,
        model,
        modelFiles: modelOverrideFiles(model, builtin),
        steps,
        cfg,
      },
    })
  }

  parsePollResponse(result: any): VideoPollResponse {
    const history = readComfyHistory(result)
    if (history.state === 'missing') return { status: 'failed', error: COMFY_MISSING_ERROR }
    if (history.state === 'error') return { status: 'failed', error: history.error }
    if (history.state === 'running') return { status: 'processing' }

    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { status: 'completed', videoUrl }
    const animatedOnly = !!findComfyOutput(history.entry.outputs, ANIMATED_IMAGE_EXT_RE)
    return {
      status: 'failed',
      error: animatedOnly
        ? 'ComfyUI 只输出了 GIF / WebP 动图，无法播放和拼接：请改用 SaveVideo 或 VHS_VideoCombine 输出 mp4'
        : 'ComfyUI 工作流已完成但没有视频输出（请确认含 SaveVideo / VHS_VideoCombine 等保存视频的节点）',
    }
  }

  extractVideoUrl(result: any): string | null {
    const entry: any = result && typeof result === 'object' ? Object.values(result)[0] : null
    const file = findComfyVideoOutput(entry?.outputs)
    return file ? comfyViewPath(file) : null
  }

  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    return this.download(config, videoUrl, '.mp4')
  }
}
