/**
 * 本地显卡排队：同一台机器上的本地生成服务（ComfyUI / SD WebUI / Fooocus）一次只交一个任务
 *
 * 批量生成视频时以前是一口气全部提交给 ComfyUI：小显存（12G / 16G）的卡上排队的任务会一个接一个地加载模型、
 * 显存碎片越积越多，常常跑到第二三个就显存不足甚至把 ComfyUI 整个带崩退出。
 * 现在按「主机」排队（127.0.0.1 / localhost 视为同一台）：前一个任务结束（成功 / 失败）后才提交下一个，
 * 等待中的任务在进度里显示「排队第 N 个」。默认每台机器同时 1 个，可在 ComfyUI 配置里改「同时提交任务数」。
 */
import type { AIConfig } from './ai.js'

/** 会占用本机显卡、需要排队的服务商 */
export const LOCAL_GPU_PROVIDERS = new Set(['comfyui', 'sdwebui', 'fooocus'])

interface Waiter {
  taskId: number
  resolve: () => void
  onPosition?: (position: number) => void
}

interface Lane {
  active: Set<number>
  waiters: Waiter[]
  limit: number
  /** 上一个视频任务结束后还没有释放过显存 */
  dirty: boolean
  /** 上次重启 ComfyUI 以来交过几个视频（小显存定期重启用） */
  videosSinceRestart: number
}

const lanes = new Map<string, Lane>()
/** taskId → 所在队列（释放时用） */
const held = new Map<number, { key: string; kind: string }>()

export function hostKey(baseUrl: string | null | undefined): string {
  try {
    const h = new URL(String(baseUrl || 'http://127.0.0.1')).hostname.toLowerCase()
    return ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(h) ? 'local' : h
  } catch {
    return 'local'
  }
}

/** 这个配置要不要排队；要的话返回队列名（按主机） */
export function gpuLaneKey(config: Pick<AIConfig, 'provider' | 'baseUrl'>): string | null {
  if (!LOCAL_GPU_PROVIDERS.has(String(config.provider || '').toLowerCase())) return null
  return `gpu:${hostKey(config.baseUrl)}`
}

/**
 * 云端服务的并发上限：aiask.me 的 Grok 视频转给上游 wokey.ai，上游按账号限制同时生成的视频数，
 * 批量生成时一口气提交十几个，超出的会直接失败。按「服务商 + 主机」排队，同时只交 cloudLaneLimit 个。
 */
const CLOUD_VIDEO_LANES: Record<string, { env: string; fallback: number }> = {
  aiask: { env: 'AIASK_VIDEO_CONCURRENCY', fallback: 2 },
}

/** 云端视频要不要排队；要的话返回队列名 */
export function cloudLaneKey(config: Pick<AIConfig, 'provider' | 'baseUrl'>, type: string): string | null {
  const provider = String(config.provider || '').toLowerCase()
  if (type !== 'video' || !CLOUD_VIDEO_LANES[provider]) return null
  return `cloud:${provider}:${hostKey(config.baseUrl)}:video`
}

/** 云端视频同时提交数：配置里的 max_concurrent（1~8），否则环境变量，再否则默认 2 */
export function cloudLaneLimit(config: Pick<AIConfig, 'provider' | 'settings'>): number {
  const lane = CLOUD_VIDEO_LANES[String(config.provider || '').toLowerCase()]
  const raw = Number(config.settings?.max_concurrent ?? process.env[lane?.env || ''] ?? lane?.fallback ?? 2)
  return Number.isFinite(raw) && raw >= 1 ? Math.min(8, Math.floor(raw)) : (lane?.fallback ?? 2)
}

/** 同时提交任务数：配置里的 max_concurrent（1~8，0 / 空 = 1），环境变量 LOCAL_GPU_CONCURRENCY 兜底 */
export function laneLimit(config: Pick<AIConfig, 'settings'>): number {
  const raw = Number(config.settings?.max_concurrent ?? process.env.LOCAL_GPU_CONCURRENCY ?? 1)
  return Number.isFinite(raw) && raw >= 1 ? Math.min(8, Math.floor(raw)) : 1
}

function lane(key: string): Lane {
  let l = lanes.get(key)
  if (!l) lanes.set(key, (l = { active: new Set(), waiters: [], limit: 1, dirty: false, videosSinceRestart: 0 }))
  return l
}

function notifyPositions(l: Lane) {
  l.waiters.forEach((w, i) => {
    try { w.onPosition?.(i + 1) } catch { /* 进度上报失败不影响排队 */ }
  })
}

function pump(l: Lane) {
  while (l.waiters.length && l.active.size < l.limit) {
    const next = l.waiters.shift()!
    l.active.add(next.taskId)
    next.resolve()
  }
  notifyPositions(l)
}

/**
 * 等到轮到这个任务。onPosition(n)：前面还有 n 个任务（含正在跑的）时回调，用来更新进度文字。
 * 返回 true 表示刚才排过队（前面有任务）。
 */
export async function acquireGpuLane(
  key: string,
  taskId: number,
  opts: { limit?: number; kind?: string; onPosition?: (position: number, running: number) => void } = {},
): Promise<boolean> {
  const l = lane(key)
  if (opts.limit) l.limit = opts.limit
  held.set(taskId, { key, kind: opts.kind || '' })
  if (l.active.has(taskId)) return false
  if (l.active.size < l.limit && !l.waiters.length) {
    l.active.add(taskId)
    return false
  }
  await new Promise<void>((resolve) => {
    l.waiters.push({ taskId, resolve, onPosition: (p) => opts.onPosition?.(p, l.active.size) })
    notifyPositions(l)
  })
  return true
}

/** 任务结束（成功 / 失败 / 中途出错）时调用；可重复调用 */
export function releaseGpuLane(taskId: number) {
  const h = held.get(taskId)
  if (!h) return
  held.delete(taskId)
  const l = lanes.get(h.key)
  if (!l) return
  const wasActive = l.active.delete(taskId)
  if (wasActive && h.kind === 'video') l.dirty = true
  // 还没轮到就结束了（如被删除）：从等待队列里移除
  const i = l.waiters.findIndex((w) => w.taskId === taskId)
  if (i >= 0) l.waiters.splice(i, 1)
  pump(l)
}

/** 上一个视频任务结束后是否还没释放过显存；consume = true 时顺便清掉标记 */
export function laneNeedsFree(key: string, consume = false): boolean {
  const l = lanes.get(key)
  if (!l?.dirty) return false
  if (consume) l.dirty = false
  return true
}

/** 上次重启以来交过的视频数；传 set 时改写 */
export function laneVideosSinceRestart(key: string, set?: number): number {
  const l = lane(key)
  if (set !== undefined) l.videosSinceRestart = set
  return l.videosSinceRestart
}

export function gpuLaneStatus(key: string) {
  const l = lanes.get(key)
  return { running: l ? [...l.active] : [], waiting: l ? l.waiters.map((w) => w.taskId) : [], limit: l?.limit ?? 1 }
}

/** 测试用 */
export function resetGpuLanes() {
  lanes.clear()
  held.clear()
}
