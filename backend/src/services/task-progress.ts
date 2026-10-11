/**
 * 生成任务的实时进度（内存态，随任务查询接口一起返回给前端）
 *
 * 阶段：preparing 准备素材 → uploading 上传参考图 → submitting 提交 → queued 排队 → running 生成中
 *       → downloading 下载结果 → saving 保存 / 生成缩略图 → completed / failed
 * percent 为整体进度估算（0~100，未知为 null）；detail 带结构化细节（排队位置、采样步数、节点、下载字节、预计剩余）。
 * message 是中文的一句话说明，前端可直接显示，也可按 stage + detail 自行组装多语言文案。
 * 任务结束 30 分钟后清理；后端重启后丢失（任务本身状态仍在 sys_task 表里）。
 */

export type TaskStage =
  | 'preparing'
  | 'uploading'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'downloading'
  | 'saving'
  | 'completed'
  | 'failed'

export interface TaskProgressDetail {
  /** 排队：前面还有几个任务（0 = 下一个就是它） */
  queue_ahead?: number
  queue_total?: number
  /** 当前采样步 / 总步数 */
  step?: number
  steps?: number
  /** 第几个采样器 / 共几个（Wan 2.2 14B 两段采样 = 2） */
  sampler_index?: number
  sampler_total?: number
  /** 已完成节点数 / 工作流节点总数 */
  nodes_done?: number
  nodes_total?: number
  /** 正在执行的节点 */
  node_id?: string
  node_class?: string
  node_title?: string
  /** 上传参考图 */
  uploaded?: number
  upload_total?: number
  /** 下载结果 */
  downloaded_bytes?: number
  total_bytes?: number
  /** 预计剩余秒数 */
  eta_seconds?: number
  /** 上游服务的原始状态文字（如 Fooocus 的 job_status、云端任务状态） */
  provider_status?: string
  /** 轮询次数（云端服务没有细粒度进度时显示） */
  poll_count?: number
}

export interface TaskProgress {
  stage: TaskStage
  percent: number | null
  message: string
  detail: TaskProgressDetail
  started_at: number
  stage_started_at: number
  updated_at: number
  /** 阶段变化记录（最近 30 条），前端展开可看完整过程 */
  history: Array<{ at: number; stage: TaskStage; message: string }>
}

export interface TaskProgressPatch {
  stage?: TaskStage
  percent?: number | null
  message?: string
  detail?: TaskProgressDetail
  /** true 时 detail 整体替换；默认与旧值合并 */
  replaceDetail?: boolean
}

const store = new Map<number, TaskProgress>()
const KEEP_FINISHED_MS = 30 * 60_000
const HISTORY_LIMIT = 30

/** 阶段默认的整体进度区间：进入阶段时至少到 min，阶段内的细粒度进度映射到 [min, max] */
export const STAGE_RANGES: Record<TaskStage, [number, number]> = {
  preparing: [0, 3],
  uploading: [3, 8],
  submitting: [8, 10],
  queued: [10, 10],
  running: [10, 90],
  downloading: [90, 98],
  saving: [98, 99],
  completed: [100, 100],
  failed: [0, 100],
}

/** 把阶段内的 0~1 进度映射为整体百分比 */
export function stagePercent(stage: TaskStage, fraction: number): number {
  const [min, max] = STAGE_RANGES[stage]
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
  return Math.round((min + (max - min) * f) * 10) / 10
}

function prune() {
  const now = Date.now()
  for (const [id, p] of store) {
    if ((p.stage === 'completed' || p.stage === 'failed') && now - p.updated_at > KEEP_FINISHED_MS) store.delete(id)
  }
}

const LATE_STAGES = new Set<TaskStage>(['downloading', 'saving', 'completed', 'failed'])
const EARLY_STAGES = new Set<TaskStage>(['preparing', 'uploading', 'submitting', 'queued', 'running'])

export function setTaskProgress(id: number, patch: TaskProgressPatch): TaskProgress {
  const now = Date.now()
  const prev = store.get(id)
  // 迟到的实时事件（如 WebSocket 在下载阶段才到）不能把阶段拉回去
  if (prev && patch.stage && LATE_STAGES.has(prev.stage) && EARLY_STAGES.has(patch.stage)) return prev
  const stage = patch.stage || prev?.stage || 'preparing'
  const stageChanged = !prev || prev.stage !== stage
  const detail = patch.replaceDetail || stageChanged ? { ...(patch.detail || {}) } : { ...(prev?.detail || {}), ...(patch.detail || {}) }
  // 去掉 undefined，保持返回体干净
  for (const key of Object.keys(detail) as Array<keyof TaskProgressDetail>) {
    if (detail[key] === undefined) delete detail[key]
  }
  let percent = patch.percent !== undefined
    ? patch.percent
    : stageChanged
      ? (stage === 'failed' ? prev?.percent ?? null : STAGE_RANGES[stage][0])
      : prev?.percent ?? null
  // 进度只前进不后退（失败除外），避免轮询间隙估算抖动
  if (percent != null && prev?.percent != null && stage !== 'failed' && percent < prev.percent && !stageChanged) percent = prev.percent
  if (percent != null && prev?.percent != null && stage !== 'failed' && stageChanged && percent < prev.percent) percent = prev.percent
  const message = patch.message ?? (stageChanged ? defaultStageMessage(stage) : prev?.message ?? '')
  const history = prev ? [...prev.history] : []
  const last = history[history.length - 1]
  if (stageChanged || (patch.message && last?.message !== patch.message && isNotable(prev?.detail, patch.detail))) {
    history.push({ at: now, stage, message })
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT)
  }
  const next: TaskProgress = {
    stage,
    percent: percent == null ? null : Math.min(100, Math.max(0, percent)),
    message,
    detail,
    started_at: prev?.started_at ?? now,
    stage_started_at: stageChanged ? now : prev!.stage_started_at,
    updated_at: now,
    history,
  }
  store.set(id, next)
  if (store.size > 200) prune()
  return next
}

/** 只有阶段内「换节点 / 换采样段 / 上游状态变化」才记入历史，逐步刷新的采样步数、下载字节不记 */
function isNotable(prev: TaskProgressDetail | undefined, next: TaskProgressDetail | undefined): boolean {
  if (!next) return false
  const changed = (key: keyof TaskProgressDetail) => next[key] !== undefined && next[key] !== prev?.[key]
  return changed('node_id') || changed('sampler_index') || changed('provider_status') || changed('queue_ahead') || changed('uploaded')
}

export function getTaskProgress(id: number): TaskProgress | null {
  return store.get(id) || null
}

export function clearTaskProgress(id: number) {
  store.delete(id)
}

/** 给任务行附上进度（行里有 id 字段即可，camelCase / snake_case 均可） */
export function withTaskProgress<T extends { id?: number | null }>(row: T): T & { progress: TaskProgress | null } {
  return { ...row, progress: row?.id != null ? getTaskProgress(Number(row.id)) : null }
}

export function defaultStageMessage(stage: TaskStage): string {
  switch (stage) {
    case 'preparing': return '准备参考素材'
    case 'uploading': return '上传参考图'
    case 'submitting': return '提交生成请求'
    case 'queued': return '排队等待中'
    case 'running': return '生成中'
    case 'downloading': return '下载结果'
    case 'saving': return '保存文件、生成缩略图'
    case 'completed': return '已完成'
    case 'failed': return '失败'
  }
}

export function formatBytes(bytes?: number | null): string {
  const n = Number(bytes || 0)
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function formatEta(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.round(seconds)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

/** 适配器上报进度的回调 */
export type ProgressReporter = (patch: TaskProgressPatch) => void
