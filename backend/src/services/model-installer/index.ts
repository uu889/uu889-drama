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
import { activeJobFor, createJob, getJob, publicJob, targetKeyOf, type DownloadJob } from './jobs'
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
 * 生成任务开始前：本地服务开启了「按风格切换模型」+「自动下载缺少的模型」，且配置了安装位置时，
 * 检查这个风格要用的文件；缺了就创建下载任务（或加入正在进行的任务）并等待下完，期间在任务进度里显示下载进度。
 * 不满足条件时直接返回；检查本身出错（连不上远程等）只提示、不阻断生成。
 */
export async function ensureStyleModelsForTask(
  config: { provider: string; baseUrl?: string; apiKey?: string; model?: string; settings?: Record<string, any> | null },
  serviceType: 'image' | 'video',
  style: string | null | undefined,
  report: ProgressReporter,
): Promise<void> {
  const settings = config.settings || {}
  if (!isInstallProvider(config.provider) || !settings.style_models_enabled || !settings.style_models_auto_download) return
  if (!isStyleKey(style)) return
  if (serviceType === 'video' && config.provider !== 'comfyui') return
  let install: ModelInstallSettings | null = null
  try { install = normalizeModelInstall(settings.model_install) } catch { install = null }
  if (!install?.root) return

  const target = targetOf(install)
  let job: DownloadJob | null = null
  let t: TargetFs | null = null
  try {
    report({ stage: 'preparing', message: '检查风格模型是否齐全…' })
    t = await openTarget(target)
    const plan = await planOnTarget(t, {
      target,
      root: install.root,
      provider: config.provider,
      serviceType,
      styles: [style],
      settings,
      model: Array.isArray(config.model) ? config.model[0] : config.model,
      preferMirror: !!settings.download_prefer_mirror,
    })
    const missing = plan.files.filter((f) => f.state !== 'present')
    if (!missing.length) return
    const key = targetKeyOf(target)
    job = missing.map((f) => activeJobFor(key, f.dest)).find(Boolean) || null
    const notCovered = missing.filter((f) => !activeJobFor(key, f.dest))
    if (notCovered.length) {
      job = createJob({
        provider: config.provider,
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
    }
  } catch (err: any) {
    report({ stage: 'preparing', message: `检查风格模型失败，按现有模型继续：${err?.message || err}` })
    return
  } finally {
    t?.close()
  }
  if (!job) return

  const started = Date.now()
  const jobId = job.id
  while (Date.now() - started < WAIT_LIMIT_MS) {
    const cur = getJob(jobId)
    if (!cur) break
    const pj = publicJob(cur)
    if (cur.status === 'done') {
      report({ stage: 'preparing', message: '风格模型下载完成，开始生成' })
      return
    }
    if (cur.status === 'failed' || cur.status === 'canceled' || cur.status === 'paused') {
      throw new Error(`风格模型没有下完（${cur.status === 'paused' ? '已暂停' : cur.status === 'canceled' ? '已取消' : cur.error || cur.message || '下载失败'}）：请在设置 → 视觉风格 → 模型 → 下载任务里处理后重试`)
    }
    const pct = pj.percent ?? 0
    report({
      stage: 'preparing',
      percent: 1,
      message: `正在下载风格模型 ${pj.files_done}/${pj.files_total} 个文件，${pct}%（${fmtGb(pj.received_bytes)} / ${fmtGb(pj.total_bytes)}${pj.speed ? `，${(pj.speed / 1048576).toFixed(1)} MB/s` : ''}），下完自动开始生成`,
      detail: { downloaded_bytes: pj.received_bytes, total_bytes: pj.total_bytes, eta_seconds: pj.eta ?? undefined },
    })
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('等待风格模型下载超时（12 小时）')
}

export { STYLE_KEYS }
