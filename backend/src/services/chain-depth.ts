/**
 * 接戏链代数：一个视频的结尾帧已经被「上一镜结尾帧 → 首帧」连续接了几代。
 *
 * 图生视频每过一代都会把上一代的压缩块、过度锐化、饱和度 / 对比度漂移原样带进来再放大一点，
 * 同场景连着十几个镜头都拿上一镜结尾帧做首帧时，后面的镜头会越来越糊、越来越艳（重绘也救不回来，
 * 因为首帧本身已经坏了）。前端据此在代数到上限时不再把结尾帧当首帧，改作参考图或只用文字接戏，
 * 让画面从角色 / 场景原图重新起一代。
 *
 * 代数 = 0：这个视频不是从别的镜头结尾帧起的（首帧是原图 / 没有首帧）
 * 代数 = n：首帧是某个视频的结尾帧，而那个视频的代数是 n - 1
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

/** 结尾帧最多连续当几代首帧；到了就换成参考图 / 文字接戏 */
export const MAX_FIRST_FRAME_GENERATIONS = 2

const END_FRAME_RE = /_last\.jpg$/i
const MAX_WALK = 50

/** 把 /static/…、http://host/static/…、static/… 统一成 static/… 相对路径 */
export function toStaticRel(url: string | null | undefined): string | null {
  const s = String(url || '').trim().split('?')[0]
  const i = s.indexOf('static/')
  return i >= 0 ? s.slice(i) : null
}

/** static/videos/x_last.jpg → static/videos/x.mp4（结尾帧路径换回视频路径的候选） */
export function videoPathsForEndFrame(endFrameRel: string): string[] {
  if (!END_FRAME_RE.test(endFrameRel)) return []
  const base = endFrameRel.replace(END_FRAME_RE, '')
  return ['.mp4', '.mov', '.webm', '.mkv'].map(ext => base + ext)
}

function parseParams(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

export type TaskLookup = (videoRel: string) => Promise<{ provider?: string | null; params?: string | null } | null>

async function dbLookup(videoRel: string) {
  const rows = await db.select({ provider: schema.sysTask.provider, params: schema.sysTask.params, id: schema.sysTask.id })
    .from(schema.sysTask)
    .where(eq(schema.sysTask.localPath, videoRel))
  return rows.sort((a, b) => b.id - a.id)[0] || null
}

/**
 * 视频（static/… 相对路径）的接戏代数。查不到生成记录（手动上传 / 记录已删）按 0 算。
 * lookup 可替换，便于测试。
 */
export async function videoChainDepth(videoUrl: string | null | undefined, lookup: TaskLookup = dbLookup): Promise<number> {
  let video = toStaticRel(videoUrl)
  let depth = 0
  const seen = new Set<string>()
  for (let i = 0; video && i < MAX_WALK; i++) {
    if (seen.has(video)) break
    seen.add(video)
    const task = await lookup(video)
    if (!task) break
    const params = parseParams(task.params)
    // 高清化结果：看它的原视频
    if (task.provider === 'upscale') {
      video = toStaticRel(params?.upscale?.source)
      continue
    }
    const first = toStaticRel(params.firstFrameUrl || params.imageUrl)
    if (!first || !END_FRAME_RE.test(first)) break
    depth++
    let next: string | null = null
    for (const candidate of videoPathsForEndFrame(first)) {
      if (await lookup(candidate)) { next = candidate; break }
    }
    if (!next) break
    video = next
  }
  return depth
}
