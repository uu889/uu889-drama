/**
 * 创作会话存储：studio_sessions（设置 / 一贯性设定 / 界面时间线）+ studio_assets（图片 / 视频 / 成片素材）
 */
import fs from 'fs'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, getInsertId, schema } from '../../db/index.js'
import { now } from '../../utils/response.js'
import { getAbsolutePath } from '../../utils/storage.js'
import { getTaskProgress } from '../task-progress.js'
import { DEFAULT_SETTINGS, emptyBible, normalizeBible, normalizeSettings, type StudioBible, type StudioSettings } from './consistency.js'

export type SessionKind = 'agent' | 'workflow'

/** 界面时间线上的一块：用户消息 / 智能体文字 / 工具卡片 / 任务清单 / 提醒 */
export interface TimelineBlock {
  id: string
  type: 'user' | 'assistant' | 'tool' | 'plan' | 'notice'
  text?: string
  tool?: string
  label?: string
  args?: any
  status?: 'running' | 'done' | 'error'
  result?: any
  asset_ids?: number[]
  steps?: Array<{ title: string; status: string }>
  at: string
}

export interface StudioSession {
  id: number
  kind: SessionKind
  refId: string
  title: string
  settings: StudioSettings
  bible: StudioBible
  timeline: TimelineBlock[]
  status: string
  errorMsg: string | null
  createdAt: string
  updatedAt: string
}

export interface StudioAsset {
  id: number
  sessionId: number
  kind: string
  role: string | null
  name: string
  prompt: string | null
  taskId: number | null
  path: string | null
  status: string
  errorMsg: string | null
  meta: Record<string, any>
  createdAt: string
  updatedAt: string
}

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) ?? fallback } catch { return fallback }
}

function toSession(row: typeof schema.studioSessions.$inferSelect): StudioSession {
  return {
    id: row.id,
    kind: row.kind as SessionKind,
    refId: row.refId,
    title: row.title,
    settings: normalizeSettings(parse(row.settings, {}), DEFAULT_SETTINGS),
    bible: normalizeBible(parse(row.bible, emptyBible())),
    timeline: parse<TimelineBlock[]>(row.timeline, []),
    status: row.status,
    errorMsg: row.errorMsg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toAsset(row: typeof schema.studioAssets.$inferSelect): StudioAsset {
  return { ...row, meta: parse<Record<string, any>>(row.meta, {}) }
}

export async function createSession(input: { kind: SessionKind; refId: string; title: string; settings?: unknown; bible?: unknown }): Promise<StudioSession> {
  const ts = now()
  const res = await db.insert(schema.studioSessions).values({
    kind: input.kind,
    refId: input.refId,
    title: input.title.slice(0, 80) || '新会话',
    settings: JSON.stringify(normalizeSettings(input.settings)),
    bible: JSON.stringify(normalizeBible(input.bible ?? emptyBible())),
    timeline: '[]',
    status: 'idle',
    createdAt: ts,
    updatedAt: ts,
  })
  return (await getSession(getInsertId(res)))!
}

export async function getSession(id: number): Promise<StudioSession | null> {
  const [row] = await db.select().from(schema.studioSessions).where(eq(schema.studioSessions.id, id))
  return row ? toSession(row) : null
}

export async function listSessions(kind: SessionKind, refId?: string) {
  const where = refId ? and(eq(schema.studioSessions.kind, kind), eq(schema.studioSessions.refId, refId)) : eq(schema.studioSessions.kind, kind)
  const rows = await db.select({
    id: schema.studioSessions.id,
    kind: schema.studioSessions.kind,
    refId: schema.studioSessions.refId,
    title: schema.studioSessions.title,
    status: schema.studioSessions.status,
    createdAt: schema.studioSessions.createdAt,
    updatedAt: schema.studioSessions.updatedAt,
  }).from(schema.studioSessions).where(where).orderBy(desc(schema.studioSessions.updatedAt)).limit(50)
  return rows
}

export async function updateSession(id: number, patch: Partial<Pick<StudioSession, 'title' | 'settings' | 'bible' | 'timeline' | 'status' | 'errorMsg'>>) {
  const set: Record<string, any> = { updatedAt: now() }
  if (patch.title !== undefined) set.title = patch.title.slice(0, 80)
  if (patch.settings !== undefined) set.settings = JSON.stringify(patch.settings)
  if (patch.bible !== undefined) set.bible = JSON.stringify(patch.bible)
  if (patch.timeline !== undefined) set.timeline = JSON.stringify(patch.timeline)
  if (patch.status !== undefined) set.status = patch.status
  if (patch.errorMsg !== undefined) set.errorMsg = patch.errorMsg
  await db.update(schema.studioSessions).set(set).where(eq(schema.studioSessions.id, id))
}

export async function deleteSession(id: number, deleteFiles = true) {
  const assets = await listAssets(id)
  if (deleteFiles) {
    for (const a of assets) {
      // 只删本会话自己生成 / 截取 / 合成的文件；生成任务的文件由任务记录管理（sys_task 保留）
      if (a.path && ['frame', 'render', 'upload', 'voice'].includes(a.kind)) {
        try { fs.rmSync(getAbsolutePath(a.path), { force: true }) } catch { /* 忽略 */ }
      }
    }
  }
  await db.delete(schema.studioAssets).where(eq(schema.studioAssets.sessionId, id))
  await db.delete(schema.studioSessions).where(eq(schema.studioSessions.id, id))
}

export async function addAsset(input: {
  sessionId: number; kind: string; role?: string | null; name: string; prompt?: string | null
  taskId?: number | null; path?: string | null; status?: string; errorMsg?: string | null; meta?: Record<string, any>
}): Promise<StudioAsset> {
  const ts = now()
  const res = await db.insert(schema.studioAssets).values({
    sessionId: input.sessionId,
    kind: input.kind,
    role: input.role ?? null,
    name: input.name.slice(0, 80) || input.kind,
    prompt: input.prompt ?? null,
    taskId: input.taskId ?? null,
    path: input.path ?? null,
    status: input.status ?? (input.path ? 'completed' : 'processing'),
    errorMsg: input.errorMsg ?? null,
    meta: JSON.stringify(input.meta || {}),
    createdAt: ts,
    updatedAt: ts,
  })
  return (await getAsset(getInsertId(res)))!
}

export async function getAsset(id: number): Promise<StudioAsset | null> {
  const [row] = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.id, id))
  return row ? toAsset(row) : null
}

export async function updateAsset(id: number, patch: Partial<Pick<StudioAsset, 'path' | 'status' | 'errorMsg' | 'meta' | 'name' | 'taskId'>>) {
  const set: Record<string, any> = { updatedAt: now() }
  if (patch.path !== undefined) set.path = patch.path
  if (patch.status !== undefined) set.status = patch.status
  if (patch.errorMsg !== undefined) set.errorMsg = patch.errorMsg
  if (patch.meta !== undefined) set.meta = JSON.stringify(patch.meta)
  if (patch.name !== undefined) set.name = patch.name
  if (patch.taskId !== undefined) set.taskId = patch.taskId
  await db.update(schema.studioAssets).set(set).where(eq(schema.studioAssets.id, id))
}

export async function listAssets(sessionId: number): Promise<StudioAsset[]> {
  const rows = await db.select().from(schema.studioAssets).where(eq(schema.studioAssets.sessionId, sessionId)).orderBy(schema.studioAssets.id)
  return rows.map(toAsset)
}

/**
 * 生成任务（sys_task）的结果同步到素材：完成写路径，失败写原因；返回同步后的素材
 */
export async function syncAssets(assets: StudioAsset[]): Promise<StudioAsset[]> {
  const pending = assets.filter(a => a.status === 'processing' && a.taskId)
  if (!pending.length) return assets
  const tasks = await db.select().from(schema.sysTask).where(inArray(schema.sysTask.id, pending.map(a => a.taskId!)))
  const byId = new Map(tasks.map(t => [t.id, t]))
  for (const a of pending) {
    const t = byId.get(a.taskId!)
    if (!t) {
      a.status = 'failed'
      a.errorMsg = '生成任务记录已被删除'
      await updateAsset(a.id, { status: a.status, errorMsg: a.errorMsg })
    } else if (t.status === 'completed' && t.localPath) {
      a.status = 'completed'
      a.path = t.localPath
      a.errorMsg = t.errorMsg || null
      await updateAsset(a.id, { status: 'completed', path: a.path, errorMsg: a.errorMsg })
    } else if (t.status === 'failed') {
      a.status = 'failed'
      a.errorMsg = t.errorMsg || '生成失败'
      await updateAsset(a.id, { status: 'failed', errorMsg: a.errorMsg })
    }
  }
  return assets
}

/** 给前端的素材：附生成进度 */
export function assetDto(a: StudioAsset) {
  const progress = a.status === 'processing' && a.taskId ? getTaskProgress(a.taskId) : null
  return {
    id: a.id,
    kind: a.kind,
    role: a.role,
    name: a.name,
    prompt: a.prompt,
    task_id: a.taskId,
    path: a.path,
    status: a.status,
    error_msg: a.errorMsg,
    meta: a.meta,
    progress,
    created_at: a.createdAt,
  }
}
