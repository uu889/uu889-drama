/**
 * 视频海报帧提取 — 供 <video poster> 使用，避免列表页为显示首帧而缓冲整个视频
 */
import fs from 'fs'
import path from 'path'
import { getAbsolutePath } from './storage.js'
import { ffmpeg, checkFfmpegSuite } from './ffmpeg.js'

/** 由视频相对路径推导海报帧路径：static/videos/x.mp4 → static/videos/x_poster.jpg */
export function posterPathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_poster.jpg')
}

/**
 * 抽取视频 0.5s 处画面作为海报帧（宽 640，等比缩放，与原视频同目录）。
 * 失败返回 null，不阻断主流程。
 */
export async function extractVideoPoster(relativePath: string): Promise<string | null> {
  try {
    // ffmpeg 二进制损坏（跨平台拷贝 node_modules / 下载不完整）时静默跳过，
    // 避免 fluent-ffmpeg 延迟回调里的同步 EFTYPE 崩掉整个进程
    const { ffmpeg: ffmpegOk } = await checkFfmpegSuite()
    if (!ffmpegOk) return null

    const posterRel = posterPathFor(relativePath)
    const posterAbs = getAbsolutePath(posterRel)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(getAbsolutePath(relativePath))
        .screenshots({
          timestamps: ['0.5'],
          filename: path.basename(posterAbs),
          folder: path.dirname(posterAbs),
          size: '640x?',
        })
        .on('end', () => resolve())
        .on('error', reject)
    })
    return posterRel
  } catch (err) {
    console.warn(`[video-poster] 海报帧提取失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}

/** 由视频相对路径推导结尾帧路径：static/videos/x.mp4 → static/videos/x_last.jpg */
export function endFramePathFor(relativePath: string): string {
  return relativePath.replace(/\.[^./]+$/, '_last.jpg')
}

/**
 * 抽取视频最后一帧（原分辨率，高质量 JPEG），供下一个镜头「接戏」做首帧 / 参考图。
 * 已存在直接返回；失败返回 null，不阻断主流程。
 */
export async function extractVideoEndFrame(relativePath: string, force = false): Promise<string | null> {
  try {
    const endRel = endFramePathFor(relativePath)
    const endAbs = getAbsolutePath(endRel)
    if (!force && fs.existsSync(endAbs) && fs.statSync(endAbs).size > 0) return endRel
    const { ffmpeg: ffmpegOk } = await checkFfmpegSuite()
    if (!ffmpegOk) return null
    await new Promise<void>((resolve, reject) => {
      ffmpeg(getAbsolutePath(relativePath))
        // 从结尾往前 0.2 秒开始读，取第一帧即最后一帧附近（避开个别编码器末尾的黑帧 / 空帧）
        .inputOptions(['-sseof', '-0.2'])
        .outputOptions(['-frames:v', '1', '-q:v', '2', '-y'])
        .output(endAbs)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
    return fs.existsSync(endAbs) ? endRel : null
  } catch (err) {
    console.warn(`[video-end-frame] 结尾帧提取失败 ${relativePath}:`, (err as Error).message)
    return null
  }
}
