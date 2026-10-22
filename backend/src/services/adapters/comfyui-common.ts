/**
 * ComfyUI 原生 HTTP API 公共部分（视频 / 图片适配器共用）
 * 上传: POST /upload/image（multipart: image, type=input, overwrite=true）→ { name, subfolder }
 * 提交: POST /prompt { prompt: <API 格式工作流>, client_id } → { prompt_id, node_errors }
 * 轮询: GET  /history/{prompt_id} → 执行结束前为 {}；结束后 { [id]: { status, outputs } }
 *       history 为空时再查 /queue，两处都没有即任务丢失（ComfyUI 重启 / 被删）
 * 取回: GET  /view?filename=&subfolder=&type=output
 *
 * 工作流里的 {{占位符}} 在提交前替换：字段值恰好是一个占位符时按类型替换（数字占位符写入数字）。
 * 图片占位符没有对应素材时，引用它的节点（如 LoadImage）连同只依赖它的下游节点一起移除，
 * 必填输入被断开的节点（按 /object_info 判断）也一并移除，其余指向被移除节点的连线删掉。
 */
import type { AIConfig, DownloadRequest, GenerateContext, ProviderRequest, RetryContext } from './types'
import { loadReferenceFile } from './media'
import { autoBindComfyWorkflow, type ComfyBindOptions } from './comfyui-bind'
import { comfyMonitorFor, comfyQueuePosition, describeComfyPromptMeta } from './comfyui-progress'
import { stagePercent, type TaskProgressPatch } from '../task-progress'

/** WebSocket 不可用时提交用的 client_id（与进度订阅的 clientId 不同也能正常生成） */
const COMFYUI_CLIENT_ID = 'uu889-drama'

const NUMERIC_PLACEHOLDERS = new Set(['seed', 'width', 'height', 'duration', 'fps', 'frames', 'length', 'steps', 'cfg'])
const TEXT_PLACEHOLDERS = new Set(['prompt', 'negative_prompt', 'aspect_ratio', 'resolution', 'model', 'shot_type', 'frame_type'])
const IMAGE_PLACEHOLDER_RE = /^(image|first_frame|last_frame|reference_image_\d+)$/
/**
 * 缺图时整个节点要「短路」的节点：图片 / 音频都没接时这个节点会报错（如 MiniMaxH3AddGuide「needs an image or an audio」），
 * 所以把它从链路里摘掉，下游改接它的 through 输入（原样往下传）。
 */
const BYPASS_WITHOUT_MEDIA: Record<string, { through: string; media: string[] }> = {
  MiniMaxH3AddGuide: { through: 'positive', media: ['image', 'audio'] },
}
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

/**
 * 本地 ComfyUI 串行出图 / 出片，批量提交时后面的任务要排很久：轮询上限放宽到 6 小时。
 * 每 3 秒查一次（本地服务，开销很小），排队位置与完成状态更及时；执行细节由 WebSocket 实时推送。
 */
export const COMFYUI_POLL_PROFILE = { attempts: 7200, intervalMs: 3_000, maxDurationMs: null }

export type ComfyPlaceholderValues = Record<string, string | number | undefined>

/** 节点类型的必填输入名（来自 ComfyUI /object_info），用于判断删掉一条连线后节点是否还能运行 */
export type ComfyRequiredInputs = Record<string, string[] | undefined>

export interface ComfyOutputFile {
  filename: string
  subfolder: string
  type: string
}

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
      // 图片 / 音频都没了的引导节点：下游改接它的 through 输入，再移除它
      const bypass = BYPASS_WITHOUT_MEDIA[node.class_type]
      const through = bypass ? node.inputs?.[bypass.through] : null
      if (bypass && isLink(through) && !pruned.has(String(through[0]))
        && bypass.media.every((k) => !isLink(node.inputs?.[k]) || pruned.has(String(node.inputs[k][0])))) {
        for (const [otherId, other] of Object.entries(workflow)) {
          if (otherId === nodeId) continue
          for (const [key, value] of Object.entries(other?.inputs || {})) {
            if (isLink(value) && String(value[0]) === nodeId && value[1] === 0) other.inputs[key] = [through[0], through[1]]
          }
        }
        pruned.add(nodeId)
        changed = true
        continue
      }
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

/** 各加载节点读取模型的目录（相对 ComfyUI 根目录），用于报错时告诉用户文件该放哪 */
const LOADER_FOLDERS: Record<string, string> = {
  CheckpointLoaderSimple: 'models/checkpoints',
  UNETLoader: 'models/diffusion_models',
  CLIPLoader: 'models/text_encoders',
  DualCLIPLoader: 'models/text_encoders',
  TripleCLIPLoader: 'models/text_encoders',
  VAELoader: 'models/vae',
  CLIPVisionLoader: 'models/clip_vision',
  LoraLoader: 'models/loras',
  LoraLoaderModelOnly: 'models/loras',
  ControlNetLoader: 'models/controlnet',
  UpscaleModelLoader: 'models/upscale_models',
}

const MODEL_FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i
// safetensors / torch 读到截断或损坏文件时的典型报错
const CORRUPT_FILE_RE = /incomplete metadata|not fully covered|deserializ|header ?too ?large|invalid header|unexpected end of file|PytorchStreamReader|central directory|MetadataIncompleteBuffer|safetensors_rust/i
const OUT_OF_MEMORY_RE = /out of memory|OutOfMemory|CUDA error: out of memory|allocation on device/i
/**
 * 显存不足时自动重试的次数：① 释放显存 ② 重启 ComfyUI（没有 Manager 时再释放一次）
 * ③ 还是不行就降到 480p 再试一次（分辨率已经不高于 480p 时不做这一步）
 */
export const COMFY_OOM_RETRIES = 3
/** 显存不足最后一招降到的短边 */
export const COMFY_OOM_SHORT_EDGE = 480

/** 显存不足时是否允许降到 480p 重试：配置 oom_lower_resolution，默认开 */
export function oomLowerResolutionEnabled(settings: Record<string, any> | null | undefined): boolean {
  const v = settings?.oom_lower_resolution
  return !(v === false || v === 'false' || v === 0)
}

/**
 * 把 /prompt 请求里的视频画布降到短边 short（就地修改）：找同时带数字 width / height / length 的节点
 * （MiniMaxH3ReferenceToVideo / WanImageToVideo / Wan22ImageToVideoLatent / EmptyHunyuanLatentVideo 等视频潜空间节点），
 * 保持宽高比，长边取 32 的倍数。已经不高于 short 时返回 null。
 */
export function shrinkComfyVideoCanvas(body: any, short = COMFY_OOM_SHORT_EDGE): { from: string; to: string } | null {
  const workflow = body?.prompt
  if (!workflow || typeof workflow !== 'object') return null
  let changed: { from: string; to: string } | null = null
  for (const node of Object.values<any>(workflow)) {
    const inp = node?.inputs
    if (!inp || typeof inp.width !== 'number' || typeof inp.height !== 'number' || typeof inp.length !== 'number') continue
    const { width: w, height: h } = inp
    if (!(w > 0 && h > 0) || Math.min(w, h) <= short) continue
    const ratio = w / h
    const long = Math.max(short, Math.round((short * Math.max(ratio, 1 / ratio)) / 32) * 32)
    const next = ratio >= 1 ? { width: long, height: short } : { width: short, height: long }
    changed ||= { from: `${w}×${h}`, to: `${next.width}×${next.height}` }
    inp.width = next.width
    inp.height = next.height
  }
  return changed
}

export function isComfyOutOfMemory(text: string | null | undefined): boolean {
  return OUT_OF_MEMORY_RE.test(String(text || ''))
}

function toGb(num: string, unit: string): number {
  const n = Number(num)
  return /^M/i.test(unit) ? n / 1024 : /^K/i.test(unit) ? n / 1048576 : n
}

function fmtGb(gb: number): string {
  return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${gb.toFixed(1)} GB`
}

/**
 * PyTorch 的 CUDA OOM 原文（「Tried to allocate … GPU 0 has a total capacity of … of which … is free.
 * Process N has … memory in use. Including non-PyTorch memory, this process has … memory in use.」）
 * → 先说结论和怎么办，原文放最后（任务卡片只显示前几行）。
 */
export function describeComfyOutOfMemory(nodeType: string, message: string): string {
  const num = '([\\d.]+)\\s*([KMG]i?B)'
  const total = new RegExp(`total capacity of ${num}`, 'i').exec(message)
  const free = new RegExp(`of which ${num} is free`, 'i').exec(message)
  const self = new RegExp(`this process has ${num} memory in use`, 'i').exec(message)
  const procs = [...message.matchAll(new RegExp(`Process (\\d+) has ${num} memory in use`, 'gi'))]
    .map((m) => ({ pid: m[1], gb: toGb(m[2], m[3]) }))
  const selfGb = self ? toGb(self[1], self[2]) : null
  const parts: string[] = []
  if (total) parts.push(`显卡共 ${fmtGb(toGb(total[1], total[2]))}${free ? `，只剩 ${fmtGb(toGb(free[1], free[2]))}` : ''}`)
  if (selfGb != null) {
    parts.push(`ComfyUI 自己占用 ${fmtGb(selfGb)}`)
    const others = procs.filter((p) => Math.abs(p.gb - selfGb) > 0.5)
    if (others.length) parts.push(`其他程序占用 ${others.map((p) => `${fmtGb(p.gb)}（进程 ${p.pid}）`).join('、')}`)
  } else if (procs.length) {
    parts.push(`占用显存的进程：${procs.map((p) => `${p.pid} 占 ${fmtGb(p.gb)}`).join('、')}（如果不是 ComfyUI，就是同一张显卡上的其他程序）`)
  }
  const where = nodeType ? `（${nodeType} 加载时）` : ''
  return [
    `ComfyUI 显存不足${where}${parts.length ? `：${parts.join('，')}` : ''}。`,
    '处理办法：① 关掉同一张显卡上的其他程序（SD WebUI / Fooocus / 另一个 ComfyUI / 本地大模型），或不要同时生成图片和视频；',
    '② ComfyUI 不要用 --highvram / --gpu-only 启动，显存紧张时改用 --lowvram 或 --reserve-vram 4；',
    '③ 降低分辨率或时长，或改用 fp8 / GGUF 量化模型；',
    '④ 连续生成几个视频之后才显存不足，多半是 ComfyUI 没把上一个任务的内存 / 显存释放干净：重启 ComfyUI，启动参数加 --cache-none（不保留上一个任务的中间结果）。',
    `原始错误：${nodeType} ${message}`.trim(),
  ].join('')
}

/**
 * ComfyUI execution_error → 带排查建议的文案。
 * current_inputs 里带着该节点的输入值，可据此指出是哪个模型文件、应该放在哪个目录。
 */
export function describeComfyExecutionError(failure: any): string {
  const nodeType = String(failure?.node_type || '')
  const message = String(failure?.exception_message || '').replace(/\s+/g, ' ').trim()
  const base = `ComfyUI 执行失败：${nodeType} ${message}`.trim()
  const values = Object.values(failure?.current_inputs || {}).flat()
  const file = values.find((v): v is string => typeof v === 'string' && MODEL_FILE_RE.test(v))
  const folder = LOADER_FOLDERS[nodeType]
  const where = `${folder ? `ComfyUI/${folder}/` : ''}${file || '该节点使用的模型文件'}`
  if (CORRUPT_FILE_RE.test(message)) {
    return `${base}；模型文件不完整或已损坏（多为下载中断）：请删除 ${where} 后重新下载，并核对文件大小 / SHA256 与下载页一致`
  }
  if (OUT_OF_MEMORY_RE.test(message)) return describeComfyOutOfMemory(nodeType, message)
  if (file && /no such file|not found|does not exist/i.test(message)) {
    return `${base}；找不到模型文件：请把 ${file} 放到 ComfyUI/${folder || 'models'}/ 下`
  }
  return base
}

/** /prompt 校验错误（node_errors）→ 一行可读文案；模型文件不在列表里时提示应放的目录 */
export function summarizeComfyNodeErrors(nodeErrors: unknown): string {
  if (!nodeErrors || typeof nodeErrors !== 'object') return ''
  return Object.entries(nodeErrors as Record<string, any>)
    .map(([id, e]) => {
      const details = (e?.errors || []).map((x: any) => [x?.message, x?.details].filter(Boolean).join(': ')).filter(Boolean).join('; ')
      const folder = LOADER_FOLDERS[e?.class_type]
      const missingModel = folder && (e?.errors || []).some((x: any) => x?.type === 'value_not_in_list')
      return `#${id} ${e?.class_type || ''}${details ? ` — ${details}` : ''}${missingModel ? `（模型文件不存在：请放到 ComfyUI/${folder}/ 或在工作流里改成已有的文件）` : ''}`.trim()
    })
    .join(' | ')
}

/** 在 history 节点输出里按扩展名找结果文件，score 越高越优先（默认优先 output 目录） */
export function findComfyOutput(
  outputs: Record<string, any> | null | undefined,
  extRe: RegExp,
  score: (file: ComfyOutputFile) => number = (f) => (f.type === 'output' ? 4 : 0),
): ComfyOutputFile | null {
  const candidates: ComfyOutputFile[] = []
  for (const output of Object.values(outputs || {})) {
    if (!output || typeof output !== 'object') continue
    for (const list of Object.values(output)) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        if (item && typeof item === 'object' && typeof item.filename === 'string' && extRe.test(item.filename)) {
          candidates.push({ filename: item.filename, subfolder: String(item.subfolder || ''), type: String(item.type || 'output') })
        }
      }
    }
  }
  candidates.sort((a, b) => score(b) - score(a))
  return candidates[0] || null
}

export function comfyViewPath(file: ComfyOutputFile): string {
  return `/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type }).toString()}`
}

export function comfyAuthHeaders(config: AIConfig): Record<string, string> {
  return config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}
}

/** 本地服务地址 + 路径（/view 带查询串，不能走会改写 pathname 的 joinProviderUrl） */
export function comfyUrl(config: AIConfig, pathWithQuery: string): string {
  const base = (config.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '')
  return `${base}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`
}

/** 一条 history 记录的状态（parsePollResponse 共用） */
export type ComfyHistoryState =
  | { state: 'missing' }
  | { state: 'running' }
  | { state: 'error'; error: string }
  | { state: 'finished'; entry: any }

export function readComfyHistory(result: any): ComfyHistoryState {
  if (result?.__comfyMissing) return { state: 'missing' }
  if (result?.__comfyQueue) return { state: 'running' }
  const entry: any = result && typeof result === 'object' ? Object.values(result)[0] : null
  if (!entry || typeof entry !== 'object') return { state: 'running' }
  const status = entry.status || {}
  if (status.status_str === 'error') {
    const messages: any[] = Array.isArray(status.messages) ? status.messages : []
    const failure = messages.find((m) => m?.[0] === 'execution_error')?.[1]
    const interrupted = messages.some((m) => m?.[0] === 'execution_interrupted')
    return {
      state: 'error',
      error: failure
        ? describeComfyExecutionError(failure)
        : interrupted ? 'ComfyUI 任务被中断' : 'ComfyUI 执行失败',
    }
  }
  // 有输出或已标记完成都算结束；结果文件由各适配器按类型挑选
  if (status.completed || status.status_str === 'success' || Object.keys(entry.outputs || {}).length) {
    return { state: 'finished', entry }
  }
  return { state: 'running' }
}

/** ComfyUI 是否在运行：能连上就算（反向代理在 ComfyUI 没起来时返回的 502 / 503 / 504 不算） */
export async function comfyAlive(config: AIConfig): Promise<boolean> {
  try {
    const resp = await fetch(comfyUrl(config, '/system_stats'), { headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(8_000) })
    // 把响应读完再结束（中途丢弃会让 Windows 上的 ComfyUI 控制台打印 WinError 10054）
    await resp.arrayBuffer().catch(() => null)
    return ![502, 503, 504].includes(resp.status)
  } catch {
    return false
  }
}

/**
 * 等 ComfyUI 回来（被显存不足带崩退出后，用户重启 ComfyUI 或它自己的守护进程拉起来）。
 * 每 5 秒查一次，最多 maxMs；期间通过 report 显示已等待多久。
 */
export async function waitComfyAlive(config: AIConfig, maxMs = 15 * 60_000, report?: (message: string) => void): Promise<boolean> {
  if (await comfyAlive(config)) return true
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const waited = Math.round((Date.now() - started) / 1000)
    report?.(`ComfyUI（${config.baseUrl || 'http://127.0.0.1:8188'}）没有响应，可能已经退出：请重新启动 ComfyUI，启动后自动继续（已等待 ${waited < 60 ? `${waited} 秒` : `${Math.floor(waited / 60)} 分 ${waited % 60} 秒`}，最多等 ${Math.round(maxMs / 60_000)} 分钟）`)
    await new Promise((r) => setTimeout(r, 5_000))
    if (await comfyAlive(config)) return true
  }
  return false
}

/**
 * 连续多久连不上 ComfyUI 就放弃这个任务（交给 prepareRetry 等它回来再重新提交）。
 * 不能太短：ComfyUI 加载大模型、内存吃紧时会卡住好几分钟不响应，此时任务其实还在跑，过早判定会重复提交。
 * ComfyUI 真的重启过的话，恢复连接后队列和历史里都找不到任务，会立即走「任务丢失 → 重新提交」。
 */
export const COMFY_DOWN_GRACE_MS = Number(process.env.COMFY_DOWN_GRACE_MS) || 15 * 60_000
/**
 * 连接被拒绝（端口上没有进程在听）：ComfyUI 已经退出，而不是卡住。不用等 15 分钟，1 分钟后就按任务丢失处理
 * （先拉起 / 等它回来再重新提交）。用户诊断日志里 ComfyUI 闪退（Fatal Python error: Aborted）就是这种。
 */
export const COMFY_EXITED_GRACE_MS = Number(process.env.COMFY_EXITED_GRACE_MS) || 60_000

/** fetch 失败是不是因为连接被拒绝（进程不在了） */
export function isConnectionRefused(err: any): boolean {
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (e.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(e.message || ''))) return true
  }
  return false
}

/**
 * ComfyUI 没在运行时用配置的启动命令把它拉起来（settings.comfy_start_command，如 run_nvidia_gpu.bat 的完整路径）。
 * 只对本机地址生效；同一个配置 3 分钟内只启动一次（启动要加载自定义节点，需要一两分钟）。
 */
const lastStartAt = new Map<string, number>()
export async function startComfyIfConfigured(config: AIConfig, report?: (message: string) => void): Promise<boolean> {
  const command = String(config.settings?.comfy_start_command || '').trim()
  if (!command) return false
  let host = ''
  try { host = new URL(config.baseUrl || 'http://127.0.0.1:8188').hostname.toLowerCase() } catch { return false }
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(host)) return false
  const key = config.baseUrl || 'local'
  if (Date.now() - (lastStartAt.get(key) || 0) < 3 * 60_000) return true
  if (await comfyAlive(config)) return false
  lastStartAt.set(key, Date.now())
  try {
    const { spawn } = await import('node:child_process')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const file = /^".*"$/.test(command) ? command.slice(1, -1) : command
    // 命令就是一个脚本文件时在它所在目录运行（便携包的 .bat 依赖相对路径）
    const cwd = fs.existsSync(file) ? path.dirname(file) : undefined
    const child = spawn(command, { shell: true, detached: true, stdio: 'ignore', cwd, windowsHide: false })
    child.on('error', () => {})
    child.unref()
    report?.(`ComfyUI 没在运行，已用设置里的启动命令重新启动它，等它起来后自动继续：${command}`)
    return true
  } catch {
    return false
  }
}

/**
 * 小显存每隔几个视频重启一次 ComfyUI（需要 ComfyUI-Manager）：连续跑很多个视频后 ComfyUI 进程里的显存 / 内存
 * 越积越多，可用显存掉到 0（模型全部挪到内存里跑，慢一倍以上），最后整个进程崩溃退出。
 * settings.restart_every：数字 = 每 N 个视频重启一次，0 = 不定期重启；不设时 12G 及以下模板每 3 个、16G 每 5 个。
 */
export function restartEveryVideos(settings: Record<string, any> | null | undefined, templateVram: number | null | undefined): number {
  const raw = settings?.restart_every
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  if (!templateVram) return 0
  return templateVram <= 12 ? 3 : templateVram <= 16 ? 5 : 0
}
/** /system_stats：显存 / 内存用量（字节；读不到为 null） */
export async function comfySystemStats(config: AIConfig): Promise<{ vramTotal: number; vramFree: number; ramTotal: number; ramFree: number } | null> {
  try {
    const resp = await fetch(comfyUrl(config, '/system_stats'), { headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(10_000) })
    if (!resp.ok) { await resp.arrayBuffer().catch(() => null); return null }
    const s: any = await resp.json()
    const d = s?.devices?.[0] || {}
    const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    return { vramTotal: n(d.vram_total), vramFree: n(d.vram_free), ramTotal: n(s?.system?.ram_total), ramFree: n(s?.system?.ram_free) }
  } catch {
    return null
  }
}

/**
 * 释放之后 ComfyUI 是否还占着大量显存 / 内存（上一个任务没释放干净，继续跑大概率显存不足或越跑越慢）：
 * 空闲显存不到总量的 60%，或空闲内存不到 10%。
 */
export function comfyMemoryLeftover(stats: { vramTotal: number; vramFree: number; ramTotal: number; ramFree: number } | null): string | null {
  if (!stats) return null
  const gb = (b: number) => `${(b / 1073741824).toFixed(1)} GB`
  if (stats.vramTotal > 0 && stats.vramFree < stats.vramTotal * 0.6) return `显存只剩 ${gb(stats.vramFree)} / ${gb(stats.vramTotal)}`
  if (stats.ramTotal > 0 && stats.ramFree < stats.ramTotal * 0.1) return `内存只剩 ${gb(stats.ramFree)} / ${gb(stats.ramTotal)}`
  return null
}

/** 自动重启 ComfyUI（需要 ComfyUI-Manager）：配置 auto_restart_comfy，默认开 */
export function autoRestartEnabled(settings: Record<string, any> | null | undefined): boolean {
  const v = settings?.auto_restart_comfy
  return !(v === false || v === 'false' || v === 0)
}

/**
 * 通过 ComfyUI-Manager 重启 ComfyUI（整个进程重开，内存 / 显存全部还给系统），等它重新起来。
 * 老版 Manager：GET /api/manager/reboot（/manager/reboot）；新版：/v2/manager/reboot。
 * 返回 'rebooted'（已重启并恢复）/ 'unsupported'（没装 Manager）/ 'forbidden'（Manager 安全级别不允许）/ 'timeout'（重启后没回来）
 */
export async function rebootComfy(config: AIConfig, report?: (message: string) => void): Promise<'rebooted' | 'unsupported' | 'forbidden' | 'timeout'> {
  const paths = ['/api/manager/reboot', '/manager/reboot', '/api/v2/manager/reboot', '/v2/manager/reboot']
  let sent = false
  let forbidden = false
  for (const p of paths) {
    for (const method of ['GET', 'POST']) {
      try {
        const resp = await fetch(comfyUrl(config, p), { method, headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(15_000) })
        await resp.arrayBuffer().catch(() => null)
        if (resp.status === 403) { forbidden = true; break }
        if (resp.status === 404) break
        if (resp.status === 405) continue
        if (resp.ok) { sent = true; break }
      } catch {
        // 请求过程中连接断开：ComfyUI 正在重启
        sent = true
        break
      }
    }
    if (sent) break
  }
  if (!sent) return forbidden ? 'forbidden' : 'unsupported'
  report?.('已让 ComfyUI-Manager 重启 ComfyUI（清空内存和显存），等它重新启动')
  // 先等它真的退出（最多 30 秒），再等它回来（最多 5 分钟）
  const t0 = Date.now()
  while (Date.now() - t0 < 30_000 && (await comfyAlive(config))) await new Promise((r) => setTimeout(r, 1000))
  const back = await waitComfyAlive(config, 5 * 60_000, (m) => report?.(`ComfyUI 重启中：${m}`))
  if (!back) return 'timeout'
  // 刚起来时自定义节点还在加载，稍等一下再提交
  await new Promise((r) => setTimeout(r, 3000))
  return 'rebooted'
}

/** ComfyUI 退出 / 重启导致任务丢失时，等它回来后自动重新提交的次数 */
export const COMFY_RESTART_RETRIES = 2

/**
 * 每个视频任务之间要不要先释放显存（unload_models）：
 * 配置 settings.free_vram_between = true / false 时按配置；没设置时 16G 及以下的内置模板默认释放（代价是每个任务重新加载模型）。
 */
export function shouldFreeVramBetween(settings: Record<string, any> | null | undefined, templateVram: number | null | undefined): boolean {
  const v = settings?.free_vram_between
  if (v === true || v === 'true' || v === 1) return true
  if (v === false || v === 'false' || v === 0) return false
  return !!templateVram && templateVram <= 16
}

async function comfyVramFree(config: AIConfig): Promise<number | null> {
  try {
    const resp = await fetch(comfyUrl(config, '/system_stats'), { headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(10_000) })
    if (!resp.ok) return null
    const stats: any = await resp.json()
    const v = Number(stats?.devices?.[0]?.vram_free)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * 让 ComfyUI 卸载缓存的模型并清空显存缓存（POST /free），可一次处理同一台机器上的多个 ComfyUI。
 * ComfyUI 在当前任务结束后（空闲时立即）处理 /free；等第一个实例的空闲显存真的涨上来（最多 waitMs），
 * 避免重新提交的任务抢在释放之前开始。返回释放了多少字节（查不到时为 null）。
 */
export async function freeComfyMemory(configs: AIConfig[], waitMs = 15_000): Promise<number | null> {
  if (!configs.length) return null
  const before = await comfyVramFree(configs[0])
  await Promise.all(configs.map((c) => fetch(comfyUrl(c, '/free'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...comfyAuthHeaders(c) },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)))
  const started = Date.now()
  let after = before
  while (Date.now() - started < waitMs) {
    await new Promise((r) => setTimeout(r, 1000))
    after = await comfyVramFree(configs[0])
    if (before == null || after == null) {
      if (Date.now() - started >= 3000) break
      continue
    }
    if (after - before > 512 * 1048576) break
  }
  return before != null && after != null ? Math.max(0, after - before) : null
}

export const COMFY_MISSING_ERROR = 'ComfyUI 的队列和历史里都找不到该任务（ComfyUI 可能已退出 / 重启，或任务被删除），请重新生成。如果是 ComfyUI 闪退：在 ComfyUI 配置里填「ComfyUI 启动命令」，它退出后会自动重新启动并接着生成'

/**
 * 视频 / 图片适配器共用的 ComfyUI 客户端：上传素材、渲染并提交工作流、按队列判断任务状态、取消、错误整理。
 * 子类只负责准备占位符取值和挑选结果文件。
 */
export abstract class ComfyUIClient {
  provider = 'comfyui'
  pollProfile = COMFYUI_POLL_PROFILE

  /**
   * 渲染工作流并构造 /prompt 请求：
   * ① 自动绑定（没写占位符的工作流按节点结构识别提示词 / 图片 / 种子 / 尺寸 / 帧数 / FPS / 模型文件）
   * ② 只上传工作流里实际引用到的图片（逐张上报进度）
   * ③ 替换占位符；若有节点被断开连线，查 /object_info 必填输入后重新渲染
   * ④ client_id 用进度订阅连接的 clientId，ComfyUI 才会把执行事件推给我们
   */
  protected async buildPromptRequest(
    config: AIConfig,
    template: Record<string, any>,
    values: ComfyPlaceholderValues,
    imageSources: Record<string, string | undefined>,
    uploadPrefix: string,
    opts: { kind: 'image' | 'video'; bind?: ComfyBindOptions; ctx?: GenerateContext } = { kind: 'video' },
  ): Promise<ProviderRequest> {
    const { workflow: bound } = autoBindComfyWorkflow(template, opts.kind, opts.bind)
    const templateText = JSON.stringify(bound)
    const uploaded = new Map<string, string>()
    const toUpload = Object.entries(imageSources).filter(([key, source]) =>
      source && new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(templateText))
    const distinct = new Set(toUpload.map(([, source]) => source))
    if (distinct.size) {
      opts.ctx?.report({ stage: 'uploading', message: `上传参考图到 ComfyUI（0/${distinct.size}）`, detail: { uploaded: 0, upload_total: distinct.size } })
    }
    for (const [key, source] of toUpload) {
      if (!uploaded.has(source!)) {
        uploaded.set(source!, await this.uploadImage(config, source!, `${uploadPrefix}-${key}`))
        opts.ctx?.report({
          stage: 'uploading',
          percent: stagePercent('uploading', uploaded.size / distinct.size),
          message: `上传参考图到 ComfyUI（${uploaded.size}/${distinct.size}）`,
          detail: { uploaded: uploaded.size, upload_total: distinct.size },
        })
      }
      values[key] = uploaded.get(source!)
    }

    let workflow = renderComfyWorkflow(bound, values)
    const affected = classesWithDroppedLinks(bound, workflow)
    if (affected.length) {
      const required = await this.fetchRequiredInputs(config, affected)
      if (Object.keys(required).length) workflow = renderComfyWorkflow(bound, values, required)
    }

    // 先连上进度 WebSocket 再提交，执行事件才不会丢；连不上也照常生成
    const monitor = comfyMonitorFor(config)
    const live = await monitor.ensureConnected().catch(() => false)
    opts.ctx?.report({ stage: 'submitting', message: `提交工作流到 ComfyUI（${Object.keys(workflow).length} 个节点）` })
    return {
      url: comfyUrl(config, '/prompt'),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...comfyAuthHeaders(config) },
      body: { prompt: workflow, client_id: live ? monitor.clientId : COMFYUI_CLIENT_ID },
    }
  }

  /** 生成图片还是视频（决定自动绑定规则与进度文案） */
  protected abstract readonly mediaKind: 'image' | 'video'

  /** 提交成功：开始跟踪该 prompt 的执行进度（WebSocket 事件实时推给任务进度） */
  onSubmitted(config: AIConfig, taskId: string, request: ProviderRequest, report?: (patch: TaskProgressPatch) => void) {
    const workflow = request?.body?.prompt
    if (!workflow || typeof workflow !== 'object') return
    comfyMonitorFor(config).track(taskId, describeComfyPromptMeta(workflow, this.mediaKind), report)
  }

  onFinished(config: AIConfig, taskId: string) {
    comfyMonitorFor(config).untrack(taskId)
  }

  /**
   * 显存不足：让这台机器上的 ComfyUI 卸载缓存的模型、清空显存缓存，再用同一个工作流重新提交（最多 COMFY_OOM_RETRIES 次）。
   * 常见原因是前面的任务（另一个工作流 / 生图）留在显存里的模型没卸掉，释放后通常就能跑。
   */
  async prepareRetry(config: AIConfig, ctx: RetryContext): Promise<boolean> {
    // ComfyUI 退出 / 重启把任务弄丢了：等它重新启动后用同一个工作流重新提交（上传过的图片还在 input 目录里）
    if (ctx.error === COMFY_MISSING_ERROR) {
      if (ctx.attempt >= COMFY_RESTART_RETRIES) return false
      const n = ctx.attempt + 1
      await startComfyIfConfigured(config, (message) => ctx.report?.({ stage: 'queued', message }))
      const back = await waitComfyAlive(config, 15 * 60_000, (message) => ctx.report?.({ stage: 'queued', message }))
      if (!back) return false
      ctx.report?.({ stage: 'queued', message: `ComfyUI 已恢复，重新提交这个任务（第 ${n}/${COMFY_RESTART_RETRIES} 次）` })
      return true
    }
    if (!isComfyOutOfMemory(ctx.error) || ctx.attempt >= COMFY_OOM_RETRIES) return false
    const n = ctx.attempt + 1
    // 最后一次：释放 + 重启都不够，说明这个镜头本身太大（时长长 / 参考图多 / 分辨率高）：降到 480p 再试
    if (ctx.attempt >= 2) {
      if (!oomLowerResolutionEnabled(config.settings) || !ctx.request) return false
      const shrunk = shrinkComfyVideoCanvas(ctx.request.body)
      if (!shrunk) return false
      ctx.report?.({ stage: 'queued', message: `这个镜头在当前分辨率下显存一直不够，降到 ${COMFY_OOM_SHORT_EDGE}p（${shrunk.from} → ${shrunk.to}）再试（第 ${n}/${COMFY_OOM_RETRIES} 次），出片后可以用「高清化」放大到 1080p` })
      await freeComfyMemory([config, ...ctx.peers])
      ctx.downgraded = shrunk
      return true
    }
    // 释放过一次还是显存不足：ComfyUI 进程里有释放不掉的占用（连续跑多个视频后常见），重启 ComfyUI 最彻底
    if (ctx.attempt === 1 && autoRestartEnabled(config.settings)) {
      ctx.report?.({ stage: 'queued', message: `释放显存后仍然显存不足，自动重启 ComfyUI 后重试（第 ${n}/${COMFY_OOM_RETRIES} 次）` })
      const r = await rebootComfy(config, (message) => ctx.report?.({ stage: 'queued', message }))
      if (r === 'rebooted') {
        ctx.report?.({ stage: 'queued', message: `ComfyUI 已重启，重新提交（第 ${n}/${COMFY_OOM_RETRIES} 次）` })
        return true
      }
      if (r === 'timeout') return false
      ctx.report?.({ stage: 'queued', message: r === 'forbidden' ? 'ComfyUI-Manager 的安全级别不允许远程重启，改为再释放一次显存' : '没有检测到 ComfyUI-Manager，无法自动重启，改为再释放一次显存' })
    }
    ctx.report?.({ stage: 'queued', message: `ComfyUI 显存不足，正在让 ComfyUI 释放缓存的模型后自动重试（第 ${n}/${COMFY_OOM_RETRIES} 次）` })
    const freed = await freeComfyMemory([config, ...ctx.peers])
    ctx.report?.({
      stage: 'queued',
      message: `已让 ComfyUI 释放显存${freed ? `（空出 ${(freed / 1073741824).toFixed(1)} GB）` : ''}，重新提交（第 ${n}/${COMFY_OOM_RETRIES} 次）`,
    })
    return true
  }

  /** 轮询后的细粒度进度：排队位置（来自 /queue）+ 节点 / 采样步数（来自 WebSocket） */
  describeProgress(config: AIConfig, taskId: string, pollResult: any): TaskProgressPatch | null {
    const monitor = comfyMonitorFor(config)
    if (pollResult?.__comfyQueue !== undefined) monitor.setQueue(taskId, pollResult.__comfyQueue)
    const patch = monitor.describe(taskId)
    if (patch) return patch
    const queue = pollResult?.__comfyQueue
    if (queue && !queue.running) {
      return {
        stage: 'queued',
        message: queue.ahead > 0 ? `ComfyUI 排队中：前面还有 ${queue.ahead} 个任务` : 'ComfyUI 排队中：下一个就轮到它',
        detail: { queue_ahead: queue.ahead, queue_total: queue.total },
      }
    }
    if (queue?.running) return { stage: 'running', message: 'ComfyUI 正在执行' }
    return null
  }

  /** 查询节点类型的必填输入；老版本 ComfyUI 或网络失败时返回空表（退回只按连线判断） */
  protected async fetchRequiredInputs(config: AIConfig, classTypes: string[]): Promise<ComfyRequiredInputs> {
    const out: ComfyRequiredInputs = {}
    await Promise.all(classTypes.map(async (classType) => {
      try {
        const resp = await fetch(comfyUrl(config, `/object_info/${encodeURIComponent(classType)}`), {
          headers: comfyAuthHeaders(config),
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

  protected async uploadImage(config: AIConfig, source: string, baseName: string): Promise<string> {
    const file = await loadReferenceFile(source, baseName)
    const form = new FormData()
    form.append('image', file.blob, file.filename)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    const resp = await fetch(comfyUrl(config, '/upload/image'), {
      method: 'POST',
      headers: comfyAuthHeaders(config),
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    if (!resp.ok) throw new Error(`ComfyUI 上传参考图失败（HTTP ${resp.status}）：${(await resp.text()).slice(0, 200)}`)
    const data = await resp.json() as any
    if (!data?.name) throw new Error('ComfyUI 上传参考图未返回文件名')
    return data.subfolder ? `${data.subfolder}/${data.name}` : String(data.name)
  }

  parseGenerateResponse(result: any): { isAsync: boolean; taskId?: string } {
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
      // 工作流用到的节点没装（如低显存模板的 GGUF 加载器）
      const missingNode = body?.error?.extra_info?.class_type
        || /node\s+'?([\w.-]+)'?\s+(?:not found|does not exist)/i.exec(message)?.[1]
        || /because node ([\w.-]+) does not exist/i.exec(message)?.[1]
      if (missingNode && (body?.error?.type === 'missing_node_type' || /not found|does not exist/i.test(message))) {
        const how = /^MiniMaxH3/.test(missingNode)
          ? '这是 ComfyUI 自带的 MiniMax H3 节点，说明 ComfyUI 版本太旧：请把 ComfyUI 更新到最新版（参考图生视频需要 0.30.0 以上，锚定首帧 / 尾帧的 MiniMaxH3AddGuide 需要 0.34.0 以上）后重启'
          : /GGUF/i.test(missingNode)
          ? '这个模板用 GGUF 量化模型，需要安装 ComfyUI-GGUF 插件：ComfyUI-Manager 里搜 ComfyUI-GGUF 安装，或把 https://github.com/city96/ComfyUI-GGUF 克隆到 ComfyUI/custom_nodes 后重启 ComfyUI；不想装插件可以改选 24G 以上的 fp8 / fp16 模板'
          : '请用 ComfyUI-Manager 安装缺少的自定义节点后重启 ComfyUI，或改选不需要插件的模板'
        return `ComfyUI 缺少节点 ${missingNode}：${how}`
      }
      if (!detail && !message) return null
      return `ComfyUI 工作流校验失败（HTTP ${status}）：${[message, detail].filter(Boolean).join(' — ')}`.slice(0, 600)
    } catch {
      return null
    }
  }

  /**
   * /history/{id} 在执行结束前一直是 {}：再看一眼 /queue，任务既不在队列也不在历史里
   * （ComfyUI 重启、任务被删）就立即判失败，而不是等到轮询超时。
   */
  async fetchPollResult(config: AIConfig, taskId: string): Promise<any> {
    try {
      const result = await this.fetchPollResultOnce(config, taskId)
      this.downSince.delete(taskId)
      return result
    } catch (err) {
      // 连不上 ComfyUI：持续超过 COMFY_DOWN_GRACE_MS 就当它已经退出（任务丢失），交给 prepareRetry 等它回来后重新提交，
      // 而不是一直轮询到超时（以前会占着队列好几个小时）
      const since = this.downSince.get(taskId) ?? Date.now()
      this.downSince.set(taskId, since)
      // 连接被拒绝 = 进程已经退出，1 分钟就够；连得上但不响应 = 可能只是卡住，等满 15 分钟
      const grace = isConnectionRefused(err) ? COMFY_EXITED_GRACE_MS : COMFY_DOWN_GRACE_MS
      if (Date.now() - since >= grace) {
        this.downSince.delete(taskId)
        return { __comfyMissing: true, __comfyDown: true }
      }
      throw err
    }
  }

  private downSince = new Map<string, number>()

  private async fetchPollResultOnce(config: AIConfig, taskId: string): Promise<any> {
    const history = await this.fetchJson(config, `/history/${encodeURIComponent(taskId)}`)
    if (history && typeof history === 'object' && Object.keys(history).length) return history
    const queue = await this.fetchJson(config, '/queue')
    const position = comfyQueuePosition(queue, taskId)
    // 仍在队列：带上排队位置（describeProgress 用），readComfyHistory 视为执行中
    if (position) return { __comfyQueue: position }
    // 查队列的间隙里刚好跑完：再查一次历史
    const again = await this.fetchJson(config, `/history/${encodeURIComponent(taskId)}`)
    if (again && typeof again === 'object' && Object.keys(again).length) return again
    return { __comfyMissing: true }
  }

  protected async fetchJson(config: AIConfig, path: string): Promise<any> {
    const resp = await fetch(comfyUrl(config, path), { headers: comfyAuthHeaders(config), signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) throw new Error(`ComfyUI ${path} HTTP ${resp.status}`)
    return resp.json()
  }

  /** 轮询放弃时把任务从队列删掉；若正在执行则中断，避免继续占用显卡 */
  async cancel(config: AIConfig, taskId: string): Promise<void> {
    const post = (path: string, body: unknown) => fetch(comfyUrl(config, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...comfyAuthHeaders(config) },
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
      headers: comfyAuthHeaders(config),
      body: undefined,
    }
  }

  protected download(config: AIConfig, url: string, fallbackExt: string): DownloadRequest {
    const headers = comfyAuthHeaders(config)
    return {
      url: /^https?:\/\//i.test(url) ? url : comfyUrl(config, url),
      headers: Object.keys(headers).length ? headers : undefined,
      fallbackExt,
    }
  }
}
