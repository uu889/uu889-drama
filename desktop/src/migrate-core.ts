/**
 * 存储迁移的文件操作（不依赖 Electron，便于测试）
 *
 * - 目标目录：选了已有内容的文件夹（如 D:\ 或某个项目目录）时，自动在里面建 UU889Drama-Data 子目录
 * - 同盘判断：用 stat().dev（statfs 没有 dev 字段，旧代码会把所有情况都当成同盘）
 * - 同盘：逐个顶层条目 rename；Windows 上被杀毒 / 索引短暂占用（EPERM / EBUSY / EACCES）时重试，
 *   仍失败就改为复制该条目；中途出错把已经搬过去的条目搬回来，旧目录保持完整
 * - 跨盘：清单复制 → 字节数复核 → 删除旧目录；删旧目录失败不算迁移失败（数据已在新位置）
 */
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'

export const DATA_SUBDIR = 'UU889Drama-Data'

export interface MoveProgress {
  copiedBytes: number
  totalBytes: number
}

export interface MoveResult {
  /** 旧目录没能删掉（被占用）：数据已在新位置，旧目录可以手动删除 */
  leftover?: string
}

export function normCaseFor(platform: string, p: string): string {
  return platform === 'win32' ? p.toLowerCase() : p
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    // 忽略系统自动生成的隐藏文件（.DS_Store / Thumbs.db / desktop.ini）
    const children = (await fsp.readdir(dir)).filter((n) => !/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(n))
    return children.length === 0
  } catch {
    return true
  }
}

/**
 * 用户选的目录 → 实际使用的数据目录。
 * 不存在或是空目录：直接用；已有内容：用其中的 UU889Drama-Data 子目录（该子目录也已有内容时报错）。
 */
export async function resolveMigrationTarget(picked: string, currentDir: string, platform = process.platform): Promise<string> {
  const target = path.resolve(picked)
  const st = await fsp.stat(target).catch(() => null)
  if (st && !st.isDirectory()) throw new Error('选择的路径不是文件夹')
  const norm = (p: string) => normCaseFor(platform, path.resolve(p))
  const cur = norm(currentDir)
  if (norm(target) === cur) throw new Error('不能选择当前数据目录')
  if (!st || (await isEmptyDir(target))) return target
  const sub = path.join(target, DATA_SUBDIR)
  if (norm(sub) === cur) throw new Error('不能选择当前数据目录')
  if (!(await isEmptyDir(sub))) {
    throw new Error(`「${target}」里已有内容，且其中的 ${DATA_SUBDIR} 文件夹也不是空的；请选择一个空文件夹`)
  }
  return sub
}

/** 校验目标目录（已经过 resolveMigrationTarget），返回要搬的总字节数 */
export async function validateTarget(target: string, currentDir: string, platform = process.platform): Promise<number> {
  const st = await fsp.stat(target).catch(() => null)
  if (!st) await fsp.mkdir(target, { recursive: true })
  else if (!st.isDirectory()) throw new Error('目标路径不是文件夹')
  else if (!(await isEmptyDir(target))) throw new Error('目标文件夹必须为空')

  const probe = path.join(target, `.uu889-probe-${Date.now()}`)
  try {
    await fsp.writeFile(probe, 'probe')
    await fsp.rm(probe, { force: true })
  } catch (err) {
    throw new Error(`目标文件夹不可写：${(err as Error).message}`)
  }

  const sep = path.sep
  const a = normCaseFor(platform, path.resolve(currentDir))
  const b = normCaseFor(platform, path.resolve(target))
  if (b === a) throw new Error('不能选择当前数据目录')
  if (b.startsWith(a + sep)) throw new Error('目标文件夹在当前数据目录里面')
  if (a.startsWith(b + sep)) throw new Error('目标文件夹是当前数据目录的上级目录')

  const totalBytes = await dirSize(currentDir)
  if (!(await sameVolume(currentDir, target))) {
    try {
      const fsInfo = await fsp.statfs(target)
      const free = fsInfo.bavail * fsInfo.bsize
      if (free < totalBytes * 1.05) {
        throw new Error(`目标磁盘空间不足：需要约 ${((totalBytes * 1.05) / 1024 ** 3).toFixed(1)} GB，剩余 ${(free / 1024 ** 3).toFixed(1)} GB`)
      }
    } catch (err) {
      if (/空间不足/.test((err as Error).message)) throw err
    }
  }
  return totalBytes
}

/** 两个路径是否在同一个卷（同盘 rename 不占额外空间） */
export async function sameVolume(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)])
    return sa.dev === sb.dev
  } catch {
    return false // 判定不了按跨盘处理（逐文件复制更稳妥）
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(full)
    else if (e.isFile()) total += (await fsp.stat(full).catch(() => null))?.size || 0
  }
  return total
}

interface FileEntry { rel: string; size: number }

async function listFiles(dir: string, base = dir, out: FileEntry[] = []): Promise<FileEntry[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await listFiles(full, base, out)
    else if (e.isFile()) out.push({ rel: path.relative(base, full), size: (await fsp.stat(full)).size })
  }
  return out
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])

/** rename，被临时占用时重试几次 */
async function renameWithRetry(src: string, dst: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(src, dst)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code || ''
      if (!RETRY_CODES.has(code) || i >= attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
}

/** 删除目录，被占用时重试；最终失败返回 false */
async function removeWithRetry(dir: string): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  return false
}

/** 复制一组文件（相对 oldDir），复制完核对字节数 */
async function copyFiles(oldDir: string, newDir: string, files: FileEntry[], onProgress: (p: MoveProgress) => void, done = { bytes: 0 }, total = 0): Promise<void> {
  const totalBytes = total || files.reduce((s, f) => s + f.size, 0)
  for (const f of files) {
    const dst = path.join(newDir, f.rel)
    await fsp.mkdir(path.dirname(dst), { recursive: true })
    await fsp.copyFile(path.join(oldDir, f.rel), dst)
    const size = (await fsp.stat(dst)).size
    if (size !== f.size) throw new Error(`复制校验失败：${f.rel}（${size} / ${f.size} 字节）`)
    done.bytes += f.size
    onProgress({ copiedBytes: done.bytes, totalBytes })
  }
}

/**
 * 搬移数据目录内容。复核通过前绝不删旧目录；同盘中途失败会把已搬条目搬回去。
 */
export async function moveData(oldDir: string, newDir: string, onProgress: (p: MoveProgress) => void = () => {}): Promise<MoveResult> {
  await fsp.mkdir(newDir, { recursive: true })
  const totalBytes = await dirSize(oldDir)

  if (await sameVolume(oldDir, newDir)) {
    const top = await fsp.readdir(oldDir, { withFileTypes: true })
    const moved: string[] = []
    const copied: string[] = []
    const done = { bytes: 0 }
    try {
      for (const e of top) {
        const src = path.join(oldDir, e.name)
        const dst = path.join(newDir, e.name)
        try {
          await renameWithRetry(src, dst)
          moved.push(e.name)
          done.bytes += e.isDirectory() ? await dirSize(dst) : (await fsp.stat(dst)).size
          onProgress({ copiedBytes: done.bytes, totalBytes })
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code || ''
          if (code !== 'EXDEV' && !RETRY_CODES.has(code)) throw err
          // 跨设备（挂载点）或一直被占用：改为复制这个条目，旧的保留到最后统一删除
          const files = e.isDirectory() ? await listFiles(src, oldDir) : [{ rel: e.name, size: (await fsp.stat(src)).size }]
          await copyFiles(oldDir, newDir, files, onProgress, done, totalBytes)
          copied.push(e.name)
        }
      }
    } catch (err) {
      // 回滚：搬过去的搬回来，复制过去的删掉
      for (const name of moved.reverse()) await renameWithRetry(path.join(newDir, name), path.join(oldDir, name)).catch(() => {})
      for (const name of copied) await fsp.rm(path.join(newDir, name), { recursive: true, force: true }).catch(() => {})
      throw err
    }
    return (await removeWithRetry(oldDir)) ? {} : { leftover: oldDir }
  }

  // 跨盘：全量清单 → 逐文件复制（每个文件核对大小）→ 总数复核 → 删旧
  const files = await listFiles(oldDir)
  try {
    await copyFiles(oldDir, newDir, files, onProgress)
    const copiedFiles = await listFiles(newDir)
    const copiedTotal = copiedFiles.reduce((s, f) => s + f.size, 0)
    const expected = files.reduce((s, f) => s + f.size, 0)
    if (copiedFiles.length !== files.length || copiedTotal !== expected) {
      throw new Error(`迁移校验失败：文件数 ${copiedFiles.length}/${files.length}，字节 ${copiedTotal}/${expected}`)
    }
  } catch (err) {
    // 新目录里复制了一半的内容清掉，旧目录原样保留
    for (const name of await fsp.readdir(newDir).catch(() => [] as string[])) {
      await fsp.rm(path.join(newDir, name), { recursive: true, force: true }).catch(() => {})
    }
    throw err
  }
  return (await removeWithRetry(oldDir)) ? {} : { leftover: oldDir }
}

/** Electron ipcRenderer.invoke 抛出的错误带「Error invoking remote method 'x': Error: 」前缀，去掉只留原因 */
export function cleanIpcError(message: string): string {
  return String(message || '').replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}
