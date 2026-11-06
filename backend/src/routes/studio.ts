/**
 * 创作会话路由 — 智能体 / 工作流里直接生图、生视频、剪成片（不跳到一键生成）
 *   GET    /studio/sessions?kind=agent&ref_id=xxx   会话列表
 *   POST   /studio/sessions                         新建 { kind, ref_id, title?, settings?, style_id?, message?, model?, config_id?, cinematic? }（带 message 就直接开跑）
 *   GET    /studio/sessions/:id                     会话（时间线 / 设置 / 一贯性设定）+ 素材（含生成进度）+ running
 *   PATCH  /studio/sessions/:id                     改标题 / 设置 / 画风基调 / 设定条目
 *   DELETE /studio/sessions/:id                     删除会话（截帧 / 成片 / 上传文件一起删）
 *   POST   /studio/sessions/:id/messages            发消息 { text, model?, config_id?, cinematic? }，后台运行
 *   POST   /studio/sessions/:id/stop                停止（本轮还在生成的任务一并取消）
 *   POST   /studio/sessions/:id/uploads             上传素材（图片 / 视频 / 音频，multipart files）
 *   DELETE /studio/sessions/:id/assets/:aid         从会话里移除素材
 */
import { Hono } from 'hono'
import { success, created, badRequest, notFound } from '../utils/response.js'
import { saveUploadedFile, generateImageThumb } from '../utils/storage.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { listStyles } from '../services/catalog.js'
import { normalizeBible, normalizeSettings } from '../services/studio/consistency.js'
import {
  addAsset, assetDto, createSession, deleteSession, getAsset, getSession, listAssets, listSessions, syncAssets, updateSession,
  type SessionKind,
} from '../services/studio/store.js'
import { isRunning, startRun, stopRun } from '../services/studio/runner.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'

const app = new Hono()

const KINDS = new Set(['agent', 'workflow'])
const UPLOAD_MAX = 100 * 1024 * 1024
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

function runOpts(body: any) {
  return {
    model: typeof body?.model === 'string' && body.model ? body.model : undefined,
    configId: Number(body?.config_id) || undefined,
    cinematic: body?.cinematic && typeof body.cinematic === 'object' ? body.cinematic : undefined,
  }
}

async function sessionView(id: number) {
  const s = await getSession(id)
  if (!s) return null
  const running = isRunning(id)
  // 进程重启后残留的 running：当作已结束
  if (s.status === 'running' && !running) {
    s.status = 'idle'
    await updateSession(id, { status: 'idle' })
  }
  const assets = await syncAssets(await listAssets(id))
  return {
    id: s.id,
    kind: s.kind,
    ref_id: s.refId,
    title: s.title,
    settings: s.settings,
    bible: s.bible,
    timeline: s.timeline,
    status: s.status,
    error_msg: s.errorMsg,
    running,
    assets: assets.map(assetDto),
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  }
}

/** 选了风格库的风格：画风基调用它的提示词 */
function bibleWithStyle(styleId: unknown, bible?: unknown) {
  const b = normalizeBible(bible || {})
  if (typeof styleId === 'string' && styleId) {
    const s = listStyles().find(x => x.id === styleId)
    if (s) return { ...b, style: s.prompt, style_id: s.id }
  }
  return b
}

app.get('/sessions', async (c) => {
  const kind = c.req.query('kind') || 'agent'
  if (!KINDS.has(kind)) return badRequest(c, 'kind 只能是 agent / workflow')
  const rows = await listSessions(kind as SessionKind, c.req.query('ref_id') || undefined)
  return success(c, rows.map(r => ({ ...r, ref_id: r.refId, created_at: r.createdAt, updated_at: r.updatedAt, running: isRunning(r.id) })))
})

app.post('/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = String(body.kind || 'agent')
  const refId = String(body.ref_id || '').trim()
  if (!KINDS.has(kind)) return badRequest(c, 'kind 只能是 agent / workflow')
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(refId)) return badRequest(c, 'ref_id 无效')
  const s = await createSession({
    kind: kind as SessionKind,
    refId,
    title: String(body.title || '').trim() || '新会话',
    settings: body.settings,
    bible: bibleWithStyle(body.style_id, body.bible),
  })
  if (typeof body.message === 'string' && body.message.trim()) {
    try {
      await startRun(s.id, body.message, runOpts(body))
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }
  return created(c, await sessionView(s.id))
})

app.get('/sessions/:id', async (c) => {
  const view = await sessionView(Number(c.req.param('id')))
  return view ? success(c, view) : notFound(c, '会话不存在')
})

app.patch('/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const s = await getSession(id)
  if (!s) return notFound(c, '会话不存在')
  const body = await c.req.json().catch(() => ({}))
  const patch: Parameters<typeof updateSession>[1] = {}
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
  if (body.settings && typeof body.settings === 'object') patch.settings = normalizeSettings(body.settings, s.settings)
  if (body.bible && typeof body.bible === 'object') {
    const next = normalizeBible({ ...s.bible, ...body.bible })
    patch.bible = body.style_id !== undefined ? bibleWithStyle(body.style_id, next) : next
  } else if (body.style_id !== undefined) {
    patch.bible = bibleWithStyle(body.style_id, s.bible)
  }
  await updateSession(id, patch)
  return success(c, await sessionView(id))
})

app.delete('/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isRunning(id)) await stopRun(id)
  await deleteSession(id, c.req.query('keep_files') !== '1')
  return success(c)
})

app.post('/sessions/:id/messages', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  try {
    await startRun(id, String(body.text || ''), runOpts(body))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
  return success(c, await sessionView(id))
})

app.post('/sessions/:id/stop', async (c) => {
  const id = Number(c.req.param('id'))
  await stopRun(id)
  return success(c, await sessionView(id))
})

app.post('/sessions/:id/uploads', async (c) => {
  const id = Number(c.req.param('id'))
  if (!(await getSession(id))) return notFound(c, '会话不存在')
  const body = await c.req.parseBody({ all: true })
  const raw = body['files'] ?? body['file']
  const files = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => f instanceof File)
  if (!files.length) return badRequest(c, '请选择文件')
  const out = []
  for (const f of files.slice(0, 10)) {
    const kind = IMAGE_EXT.test(f.name) ? 'image' : VIDEO_EXT.test(f.name) ? 'video' : AUDIO_EXT.test(f.name) ? 'audio' : null
    if (!kind) return badRequest(c, `不支持的文件：${f.name}（图片 / 视频 / 音频）`)
    if (f.size > UPLOAD_MAX) return badRequest(c, `${f.name} 超过 100MB`)
    const rel = await saveUploadedFile(await f.arrayBuffer(), 'studio/uploads', f.name)
    if (kind === 'image') await generateImageThumb(rel).catch(() => null)
    if (kind === 'video') await extractVideoPoster(rel).catch(() => null)
    const a = await addAsset({ sessionId: id, kind: 'upload', role: kind, name: f.name.slice(0, 60), path: rel, meta: { media: kind } })
    out.push(assetDto(a))
  }
  return created(c, out)
})

app.delete('/sessions/:id/assets/:aid', async (c) => {
  const id = Number(c.req.param('id'))
  const a = await getAsset(Number(c.req.param('aid')))
  if (!a || a.sessionId !== id) return notFound(c, '素材不存在')
  await db.delete(schema.studioAssets).where(eq(schema.studioAssets.id, a.id))
  // 设定图被删：设定里去掉图片（外观描述保留）
  const s = await getSession(id)
  if (s?.bible.entries.some(e => e.asset_id === a.id)) {
    await updateSession(id, { bible: { ...s.bible, entries: s.bible.entries.map(e => (e.asset_id === a.id ? { ...e, asset_id: null, path: null } : e)) } })
  }
  return success(c)
})

export default app
