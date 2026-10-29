/**
 * 分镜接口附带的派生信息：台词计时（前端显示「台词 X 秒 / 分镜 Y 秒」，超过单镜上限时附带能拆成几段）与成片结尾帧
 */
import fs from 'fs'
import { checkShotTiming } from './shot-direction.js'
import { planShotSplit } from './shot-split.js'
import { getAbsolutePath } from '../utils/storage.js'
import { endFramePathFor } from '../utils/video-poster.js'

export function storyboardTiming(
  row: { description?: string | null; videoPrompt?: string | null; duration?: number | null },
  characterNames: string[] = [],
  maxSeconds = 15,
) {
  const t = checkShotTiming(row.description, Number(row.duration || 0), characterNames, row.videoPrompt, maxSeconds)
  const plan = t.overMax ? planShotSplit({ description: row.description, videoPrompt: row.videoPrompt, names: characterNames, maxSeconds }) : null
  return {
    lines: t.lines.length,
    speech_seconds: t.speechSeconds,
    needed_seconds: t.neededSeconds,
    idle_seconds: t.idleSeconds,
    status: t.status,
    recommended: t.recommended,
    /** prompt = 按视频提示词里的台词算；description = 提示词没写台词，按分镜描述算 */
    source: t.source,
    /** 单镜上限（秒） */
    max_seconds: t.maxSeconds,
    /** 台词本身超过单镜上限：只能拆成几个分镜 */
    over_max: t.overMax,
    /** 自动拆开会拆成几段（0 = 不用拆或拆不开） */
    split_parts: plan?.parts.length || 0,
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
