/**
 * 分镜接口附带的派生信息：台词计时（前端显示「台词 X 秒 / 分镜 Y 秒」）与成片结尾帧
 */
import fs from 'fs'
import { checkShotTiming } from './shot-direction.js'
import { getAbsolutePath } from '../utils/storage.js'
import { endFramePathFor } from '../utils/video-poster.js'

export function storyboardTiming(row: { description?: string | null; duration?: number | null }, characterNames: string[] = []) {
  const t = checkShotTiming(row.description, Number(row.duration || 0), characterNames)
  return {
    lines: t.lines.length,
    speech_seconds: t.speechSeconds,
    needed_seconds: t.neededSeconds,
    idle_seconds: t.idleSeconds,
    status: t.status,
    recommended: t.recommended,
  }
}

/** 视频的结尾帧已提取时返回其相对路径 */
export function existingEndFrame(videoUrl: string | null | undefined): string | null {
  const v = String(videoUrl || '')
  if (!v.startsWith('static/')) return null
  const rel = endFramePathFor(v)
  try {
    return fs.existsSync(getAbsolutePath(rel)) ? rel : null
  } catch {
    return null
  }
}
