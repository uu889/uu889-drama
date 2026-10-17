/**
 * 模型安装：把「目标机 + 根目录 + 风格」变成下载计划，并在生成前自动补齐缺少的风格模型。
 */
import { db, schema } from '../../db/index.js'
import { isNull } from 'drizzle-orm'
import { localAuthHeaders } from '../adapters/local-image.js'
import { comfyAuthHeaders } from '../adapters/comfyui-common.js'
import { isStyleKey, STYLE_KEYS } from '../adapters/style-models.js'
import { openTarget, normalizeTargetPath, type InstallTarget, type RemoteLogin, type TargetFs } from './target'
import { resolveLayout, type InstallProvider } from './detect'
import { buildPlanFiles, checkPlanFiles } from './plan'
import { activeJobFor, activeJobs, createJob, getJob, targetKeyOf } from './jobs'
import type { ProgressReporter } from '../task-progress'

export interface ModelInstallSettings {
  mode: 'local' | 'remote'
  root: string
  remote?: RemoteLogin
}

export const INSTALL_PROVIDERS: InstallProvider[] = ['sdwebui', 'comfyui', 'fooocus']

export function isInstallProvider(p: unknown): p is InstallProvider {
  return typeof p === 'string' && (INSTALL_PROVIDERS as string[]).includes(p)
}

/** 校验并规范化保存在配置 settings.model_install 里的安装位置 */
export function normalizeModelInstall(raw: unknown): ModelInstallSettings | null {
  let obj: any = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try { obj = JSON.parse(raw) } catch { throw new Error('model_install 不是合法 JSON') }
  }
  if (!obj || typeof obj !== 'object') return null
  const mode = obj.mode === 'remote' ? 'remote' : 'local'
  const root = String(obj.root || '').trim().slice(0, 1000)
  const out: ModelInstallSettings = { mode, root }
  if (mode === 'remote') {
    const r = obj.remote || {}
    const port = Number(r.port) || 22
    if (port < 1 || port > 65535) throw new Error('远程端口须为 1~65535')
    out.remote = {
      host: String(r.host || '').trim().slice(0, 255),
      port,
      username: String(r.username || '').trim().slice(0, 100),
      auth: r.auth === 'key' ? 'key' : 'password',
      password: r.auth === 'key' ? undefined : String(r.password || '').slice(0, 500) || undefined,
      privateKey: r.auth === 'key' ? String(r.privateKey || '').slice(0, 20_000) || undefined : undefined,
      passphrase: r.auth === 'key' ? String(r.passphrase || '').slice(0, 500) || undefined : undefined,
    }
  }
  if (!out.root && mode === 'local' && !obj.remote) return null
  return out
}

export function targetOf(install: ModelInstallSettings | null | undefined): InstallTarget {
  return install?.mode === 'remote' ? { mode: 'remote', remote: install.remote } : { mode: 'local' }
}

export function serviceHeaders(provider: InstallProvider, apiKey?: string): Record<string, string> {
  if (provider === 'comfyui') return comfyAuthHeaders({ provider, baseUrl: '', apiKey: apiKey || '', model: '' })
  return localAuthHeaders(apiKey || '')
}

export interface PlanRequest {
  target: InstallTarget
  root: string
  provider: InstallProvider
  serviceType: 'image' | 'video'
  styles: string[]
  settings?: Record<string, any> | null
  model?: string
  preferMirror?: boolean
}

/** 打开目标机 → 校验根目录 → 算计划 → 查缺失（调用方负责 close） */
export async function planOnTarget(t: TargetFs, req: PlanRequest) {
  const root = normalizeTargetPath(t.os, t.home, req.root)
  if (!root) throw new Error('请先识别或选择程序安装根目录')
  const layout = await resolveLayout(t, req.provider, root)
  const { files, skipped, notes } = buildPlanFiles({
    provider: req.provider,
    serviceType: req.serviceType,
    styles: req.styles,
    settings: req.settings,
    model: req.model,
    preferMirror: req.preferMirror,
  })
  const states = await checkPlanFiles(t, layout, files)
  const missing = states.filter((s) => s.state !== 'present')
  const missingBytes = missing.reduce((s, f) => s + Math.max(0, (f.bytes || 0) - f.partBytes), 0)
  const unknownSize = missing.filter((f) => !f.bytes).length
  const free = await t.freeBytes(layout.folders.checkpoint || layout.folders.diffusion_models || root)
  const warnings = [...layout.warnings]
  if (free != null && missingBytes && free < missingBytes * 1.05) {
    warnings.push(`磁盘剩余空间约 ${(free / 1073741824).toFixed(1)} GB，不够下载缺少的 ${(missingBytes / 1073741824).toFixed(1)} GB`)
  }
  return { root, layout, files: states, skipped, notes, missingBytes, unknownSize, freeBytes: free, warnings }
}

export async function stylesInUse(): Promise<string[]> {
  try {
    const rows = await db.select({ style: schema.dramas.style }).from(schema.dramas).where(isNull(schema.dramas.deletedAt))
    return [...new Set(rows.map((r: any) => r.style).filter(isStyleKey))]
  } catch {
    return []
  }
}

// ─── 生成前自动补齐 ───────────────────────────────────────────────────────

const WAIT_LIMIT_MS = 12 * 3600_000

function fmtGb(n: number) {
  return `${(n / 1073741824).toFixed(1)} GB`
}

/**
 * 同一台目标机上的「检查缺哪些文件 → 加入 / 创建下载任务」按顺序执行：
 * 多个生成任务同时开始时，后来的任务一定能看到前面任务刚建的下载任务，同一个文件不会下两遍；
 * 远程模式下也不会一下子开出一堆 SSH 连接。
 */
const targetLocks = new Map<string, Promise<void>>()

async function withTargetLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = targetLocks.get(key) || Promise.resolve()
  let release!: () => void
  const mine = prev.then(() => new Promise<void>((r) => { release = r }))
  targetLocks.set(key, mine)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (targetLocks.get(key) === mine) targetLocks.delete(key)
  }
}

/** 这个生成任务要等的一个文件：在哪个下载任务里、目标路径 */
interface WatchedFile {
  jobId: string
  dest: string
  name: string
  /** true = 别的任务（或手动下载）已经在下，这里只是等它 */
  shared: boolean
}

/**
 * 生成任务开始前：本地服务开启了「按风格切换模型」且配置了安装位置时，保证这个风格要用的模型文件是完整的。
 *
 * - 要用的文件正在下载（手动下载、别的任务触发的自动下载、上次没下完程序重启后接着下的）→ 一律等它下完，
 *   不管有没有开「自动下载」、这次能不能连上目标机——绝不在模型没下完时开始生成
 * - 开了「自动下载缺少的模型」：再到目标机上检查，缺的文件没人在下就新建下载任务，一起等
 * - 多任务并发：每个缺少的文件只会在一个下载任务里（不同风格共用的底模 / Wan 基础模型只下一份）
 * 检查本身出错（连不上远程等）时：有正在下载的文件就照样等；没有就提示后按现有模型继续。
 */
export async function ensureStyleModelsForTask(
  config: { provider: string; baseUrl?: string; apiKey?: string; model?: string; settings?: Record<string, any> | null },
  serviceType: 'image' | 'video',
  style: string | null | undefined,
  report: ProgressReporter,
): Promise<void> {
  const settings = config.settings || {}
  if (!isInstallProvider(config.provider) || !settings.style_models_enabled) return
  if (!isStyleKey(style)) return
  if (serviceType === 'video' && config.provider !== 'comfyui') return
  let install: ModelInstallSettings | null = null
  try { install = normalizeModelInstall(settings.model_install) } catch { install = null }
  if (!install?.root) return

  const provider = config.provider as InstallProvider
  const model = Array.isArray(config.model) ? config.model[0] : config.model
  const target = targetOf(install)
  const key = targetKeyOf(target)
  const watch = new Map<string, WatchedFile>()
  const addWatch = (w: WatchedFile) => { if (!watch.has(w.dest)) watch.set(w.dest, w) }

  // 1) 不连目标机：按清单算出这个风格要用的文件，正在下载的直接等
  try {
    const { files } = buildPlanFiles({ provider, serviceType, styles: [style], settings, model })
    const wanted = new Set(files.map((f) => `${f.role}:${f.file}`))
    for (const j of activeJobs()) {
      if (targetKeyOf(j.target) !== key) continue
      for (const i of j.items) {
        if (i.status === 'done' || i.status === 'skipped' || !wanted.has(`${i.role}:${i.file}`)) continue
        addWatch({ jobId: j.id, dest: i.dest, name: i.name, shared: true })
      }
    }
  } catch { /* 清单算不出来（不支持的组合）：交给下面的检查 */ }

  // 2) 开了自动下载：到目标机上查缺哪些，没人在下的新建下载任务
  if (settings.style_models_auto_download) {
    try {
      report({ stage: 'preparing', message: '检查风格模型是否齐全…' })
      const found = await withTargetLock(key, async () => {
        const t = await openTarget(target)
        try {
          const plan = await planOnTarget(t, {
            target,
            root: install!.root,
            provider,
            serviceType,
            styles: [style],
            settings,
            model,
            preferMirror: !!settings.download_prefer_mirror,
          })
          const missing = plan.files.filter((f) => f.state !== 'present')
          const out: WatchedFile[] = []
          const notCovered: typeof missing = []
          for (const f of missing) {
            const existing = activeJobFor(key, f.dest)
            if (existing) out.push({ jobId: existing.id, dest: f.dest, name: f.name, shared: true })
            else notCovered.push(f)
          }
          if (notCovered.length) {
            const job = createJob({
              provider,
              serviceType,
              styles: [style],
              root: plan.root,
              target,
              fsInfo: { os: t.os, hostname: t.hostname },
              files: notCovered,
              tokens: { civitai: settings.civitai_token, hf: settings.hf_token },
              origin: 'auto',
              refresh: { baseUrl: config.baseUrl, apiKey: config.apiKey },
            })
            for (const item of job.items) out.push({ jobId: job.id, dest: item.dest, name: item.name, shared: false })
          }
          return out
        } finally {
          t.close()
        }
      })
      for (const w of found) addWatch(w)
    } catch (err: any) {
      report({
        stage: 'preparing',
        message: watch.size
          ? `检查风格模型失败（${err?.message || err}），先等正在下载的模型下完`
          : `检查风格模型失败，按现有模型继续：${err?.message || err}`,
      })
    }
  }
  if (!watch.size) return
  await waitForFiles([...watch.values()], report)
}

async function waitForFiles(watch: WatchedFile[], report: ProgressReporter): Promise<void> {
  const sharedCount = watch.filter((w) => w.shared).length
  const started = Date.now()
  while (Date.now() - started < WAIT_LIMIT_MS) {
    let done = 0
    let received = 0
    let total = 0
    let speed = 0
    for (const w of watch) {
      const job = getJob(w.jobId)
      const item = job?.items.find((i) => i.dest === w.dest)
      if (!job || !item) throw new Error(`风格模型「${w.name}」的下载任务记录不见了（可能被删除），请重试生成`)
      const size = item.bytes || item.total || 0
      if (item.status === 'done' || item.status === 'skipped' || job.status === 'done') {
        done++
        const b = size || item.received
        received += b
        total += b
        continue
      }
      if (job.status === 'failed' || job.status === 'canceled' || job.status === 'paused' || item.status === 'failed') {
        const why = job.status === 'paused' ? '已暂停' : job.status === 'canceled' ? '已取消' : item.error || job.error || job.message || '下载失败'
        throw new Error(`风格模型「${w.name}」没有下完（${why}）：请在设置 → 视觉风格 → 模型 → 下载任务里处理后重试`)
      }
      received += item.received
      total += size
      if (item.status === 'downloading') speed += item.speed || 0
    }
    if (done === watch.length) {
      report({ stage: 'preparing', message: '风格模型下载完成，开始生成' })
      return
    }
    const pct = total ? Math.min(100, Math.round((received / total) * 1000) / 10) : 0
    const eta = speed > 0 && total ? Math.round((total - received) / speed) : undefined
    report({
      stage: 'preparing',
      percent: 1,
      message: `正在下载风格模型 ${done}/${watch.length} 个文件，${pct}%（${fmtGb(received)} / ${fmtGb(total)}${speed ? `，${(speed / 1048576).toFixed(1)} MB/s` : ''}）${sharedCount ? `，其中 ${sharedCount} 个已在下载中（共用同一份下载，不重复下）` : ''}，下完自动开始生成`,
      detail: { downloaded_bytes: received, total_bytes: total, eta_seconds: eta },
    })
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('等待风格模型下载超时（12 小时）')
}

export { STYLE_KEYS }
