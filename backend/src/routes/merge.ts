import { Hono } from 'hono'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest } from '../utils/response.js'
import { mergeEpisodeVideos } from '../services/ffmpeg-merge.js'
import { deleteBgm, listBgm, normalizeBgmOptions, saveBgm } from '../services/bgm.js'
import { normalizeIntroOptions } from '../services/episode-intro.js'
import { deleteIntroFont, listIntroFonts, saveIntroFont } from '../services/intro-fonts.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

// POST /episodes/:id/merge — 拼接镜头视频(body.storyboard_ids 可选,只拼所选)
app.post('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  if (!ep) return badRequest(c, '剧集不存在')

  let storyboardIds: number[] | undefined
  let bgmRaw: unknown = null
  let introRaw: unknown = null
  try {
    const body = await c.req.json()
    if (Array.isArray(body?.storyboard_ids)) {
      storyboardIds = body.storyboard_ids.map(Number).filter(Boolean)
    }
    bgmRaw = body?.bgm
    introRaw = body?.intro
  } catch { /* 无 body 时拼接全部 */ }
  const bgm = normalizeBgmOptions(bgmRaw)
  if (bgmRaw && typeof bgmRaw === 'object' && (bgmRaw as any).path && !bgm) return badRequest(c, '背景音乐无效，请从曲库重新选择')

  try {
    logTaskStart('MergeAPI', 'episode-merge', { episodeId, dramaId: ep.dramaId, storyboardIds })
    // intro: { enabled, duration (1~5 秒), image (static/... 统一封面，空 = 第一个镜头画面), title, subtitle, font, size, color, box, y }
    const mergeId = await mergeEpisodeVideos(episodeId, ep.dramaId, storyboardIds, bgm, normalizeIntroOptions(introRaw))
    logTaskSuccess('MergeAPI', 'episode-merge', { episodeId, mergeId })
    return success(c, { merge_id: mergeId, status: 'processing' })
  } catch (err: any) {
    logTaskError('MergeAPI', 'episode-merge', { episodeId, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /episodes/:id/merge — 查询最新拼接状态
app.get('/episodes/:id/merge', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await db.select().from(schema.videoMerges)
    .where(eq(schema.videoMerges.episodeId, episodeId))


  const latest = merges[merges.length - 1]
  if (!latest) return success(c, null)

  return success(c, toSnakeCase(latest))
})

// GET /episodes/:id/merges — 成片列表(全部拼接记录,新的在前)
app.get('/episodes/:id/merges', async (c) => {
  const episodeId = Number(c.req.param('id'))
  const merges = await db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
  merges.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return success(c, merges.slice(0, 30).map(toSnakeCase))
})

// GET /merge/bgm — 背景音乐曲库
app.get('/bgm', async (c) => success(c, await listBgm()))

// POST /merge/bgm — 上传背景音乐（multipart file）
app.post('/bgm', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, '文件必填')
  try {
    return success(c, await saveBgm(await file.arrayBuffer(), file.name))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /merge/bgm?path=static/bgm/xxx.mp3 — 从曲库删除
app.delete('/bgm', async (c) => {
  const p = c.req.query('path') || ''
  if (!deleteBgm(p)) return badRequest(c, '音乐文件不存在')
  return success(c)
})

// GET /merge/fonts — 片头文字可选字体（本机已有的中文字体 + 上传的字体）
app.get('/fonts', (c) => success(c, listIntroFonts()))

// POST /merge/fonts — 上传字体（multipart file，.ttf / .otf / .ttc）
app.post('/fonts', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, '文件必填')
  try {
    return success(c, await saveIntroFont(await file.arrayBuffer(), file.name))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /merge/fonts?id=static/fonts/xxx.ttf — 删除上传的字体
app.delete('/fonts', (c) => {
  if (!deleteIntroFont(c.req.query('id') || '')) return badRequest(c, '字体不存在')
  return success(c)
})

export default app
