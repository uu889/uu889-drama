/**
 * /model-installer — 按视觉风格自动下载本地模型（本机 / 远程 SSH）
 *
 * GET  /env                     本机系统信息
 * POST /target/test             测试远程登录（返回系统、主目录、主机名）
 * POST /detect                  识别程序安装根目录（服务接口 + 常见位置扫描）
 * POST /fs/list                 浏览目录（选择根目录用，只返回目录名）
 * POST /plan                    按风格列出需要的模型文件及本机 / 远程上的状态
 * GET  /styles-in-use           项目里正在用的视觉风格
 * GET  /jobs  GET /jobs/:id     下载任务与进度
 * POST /jobs                    创建下载任务（只下缺少的文件）
 * POST /jobs/:id/pause|resume|cancel   DELETE /jobs/:id
 *
 * 本机模式会读写这台机器的文件：服务器部署不想开放时设环境变量 MODEL_INSTALLER_LOCAL=0。
 */
import { Hono } from 'hono'
import os from 'node:os'
import { success, badRequest, notFound } from '../utils/response.js'
import { localOs, localWindowsDrives, normalizeTargetPath, openTarget, type InstallTarget, type TargetFs } from '../services/model-installer/target.js'
import { detectRoots, identifyRoot, PROVIDER_LABELS } from '../services/model-installer/detect.js'
import { SOURCE_LABELS, redactToken } from '../services/model-installer/sources.js'
import { cancelJob, createJob, getJob, listJobs, pauseJob, publicJob, removeJob, resumeJob } from '../services/model-installer/jobs.js'
import { isInstallProvider, normalizeModelInstall, planOnTarget, serviceHeaders, stylesInUse, targetOf } from '../services/model-installer/index.js'

const app = new Hono()

const localAllowed = () => process.env.MODEL_INSTALLER_LOCAL !== '0'

function targetFromBody(body: any): InstallTarget {
  const install = normalizeModelInstall(body?.install ?? { mode: 'local', root: body?.root || '' })
  const target = targetOf(install)
  if (target.mode === 'local' && !localAllowed()) throw new Error('服务器已关闭本机模型安装（MODEL_INSTALLER_LOCAL=0），请用远程模式')
  return target
}

async function withTarget<T>(body: any, fn: (t: TargetFs, target: InstallTarget) => Promise<T>): Promise<T> {
  const target = targetFromBody(body)
  const t = await openTarget(target)
  try {
    return await fn(t, target)
  } finally {
    t.close()
  }
}

function errMsg(err: any) {
  return err?.message || String(err)
}

app.get('/env', (c) => success(c, {
  os: localOs(),
  hostname: os.hostname(),
  home: os.homedir(),
  local_allowed: localAllowed(),
  source_labels: SOURCE_LABELS,
}))

app.post('/target/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    return success(c, await withTarget(body, async (t) => ({ ok: true, mode: t.mode, os: t.os, home: t.home, hostname: t.hostname, fingerprint: t.fingerprint || null })))
  } catch (err) {
    return success(c, { ok: false, error: errMsg(err) })
  }
})

app.post('/detect', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const provider = body.provider
  if (!isInstallProvider(provider)) return badRequest(c, 'provider 须为 sdwebui / comfyui / fooocus')
  try {
    const result = await withTarget(body, async (t) => {
      const candidates = await detectRoots(t, provider, { baseUrl: body.base_url, headers: serviceHeaders(provider, body.api_key) })
      return { os: t.os, home: t.home, hostname: t.hostname, candidates }
    })
    return success(c, result)
  } catch (err) {
    return badRequest(c, errMsg(err))
  }
})

app.post('/fs/list', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await withTarget(body, async (t) => {
      let p = normalizeTargetPath(t.os, t.home, body.path || '')
      // Windows 没给路径：列出盘符
      if (!p && t.os === 'windows') {
        let drives = ['C:\\']
        if (t.mode === 'local') drives = localWindowsDrives()
        else if (t.exec) {
          const { psEncoded } = await import('../services/model-installer/target.js')
          const r = await t.exec(psEncoded('Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }'), 20_000).catch(() => null)
          const list = r?.stdout.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter((s) => /^[A-Za-z]:\\$/.test(s)) || []
          if (list.length) drives = list
        }
        return { os: t.os, path: '', parent: null, home: t.home, entries: drives.map((d) => ({ name: d, path: d, marker: null })) }
      }
      if (!p) p = t.home
      const entries = await t.readdir(p)
      const names = new Set(entries.map((e) => e.name))
      const here = identifyRoot(names)
      const dirs = entries.filter((e) => e.isDir && !e.name.startsWith('.') && !e.name.startsWith('$')).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500)
      const parent = t.dirname(p)
      return {
        os: t.os,
        path: p,
        parent: parent && parent !== p ? parent : (t.os === 'windows' ? '' : null),
        home: t.home,
        marker: here ? { provider: here.provider, flavor: here.flavor, label: PROVIDER_LABELS[here.provider] } : null,
        entries: dirs.map((d) => ({ name: d.name, path: d.path, marker: null })),
      }
    })
    return success(c, result)
  } catch (err) {
    return badRequest(c, errMsg(err))
  }
})

function planInput(body: any) {
  const provider = body.provider
  if (!isInstallProvider(provider)) throw new Error('provider 须为 sdwebui / comfyui / fooocus')
  const serviceType = body.service_type === 'video' ? 'video' : 'image'
  if (serviceType === 'video' && provider !== 'comfyui') throw new Error('只有 ComfyUI 支持生视频模型下载')
  const styles = Array.isArray(body.styles) ? body.styles.map(String) : []
  return {
    provider,
    serviceType: serviceType as 'image' | 'video',
    styles,
    settings: body.settings && typeof body.settings === 'object' ? body.settings : {},
    model: Array.isArray(body.model) ? String(body.model[0] || '') : String(body.model || ''),
    preferMirror: !!body.prefer_mirror,
  }
}

function publicPlan(plan: Awaited<ReturnType<typeof planOnTarget>>, t: TargetFs) {
  return {
    os: t.os,
    hostname: t.hostname,
    root: plan.root,
    layout: { flavor: plan.layout.flavor, folders: plan.layout.folders },
    warnings: plan.warnings,
    notes: plan.notes,
    skipped: plan.skipped,
    free_bytes: plan.freeBytes,
    missing_bytes: plan.missingBytes,
    unknown_size: plan.unknownSize,
    files: plan.files.map((f) => ({
      key: f.key,
      name: f.name,
      file: f.file,
      role: f.role,
      styles: f.styles,
      page: f.page,
      size: f.size,
      bytes: f.bytes ?? null,
      sha256: f.sha256 ?? null,
      dest: f.dest,
      state: f.state,
      current_bytes: f.currentBytes,
      part_bytes: f.partBytes,
      license_status: f.licenseStatus,
      license_note: f.licenseNote,
      sources: f.sources.map((s) => ({ label: SOURCE_LABELS[s.label], url: redactToken(s.url) })),
    })),
  }
}

app.post('/plan', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const input = planInput(body)
    const result = await withTarget(body, async (t, target) => {
      const plan = await planOnTarget(t, { ...input, target, root: body.install?.root ?? body.root ?? '' })
      return publicPlan(plan, t)
    })
    return success(c, result)
  } catch (err) {
    return badRequest(c, errMsg(err))
  }
})

app.get('/styles-in-use', async (c) => success(c, await stylesInUse()))

app.get('/jobs', (c) => success(c, listJobs()))

app.get('/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'))
  return job ? success(c, publicJob(job)) : notFound(c)
})

app.post('/jobs', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const input = planInput(body)
    const job = await withTarget(body, async (t, target) => {
      const plan = await planOnTarget(t, { ...input, target, root: body.install?.root ?? body.root ?? '' })
      let files = plan.files.filter((f) => f.state !== 'present')
      if (Array.isArray(body.only_keys) && body.only_keys.length) files = files.filter((f) => body.only_keys.includes(f.key))
      return createJob({
        provider: input.provider,
        serviceType: input.serviceType,
        styles: input.styles,
        root: plan.root,
        target,
        fsInfo: { os: t.os, hostname: t.hostname },
        files,
        tokens: { civitai: String(body.civitai_token || input.settings.civitai_token || ''), hf: String(body.hf_token || input.settings.hf_token || '') },
        origin: 'manual',
        configId: Number(body.config_id) || null,
        refresh: { baseUrl: body.base_url, apiKey: body.api_key },
      })
    })
    return success(c, publicJob(job))
  } catch (err) {
    return badRequest(c, errMsg(err))
  }
})

app.post('/jobs/:id/pause', async (c) => {
  try { return success(c, await pauseJob(c.req.param('id'))) } catch (err) { return badRequest(c, errMsg(err)) }
})
app.post('/jobs/:id/resume', (c) => {
  try { return success(c, resumeJob(c.req.param('id'))) } catch (err) { return badRequest(c, errMsg(err)) }
})
app.post('/jobs/:id/cancel', async (c) => {
  try { return success(c, await cancelJob(c.req.param('id'))) } catch (err) { return badRequest(c, errMsg(err)) }
})
app.delete('/jobs/:id', (c) => {
  try { return removeJob(c.req.param('id')) ? success(c, { ok: true }) : notFound(c) } catch (err) { return badRequest(c, errMsg(err)) }
})

export default app
