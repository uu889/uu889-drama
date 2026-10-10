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
import type { AIConfig, DownloadRequest, ProviderRequest } from './types'
import { loadReferenceFile } from './media'

const COMFYUI_CLIENT_ID = 'uu889-drama'

const NUMERIC_PLACEHOLDERS = new Set(['seed', 'width', 'height', 'duration', 'fps', 'frames', 'length', 'steps', 'cfg'])
const TEXT_PLACEHOLDERS = new Set(['prompt', 'negative_prompt', 'aspect_ratio', 'resolution', 'model'])
const IMAGE_PLACEHOLDER_RE = /^(image|first_frame|last_frame|reference_image_\d+)$/
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

// 本地 ComfyUI 串行出图 / 出片，批量提交时后面的任务要排很久：轮询上限放宽到 6 小时
export const COMFYUI_POLL_PROFILE = { attempts: 2160, intervalMs: 10_000, maxDurationMs: null }

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
        ? `ComfyUI 执行失败：${failure.node_type || ''} ${failure.exception_message || ''}`.trim()
        : interrupted ? 'ComfyUI 任务被中断' : 'ComfyUI 执行失败',
    }
  }
  // 有输出或已标记完成都算结束；结果文件由各适配器按类型挑选
  if (status.completed || status.status_str === 'success' || Object.keys(entry.outputs || {}).length) {
    return { state: 'finished', entry }
  }
  return { state: 'running' }
}

export const COMFY_MISSING_ERROR = 'ComfyUI 的队列和历史里都找不到该任务（ComfyUI 可能已重启或任务被删除），请重新生成'

/**
 * 视频 / 图片适配器共用的 ComfyUI 客户端：上传素材、渲染并提交工作流、按队列判断任务状态、取消、错误整理。
 * 子类只负责准备占位符取值和挑选结果文件。
 */
export abstract class ComfyUIClient {
  provider = 'comfyui'
  pollProfile = COMFYUI_POLL_PROFILE

  /**
   * 渲染工作流并构造 /prompt 请求：只上传工作流里实际引用到的图片；
   * 若有节点被断开连线，查 /object_info 必填输入后重新渲染。
   */
  protected async buildPromptRequest(
    config: AIConfig,
    template: Record<string, any>,
    values: ComfyPlaceholderValues,
    imageSources: Record<string, string | undefined>,
    uploadPrefix: string,
  ): Promise<ProviderRequest> {
    const templateText = JSON.stringify(template)
    const uploaded = new Map<string, string>()
    for (const [key, source] of Object.entries(imageSources)) {
      if (!source || !new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(templateText)) continue
      if (!uploaded.has(source)) uploaded.set(source, await this.uploadImage(config, source, `${uploadPrefix}-${key}`))
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
      headers: { 'Content-Type': 'application/json', ...comfyAuthHeaders(config) },
      body: { prompt: workflow, client_id: COMFYUI_CLIENT_ID },
    }
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
