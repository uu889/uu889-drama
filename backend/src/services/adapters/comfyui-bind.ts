/**
 * ComfyUI 工作流自动绑定：让「直接从 ComfyUI 导出、没写任何占位符」的工作流也受 UU889-Drama 控制。
 *
 * 按节点结构识别要控制的字段，改写成 {{占位符}}，之后统一走 renderComfyWorkflow 替换：
 *   - 正 / 负提示词：从采样器（KSampler / KSamplerAdvanced / SamplerCustom / CFGGuider…）的 positive / negative
 *     连线向上找文本编码节点（CLIPTextEncode 等）；找不到采样器时按节点标题（Positive / Negative / 正向 / 负向）或出现顺序
 *   - 图片：LoadImage 节点按下游用途 / 标题识别首帧、尾帧、参考图；没有对应图片时自动裁剪（沿用原有裁剪逻辑）
 *   - 种子：seed / noise_seed
 *   - 宽高 / 帧数：Latent、ImageToVideo、FirstLastFrame 等节点的 width / height / length
 *   - FPS（视频）：CreateVideo.fps、VHS_VideoCombine.frame_rate 等
 *   - 模型：「模型」里填的是文件名时，写入 CheckpointLoaderSimple / UNETLoader 等主模型加载节点
 *     （Wan 2.2 14B 双模型填「高噪声文件|低噪声文件」，按节点顺序依次写入）
 *   - 步数 / CFG：只有在设置里明确填写时才覆盖（避免把 Lightning / Turbo 工作流的 4 步改成 25 步）
 *
 * 已经写了某类占位符的工作流（如内置模板），该类字段不再自动识别，完全尊重手写的绑定。
 */
import { splitModelFiles } from './comfyui-templates'

export type ComfyBindKind = 'image' | 'video'

export interface ComfyBinding {
  node_id: string
  class_type: string
  title: string
  input: string
  /** 绑定到的参数，如 prompt / first_frame / seed / model */
  target: string
  /** placeholder = 工作流里已写好的占位符；auto = 自动识别；override = 用设置值直接覆盖 */
  source: 'placeholder' | 'auto' | 'override'
  /** 原值（自动识别 / 覆盖时） */
  original?: unknown
  /** 覆盖写入的新值（source = override 时） */
  value?: unknown
}

export interface ComfyBindReport {
  bindings: ComfyBinding[]
  warnings: string[]
  /** 输出节点（SaveVideo / SaveImage …） */
  outputs: Array<{ node_id: string; class_type: string; title: string }>
  /** 主模型加载节点及当前值 */
  loaders: Array<{ node_id: string; class_type: string; input: string; value: unknown }>
  /** 工作流引用的全部模型文件（用于检查 ComfyUI 里是否存在） */
  model_files: Array<{ node_id: string; class_type: string; input: string; value: string }>
}

export interface ComfyBindOptions {
  /** 「模型」原始值（文件名才会写入加载节点） */
  model?: string | null
  /** 需要写进主模型加载节点的文件（已去掉 LoRA / 模板自带文件）；不传时从 model 里取 */
  modelFiles?: string[]
  /** 设置里明确填写的步数 / CFG（未填写传 undefined） */
  steps?: number
  cfg?: number
  /** 设置里关闭自动绑定时只汇报已有占位符 */
  enabled?: boolean
}

const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi
const MODEL_FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i

/** 采样 / 引导节点：带 positive / negative 连线 */
const SAMPLER_RE = /sampler|guider/i
/** 文本编码节点里可能存放提示词的字段 */
const TEXT_FIELDS = ['text', 'prompt', 'text_g', 'text_l', 't5xxl', 'clip_l', 'positive_prompt', 'string', 'value']
const NEGATIVE_FIELDS = ['negative_prompt']
const TEXT_SOURCE_FIELDS = ['value', 'string', 'text', 'prompt']
const ENCODER_RE = /textencode|cliptext|prompt|conditioning.*text|textencoder/i
/** 自带 prompt 文本框的视频条件节点（MiniMax H3 等），提示词直接写在这类节点上 */
const PROMPT_CONDITIONING_RE = /MiniMaxH3|tovideo|ImageToVideo/i
/** 输出宽高的辅助节点（如官方 H3 模板的 Resolution Selector）：自动绑定时改成直接填 UU889-Drama 的宽高 */
const RESOLUTION_HELPER_RE = /ResolutionSelector|Resolution\s*Selector|AspectRatio|ResolutionPicker/i
/** 标题像「时长 / duration」的数字常量节点：自动绑定为时长（秒） */
const DURATION_TITLE_RE = /duration|seconds|时长|秒/i
/** 主模型加载节点：class → 文件字段 */
const MAIN_LOADERS: Record<string, string> = {
  CheckpointLoaderSimple: 'ckpt_name',
  CheckpointLoader: 'ckpt_name',
  ImageOnlyCheckpointLoader: 'ckpt_name',
  unCLIPCheckpointLoader: 'ckpt_name',
  UNETLoader: 'unet_name',
  UnetLoaderGGUF: 'unet_name',
  UnetLoaderGGUFAdvanced: 'unet_name',
  WanVideoModelLoader: 'model',
}
/** 宽高 / 帧数所在的节点（latent 创建、图生视频条件） */
const DIMENSION_NODE_RE = /latent|imagetovideo|tovideo|firstlastframe|img2vid|img_to_video|i2v|emptyimage/i
const FRAME_FIELDS = ['length', 'num_frames', 'video_frames', 'frame_count', 'frames']
const FPS_FIELDS: Record<string, string> = {
  CreateVideo: 'fps',
  VHS_VideoCombine: 'frame_rate',
  SaveAnimatedWEBP: 'fps',
  SaveAnimatedPNG: 'fps',
  SaveWEBM: 'fps',
  LTXVConditioning: 'frame_rate',
  SVD_img2vid_Conditioning: 'fps',
}
const IMAGE_LOADERS = new Set(['LoadImage', 'LoadImageOutput'])
const OUTPUT_RE = /^(SaveVideo|SaveImage|PreviewImage|VHS_VideoCombine|SaveAnimatedWEBP|SaveAnimatedPNG|SaveWEBM|ImageSave|Image Save|SaveImageWebsocket)$/i

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'
}

function nodeTitle(node: any): string {
  return String(node?._meta?.title || node?.class_type || '')
}

function sortedIds(workflow: Record<string, any>): string[] {
  return Object.keys(workflow).sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.localeCompare(b)
  })
}

/** 工作流里已经出现的占位符键 */
export function collectComfyPlaceholders(workflow: Record<string, any>): Set<string> {
  const found = new Set<string>()
  const text = JSON.stringify(workflow)
  for (const m of text.matchAll(PLACEHOLDER_RE)) found.add(m[1].toLowerCase())
  return found
}

/** 每个节点被哪些节点（及输入名）引用 */
function buildConsumers(workflow: Record<string, any>): Map<string, Array<{ nodeId: string; input: string }>> {
  const consumers = new Map<string, Array<{ nodeId: string; input: string }>>()
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [input, value] of Object.entries(node?.inputs || {})) {
      if (!isLink(value)) continue
      const src = String(value[0])
      if (!consumers.has(src)) consumers.set(src, [])
      consumers.get(src)!.push({ nodeId, input })
    }
  }
  return consumers
}

export function autoBindComfyWorkflow(
  template: Record<string, any>,
  kind: ComfyBindKind,
  options: ComfyBindOptions = {},
): { workflow: Record<string, any>; report: ComfyBindReport } {
  const workflow: Record<string, any> = JSON.parse(JSON.stringify(template))
  const report: ComfyBindReport = { bindings: [], warnings: [], outputs: [], loaders: [], model_files: [] }
  const ids = sortedIds(workflow)
  const existing = collectComfyPlaceholders(workflow)
  const enabled = options.enabled !== false
  const consumers = buildConsumers(workflow)

  // ── 已有占位符 ─────────────────────────────────────────
  for (const id of ids) {
    const node = workflow[id]
    for (const [input, value] of Object.entries(node?.inputs || {})) {
      if (typeof value !== 'string') continue
      for (const m of value.matchAll(PLACEHOLDER_RE)) {
        report.bindings.push({ node_id: id, class_type: node.class_type, title: nodeTitle(node), input, target: m[1].toLowerCase(), source: 'placeholder' })
      }
    }
  }

  const bind = (id: string, input: string, target: string, value: unknown = `{{${target}}}`, source: ComfyBinding['source'] = 'auto') => {
    const node = workflow[id]
    if (!node?.inputs) return
    const original = node.inputs[input]
    node.inputs[input] = value
    report.bindings.push({ node_id: id, class_type: node.class_type, title: nodeTitle(node), input, target, source, original, ...(source === 'override' ? { value } : {}) })
  }

  // ── 提示词 ─────────────────────────────────────────────
  if (enabled && !existing.has('prompt')) {
    const positive = new Set<string>()
    const negative = new Set<string>()

    /** 从一条条件连线向上找文本编码节点，返回 [节点, 字段] 列表 */
    const findTextTargets = (start: [string, number], branch: 'positive' | 'negative'): Array<[string, string]> => {
      const out: Array<[string, string]> = []
      const seen = new Set<string>()
      const queue: string[] = [String(start[0])]
      while (queue.length && seen.size < 40) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        const node = workflow[id]
        if (!node) continue
        // 负向分支走到 ConditioningZeroOut：没有负向文本，不再追
        if (branch === 'negative' && /ZeroOut/i.test(node.class_type)) continue
        const inputs = node.inputs || {}
        const textFields = [...TEXT_FIELDS, ...(branch === 'negative' ? NEGATIVE_FIELDS : [])].filter((f) => f in inputs)
        // 文本编码节点；或自带提示词的条件节点（如 MiniMaxH3ImageToVideo 的 prompt 字段）
        const isEncoder = ENCODER_RE.test(node.class_type) || PROMPT_CONDITIONING_RE.test(node.class_type)
        if (isEncoder && textFields.length) {
          for (const field of textFields) {
            const v = inputs[field]
            if (typeof v === 'string') out.push([id, field])
            else if (isLink(v)) {
              // 文本来自 String / Primitive 节点
              const src = workflow[String(v[0])]
              const srcField = TEXT_SOURCE_FIELDS.find((f) => typeof src?.inputs?.[f] === 'string')
              if (srcField) out.push([String(v[0]), srcField])
            }
          }
          if (out.length) continue
        }
        // 继续沿条件链向上：优先同名分支，其次 conditioning 类输入
        const preferred = [branch, 'conditioning', 'conditioning_to', 'conditioning_1', 'conditioning_from', 'cond', 'positive', 'negative']
        let followed = false
        for (const key of preferred) {
          const v = inputs[key]
          if (isLink(v) && (key === branch || !['positive', 'negative'].includes(key))) {
            queue.push(String(v[0]))
            followed = true
          }
        }
        if (!followed) {
          for (const [key, v] of Object.entries(inputs)) {
            if (isLink(v) && /cond/i.test(key)) queue.push(String(v[0]))
          }
        }
      }
      return out
    }

    const samplers = ids.filter((id) => SAMPLER_RE.test(workflow[id].class_type) && (isLink(workflow[id].inputs?.positive) || isLink(workflow[id].inputs?.conditioning)))
    for (const id of samplers) {
      const inputs = workflow[id].inputs || {}
      const posLink = isLink(inputs.positive) ? inputs.positive : isLink(inputs.conditioning) ? inputs.conditioning : null
      if (posLink) for (const [n, f] of findTextTargets(posLink, 'positive')) positive.add(`${n}\u0000${f}`)
      if (isLink(inputs.negative)) for (const [n, f] of findTextTargets(inputs.negative, 'negative')) negative.add(`${n}\u0000${f}`)
    }
    // 同一个编码节点同时出现在正负两侧时按正向处理
    for (const key of positive) negative.delete(key)

    if (!positive.size) {
      // 没有可追踪的采样器：按标题 / 顺序判断文本编码节点
      const encoders = ids.filter((id) => (ENCODER_RE.test(workflow[id].class_type) || PROMPT_CONDITIONING_RE.test(workflow[id].class_type)) && TEXT_FIELDS.some((f) => typeof workflow[id].inputs?.[f] === 'string'))
      const isNeg = (id: string) => /negative|neg\b|负|反向/i.test(nodeTitle(workflow[id]))
      const pos = encoders.filter((id) => !isNeg(id))
      const neg = encoders.filter(isNeg)
      if (pos[0]) positive.add(`${pos[0]}\u0000${TEXT_FIELDS.find((f) => typeof workflow[pos[0]].inputs?.[f] === 'string')}`)
      const negId = neg[0] || pos[1]
      if (negId && !existing.has('negative_prompt')) {
        negative.add(`${negId}\u0000${TEXT_FIELDS.find((f) => typeof workflow[negId].inputs?.[f] === 'string')}`)
      }
    }

    for (const key of positive) {
      const [n, f] = key.split('\u0000')
      bind(n, f, 'prompt')
    }
    if (!existing.has('negative_prompt')) {
      for (const key of negative) {
        const [n, f] = key.split('\u0000')
        // 原本为空的负向（如 FLUX 的空编码）保持为空，避免把负向词塞进不支持负向的模型
        if (workflow[n].inputs[f] === '') continue
        bind(n, f, 'negative_prompt')
      }
    }
    if (!positive.size) report.warnings.push('没有找到正向提示词节点（CLIPTextEncode 等），UU889-Drama 的提示词无法传入；请在文本节点里写 {{prompt}}')
  }

  // ── 图片 ───────────────────────────────────────────────
  const hasImagePlaceholder = [...existing].some((k) => /^(image|first_frame|last_frame|reference_image_\d+)$/.test(k))
  if (enabled && !hasImagePlaceholder) {
    const loaders = ids.filter((id) => IMAGE_LOADERS.has(workflow[id].class_type) && typeof workflow[id].inputs?.image === 'string')
    /** 沿下游最多 4 层，收集用到这张图的输入名 */
    const downstreamInputs = (id: string): string[] => {
      const names: string[] = []
      let frontier = [id]
      for (let depth = 0; depth < 4 && frontier.length; depth++) {
        const next: string[] = []
        for (const f of frontier) {
          for (const c of consumers.get(f) || []) {
            names.push(c.input)
            next.push(c.nodeId)
          }
        }
        frontier = next
      }
      return names
    }
    const roleOf = (id: string): 'first' | 'last' | 'ref' => {
      const title = nodeTitle(workflow[id])
      if (/last|end|尾帧|结束|末帧/i.test(title)) return 'last'
      if (/first|start|首帧|起始|开始/i.test(title)) return 'first'
      const inputs = downstreamInputs(id)
      if (inputs.some((n) => /end_image|last/i.test(n))) return 'last'
      if (inputs.some((n) => /start_image|first|init_image/i.test(n))) return 'first'
      return 'ref'
    }
    if (kind === 'video') {
      let refIndex = 0
      let firstUsed = false
      for (const id of loaders) {
        const role = loaders.length === 1 ? 'first' : roleOf(id)
        if (role === 'last') bind(id, 'image', 'last_frame')
        else if (role === 'first' && !firstUsed) {
          bind(id, 'image', 'image')
          firstUsed = true
        } else bind(id, 'image', `reference_image_${++refIndex}`)
      }
    } else {
      // 生图：第 1 个 LoadImage = 第 1 张参考图，其余依次对应
      loaders.forEach((id, i) => bind(id, 'image', i === 0 ? 'image' : `reference_image_${i + 1}`))
    }
  }

  // ── 种子 ───────────────────────────────────────────────
  if (enabled && !existing.has('seed')) {
    for (const id of ids) {
      const inputs = workflow[id].inputs || {}
      for (const field of ['seed', 'noise_seed']) {
        if (typeof inputs[field] === 'number') {
          // 两段采样的第二段（add_noise=disable）种子无意义，保持原值
          if (inputs.add_noise === 'disable') continue
          bind(id, field, 'seed')
        }
      }
    }
  }

  // ── 宽高 / 帧数 ─────────────────────────────────────────
  if (enabled && !existing.has('width') && !existing.has('height')) {
    for (const id of ids) {
      const node = workflow[id]
      if (!DIMENSION_NODE_RE.test(node.class_type) || /upscale/i.test(node.class_type)) continue
      const inputs = node.inputs || {}
      const fromHelper = (v: unknown) => isLink(v) && RESOLUTION_HELPER_RE.test(String(workflow[String(v[0])]?.class_type || ''))
      if ((typeof inputs.width === 'number' || fromHelper(inputs.width)) && (typeof inputs.height === 'number' || fromHelper(inputs.height))) {
        bind(id, 'width', 'width')
        bind(id, 'height', 'height')
      }
    }
  }
  if (enabled && kind === 'video' && !existing.has('frames') && !existing.has('length')) {
    for (const id of ids) {
      const node = workflow[id]
      if (!DIMENSION_NODE_RE.test(node.class_type) || /upscale/i.test(node.class_type)) continue
      for (const field of FRAME_FIELDS) {
        if (typeof node.inputs?.[field] === 'number') bind(id, field, 'frames')
      }
    }
  }

  // ── 时长（秒）：标题为「duration / 时长」的数字常量（如官方 H3 模板里换算帧数用的 Float (duration)）──
  if (enabled && kind === 'video' && !existing.has('duration')) {
    for (const id of ids) {
      const node = workflow[id]
      if (!/^Primitive(Float|Int)$|^PrimitiveNode$/.test(String(node.class_type)) || typeof node.inputs?.value !== 'number') continue
      if (DURATION_TITLE_RE.test(nodeTitle(node))) bind(id, 'value', 'duration')
    }
  }

  // ── FPS ───────────────────────────────────────────────
  if (enabled && kind === 'video' && !existing.has('fps')) {
    for (const id of ids) {
      const field = FPS_FIELDS[workflow[id].class_type]
      if (field && typeof workflow[id].inputs?.[field] === 'number') bind(id, field, 'fps')
    }
  }

  // ── 步数 / CFG（仅设置里明确填写时）────────────────────────
  if (enabled && options.steps && !existing.has('steps')) {
    const steps = Math.round(options.steps)
    for (const id of ids) {
      const inputs = workflow[id].inputs || {}
      if (typeof inputs.steps !== 'number' || !SAMPLER_RE.test(workflow[id].class_type) && !/scheduler/i.test(workflow[id].class_type)) continue
      const oldSteps = inputs.steps
      bind(id, 'steps', 'steps', steps, 'override')
      // KSamplerAdvanced 两段采样：按比例换算分段点
      for (const field of ['start_at_step', 'end_at_step']) {
        const v = inputs[field]
        if (typeof v === 'number' && v > 0 && v < 10000 && oldSteps > 0) {
          bind(id, field, 'steps', Math.round((v * steps) / oldSteps), 'override')
        }
      }
    }
  }
  if (enabled && options.cfg != null && Number.isFinite(options.cfg) && !existing.has('cfg')) {
    for (const id of ids) {
      if (typeof workflow[id].inputs?.cfg === 'number' && SAMPLER_RE.test(workflow[id].class_type)) bind(id, 'cfg', 'cfg', options.cfg, 'override')
    }
  }

  // ── 模型文件 ───────────────────────────────────────────
  const loaderIds = ids.filter((id) => MAIN_LOADERS[workflow[id].class_type])
  for (const id of loaderIds) {
    const input = MAIN_LOADERS[workflow[id].class_type]
    report.loaders.push({ node_id: id, class_type: workflow[id].class_type, input, value: workflow[id].inputs?.[input] })
  }
  const files = options.modelFiles ?? splitModelFiles(options.model)
  if (files.length && loaderIds.length) {
    const writable = loaderIds.filter((id) => {
      const v = workflow[id].inputs?.[MAIN_LOADERS[workflow[id].class_type]]
      // {{model}} 已经由占位符替换，不重复覆盖
      return !(typeof v === 'string' && /\{\{\s*model\s*\}\}/i.test(v))
    })
    writable.slice(0, files.length).forEach((id, i) => {
      bind(id, MAIN_LOADERS[workflow[id].class_type], 'model', files[i], 'override')
    })
    if (files.length === 1 && writable.length > 1) {
      report.warnings.push(`工作流有 ${writable.length} 个主模型加载节点，只替换了第 1 个；双模型（如 Wan 2.2 14B 高 / 低噪声）请在「模型」里写成「高噪声文件|低噪声文件」`)
    }
  } else if (options.model && !files.length && kind === 'video' && loaderIds.length && !existing.has('model')) {
    // 视频「模型」是显示名（如 wan2.2-ti2v-5b）：工作流里的模型文件保持不变
  }

  // ── 模型文件清单 / 输出节点 / 提醒 ──────────────────────────
  for (const id of ids) {
    const node = workflow[id]
    for (const [input, value] of Object.entries(node.inputs || {})) {
      if (typeof value === 'string' && MODEL_FILE_RE.test(value)) report.model_files.push({ node_id: id, class_type: node.class_type, input, value })
    }
    if (OUTPUT_RE.test(node.class_type)) report.outputs.push({ node_id: id, class_type: node.class_type, title: nodeTitle(node) })
  }
  if (!report.outputs.length) {
    report.warnings.push(kind === 'video'
      ? '没有找到保存视频的节点：请在末尾加 SaveVideo（或 VHS_VideoCombine）'
      : '没有找到保存图片的节点：请在末尾加 SaveImage')
  } else if (kind === 'video' && report.outputs.every((o) => /AnimatedWEBP|AnimatedPNG|PreviewImage|SaveImage/i.test(o.class_type))) {
    report.warnings.push('工作流只输出图片 / 动图，UU889-Drama 需要 mp4：请改用 SaveVideo 或 VHS_VideoCombine（format 选 video/h264-mp4）')
  }
  const boundTargets = new Set(report.bindings.map((b) => b.target))
  if (kind === 'video' && !['image', 'first_frame', 'last_frame'].some((k) => boundTargets.has(k)) && ![...boundTargets].some((k) => k.startsWith('reference_image_'))) {
    report.warnings.push('工作流里没有图片输入节点（LoadImage）：分镜的首帧 / 参考图不会被使用，只按提示词生成')
  }
  if (!boundTargets.has('seed')) report.warnings.push('没有找到种子字段：每次生成的随机种子由工作流自己决定')

  return { workflow, report }
}
