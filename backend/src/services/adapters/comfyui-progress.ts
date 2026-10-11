/**
 * ComfyUI 实时进度：订阅 ComfyUI 的 WebSocket（/ws?clientId=），按 prompt_id 记录执行到哪个节点、采样第几步。
 *
 * ComfyUI 只把执行事件（executing / progress / executed …）发给提交该任务时的 client_id，
 * 所以每个 ComfyUI 地址用一个固定的 clientId 建一条连接，提交 /prompt 时带同一个 client_id。
 * WebSocket 连不上（老版本、反向代理不支持）时不影响生成：进度退化为「排队位置 + 已等待时长」。
 */
import { randomBytes } from 'node:crypto'
import type { AIConfig } from './types'
import { comfyAuthHeaders } from './comfyui-common'
import { formatEta, stagePercent, type TaskProgressPatch } from '../task-progress'

/** 会产生逐步进度（progress 事件）的采样类节点 */
const SAMPLER_CLASS_RE = /sampler|WanVideoSampler|SamplerCustom/i

/** 常见节点的中文名（未列出的用节点标题 / class_type） */
const NODE_LABELS: Record<string, string> = {
  CheckpointLoaderSimple: '加载 Checkpoint 模型',
  UNETLoader: '加载扩散模型',
  UnetLoaderGGUF: '加载扩散模型（GGUF）',
  CLIPLoader: '加载文本编码器',
  DualCLIPLoader: '加载文本编码器',
  VAELoader: '加载 VAE',
  CLIPVisionLoader: '加载 CLIP Vision',
  LoraLoader: '加载 LoRA',
  LoraLoaderModelOnly: '加载 LoRA',
  CLIPTextEncode: '编码提示词',
  LoadImage: '读取参考图',
  ImageScale: '缩放参考图',
  CLIPVisionEncode: '编码参考图',
  WanImageToVideo: '准备图生视频条件',
  WanFirstLastFrameToVideo: '准备首尾帧条件',
  Wan22ImageToVideoLatent: '准备视频潜空间',
  EmptyHunyuanLatentVideo: '准备视频潜空间',
  EmptyLatentImage: '准备潜空间',
  EmptySD3LatentImage: '准备潜空间',
  ModelSamplingSD3: '设置采样偏移',
  FluxGuidance: '设置引导强度',
  KSampler: '采样',
  KSamplerAdvanced: '采样',
  SamplerCustom: '采样',
  SamplerCustomAdvanced: '采样',
  VAEDecode: 'VAE 解码',
  VAEDecodeTiled: 'VAE 分块解码',
  CreateVideo: '合成视频',
  SaveVideo: '保存视频',
  VHS_VideoCombine: '合成并保存视频',
  SaveImage: '保存图片',
  PreviewImage: '预览图片',
}

export interface ComfyPromptMeta {
  nodeTotal: number
  samplerIds: string[]
  titles: Record<string, string>
  classes: Record<string, string>
  /** 视频任务（解码 / 合成阶段的说明不同） */
  kind: 'image' | 'video'
}

interface PromptState {
  meta: ComfyPromptMeta
  /** 实时推送进度（收到 WebSocket 事件时调用，节流 400ms） */
  report?: (patch: TaskProgressPatch) => void
  lastReportAt: number
  reportTimer: NodeJS.Timeout | null
  started: boolean
  finished: boolean
  executing: string | null
  done: Set<string>
  cached: Set<string>
  progress: { node: string; value: number; max: number } | null
  /** 每个采样节点开始计步的时间与起始步，用于估算速度 */
  rate: Map<string, { t0: number; v0: number; t: number; v: number }>
  /** 已完成采样节点用时（秒/步），给后续采样段估算 */
  secondsPerStep: number | null
  lastEventAt: number
  queue: { ahead: number; total: number; running: boolean } | null
}

const monitors = new Map<string, ComfyMonitor>()

export function comfyMonitorFor(config: AIConfig): ComfyMonitor {
  const base = (config.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '')
  const key = `${base}\u0000${config.apiKey || ''}`
  let monitor = monitors.get(key)
  if (!monitor) {
    monitor = new ComfyMonitor(base, config)
    monitors.set(key, monitor)
  }
  return monitor
}

export function describeComfyPromptMeta(workflow: Record<string, any>, kind: 'image' | 'video'): ComfyPromptMeta {
  const titles: Record<string, string> = {}
  const classes: Record<string, string> = {}
  const samplerIds: string[] = []
  for (const [id, node] of Object.entries(workflow)) {
    classes[id] = String(node?.class_type || '')
    titles[id] = String(node?._meta?.title || '')
    if (SAMPLER_CLASS_RE.test(classes[id]) && !/select|scheduler/i.test(classes[id])) samplerIds.push(id)
  }
  samplerIds.sort((a, b) => Number(a) - Number(b))
  return { nodeTotal: Object.keys(workflow).length, samplerIds, titles, classes, kind }
}

export class ComfyMonitor {
  readonly clientId = `uu889-drama-${randomBytes(4).toString('hex')}`
  private ws: any = null
  private connecting: Promise<boolean> | null = null
  private prompts = new Map<string, PromptState>()
  private retryTimer: NodeJS.Timeout | null = null
  private failures = 0
  /** WebSocket 不可用（环境不支持 / 连续失败）时不再尝试，进度退化为排队信息 */
  private disabled = false

  constructor(private base: string, private config: AIConfig) {}

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === 1
  }

  /** 提交前调用：尽量先连上，保证执行事件发到这条连接；最多等 3 秒 */
  async ensureConnected(timeoutMs = 3000): Promise<boolean> {
    if (this.disabled) return false
    if (this.connected) return true
    if (!this.connecting) this.connecting = this.connect(timeoutMs).finally(() => { this.connecting = null })
    return this.connecting
  }

  track(promptId: string, meta: ComfyPromptMeta, report?: (patch: TaskProgressPatch) => void) {
    this.prompts.set(promptId, {
      meta,
      report,
      lastReportAt: 0,
      reportTimer: null,
      started: false,
      finished: false,
      executing: null,
      done: new Set(),
      cached: new Set(),
      progress: null,
      rate: new Map(),
      secondsPerStep: null,
      lastEventAt: Date.now(),
      queue: null,
    })
    void this.ensureConnected()
  }

  untrack(promptId: string) {
    const state = this.prompts.get(promptId)
    if (state?.reportTimer) clearTimeout(state.reportTimer)
    this.prompts.delete(promptId)
    if (!this.prompts.size && this.ws) {
      // 没有任务时保持连接也无妨，但长时间空闲就关掉，避免占用
      setTimeout(() => {
        if (!this.prompts.size && this.ws) {
          try { this.ws.close() } catch { /* ignore */ }
          this.ws = null
        }
      }, 60_000).unref?.()
    }
  }

  setQueue(promptId: string, queue: { ahead: number; total: number; running: boolean } | null) {
    const state = this.prompts.get(promptId)
    if (state) state.queue = queue
  }

  private async connect(timeoutMs: number): Promise<boolean> {
    const WS = (globalThis as any).WebSocket
    if (typeof WS !== 'function') {
      this.disabled = true
      return false
    }
    const url = `${this.base.replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(this.clientId)}`
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      let ws: any
      try {
        const headers = comfyAuthHeaders(this.config)
        // Node 内置 WebSocket（undici）支持 headers；不支持时退回无头连接
        try {
          ws = Object.keys(headers).length ? new WS(url, { headers }) : new WS(url)
        } catch {
          ws = new WS(url)
        }
      } catch {
        this.scheduleRetry()
        finish(false)
        return
      }
      ws.binaryType = 'arraybuffer'
      const timer = setTimeout(() => {
        try { ws.close() } catch { /* ignore */ }
        finish(false)
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        this.ws = ws
        this.failures = 0
        finish(true)
      }
      ws.onmessage = (event: any) => {
        if (typeof event.data !== 'string') return // 预览图等二进制帧
        try {
          this.handle(JSON.parse(event.data))
        } catch { /* ignore malformed */ }
      }
      ws.onerror = () => { /* onclose 统一处理 */ }
      ws.onclose = () => {
        clearTimeout(timer)
        if (this.ws === ws) this.ws = null
        finish(false)
        if (this.prompts.size) this.scheduleRetry()
      }
    })
  }

  private scheduleRetry() {
    if (this.retryTimer || this.disabled) return
    this.failures++
    if (this.failures > 30) {
      this.disabled = true
      return
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.failures, 5))
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.prompts.size) void this.ensureConnected(5000)
    }, delay)
    this.retryTimer.unref?.()
  }

  /** 处理 ComfyUI 推送的一条事件 */
  handle(msg: { type?: string; data?: any }) {
    const data = msg?.data || {}
    const state = data.prompt_id ? this.prompts.get(String(data.prompt_id)) : null
    if (!state) return
    state.lastEventAt = Date.now()
    switch (msg.type) {
      case 'execution_start':
        state.started = true
        state.queue = null
        break
      case 'execution_cached':
        for (const id of data.nodes || []) state.cached.add(String(id))
        state.started = true
        break
      case 'executing': {
        state.started = true
        state.queue = null
        if (state.executing && state.executing !== data.node) this.finishNode(state, state.executing)
        if (data.node == null) {
          state.finished = true
          state.executing = null
        } else {
          state.executing = String(data.node)
          if (state.progress && state.progress.node !== state.executing) state.progress = null
        }
        break
      }
      case 'progress': {
        const node = String(data.node ?? state.executing ?? '')
        const value = Number(data.value)
        const max = Number(data.max)
        if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) break
        state.progress = { node, value, max }
        const now = Date.now()
        const r = state.rate.get(node)
        if (!r || value < r.v) state.rate.set(node, { t0: now, v0: value, t: now, v: value })
        else { r.t = now; r.v = value }
        break
      }
      case 'progress_state': {
        // 新版 ComfyUI：一次给出所有节点的进度
        for (const [id, info] of Object.entries<any>(data.nodes || {})) {
          if (info?.state === 'finished') state.done.add(String(id))
          else if (info?.state === 'running' && Number(info.max) > 1) {
            state.executing = String(id)
            this.handle({ type: 'progress', data: { prompt_id: data.prompt_id, node: id, value: info.value, max: info.max } })
          }
        }
        break
      }
      case 'executed':
        if (data.node != null) this.finishNode(state, String(data.node))
        break
      case 'execution_success':
        state.finished = true
        break
      default:
        break
    }
    this.push(String(data.prompt_id), state)
  }

  /** 把最新进度推给任务（节流：最多每 400ms 一次，最后一次一定会推出去） */
  private push(promptId: string, state: PromptState) {
    if (!state.report) return
    const emit = () => {
      state.reportTimer = null
      state.lastReportAt = Date.now()
      const patch = this.describe(promptId)
      if (patch && this.prompts.has(promptId)) {
        try { state.report!(patch) } catch { /* ignore */ }
      }
    }
    const wait = 400 - (Date.now() - state.lastReportAt)
    if (wait <= 0) emit()
    else if (!state.reportTimer) {
      state.reportTimer = setTimeout(emit, wait)
      state.reportTimer.unref?.()
    }
  }

  private finishNode(state: PromptState, nodeId: string) {
    state.done.add(nodeId)
    const r = state.rate.get(nodeId)
    if (r && r.v > r.v0 && r.t > r.t0) state.secondsPerStep = (r.t - r.t0) / 1000 / (r.v - r.v0)
  }

  /** 当前进度 → 任务进度补丁；没有任何信息时返回 null */
  describe(promptId: string): TaskProgressPatch | null {
    const state = this.prompts.get(promptId)
    if (!state) return null
    const { meta } = state

    if (!state.started) {
      if (state.queue && !state.queue.running) {
        const ahead = state.queue.ahead
        return {
          stage: 'queued',
          message: ahead > 0 ? `ComfyUI 排队中：前面还有 ${ahead} 个任务` : 'ComfyUI 排队中：下一个就轮到它',
          detail: { queue_ahead: ahead, queue_total: state.queue.total },
        }
      }
      if (!state.queue) return null
      // 在 running 列表里但还没收到事件（WebSocket 不可用）
      return { stage: 'running', message: this.connected ? 'ComfyUI 开始执行' : 'ComfyUI 正在执行（未连上 WebSocket，无法显示细节进度）' }
    }

    const completed = new Set([...state.done, ...state.cached])
    const nodesDone = Math.min(meta.nodeTotal, completed.size)
    const samplerTotal = meta.samplerIds.length
    const samplersDone = meta.samplerIds.filter((id) => completed.has(id)).length
    const current = state.executing
    const progress = state.progress && state.progress.node === current ? state.progress : null
    const currentFrac = progress ? progress.value / progress.max : 0
    const currentIsSampler = !!current && meta.samplerIds.includes(current)

    let fraction: number
    if (samplerTotal) {
      const others = Math.max(1, meta.nodeTotal - samplerTotal)
      const otherDone = Math.min(others, nodesDone - samplersDone)
      fraction = 0.1 * (otherDone / others) + 0.88 * ((samplersDone + (currentIsSampler ? currentFrac : 0)) / samplerTotal)
      if (samplersDone === samplerTotal) fraction = Math.max(fraction, 0.9)
    } else {
      fraction = (nodesDone + currentFrac) / Math.max(1, meta.nodeTotal)
    }
    if (state.finished) fraction = 1

    const detail: Record<string, any> = {
      nodes_done: nodesDone,
      nodes_total: meta.nodeTotal,
    }
    let message = state.finished ? 'ComfyUI 执行完成，读取结果' : 'ComfyUI 生成中'
    let eta: number | null = null
    if (current) {
      const cls = meta.classes[current] || ''
      const label = NODE_LABELS[cls] || meta.titles[current] || cls
      const title = meta.titles[current] && meta.titles[current] !== label ? `「${meta.titles[current]}」` : ''
      detail.node_id = current
      detail.node_class = cls
      detail.node_title = meta.titles[current] || label
      message = `正在执行：${label}${title}（${cls}）`
      if (progress) {
        detail.step = progress.value
        detail.steps = progress.max
        if (currentIsSampler && samplerTotal) {
          detail.sampler_index = meta.samplerIds.indexOf(current) + 1
          detail.sampler_total = samplerTotal
        }
        const r = state.rate.get(current)
        const sps = r && r.v > r.v0 && r.t > r.t0 ? (r.t - r.t0) / 1000 / (r.v - r.v0) : state.secondsPerStep
        if (sps) {
          eta = (progress.max - progress.value) * sps
          // 后面还有采样段时按同样步速估算
          if (currentIsSampler) {
            const remainingSamplers = meta.samplerIds.filter((id) => id !== current && !completed.has(id)).length
            eta += remainingSamplers * progress.max * sps
          }
        }
        const samplerText = detail.sampler_total > 1 ? `第 ${detail.sampler_index}/${detail.sampler_total} 段` : ''
        message = currentIsSampler
          ? `采样中${samplerText ? `（${samplerText}）` : ''}：第 ${progress.value}/${progress.max} 步`
          : `${label}：${progress.value}/${progress.max}`
      } else if (/Loader/i.test(cls)) {
        message += ' — 首次加载模型需要几十秒到几分钟'
      } else if (meta.kind === 'video' && /VAEDecode/i.test(cls)) {
        message += ' — 把潜空间解码成视频帧'
      } else if (/CreateVideo|SaveVideo|VideoCombine/i.test(cls)) {
        message += ' — 编码 mp4'
      }
    } else if (samplerTotal && samplersDone === samplerTotal && !state.finished) {
      message = meta.kind === 'video' ? '采样完成，解码并合成视频' : '采样完成，解码保存图片'
    }
    if (eta != null && Number.isFinite(eta)) {
      detail.eta_seconds = Math.round(eta)
      message += `，预计还需 ${formatEta(eta)}`
    }
    return { stage: 'running', percent: stagePercent('running', fraction), message, detail, replaceDetail: true }
  }
}

/** /queue 返回 → 任务的排队位置；不在队列里返回 null */
export function comfyQueuePosition(queue: any, promptId: string): { ahead: number; total: number; running: boolean } | null {
  const running: any[] = Array.isArray(queue?.queue_running) ? queue.queue_running : []
  const pending: any[] = Array.isArray(queue?.queue_pending) ? queue.queue_pending : []
  if (running.some((item) => Array.isArray(item) && String(item[1]) === promptId)) {
    return { ahead: 0, total: running.length + pending.length, running: true }
  }
  const sorted = [...pending].filter(Array.isArray).sort((a, b) => Number(a[0]) - Number(b[0]))
  const index = sorted.findIndex((item) => String(item[1]) === promptId)
  if (index < 0) return null
  return { ahead: running.length + index, total: running.length + pending.length, running: false }
}
