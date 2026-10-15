/**
 * 模型下载任务：创建、执行、暂停 / 继续 / 取消、进度、持久化。
 *
 * - 本机：由后端进程直接下载（续传、换来源、校验），关掉浏览器页面也会继续；程序重启后自动接着下
 * - 远程：把下载脚本放到远程机器后台运行，后端只负责读进度；UU889-Drama 关掉也会在远程继续下完
 * 任务存 DATA_ROOT/model-downloads/jobs.json（含远程登录信息，只保存在本机数据目录）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_ROOT } from '../../utils/paths.js'
import { openTarget, publicTarget, psEncoded, shQuote, type InstallTarget, type TargetFs, type TargetOs } from './target'
import { authorize, redactToken, SOURCE_LABELS, type DownloadSource } from './sources'
import { buildPosixScript, buildPowerShellScript, jobTag, parseStatusLog, scriptFileName } from './remote-script'
import type { InstallProvider } from './detect'
import type { PlanFileState } from './plan'

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'canceled'
export type ItemStatus = 'pending' | 'downloading' | 'verifying' | 'done' | 'skipped' | 'failed'

export interface JobItem {
  key: string
  name: string
  file: string
  role: string
  dest: string
  styles: string[]
  bytes?: number
  sha256?: string
  sources: DownloadSource[]
  status: ItemStatus
  received: number
  total?: number
  speed?: number
  eta?: number
  sourceIndex: number
  sourceLabel?: string
  error?: string
  attempts: number
  log: string[]
}

export interface DownloadJob {
  id: string
  createdAt: number
  updatedAt: number
  provider: InstallProvider
  serviceType: 'image' | 'video'
  styles: string[]
  root: string
  os: TargetOs
  hostname: string
  target: InstallTarget
  tokens: { civitai?: string; hf?: string }
  status: JobStatus
  items: JobItem[]
  message?: string
  error?: string
  origin: 'manual' | 'auto'
  configId?: number | null
  /** 下完后让服务刷新模型列表 */
  refresh?: { baseUrl?: string; apiKey?: string }
  remote?: { jobDir: string; launchedAt?: number; lastPollAt?: number; pollError?: string }
}

const STORE_DIR = path.join(DATA_ROOT, 'model-downloads')
const STORE_FILE = path.join(STORE_DIR, 'jobs.json')
const jobs = new Map<string, DownloadJob>()
const controllers = new Map<string, AbortController>()
const remoteConns = new Map<string, TargetFs>()
let loaded = false
let saveTimer: NodeJS.Timeout | null = null
let pollTimer: NodeJS.Timeout | null = null

function load() {
  if (loaded) return
  loaded = true
  try {
    const list = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as DownloadJob[]
    for (const j of list) jobs.set(j.id, j)
  } catch { /* 没有记录 */ }
}

function saveNow() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    const list = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50)
    fs.writeFileSync(`${STORE_FILE}.tmp`, JSON.stringify(list, null, 1))
    fs.renameSync(`${STORE_FILE}.tmp`, STORE_FILE)
  } catch (err) {
    console.error('[model-installer] 保存下载任务失败', err)
  }
}

function save(immediate = false) {
  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    saveNow()
    return
  }
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; saveNow() }, 2000)
}

function touch(job: DownloadJob) {
  job.updatedAt = Date.now()
  save()
}

function itemLog(item: JobItem, msg: string) {
  item.log.push(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${msg}`)
  if (item.log.length > 12) item.log.splice(0, item.log.length - 12)
}

// ─── 对外：查询 ───────────────────────────────────────────────────────────

/** 返回给前端的任务（去掉 Token、远程密码 / 私钥、来源 URL 里的 token） */
export function publicJob(job: DownloadJob) {
  const done = job.items.filter((i) => i.status === 'done' || i.status === 'skipped')
  const totalBytes = job.items.reduce((s, i) => s + (i.bytes || i.total || 0), 0)
  const receivedBytes = job.items.reduce((s, i) => s + (i.status === 'done' || i.status === 'skipped' ? (i.bytes || i.total || i.received) : i.received), 0)
  const speed = job.items.reduce((s, i) => s + (i.status === 'downloading' ? i.speed || 0 : 0), 0)
  return {
    id: job.id,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    provider: job.provider,
    service_type: job.serviceType,
    styles: job.styles,
    root: job.root,
    os: job.os,
    hostname: job.hostname,
    target: publicTarget(job.target),
    status: job.status,
    message: job.message,
    error: job.error,
    origin: job.origin,
    config_id: job.configId ?? null,
    remote_poll_error: job.remote?.pollError,
    files_done: done.length,
    files_total: job.items.length,
    total_bytes: totalBytes,
    received_bytes: Math.min(receivedBytes, totalBytes || receivedBytes),
    percent: totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 1000) / 10) : null,
    speed,
    eta: speed > 0 && totalBytes ? Math.round((totalBytes - receivedBytes) / speed) : null,
    items: job.items.map((i) => ({
      key: i.key,
      name: i.name,
      file: i.file,
      role: i.role,
      dest: i.dest,
      styles: i.styles,
      bytes: i.bytes ?? null,
      status: i.status,
      received: i.received,
      total: i.total ?? i.bytes ?? null,
      speed: i.speed ?? 0,
      eta: i.eta ?? null,
      source: i.sourceLabel ? SOURCE_LABELS[i.sourceLabel as keyof typeof SOURCE_LABELS] || i.sourceLabel : null,
      sources: i.sources.map((s) => ({ label: SOURCE_LABELS[s.label] || s.label, url: redactToken(s.url) })),
      error: i.error,
      log: i.log,
    })),
  }
}

export function listJobs() {
  load()
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(publicJob)
}

export function getJob(id: string): DownloadJob | null {
  load()
  return jobs.get(id) || null
}

export function removeJob(id: string): boolean {
  load()
  const job = jobs.get(id)
  if (!job) return false
  if (job.status === 'running' || job.status === 'queued') throw new Error('任务还在下载，先暂停或取消再删除记录')
  jobs.delete(id)
  save(true)
  return true
}

/** 某个目标机 + 根目录上正在进行（含排队、暂停）的任务里包含的目标文件 */
export function activeJobFor(targetKey: string, dest: string): DownloadJob | null {
  load()
  for (const j of jobs.values()) {
    if (!['queued', 'running', 'paused'].includes(j.status)) continue
    if (targetKeyOf(j.target) !== targetKey) continue
    if (j.items.some((i) => i.dest === dest && i.status !== 'done' && i.status !== 'skipped')) return j
  }
  return null
}

export function targetKeyOf(target: InstallTarget): string {
  if (target?.mode !== 'remote') return 'local'
  const r = target.remote!
  return `remote:${r.username}@${r.host}:${r.port || 22}`
}

// ─── 创建 ─────────────────────────────────────────────────────────────────

export interface CreateJobInput {
  provider: InstallProvider
  serviceType: 'image' | 'video'
  styles: string[]
  root: string
  target: InstallTarget
  fsInfo: { os: TargetOs; hostname: string }
  files: PlanFileState[]
  tokens?: { civitai?: string; hf?: string }
  origin?: 'manual' | 'auto'
  configId?: number | null
  refresh?: { baseUrl?: string; apiKey?: string }
}

export function createJob(input: CreateJobInput): DownloadJob {
  load()
  const targetKey = targetKeyOf(input.target)
  // 其他进行中的任务已经在下的文件不重复下载
  const wanted = input.files.filter((f) => f.state !== 'present' && !activeJobFor(targetKey, f.dest))
  if (!wanted.length) throw new Error('没有需要下载的文件（都已存在，或已在其他下载任务里）')
  const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  const job: DownloadJob = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider: input.provider,
    serviceType: input.serviceType,
    styles: input.styles,
    root: input.root,
    os: input.fsInfo.os,
    hostname: input.fsInfo.hostname,
    target: input.target,
    tokens: { civitai: input.tokens?.civitai || undefined, hf: input.tokens?.hf || undefined },
    status: 'queued',
    origin: input.origin || 'manual',
    configId: input.configId ?? null,
    refresh: input.refresh,
    items: wanted.map((f) => ({
      key: f.key,
      name: f.name,
      file: f.file,
      role: f.role,
      dest: f.dest,
      styles: f.styles,
      bytes: f.bytes,
      sha256: f.sha256,
      sources: f.sources,
      status: 'pending',
      received: f.partBytes || 0,
      sourceIndex: 0,
      attempts: 0,
      log: [],
    })),
  }
  jobs.set(id, job)
  save(true)
  startJob(job)
  return job
}

// ─── 控制 ─────────────────────────────────────────────────────────────────

function startJob(job: DownloadJob) {
  job.status = 'running'
  job.error = undefined
  job.message = undefined
  touch(job)
  if (job.target.mode === 'remote') {
    launchRemote(job).catch((err) => {
      job.status = 'failed'
      job.error = err?.message || String(err)
      touch(job)
    })
  } else {
    runLocal(job).catch((err) => {
      job.status = 'failed'
      job.error = err?.message || String(err)
      touch(job)
    })
  }
}

export async function pauseJob(id: string) {
  const job = getJob(id)
  if (!job) throw new Error('任务不存在')
  if (job.status !== 'running' && job.status !== 'queued') return publicJob(job)
  job.status = 'paused'
  job.message = '已暂停，点「继续」接着下载（已下载的部分会保留）'
  controllers.get(id)?.abort()
  if (job.target.mode === 'remote') await killRemote(job).catch((err) => { job.message = `暂停时结束远程进程失败：${err.message}` })
  for (const i of job.items) if (i.status === 'downloading' || i.status === 'verifying') { i.status = 'pending'; i.speed = 0 }
  touch(job)
  return publicJob(job)
}

export function resumeJob(id: string) {
  const job = getJob(id)
  if (!job) throw new Error('任务不存在')
  if (job.status === 'running') return publicJob(job)
  for (const i of job.items) if (i.status === 'failed') { i.status = 'pending'; i.error = undefined; i.sourceIndex = 0; i.attempts = 0 }
  startJob(job)
  return publicJob(job)
}

export async function cancelJob(id: string) {
  const job = getJob(id)
  if (!job) throw new Error('任务不存在')
  controllers.get(id)?.abort()
  if (job.target.mode === 'remote' && (job.status === 'running' || job.status === 'queued')) await killRemote(job).catch(() => {})
  job.status = 'canceled'
  job.message = '已取消；已下载的部分（.uu889part）保留在模型目录，下次下载同一文件会接着下'
  for (const i of job.items) if (i.status === 'downloading' || i.status === 'verifying') { i.status = 'pending'; i.speed = 0 }
  touch(job)
  return publicJob(job)
}

function finishJob(job: DownloadJob) {
  const failed = job.items.filter((i) => i.status === 'failed')
  job.status = failed.length ? 'failed' : 'done'
  job.message = failed.length
    ? `${failed.length} 个文件下载失败，点「继续」重试（已下载的部分会保留）`
    : '全部下载完成'
  for (const i of job.items) { i.speed = 0; i.eta = undefined }
  touch(job)
  save(true)
  if (!failed.length) refreshService(job).catch(() => {})
}

/** 让服务重新读取模型列表（SD WebUI 需要；ComfyUI 每次读取都会重新扫描目录） */
async function refreshService(job: DownloadJob) {
  const base = String(job.refresh?.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return
  const { localAuthHeaders } = await import('../adapters/local-image.js')
  const headers = localAuthHeaders(job.refresh?.apiKey || '')
  const call = (p: string, method = 'POST') => fetch(`${base}${p}`, { method, headers, signal: AbortSignal.timeout(30_000) }).catch(() => null)
  if (job.provider === 'sdwebui') {
    await call('/sdapi/v1/refresh-checkpoints')
    await call('/sdapi/v1/refresh-loras')
  } else if (job.provider === 'fooocus') {
    await call('/v1/engines/all-models', 'GET')
  }
}

// ─── 本机下载 ─────────────────────────────────────────────────────────────

const STALL_MS = 90_000
const RETRIES_PER_SOURCE = 3

class SourceError extends Error {
  /** true = 这个来源没用（404 / 401 / 文件不一致），直接换下一个来源 */
  constructor(message: string, readonly skipSource = false) { super(message) }
}

async function runLocal(job: DownloadJob) {
  const ctrl = new AbortController()
  controllers.set(job.id, ctrl)
  try {
    for (const item of job.items) {
      if (ctrl.signal.aborted) break
      if (item.status === 'done' || item.status === 'skipped') continue
      try {
        await downloadLocalItem(job, item, ctrl.signal)
      } catch (err: any) {
        if (ctrl.signal.aborted) break
        item.status = 'failed'
        item.error = err?.message || String(err)
        item.speed = 0
        itemLog(item, `失败：${item.error}`)
        touch(job)
      }
    }
  } finally {
    controllers.delete(job.id)
  }
  if (job.status === 'running') finishJob(job)
}

async function fileSize(p: string): Promise<number> {
  try { return (await fs.promises.stat(p)).size } catch { return 0 }
}

async function sha256File(p: string, signal: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(p, { highWaterMark: 4 * 1024 * 1024 })
  for await (const chunk of stream) {
    if (signal.aborted) { stream.destroy(); throw new Error('aborted') }
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

async function downloadLocalItem(job: DownloadJob, item: JobItem, signal: AbortSignal) {
  const dest = item.dest
  const part = `${dest}.uu889part`
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const existing = await fileSize(dest)
  if (existing > 0 && (!item.bytes || existing === item.bytes)) {
    item.status = 'skipped'
    item.received = existing
    itemLog(item, '文件已存在，跳过')
    touch(job)
    return
  }

  let lastError = ''
  for (let si = item.sourceIndex; si < item.sources.length; si++) {
    item.sourceIndex = si
    const src = item.sources[si]
    item.sourceLabel = src.label
    for (let attempt = 0; attempt < RETRIES_PER_SOURCE; attempt++) {
      if (signal.aborted) throw new Error('aborted')
      try {
        await fetchToPart(job, item, src, part, signal)
        await finalizeLocal(job, item, part, dest, signal)
        return
      } catch (err: any) {
        if (signal.aborted) throw err
        lastError = err?.message || String(err)
        item.attempts++
        itemLog(item, `${SOURCE_LABELS[src.label]}：${lastError}`)
        touch(job)
        if (err instanceof SourceError && err.skipSource) break
        await new Promise((r) => setTimeout(r, Math.min(30_000, 3000 * (attempt + 1))))
      }
    }
  }
  throw new Error(`所有下载来源都失败了：${lastError}`)
}

async function fetchToPart(job: DownloadJob, item: JobItem, src: DownloadSource, part: string, signal: AbortSignal) {
  let have = await fileSize(part)
  if (item.bytes && have === item.bytes) return
  if (item.bytes && have > item.bytes) { await fs.promises.rm(part, { force: true }); have = 0 }
  const { url, headers } = authorize(src, job.tokens)
  const reqHeaders: Record<string, string> = { 'User-Agent': 'UU889-Drama-ModelInstaller', ...headers }
  if (have > 0) reqHeaders.Range = `bytes=${have}-`

  const stall = new AbortController()
  const onAbort = () => stall.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let stallTimer = setTimeout(() => stall.abort(), 30_000)
  const resetStall = () => { clearTimeout(stallTimer); stallTimer = setTimeout(() => stall.abort(), STALL_MS) }

  item.status = 'downloading'
  itemLog(item, `${have ? `从 ${(have / 1048576).toFixed(0)} MB 处续传` : '开始下载'}：${SOURCE_LABELS[src.label]}`)
  touch(job)
  try {
    const resp = await fetch(url, { headers: reqHeaders, redirect: 'follow', signal: stall.signal })
    if (resp.status === 416) {
      await resp.body?.cancel().catch(() => {})
      if (item.bytes && have === item.bytes) return
      await fs.promises.rm(part, { force: true })
      throw new Error('续传位置无效，已清掉重新下载')
    }
    if (resp.status === 401 || resp.status === 403) {
      await resp.body?.cancel().catch(() => {})
      const hint = src.auth === 'civitai'
        ? '需要 Civitai API Key（civitai.com → Account settings → API Keys），填到「Civitai API Key」后重试'
        : '需要 Hugging Face Token（huggingface.co/settings/tokens，并在模型页同意协议）'
      throw new SourceError(`HTTP ${resp.status}：${hint}`, true)
    }
    if (resp.status === 404) {
      await resp.body?.cancel().catch(() => {})
      throw new SourceError('HTTP 404：这个来源上没有该文件', true)
    }
    if (!resp.ok || !resp.body) {
      await resp.body?.cancel().catch(() => {})
      throw new Error(`HTTP ${resp.status}`)
    }
    const ctype = resp.headers.get('content-type') || ''
    if (/text\/html/i.test(ctype)) {
      await resp.body.cancel().catch(() => {})
      throw new SourceError('返回的是网页而不是模型文件（可能需要登录或被拦截）', true)
    }
    let append = have > 0 && resp.status === 206
    if (have > 0 && resp.status === 200) { append = false; have = 0 }
    const len = Number(resp.headers.get('content-length') || 0)
    const range = resp.headers.get('content-range')
    const total = range && /\/(\d+)$/.test(range) ? Number(range.match(/\/(\d+)$/)![1]) : (len ? have + len : undefined)
    if (item.bytes && total && total !== item.bytes) {
      await resp.body.cancel().catch(() => {})
      throw new SourceError(`文件大小不一致（来源 ${total} 字节，应为 ${item.bytes} 字节）`, true)
    }
    item.total = total || item.bytes
    item.received = have

    const out = fs.createWriteStream(part, { flags: append ? 'a' : 'w' })
    let lastTick = Date.now()
    let lastBytes = have
    try {
      for await (const chunk of resp.body as any as AsyncIterable<Uint8Array>) {
        resetStall()
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        item.received += chunk.byteLength
        const now = Date.now()
        if (now - lastTick >= 1000) {
          const inst = ((item.received - lastBytes) * 1000) / (now - lastTick)
          item.speed = item.speed ? item.speed * 0.6 + inst * 0.4 : inst
          item.eta = item.total && item.speed > 0 ? Math.round((item.total - item.received) / item.speed) : undefined
          lastTick = now
          lastBytes = item.received
          touch(job)
        }
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()))
    }
    if (item.total && item.received < item.total) throw new Error(`连接中断（已下 ${(item.received / 1048576).toFixed(0)} MB），稍后续传`)
  } catch (err: any) {
    if (stall.signal.aborted && !signal.aborted) throw new Error('90 秒没有收到数据，重新连接续传')
    throw err
  } finally {
    clearTimeout(stallTimer)
    signal.removeEventListener('abort', onAbort)
    item.speed = 0
  }
}

async function finalizeLocal(job: DownloadJob, item: JobItem, part: string, dest: string, signal: AbortSignal) {
  const size = await fileSize(part)
  if (item.bytes && size !== item.bytes) {
    await fs.promises.rm(part, { force: true })
    throw new SourceError(`文件大小不对（${size} 字节，应为 ${item.bytes}），已删除重新下载`)
  }
  if (!item.bytes && size < 1024 * 1024) {
    await fs.promises.rm(part, { force: true })
    throw new SourceError('下载到的文件太小，不像模型文件', true)
  }
  if (item.sha256) {
    item.status = 'verifying'
    itemLog(item, '校验 SHA256…')
    touch(job)
    const got = await sha256File(part, signal)
    if (got !== item.sha256.toLowerCase()) {
      await fs.promises.rm(part, { force: true })
      throw new SourceError('SHA256 校验不一致，已删除，换下一个来源', true)
    }
  }
  await fs.promises.rename(part, dest)
  item.status = 'done'
  item.received = size
  item.total = size
  item.error = undefined
  itemLog(item, '完成')
  touch(job)
}

// ─── 远程下载 ─────────────────────────────────────────────────────────────

async function remoteFs(job: DownloadJob): Promise<TargetFs> {
  const key = targetKeyOf(job.target)
  const cached = remoteConns.get(key)
  if (cached) {
    // 连接还活着就复用
    try {
      await cached.stat(job.root)
      return cached
    } catch {
      remoteConns.delete(key)
    }
  }
  const t = await openTarget(job.target)
  remoteConns.set(key, t)
  return t
}

function dropRemote(job: DownloadJob) {
  const key = targetKeyOf(job.target)
  const t = remoteConns.get(key)
  if (t) { t.close(); remoteConns.delete(key) }
}

async function launchRemote(job: DownloadJob) {
  const t = await remoteFs(job)
  const jobDir = t.join(job.root, '.uu889-downloads', jobTag(job.id))
  await t.mkdirp!(jobDir)
  const items = job.items.map((i) => ({
    dest: i.dest,
    bytes: i.bytes,
    sha256: i.sha256,
    sources: i.sources.map((s) => {
      const a = authorize(s, job.tokens)
      return { label: s.label, url: a.url, headers: a.headers }
    }),
  }))
  const scriptPath = t.join(jobDir, scriptFileName(t.os))
  const script = t.os === 'windows' ? buildPowerShellScript(job.id, jobDir, items) : buildPosixScript(job.id, jobDir, items)
  await t.writeFile!(scriptPath, script)
  // 新一轮运行：清空旧日志（暂停后继续时，已完成的文件会被脚本跳过）
  await t.writeFile!(t.join(jobDir, 'status.log'), '')
  let r
  if (t.os === 'windows') {
    const cmdline = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`
    r = await t.exec!(psEncoded(`$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmdline.replace(/'/g, "''")}' }; Write-Output $r.ReturnValue`), 30_000)
    if (r.code !== 0 || r.stdout.trim().split(/\s+/).pop() !== '0') throw new Error(`启动远程下载失败：${(r.stderr || r.stdout).trim() || '未知错误'}`)
  } else {
    r = await t.exec!(`chmod +x ${shQuote(scriptPath)}; nohup sh ${shQuote(scriptPath)} > ${shQuote(t.join(jobDir, 'run.out'))} 2>&1 < /dev/null & echo started`, 30_000)
    if (!/started/.test(r.stdout)) throw new Error(`启动远程下载失败：${(r.stderr || r.stdout).trim()}`)
  }
  job.remote = { jobDir, launchedAt: Date.now() }
  job.message = `已在远程 ${job.hostname} 后台下载（关掉 UU889-Drama 也会继续）`
  touch(job)
  ensurePolling()
}

async function killRemote(job: DownloadJob) {
  const t = await remoteFs(job)
  const tag = jobTag(job.id)
  if (t.os === 'windows') {
    await t.exec!(psEncoded(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${tag}*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`), 30_000)
  } else {
    // [l] 让 pkill 的模式不匹配执行它的 shell 自己
    const pattern = tag.replace(/l-/, '[l]-')
    await t.exec!(`pkill -f ${shQuote(pattern)}; true`, 30_000)
  }
}

async function remoteAlive(t: TargetFs, job: DownloadJob): Promise<boolean> {
  const pidFile = t.join(job.remote!.jobDir, 'pid')
  const pid = (await t.readFile!(pidFile))?.replace(/^﻿/, '').trim()
  if (!pid || !/^\d+$/.test(pid)) return false
  if (t.os === 'windows') {
    const r = await t.exec!(psEncoded(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'dead' }`), 20_000)
    return /alive/.test(r.stdout)
  }
  const r = await t.exec!(`kill -0 ${pid} 2>/dev/null && echo alive || echo dead`, 20_000)
  return /alive/.test(r.stdout)
}

async function pollRemote(job: DownloadJob) {
  if (!job.remote?.jobDir) return
  let t: TargetFs
  try {
    t = await remoteFs(job)
  } catch (err: any) {
    job.remote.pollError = `暂时连不上远程（${err.message}），远程那边仍在后台下载，恢复连接后自动更新进度`
    touch(job)
    return
  }
  try {
    const log = (await t.readFile!(t.join(job.remote.jobDir, 'status.log'))) || ''
    const parsed = parseStatusLog(log, job.items.length)
    const now = Date.now()
    for (let i = 0; i < job.items.length; i++) {
      const item = job.items[i]
      const st = parsed.items[i]
      if (st.sourceLabel) item.sourceLabel = st.sourceLabel
      item.error = st.error
      if (st.status === 'done' || st.status === 'skipped') {
        item.status = st.status
        item.received = item.bytes || item.total || item.received
        item.speed = 0
        item.eta = undefined
      } else if (st.status === 'failed') {
        item.status = 'failed'
        item.speed = 0
      } else if (st.status === 'downloading' || st.status === 'verifying') {
        item.status = st.status
        const part = await t.stat(`${item.dest}.uu889part`)
        const size = part?.size ?? item.received
        const prevAt = (item as any)._pollAt as number | undefined
        if (prevAt && size >= item.received) {
          const inst = ((size - item.received) * 1000) / Math.max(1, now - prevAt)
          item.speed = item.speed ? item.speed * 0.5 + inst * 0.5 : inst
        }
        ;(item as any)._pollAt = now
        item.received = size
        item.total = item.bytes || item.total
        item.eta = item.total && item.speed ? Math.round((item.total - item.received) / item.speed) : undefined
      }
    }
    job.remote.lastPollAt = now
    job.remote.pollError = undefined
    if (parsed.finished) {
      finishJob(job)
      return
    }
    // 进程不在了但没写 FINISHED：远程重启 / 被结束
    if (now - (job.remote.launchedAt || 0) > 20_000 && !(await remoteAlive(t, job))) {
      job.status = 'failed'
      job.error = '远程下载进程已停止（可能是远程机器重启或进程被结束），点「继续」从断点接着下'
      for (const i of job.items) if (i.status === 'downloading' || i.status === 'verifying') { i.status = 'pending'; i.speed = 0 }
    }
    touch(job)
  } catch (err: any) {
    job.remote.pollError = `读取远程进度失败：${err.message}`
    dropRemote(job)
    touch(job)
  }
}

let polling = false
function ensurePolling() {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    if (polling) return
    polling = true
    try {
      const active = [...jobs.values()].filter((j) => j.target.mode === 'remote' && j.status === 'running' && j.remote?.jobDir)
      if (!active.length) {
        clearInterval(pollTimer!)
        pollTimer = null
        for (const t of remoteConns.values()) t.close()
        remoteConns.clear()
        return
      }
      for (const j of active) await pollRemote(j)
    } finally {
      polling = false
    }
  }, 3000)
}

/** 后端启动时：本机任务接着下；远程任务恢复读进度（远程在 UU889-Drama 关闭期间一直在下） */
export function resumeJobsOnStartup() {
  load()
  for (const job of jobs.values()) {
    if (job.status !== 'running' && job.status !== 'queued') continue
    if (job.target.mode === 'remote') {
      if (job.remote?.jobDir) ensurePolling()
      else startJob(job)
    } else {
      for (const i of job.items) if (i.status === 'downloading' || i.status === 'verifying') i.status = 'pending'
      startJob(job)
    }
  }
}
