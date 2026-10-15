/**
 * 识别 Stable Diffusion WebUI / ComfyUI / Fooocus 的安装根目录，并算出各类模型应放的目录。
 *
 * 识别方式（结果合并去重，按可信度排序）：
 * 1. 问正在运行的服务：ComfyUI GET /internal/folder_paths、SD WebUI GET /sdapi/v1/cmd-flags（最准，能拿到自定义模型目录）
 * 2. 在常见位置按「特征文件」扫描（深度有限、目录数有上限，不会全盘搜索）
 */
import type { TargetFs, TargetOs } from './target'
import { localWindowsDrives } from './target'

export type InstallProvider = 'sdwebui' | 'comfyui' | 'fooocus'
export type FolderRole = 'checkpoint' | 'lora' | 'diffusion_models' | 'text_encoders' | 'vae'

export interface InstallLayout {
  provider: InstallProvider
  root: string
  /** 识别出的程序形态 */
  flavor: string
  folders: Partial<Record<FolderRole, string>>
  warnings: string[]
}

export interface RootCandidate {
  provider: InstallProvider
  path: string
  flavor: string
  source: 'api' | 'scan'
}

export const PROVIDER_LABELS: Record<InstallProvider, string> = {
  sdwebui: 'Stable Diffusion WebUI',
  comfyui: 'ComfyUI',
  fooocus: 'Fooocus',
}

/** 根据目录里的文件名判断是哪个程序的根目录 */
export function identifyRoot(names: Set<string>): { provider: InstallProvider; flavor: string } | null {
  const has = (n: string) => names.has(n) || names.has(n.toLowerCase())
  if (has('main.py') && has('comfy') && has('models')) return { provider: 'comfyui', flavor: 'ComfyUI' }
  // ComfyUI Desktop 的数据目录（Documents/ComfyUI）：没有 main.py，但有 models / custom_nodes / user
  if (has('models') && has('custom_nodes') && has('user') && !has('webui.py')) return { provider: 'comfyui', flavor: 'ComfyUI Desktop' }
  if (has('webui.py') && has('modules')) {
    const forge = has('modules_forge') || has('backend')
    return { provider: 'sdwebui', flavor: forge ? 'SD WebUI Forge' : 'Stable Diffusion WebUI' }
  }
  if (has('fooocusapi') && has('main.py')) return { provider: 'fooocus', flavor: 'Fooocus-API' }
  if (has('entry_with_update.py') && has('modules')) return { provider: 'fooocus', flavor: 'Fooocus' }
  return null
}

/** 各程序的模型目录（相对根目录） */
async function resolveFolders(fs: TargetFs, provider: InstallProvider, root: string) {
  const j = (...p: string[]) => fs.join(root, ...p)
  const warnings: string[] = []
  if (provider === 'sdwebui') {
    return { folders: { checkpoint: j('models', 'Stable-diffusion'), lora: j('models', 'Lora') }, warnings }
  }
  if (provider === 'fooocus') {
    // Fooocus-API 把 Fooocus 放在 repositories/Fooocus 里；单独的 Fooocus 直接是 models/
    const nested = j('repositories', 'Fooocus', 'models')
    if (await fs.stat(nested)) return { folders: { checkpoint: fs.join(nested, 'checkpoints'), lora: fs.join(nested, 'loras') }, warnings }
    return { folders: { checkpoint: j('models', 'checkpoints'), lora: j('models', 'loras') }, warnings }
  }
  return {
    folders: {
      checkpoint: j('models', 'checkpoints'),
      lora: j('models', 'loras'),
      diffusion_models: j('models', 'diffusion_models'),
      text_encoders: j('models', 'text_encoders'),
      vae: j('models', 'vae'),
    },
    warnings,
  }
}

/** 校验根目录并给出模型目录；不是该程序的根目录时 flavor 为空并给出提醒 */
export async function resolveLayout(fs: TargetFs, provider: InstallProvider, root: string): Promise<InstallLayout> {
  const warnings: string[] = []
  const st = await fs.stat(root)
  if (!st || !st.isDir) throw new Error(`目录不存在：${root}`)
  let flavor = ''
  try {
    const names = new Set((await fs.readdir(root)).map((e) => e.name))
    const id = identifyRoot(names)
    if (id && id.provider === provider) flavor = id.flavor
    else if (id) warnings.push(`这个目录看起来是 ${id.flavor} 的根目录，不是 ${PROVIDER_LABELS[provider]}；请确认`)
    else warnings.push(`没在这个目录里找到 ${PROVIDER_LABELS[provider]} 的特征文件，请确认选的是程序根目录（模型会放进它下面的 models 目录）`)
  } catch (err: any) {
    warnings.push(err.message)
  }
  const r = await resolveFolders(fs, provider, root)
  return { provider, root, flavor, folders: r.folders, warnings: [...warnings, ...r.warnings] }
}

// ─── 扫描常见位置 ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.npm', '.conda', 'anaconda3', 'miniconda3', 'Library', 'AppData', '$Recycle.Bin',
  'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'proc', 'sys', 'dev',
  'usr', 'bin', 'sbin', 'lib', 'lib64', 'etc', 'var', 'boot', 'snap', 'models', 'venv', '.venv', 'site-packages', 'custom_nodes',
  'outputs', 'output', 'input', 'Pictures', 'Music', 'Movies', 'Videos', 'Photos', 'Applications', 'System', 'private',
])

function scanBases(targetOs: TargetOs, home: string, j: (...p: string[]) => string, drives: string[]): Array<{ dir: string; depth: number }> {
  if (targetOs === 'windows') {
    return [
      { dir: home, depth: 3 },
      { dir: j(home, 'Documents'), depth: 2 },
      { dir: j(home, 'Desktop'), depth: 3 },
      { dir: j(home, 'Downloads'), depth: 3 },
      ...drives.map((d) => ({ dir: d, depth: 3 })),
    ]
  }
  if (targetOs === 'macos') {
    return [
      { dir: home, depth: 3 },
      { dir: j(home, 'Documents'), depth: 2 },
      { dir: j(home, 'Desktop'), depth: 3 },
      { dir: j(home, 'Downloads'), depth: 3 },
      { dir: '/opt', depth: 2 },
      { dir: '/Volumes', depth: 3 },
    ]
  }
  return [
    { dir: home, depth: 3 },
    { dir: '/root', depth: 3 },
    { dir: '/opt', depth: 2 },
    { dir: '/data', depth: 3 },
    { dir: '/workspace', depth: 3 },
    { dir: '/srv', depth: 2 },
    { dir: '/mnt', depth: 3 },
    { dir: '/home', depth: 3 },
  ]
}

async function windowsDrives(fs: TargetFs): Promise<string[]> {
  if (fs.mode === 'local') return localWindowsDrives()
  if (!fs.exec) return ['C:\\']
  try {
    const { psEncoded } = await import('./target')
    const r = await fs.exec(psEncoded('Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }'), 20_000)
    const list = r.stdout.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter((s) => /^[A-Za-z]:\\$/.test(s))
    return list.length ? list : ['C:\\']
  } catch {
    return ['C:\\']
  }
}

/** 在常见位置按特征文件扫描安装目录 */
export async function scanForRoots(fs: TargetFs, opts: { maxDirs?: number; timeoutMs?: number } = {}): Promise<RootCandidate[]> {
  const maxDirs = opts.maxDirs ?? 4000
  const deadline = Date.now() + (opts.timeoutMs ?? 25_000)
  const drives = fs.os === 'windows' ? await windowsDrives(fs) : []
  const bases = scanBases(fs.os, fs.home, (...p) => fs.join(...p), drives)
  const seen = new Set<string>()
  const found: RootCandidate[] = []
  let visited = 0
  const queue: Array<{ dir: string; depth: number }> = [...bases]
  while (queue.length && visited < maxDirs && Date.now() < deadline) {
    const { dir, depth } = queue.shift()!
    const key = fs.os === 'windows' ? dir.toLowerCase() : dir
    if (seen.has(key)) continue
    seen.add(key)
    visited++
    let entries
    try {
      entries = await fs.readdir(dir)
    } catch {
      continue
    }
    const id = identifyRoot(new Set(entries.map((e) => e.name)))
    if (id) {
      found.push({ provider: id.provider, path: dir, flavor: id.flavor, source: 'scan' })
      continue // 程序目录内部不再往下找
    }
    if (depth <= 0) continue
    for (const e of entries) {
      if (!e.isDir || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
      queue.push({ dir: e.path, depth: depth - 1 })
    }
  }
  return found
}

/** 问正在运行的服务要模型目录（ComfyUI / SD WebUI），推出安装根目录 */
export async function detectRootsFromApi(provider: InstallProvider, baseUrl: string, headers: Record<string, string> = {}): Promise<RootCandidate[]> {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return []
  const get = async (p: string) => {
    const resp = await fetch(`${base}${p}`, { headers, signal: AbortSignal.timeout(8_000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.json() as Promise<any>
  }
  const parentOf = (p: string, levels: number) => {
    let s = String(p).replace(/[\\/]+$/, '')
    for (let i = 0; i < levels; i++) s = s.replace(/[\\/][^\\/]+$/, '')
    return s
  }
  try {
    if (provider === 'comfyui') {
      const data = await get('/internal/folder_paths')
      const ck = data?.checkpoints?.[0]
      const dir = Array.isArray(ck) ? ck[0] : ck
      if (typeof dir === 'string' && /checkpoints$/i.test(dir.replace(/[\\/]+$/, ''))) {
        return [{ provider, path: parentOf(dir, 2), flavor: 'ComfyUI（运行中的服务）', source: 'api' }]
      }
    } else if (provider === 'sdwebui') {
      const flags = await get('/sdapi/v1/cmd-flags')
      const dataDir = flags?.data_dir || (flags?.ckpt_dir ? parentOf(flags.ckpt_dir, 2) : '')
      if (typeof dataDir === 'string' && dataDir) return [{ provider, path: dataDir.replace(/[\\/]+$/, ''), flavor: 'SD WebUI（运行中的服务）', source: 'api' }]
    }
  } catch { /* 服务没开或接口不存在 */ }
  return []
}

export async function detectRoots(fs: TargetFs, provider: InstallProvider, api?: { baseUrl?: string; headers?: Record<string, string> }): Promise<RootCandidate[]> {
  const fromApi = api?.baseUrl ? await detectRootsFromApi(provider, api.baseUrl, api.headers) : []
  // API 给出的路径要在目标机上真实存在才算（服务可能在另一台机器上）
  const verified: RootCandidate[] = []
  for (const c of fromApi) if (await fs.stat(c.path)) verified.push(c)
  const scanned = (await scanForRoots(fs)).filter((c) => c.provider === provider)
  const out: RootCandidate[] = []
  const keys = new Set<string>()
  for (const c of [...verified, ...scanned]) {
    const k = fs.os === 'windows' ? c.path.toLowerCase() : c.path
    if (keys.has(k)) continue
    keys.add(k)
    out.push(c)
  }
  return out
}
