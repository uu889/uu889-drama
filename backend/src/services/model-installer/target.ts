/**
 * 模型安装的目标机器：本机（运行 UU889-Drama 后端的这台电脑）或远程（SSH 登录的 Windows / macOS / Linux）。
 *
 * 两种目标对外是同一套接口（TargetFs）：判断系统、列目录、查文件大小、查剩余空间、执行命令。
 * 路径统一用「目标机原生写法」：Windows 为 C:\\a\\b，macOS / Linux 为 /a/b。
 * 远程 Windows 的 SFTP 需要 /C:/a/b 形式，内部自动转换。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type TargetOs = 'windows' | 'macos' | 'linux'

export interface RemoteLogin {
  host: string
  port?: number
  username: string
  /** password | key */
  auth?: 'password' | 'key'
  password?: string
  /** OpenSSH 私钥文本（-----BEGIN ... PRIVATE KEY-----） */
  privateKey?: string
  passphrase?: string
}

export interface InstallTarget {
  mode: 'local' | 'remote'
  remote?: RemoteLogin
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size: number
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface TargetFs {
  mode: 'local' | 'remote'
  os: TargetOs
  home: string
  hostname: string
  join(...parts: string[]): string
  dirname(p: string): string
  stat(p: string): Promise<{ size: number; isDir: boolean } | null>
  readdir(p: string): Promise<DirEntry[]>
  freeBytes(p: string): Promise<number | null>
  /** 本机返回 null（本机下载由后端进程直接完成，不执行命令） */
  exec?(command: string, timeoutMs?: number): Promise<ExecResult>
  writeFile?(p: string, content: string): Promise<void>
  readFile?(p: string): Promise<string | null>
  mkdirp?(p: string): Promise<void>
  close(): void
}

export function localOs(): TargetOs {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
}

// ─── 路径工具（按目标系统）────────────────────────────────────────────────

export function joinFor(targetOs: TargetOs, ...parts: string[]): string {
  if (targetOs === 'windows') return path.win32.join(...parts.map((p) => p.replace(/\//g, '\\')))
  return path.posix.join(...parts.map((p) => p.replace(/\\/g, '/')))
}

export function dirnameFor(targetOs: TargetOs, p: string): string {
  return targetOs === 'windows' ? path.win32.dirname(p.replace(/\//g, '\\')) : path.posix.dirname(p)
}

/** 用户输入的路径规范化：去引号、去末尾分隔符、~ 展开、Windows 统一反斜杠 */
export function normalizeTargetPath(targetOs: TargetOs, home: string, input: string): string {
  let p = String(input || '').trim().replace(/^["']|["']$/g, '')
  if (!p) return p
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = joinFor(targetOs, home, p.slice(1))
  if (targetOs === 'windows') {
    p = p.replace(/\//g, '\\')
    // /C:/foo（SFTP 写法）→ C:\foo
    p = p.replace(/^\\([A-Za-z]:)/, '$1')
    if (/^[A-Za-z]:$/.test(p)) p += '\\'
    if (p.length > 3) p = p.replace(/\\+$/, '')
  } else if (p.length > 1) {
    p = p.replace(/\/+$/, '')
  }
  return p
}

/** Windows 原生路径 → SFTP 路径（C:\a → /C:/a） */
export function toSftpPath(targetOs: TargetOs, p: string): string {
  if (targetOs !== 'windows') return p
  const fwd = p.replace(/\\/g, '/')
  return /^[A-Za-z]:/.test(fwd) ? `/${fwd}` : fwd
}

// ─── 本机 ─────────────────────────────────────────────────────────────────

export function openLocalTarget(): TargetFs {
  const tos = localOs()
  return {
    mode: 'local',
    os: tos,
    home: os.homedir(),
    hostname: os.hostname(),
    join: (...parts) => path.join(...parts),
    dirname: (p) => path.dirname(p),
    async stat(p) {
      try {
        const st = await fs.promises.stat(p)
        return { size: st.size, isDir: st.isDirectory() }
      } catch {
        return null
      }
    },
    async readdir(p) {
      const entries = await fs.promises.readdir(p, { withFileTypes: true })
      const out: DirEntry[] = []
      for (const e of entries) {
        const full = path.join(p, e.name)
        let isDir = e.isDirectory()
        if (e.isSymbolicLink()) {
          try { isDir = (await fs.promises.stat(full)).isDirectory() } catch { continue }
        }
        out.push({ name: e.name, path: full, isDir, size: 0 })
      }
      return out
    },
    async freeBytes(p) {
      try {
        let dir = p
        while (dir && !fs.existsSync(dir)) {
          const parent = path.dirname(dir)
          if (parent === dir) break
          dir = parent
        }
        const st = await fs.promises.statfs(dir)
        return Number(st.bavail) * Number(st.bsize)
      } catch {
        return null
      }
    },
    close() {},
  }
}

/** 本机 Windows 的可用盘符（C:\ D:\ …） */
export function localWindowsDrives(): string[] {
  const out: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    try {
      if (fs.existsSync(root)) out.push(root)
    } catch { /* 无权限 */ }
  }
  return out
}

// ─── 远程（SSH + SFTP）────────────────────────────────────────────────────

/** sh 单引号转义 */
export function shQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** PowerShell 单引号转义 */
export function psQuote(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** PowerShell -EncodedCommand（UTF-16LE base64），避开 cmd / sh 多层引号 */
export function psEncoded(script: string): string {
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
}

function friendlySshError(err: any, login: RemoteLogin): string {
  const msg = String(err?.message || err)
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return `找不到主机 ${login.host}，请检查地址`
  if (/ECONNREFUSED/.test(msg)) return `连接被拒绝：${login.host}:${login.port || 22} 没有开 SSH 服务（Windows 需安装 OpenSSH Server，macOS 需在「共享」里开启「远程登录」）`
  if (/ETIMEDOUT|Timed out/i.test(msg)) return `连接超时：${login.host}:${login.port || 22}，请检查网络、防火墙或端口`
  if (/authentication/i.test(msg)) return '登录失败：用户名、密码或私钥不对'
  if (/privateKey|Cannot parse/i.test(msg)) return '私钥无法解析：请粘贴完整的 OpenSSH 私钥（含 BEGIN / END 行），有密码的私钥要填私钥密码'
  return `SSH 连接失败：${msg}`
}

export async function openRemoteTarget(login: RemoteLogin): Promise<TargetFs> {
  if (!login?.host || !login?.username) throw new Error('请填写远程主机地址和用户名')
  const { Client } = await import('ssh2')
  const client = new Client()
  // 密码登录的 keyboard-interactive（部分 macOS / Linux 只开了这种方式）；必须在 connect 前挂上，否则密码错误时会一直等到超时
  client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => login.password || '')))
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (err) => reject(new Error(friendlySshError(err, login))))
    try {
      client.connect({
        host: login.host.trim(),
        port: Number(login.port) || 22,
        username: login.username.trim(),
        password: login.auth === 'key' ? undefined : login.password,
        privateKey: login.auth === 'key' ? login.privateKey : undefined,
        passphrase: login.auth === 'key' ? login.passphrase || undefined : undefined,
        readyTimeout: 20_000,
        keepaliveInterval: 15_000,
        tryKeyboard: login.auth !== 'key',
      })
    } catch (err) {
      reject(new Error(friendlySshError(err, login)))
    }
  })
  const exec = (command: string, timeoutMs = 60_000) => new Promise<ExecResult>((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        try { stream.close() } catch { /* ignore */ }
        reject(new Error(`远程命令超时（${Math.round(timeoutMs / 1000)} 秒）`))
      }, timeoutMs)
      stream.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
      stream.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8') })
      stream.on('close', (code: number) => {
        clearTimeout(timer)
        resolve({ code: code ?? 0, stdout, stderr })
      })
    })
  })

  // 判断系统：uname 成功 → Linux / macOS；否则按 Windows（OpenSSH 默认 shell 是 cmd）
  let tos: TargetOs = 'linux'
  let home = ''
  let hostname = login.host
  const uname = await exec('uname -s', 15_000).catch(() => null)
  const unameOut = uname?.stdout.trim() || ''
  if (uname && uname.code === 0 && /^(Linux|Darwin)/.test(unameOut)) {
    tos = unameOut.startsWith('Darwin') ? 'macos' : 'linux'
    const info = await exec('printf "%s\\n%s" "$HOME" "$(hostname)"', 15_000)
    const [h, hn] = info.stdout.split('\n')
    home = (h || '').trim() || '/'
    hostname = (hn || '').trim() || hostname
  } else {
    tos = 'windows'
    const info = await exec(psEncoded('Write-Output $env:USERPROFILE; Write-Output $env:COMPUTERNAME'), 20_000)
    const [h, hn] = info.stdout.replace(/\r/g, '').split('\n')
    home = (h || '').trim() || 'C:\\'
    hostname = (hn || '').trim() || hostname
  }

  const sftp: any = await new Promise((resolve, reject) => client.sftp((err, s) => (err ? reject(new Error(`SFTP 不可用：${err.message}（服务器需要开启 sftp 子系统）`)) : resolve(s))))
  const sp = (p: string) => toSftpPath(tos, p)

  const target: TargetFs = {
    mode: 'remote',
    os: tos,
    home,
    hostname,
    join: (...parts) => joinFor(tos, ...parts),
    dirname: (p) => dirnameFor(tos, p),
    stat: (p) => new Promise((resolve) => {
      sftp.stat(sp(p), (err: any, st: any) => resolve(err ? null : { size: Number(st.size), isDir: st.isDirectory() }))
    }),
    readdir: (p) => new Promise((resolve, reject) => {
      sftp.readdir(sp(p), (err: any, list: any[]) => {
        if (err) return reject(new Error(`无法读取目录 ${p}：${err.message}`))
        resolve(list
          .filter((e) => e.filename !== '.' && e.filename !== '..')
          .map((e) => ({
            name: e.filename,
            path: joinFor(tos, p, e.filename),
            // 符号链接按目录处理（常见于 models 软链到数据盘）
            isDir: e.attrs.isDirectory() || e.attrs.isSymbolicLink(),
            size: Number(e.attrs.size || 0),
          })))
      })
    }),
    async freeBytes(p) {
      try {
        if (tos === 'windows') {
          const drive = (p.match(/^([A-Za-z]):/) || [])[1] || 'C'
          const r = await exec(psEncoded(`(Get-PSDrive -Name ${drive}).Free`), 20_000)
          const n = Number(r.stdout.trim())
          return Number.isFinite(n) ? n : null
        }
        let dir = p
        for (let i = 0; i < 20; i++) {
          if (await target.stat(dir)) break
          const parent = dirnameFor(tos, dir)
          if (parent === dir) break
          dir = parent
        }
        const r = await exec(`df -Pk ${shQuote(dir)} | tail -1`, 20_000)
        const cols = r.stdout.trim().split(/\s+/)
        const kb = Number(cols[3])
        return Number.isFinite(kb) ? kb * 1024 : null
      } catch {
        return null
      }
    },
    exec,
    writeFile: (p, content) => new Promise((resolve, reject) => {
      sftp.writeFile(sp(p), content, (err: any) => (err ? reject(new Error(`写入 ${p} 失败：${err.message}`)) : resolve()))
    }),
    readFile: (p) => new Promise((resolve) => {
      sftp.readFile(sp(p), (err: any, buf: Buffer) => resolve(err ? null : buf.toString('utf8')))
    }),
    async mkdirp(p) {
      const cmd = tos === 'windows'
        ? psEncoded(`New-Item -ItemType Directory -Force -Path ${psQuote(p)} | Out-Null`)
        : `mkdir -p ${shQuote(p)}`
      const r = await exec(cmd, 30_000)
      if (r.code !== 0) throw new Error(`创建目录 ${p} 失败：${(r.stderr || r.stdout).trim()}`)
    },
    close() {
      try { client.end() } catch { /* ignore */ }
    },
  }
  return target
}

export async function openTarget(target: InstallTarget): Promise<TargetFs> {
  if (target?.mode === 'remote') return openRemoteTarget(target.remote as RemoteLogin)
  return openLocalTarget()
}

/** 不带密码 / 私钥的远程信息（返回给前端、写日志用） */
export function publicTarget(target: InstallTarget | null | undefined) {
  if (!target || target.mode !== 'remote') return { mode: 'local' as const }
  const r = target.remote || ({} as RemoteLogin)
  return { mode: 'remote' as const, host: r.host, port: r.port || 22, username: r.username, auth: r.auth || 'password' }
}
