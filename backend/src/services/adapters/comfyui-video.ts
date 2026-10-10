/**
 * 本地 ComfyUI 视频 Adapter（ComfyUI 原生 HTTP API）
 * 上传: POST /upload/image（multipart: image, type=input, overwrite=true）→ { name, subfolder }
 * 提交: POST /prompt { prompt: <API 格式工作流>, client_id } → { prompt_id, node_errors }
 * 轮询: GET  /history/{prompt_id} → 执行结束前为 {}；结束后 { [id]: { status, outputs } }
 * 取回: GET  /view?filename=&subfolder=&type=output
 *
 * 工作流来自配置 settings.comfyui_workflow（ComfyUI「导出 (API)」得到的 JSON），未配置时用内置
 * Wan 2.2 TI2V 5B 模板。工作流里的 {{占位符}} 在提交前替换：
 *   {{prompt}} {{negative_prompt}} {{seed}} {{width}} {{height}} {{duration}} {{fps}} {{frames}}
 *   {{aspect_ratio}} {{resolution}} {{model}}
 *   {{image}}（首帧，无首帧时取第一张参考图）{{first_frame}} {{last_frame}} {{reference_image_1..9}}
 * 字段值恰好是一个占位符时按类型替换（数字占位符写入数字）。
 * 图片占位符没有对应素材时，引用它的节点（如 LoadImage）连同只依赖它的下游节点一起移除，
 * 其余节点里指向被移除节点的连线也删掉——图生视频工作流里可选的 start_image 因此可以同时跑文生视频。
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
import { loadReferenceFile, parseUrlArray } from './media'

export const COMFYUI_DEFAULT_MODEL = 'wan2.2-ti2v-5b'
export const COMFYUI_DEFAULT_FPS = 24
const COMFYUI_CLIENT_ID = 'uu889-drama'
const MAX_REFERENCE_IMAGES = 9

/** Wan 官方推荐的负向提示词 */
export const COMFYUI_DEFAULT_NEGATIVE_PROMPT = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'

/**
 * 内置模板：ComfyUI 官方 Wan 2.2 TI2V 5B（文生 / 图生二合一）。
 * 需要 models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors、
 * models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors、models/vae/wan2.2_vae.safetensors。
 */
export const COMFYUI_DEFAULT_WORKFLOW: Record<string, any> = {
  '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1, model: ['48', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['55', 0] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['38', 0] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['38', 0] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['39', 0] } },
  '37': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: 'default' } },
  '38': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
  '39': { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
  '48': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['37', 0] } },
  '55': { class_type: 'Wan22ImageToVideoLatent', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1, vae: ['39', 0], start_image: ['56', 0] } },
  '56': { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
  '57': { class_type: 'CreateVideo', inputs: { fps: '{{fps}}', images: ['8', 0] } },
  '58': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/uu889-drama', format: 'auto', codec: 'auto', video: ['57', 0] } },
}

const NUMERIC_PLACEHOLDERS = new Set(['seed', 'width', 'height', 'duration', 'fps', 'frames', 'length'])
const TEXT_PLACEHOLDERS = new Set(['prompt', 'negative_prompt', 'aspect_ratio', 'resolution', 'model'])
const IMAGE_PLACEHOLDER_RE = /^(image|first_frame|last_frame|reference_image_\d+)$/
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi
// 只认浏览器 <video> 与 FFmpeg 拼接都能处理的容器；动图（gif / 动态 webp）单独提示
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i
const ANIMATED_IMAGE_EXT_RE = /\.(gif|webp)$/i
// 本地 ComfyUI 串行出片，批量提交时后面的任务要排很久：轮询上限放宽到 6 小时
const COMFYUI_POLL_PROFILE = { attempts: 2160, intervalMs: 10_000 }

export type ComfyPlaceholderValues = Record<string, string | number | undefined>

/** 节点类型的必填输入名（来自 ComfyUI /object_info），用于判断删掉一条连线后节点是否还能运行 */
export type ComfyRequiredInputs = Record<string, string[] | undefined>

/** 解析配置里的工作流（字符串或对象）并校验是 API 格式；为空返回 null */
export function parseComfyWorkflow(raw: unknown): Record<string, any> | null {
  if (raw == null || raw === '') return null
  let parsed: any = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`ComfyUI 工作流不是合法 JSON：${(err as Error).message}`)
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ComfyUI 工作流必须是 JSON 对象')
  }
  if (Array.isArray(parsed.nodes)) {
    throw new Error('这是 ComfyUI 界面格式的工作流，请在 ComfyUI 中用「导出 (API)」/ Export (API) 重新导出')
  }
  // 兼容直接粘贴 /prompt 请求体 { prompt: {...} }
  if (parsed.prompt && typeof parsed.prompt === 'object' && !Array.isArray(parsed.prompt)) parsed = parsed.prompt
  const nodes = Object.values(parsed)
  if (!nodes.length || !nodes.every((n: any) => n && typeof n === 'object' && typeof n.class_type === 'string')) {
    throw new Error('ComfyUI 工作流格式不正确：每个节点都需要 class_type（请使用「导出 (API)」得到的 JSON）')
  }
  return parsed
}

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

/** 帧数：时长 × fps，对齐到 4n+1（Wan 系时间维压缩要求） */
export function comfyFrameCount(durationSeconds: number, fps: number): number {
  const n = Math.max(1, Math.round((durationSeconds * fps) / 4))
  return n * 4 + 1
}

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'
}

/**
 * 替换占位符 + 裁剪缺素材的图片节点，返回可直接提交的工作流副本。
 * requiredInputs（可选，来自 /object_info）：某节点被删掉的连线若是它的必填输入，该节点也一并移除，
 * 否则 ComfyUI 会以 "Required input is missing" 拒绝整个工作流（如 Wan 2.1 I2V 的 CLIPVisionEncode）。
 */
export function renderComfyWorkflow(
  template: Record<string, any>,
  values: ComfyPlaceholderValues,
  requiredInputs: ComfyRequiredInputs = {},
): Record<string, any> {
  const workflow: Record<string, any> = JSON.parse(JSON.stringify(template))
  const pruned = new Set<string>()
  const unknown = new Set<string>()

  const substitute = (value: unknown, nodeId: string): unknown => {
    if (typeof value === 'string') {
      const exact = value.match(/^\{\{\s*([a-z0-9_]+)\s*\}\}$/i)
      if (exact) {
        const key = exact[1].toLowerCase()
        const v = values[key]
        if (v === undefined || v === '') {
          if (IMAGE_PLACEHOLDER_RE.test(key)) pruned.add(nodeId)
          else if (TEXT_PLACEHOLDERS.has(key)) return ''
          else unknown.add(key)
          return value
        }
        return NUMERIC_PLACEHOLDERS.has(key) ? Number(v) : v
      }
      return value.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
        const key = rawKey.toLowerCase()
        const v = values[key]
        if (v === undefined || v === '') {
          if (IMAGE_PLACEHOLDER_RE.test(key)) pruned.add(nodeId)
          else if (TEXT_PLACEHOLDERS.has(key)) return ''
          else unknown.add(key)
          return match
        }
        return String(v)
      })
    }
    if (Array.isArray(value)) return isLink(value) ? value : value.map((item) => substitute(item, nodeId))
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) (value as any)[k] = substitute(v, nodeId)
    }
    return value
  }

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node?.inputs) node.inputs = substitute(node.inputs, nodeId)
  }
  if (unknown.size) {
    throw new Error(`ComfyUI 工作流包含不支持的占位符：${[...unknown].map((k) => `{{${k}}}`).join('、')}`)
  }

  // 级联移除：① 所有连线输入都指向已移除节点（如 LoadImage → ImageScale）；
  // ② 指向已移除节点的连线是该节点的必填输入（需要 requiredInputs）
  let changed = pruned.size > 0
  while (changed) {
    changed = false
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (pruned.has(nodeId)) continue
      const linkEntries = Object.entries(node?.inputs || {}).filter(([, v]) => isLink(v)) as Array<[string, [string, number]]>
      if (!linkEntries.length) continue
      const dangling = linkEntries.filter(([, link]) => pruned.has(String(link[0])))
      if (!dangling.length) continue
      const required = requiredInputs[node.class_type] || []
      if (dangling.length === linkEntries.length || dangling.some(([key]) => required.includes(key))) {
        pruned.add(nodeId)
        changed = true
      }
    }
  }
  for (const nodeId of pruned) delete workflow[nodeId]
  for (const node of Object.values(workflow)) {
    for (const [key, value] of Object.entries(node?.inputs || {})) {
      if (isLink(value) && pruned.has(String(value[0]))) delete node.inputs[key]
    }
  }
  if (!Object.keys(workflow).length) throw new Error('ComfyUI 工作流裁剪后为空')
  return workflow
}

/** 渲染结果里被删掉连线输入的节点类型（需要查询必填输入才能判断是否还能运行） */
export function classesWithDroppedLinks(template: Record<string, any>, rendered: Record<string, any>): string[] {
  const out = new Set<string>()
  for (const [nodeId, node] of Object.entries(rendered)) {
    const original = template[nodeId]?.inputs || {}
    for (const [key, value] of Object.entries(original)) {
      if (isLink(value) && !(key in (node?.inputs || {}))) out.add(node.class_type)
    }
  }
  return [...out]
}

/** /prompt 校验错误（node_errors）→ 一行可读文案 */
export function summarizeComfyNodeErrors(nodeErrors: unknown): string {
  if (!nodeErrors || typeof nodeErrors !== 'object') return ''
  return Object.entries(nodeErrors as Record<string, any>)
    .map(([id, e]) => {
      const details = (e?.errors || []).map((x: any) => [x?.message, x?.details].filter(Boolean).join(': ')).filter(Boolean).join('; ')
      return `#${id} ${e?.class_type || ''}${details ? ` — ${details}` : ''}`.trim()
    })
    .join(' | ')
}

/** 在 history 节点输出里找成片：优先 output 目录、视频扩展名、mp4 */
export function findComfyVideoOutput(outputs: Record<string, any> | null | undefined): { filename: string; subfolder: string; type: string } | null {
  const candidates: Array<{ filename: string; subfolder: string; type: string }> = []
  for (const output of Object.values(outputs || {})) {
    if (!output || typeof output !== 'object') continue
    for (const list of Object.values(output)) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item && typeof item === 'object' && typeof item.filename === 'string' && VIDEO_EXT_RE.test(item.filename)) {
          candidates.push({ filename: item.filename, subfolder: String(item.subfolder || ''), type: String(item.type || 'output') })
        }
      }
    }
  }
  const score = (c: { filename: string; type: string }) =>
    (c.type === 'output' ? 4 : 0) + (/\.mp4$/i.test(c.filename) ? 2 : 0) + (/\.(webm|mov|mkv)$/i.test(c.filename) ? 1 : 0)
  candidates.sort((a, b) => score(b) - score(a))
  return candidates[0] || null
}

function authHeaders(config: AIConfig): Record<string, string> {
  return config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}
}

/** 本地服务地址 + 路径（/view 带查询串，不能走会改写 pathname 的 joinProviderUrl） */
function comfyUrl(config: AIConfig, pathWithQuery: string): string {
  const base = (config.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '')
  return `${base}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`
}

export class ComfyUIVideoAdapter implements VideoProviderAdapter {
  provider = 'comfyui'

  async buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): Promise<ProviderRequest> {
    const settings = config.settings || {}
    const template = parseComfyWorkflow(settings.comfyui_workflow) || COMFYUI_DEFAULT_WORKFLOW
    const templateText = JSON.stringify(template)

    const fpsSetting = Number(settings.comfyui_fps)
    const fps = Number.isFinite(fpsSetting) && fpsSetting > 0 ? Math.round(fpsSetting) : COMFYUI_DEFAULT_FPS
    const durationRaw = Math.round(Number(record.duration || 5))
    const duration = Number.isFinite(durationRaw) ? Math.min(60, Math.max(1, durationRaw)) : 5
    const { width, height } = comfyDimensions(record.aspectRatio, record.resolution)
    const frames = comfyFrameCount(duration, fps)
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

    // 只上传工作流里实际引用到的图片
    const values: ComfyPlaceholderValues = {
      prompt: (record.prompt || '').trim(),
      negative_prompt: typeof settings.comfyui_negative_prompt === 'string' && settings.comfyui_negative_prompt.trim()
        ? settings.comfyui_negative_prompt.trim()
        : COMFYUI_DEFAULT_NEGATIVE_PROMPT,
      seed,
      width,
      height,
      duration,
      fps,
      frames,
      length: frames,
      aspect_ratio: record.aspectRatio || '16:9',
      resolution: record.resolution || '720p',
      model: record.model || config.model || COMFYUI_DEFAULT_MODEL,
    }
    const uploaded = new Map<string, string>()
    for (const [key, source] of Object.entries(imageSources)) {
      if (!source || !new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(templateText)) continue
      if (!uploaded.has(source)) uploaded.set(source, await this.uploadImage(config, source, `uu889-${record.id}-${key}`))
      values[key] = uploaded.get(source)
    }

    let workflow = renderComfyWorkflow(template, values)
    const affected = classesWithDroppedLinks(template, workflow)
    if (affected.length) {
      const required = await this.fetchRequiredInputs(config, affected)
      if (Object.keys(required).length) workflow = renderComfyWorkflow(template, values, required)
    }
    return {
      url: comfyUrl(config, '/prompt'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: { prompt: workflow, client_id: COMFYUI_CLIENT_ID },
    }
  }

  /** 查询节点类型的必填输入；老版本 ComfyUI 或网络失败时返回空表（退回只按连线判断） */
  private async fetchRequiredInputs(config: AIConfig, classTypes: string[]): Promise<ComfyRequiredInputs> {
    const out: ComfyRequiredInputs = {}
    await Promise.all(classTypes.map(async (classType) => {
      try {
        const resp = await fetch(comfyUrl(config, `/object_info/${encodeURIComponent(classType)}`), {
          headers: authHeaders(config),
          signal: AbortSignal.timeout(15_000),
        })
        if (!resp.ok) return
        const info = await resp.json() as any
        const required = info?.[classType]?.input?.required
        if (required && typeof required === 'object') out[classType] = Object.keys(required)
      } catch { /* 忽略：按连线规则裁剪 */ }
    }))
    return out
  }

  private async uploadImage(config: AIConfig, source: string, baseName: string): Promise<string> {
    const file = await loadReferenceFile(source, baseName)
    const form = new FormData()
    form.append('image', file.blob, file.filename)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    const resp = await fetch(comfyUrl(config, '/upload/image'), {
      method: 'POST',
      headers: authHeaders(config),
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    if (!resp.ok) throw new Error(`ComfyUI 上传参考图失败（HTTP ${resp.status}）：${(await resp.text()).slice(0, 200)}`)
    const data = await resp.json() as any
    if (!data?.name) throw new Error('ComfyUI 上传参考图未返回文件名')
    return data.subfolder ? `${data.subfolder}/${data.name}` : String(data.name)
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    // 有 prompt_id 即已入队：部分输出节点校验失败时 ComfyUI 仍会执行其余输出，不能判失败
    if (result?.prompt_id) return { isAsync: true, taskId: String(result.prompt_id) }
    const detail = summarizeComfyNodeErrors(result?.node_errors)
    if (detail) throw new Error(`ComfyUI 工作流校验失败：${detail}`)
    const err = result?.error
    throw new Error(`ComfyUI 未返回 prompt_id${err ? `：${typeof err === 'string' ? err : err.message || JSON.stringify(err)}` : ''}`)
  }

  /** /prompt 返回 400（所有输出都校验失败）时，把 node_errors 整理成可读文案 */
  describeError(status: number, bodyText: string): string | null {
    try {
      const body = JSON.parse(bodyText)
      const detail = summarizeComfyNodeErrors(body?.node_errors)
      const message = body?.error?.message || ''
      if (!detail && !message) return null
      return `ComfyUI 工作流校验失败（HTTP ${status}）：${[message, detail].filter(Boolean).join(' — ')}`.slice(0, 600)
    } catch {
      return null
    }
  }

  pollProfile = COMFYUI_POLL_PROFILE

  /**
   * /history/{id} 在执行结束前一直是 {}：再看一眼 /queue，任务既不在队列也不在历史里
   * （ComfyUI 重启、任务被删）就立即判失败，而不是等到轮询超时。
   */
  async fetchPollResult(config: AIConfig, taskId: string): Promise<any> {
    const history = await this.fetchJson(config, `/history/${encodeURIComponent(taskId)}`)
    if (history && typeof history === 'object' && Object.keys(history).length) return history
    const queue = await this.fetchJson(config, '/queue')
    const inQueue = [...(queue?.queue_running || []), ...(queue?.queue_pending || [])]
      .some((item: any) => Array.isArray(item) && String(item[1]) === taskId)
    if (inQueue) return {}
    // 查队列的间隙里刚好跑完：再查一次历史
    const again = await this.fetchJson(config, `/history/${encodeURIComponent(taskId)}`)
    if (again && typeof again === 'object' && Object.keys(again).length) return again
    return { __comfyMissing: true }
  }

  private async fetchJson(config: AIConfig, path: string): Promise<any> {
    const resp = await fetch(comfyUrl(config, path), { headers: authHeaders(config), signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) throw new Error(`ComfyUI ${path} HTTP ${resp.status}`)
    return resp.json()
  }

  /** 轮询放弃时把任务从队列删掉；若正在执行则中断，避免继续占用显卡 */
  async cancel(config: AIConfig, taskId: string): Promise<void> {
    const post = (path: string, body: unknown) => fetch(comfyUrl(config, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    await post('/queue', { delete: [taskId] })
    const queue = await this.fetchJson(config, '/queue').catch(() => null)
    const running = (queue?.queue_running || []).some((item: any) => Array.isArray(item) && String(item[1]) === taskId)
    if (running) await post('/interrupt', {})
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: comfyUrl(config, `/history/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: authHeaders(config),
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    // /history/{id} 在执行结束前返回 {}（排队 / 生成中）
    if (result?.__comfyMissing) {
      return { status: 'failed', error: 'ComfyUI 的队列和历史里都找不到该任务（ComfyUI 可能已重启或任务被删除），请重新生成' }
    }
    const entry: any = result && typeof result === 'object' ? Object.values(result)[0] : null
    if (!entry || typeof entry !== 'object') return { status: 'processing' }

    const status = entry.status || {}
    if (status.status_str === 'error') {
      const messages: any[] = Array.isArray(status.messages) ? status.messages : []
      const failure = messages.find((m) => m?.[0] === 'execution_error')?.[1]
      const interrupted = messages.some((m) => m?.[0] === 'execution_interrupted')
      const error = failure
        ? `ComfyUI 执行失败：${failure.node_type || ''} ${failure.exception_message || ''}`.trim()
        : interrupted ? 'ComfyUI 任务被中断' : 'ComfyUI 执行失败'
      return { status: 'failed', error }
    }

    const videoUrl = this.extractVideoUrl(result)
    if (videoUrl) return { status: 'completed', videoUrl }
    if (status.completed || status.status_str === 'success') {
      const animatedOnly = Object.values(entry.outputs || {}).some((output: any) => Object.values(output || {})
        .some((list: any) => Array.isArray(list) && list.some((item: any) => ANIMATED_IMAGE_EXT_RE.test(String(item?.filename || '')))))
      return {
        status: 'failed',
        error: animatedOnly
          ? 'ComfyUI 只输出了 GIF / WebP 动图，无法播放和拼接：请改用 SaveVideo 或 VHS_VideoCombine 输出 mp4'
          : 'ComfyUI 工作流已完成但没有视频输出（请确认含 SaveVideo / VHS_VideoCombine 等保存视频的节点）',
      }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const entry: any = result && typeof result === 'object' ? Object.values(result)[0] : null
    const file = findComfyVideoOutput(entry?.outputs)
    if (!file) return null
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })
    return `/view?${query.toString()}`
  }

  resolveDownload(config: AIConfig, videoUrl: string): DownloadRequest {
    const headers = authHeaders(config)
    return {
      url: /^https?:\/\//i.test(videoUrl) ? videoUrl : comfyUrl(config, videoUrl),
      headers: Object.keys(headers).length ? headers : undefined,
      fallbackExt: '.mp4',
    }
  }
}
