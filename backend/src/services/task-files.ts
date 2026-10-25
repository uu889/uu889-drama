/**
 * 删除生成记录时一起删除本地文件（历史视频批量删除，省硬盘空间）
 *
 * 一个视频任务在磁盘上不止一个文件：
 *   static/videos/x.mp4          原视频
 *   static/videos/x_poster.jpg   封面帧
 *   static/videos/x_last.jpg     接戏用的结尾帧
 *   static/videos/x_sub.mp4      带字幕版（任务 local_path 这时指向它）+ x_sub.srt / x_sub_poster.jpg / x_sub_last.jpg
 * 图片任务：x.png + x_thumb.webp。
 * 高清化结果（x_1080p.mp4）是另一条任务记录，不在这里删。
 *
 * 安全：只删数据目录 static/ 下的文件；同一组文件还被别的任务记录 / 分镜首尾帧引用时不删；
 * 分镜正在用这个视频时改用这个分镜最新的另一条成片（没有就清空）。
 */
import fs from 'fs'
import path from 'path'
import { and, eq, ne } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getAbsolutePath, thumbPathFor } from '../utils/storage.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { now } from '../utils/response.js'

const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv']

/** 只认站内相对路径 static/...（远程地址、绝对路径、带 .. 的一律不碰） */
function isLocalStatic(rel: string | null | undefined): rel is string {
  return !!rel && rel.startsWith('static/') && !rel.includes('..') && !/^[a-z]+:\/\//i.test(rel)
}

/** 一条任务在磁盘上对应的全部文件（相对路径） */
export function taskFileFamily(type: string, localPath: string | null | undefined): string[] {
  if (!isLocalStatic(localPath)) return []
  if (type === 'image') return [localPath, thumbPathFor(localPath)]
  const dir = path.posix.dirname(localPath)
  const stem = path.posix.basename(localPath).replace(/\.[^.]+$/, '')
  const base = stem.replace(/_sub$/, '')
  const names = new Set<string>([path.posix.basename(localPath)])
  for (const ext of VIDEO_EXTS) names.add(base + ext)
  for (const s of [base, `${base}_sub`]) {
    names.add(`${s}_poster.jpg`)
    names.add(`${s}_last.jpg`)
  }
  names.add(`${base}_sub.mp4`)
  names.add(`${base}_sub.srt`)
  return [...names].map(n => `${dir}/${n}`)
}

/** 删除文件；返回实际删掉的文件数和字节数 */
function removeFiles(rels: string[]): { files: number; bytes: number } {
  const root = path.resolve(STORAGE_ROOT)
  let files = 0
  let bytes = 0
  for (const rel of rels) {
    const abs = path.resolve(getAbsolutePath(rel))
    if (!abs.startsWith(root + path.sep)) continue
    try {
      const st = fs.statSync(abs)
      if (!st.isFile()) continue
      fs.rmSync(abs, { force: true })
      files++
      bytes += st.size
    } catch { /* 文件不存在 / 删不掉：跳过 */ }
  }
  return { files, bytes }
}

export interface TaskDeleteResult {
  id: number
  deleted: boolean
  files: number
  bytes: number
  /** 同组文件还被别处引用，只删了记录 */
  keptFiles?: boolean
  /** 分镜原来用这个视频，改用了哪一条（null = 清空） */
  storyboardVideo?: string | null
}

/** 删除一条任务记录；withFiles = true 时连本地文件一起删 */
export async function deleteTaskWithFiles(id: number, withFiles = true): Promise<TaskDeleteResult> {
  const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!row) return { id, deleted: false, files: 0, bytes: 0 }
  const family = withFiles ? taskFileFamily(row.type, row.localPath) : []
  const result: TaskDeleteResult = { id, deleted: true, files: 0, bytes: 0 }

  // 分镜正在用这个视频：改用这个分镜最新的另一条成片
  if (row.type === 'video' && row.storyboardId && isLocalStatic(row.localPath)) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, row.storyboardId))
    const own = new Set(taskFileFamily('video', row.localPath))
    if (sb?.videoUrl && own.has(sb.videoUrl)) {
      const others = (await db.select().from(schema.sysTask)
        .where(and(eq(schema.sysTask.storyboardId, row.storyboardId), eq(schema.sysTask.type, 'video'), ne(schema.sysTask.id, id))))
        .filter(t => t.status === 'completed' && t.localPath && !own.has(t.localPath))
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id - a.id)
      const next = others[0]?.localPath ?? null
      const subtitleUrl = sb.subtitleUrl && own.has(sb.subtitleUrl) ? null : sb.subtitleUrl
      await db.update(schema.storyboards)
        .set({ videoUrl: next, subtitleUrl, updatedAt: now() })
        .where(eq(schema.storyboards.id, row.storyboardId))
      result.storyboardVideo = next
    }
  }

  await db.delete(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!family.length) return result

  // 同一组文件还被别的记录引用（重复记录 / 首尾帧用了结尾帧）：保留文件
  const familySet = new Set(family)
  const otherTasks = await db.select({ localPath: schema.sysTask.localPath, type: schema.sysTask.type }).from(schema.sysTask)
  const usedByTask = otherTasks.some(t => t.localPath && familySet.has(t.localPath))
  const frames = await db.select({ a: schema.storyboards.firstFrameImage, b: schema.storyboards.lastFrameImage, v: schema.storyboards.videoUrl }).from(schema.storyboards)
  const usedByShot = frames.some(f => [f.a, f.b, f.v].some(x => x && familySet.has(x)))
  if (usedByTask || usedByShot) {
    result.keptFiles = true
    return result
  }
  Object.assign(result, removeFiles(family))
  return result
}
