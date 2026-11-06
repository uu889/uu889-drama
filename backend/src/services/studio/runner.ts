/**
 * 创作会话的运行：后台跑智能体（带工具），把文字增量 / 工具卡片写进会话时间线；
 * 前端轮询会话拿进度，关掉页面也不影响生成（再打开能看到结果）。
 */
import { Agent } from '@mastra/core/agent'
import { describeModelError } from '../../utils/model-error.js'
import { getContentLanguage } from '../app-settings.js'
import { buildLanguageDirective } from '../../agents/language.js'
import { cinematicChatDirective, normalizeCinematicSpec } from '../cinematic/index.js'
import { composeAgentInstructions, getAgent, listSkills, GENERIC_AGENT, type CatalogAgent } from '../catalog.js'
import { listAssets, syncAssets, getSession, updateSession, type TimelineBlock, type StudioSession } from './store.js'
import { sessionStateNote, studioToolsPrompt } from './prompt.js'
import { buildStudioTools, cancelRunTasks, TOOL_LABELS } from './tools.js'

interface Run {
  controller: AbortController
  taskIds: Set<number>
}

const runs = new Map<number, Run>()

export const isRunning = (sessionId: number) => runs.has(sessionId)

export const VIDEO_AGENT_ID = 'video-director'

/** 会话用哪个智能体：智能体会话 = 自己；工作流会话 = settings.agent_id，默认「视频智能体」 */
export function sessionAgent(s: StudioSession): CatalogAgent {
  const id = s.kind === 'agent' ? s.refId : (s.settings.agent_id || VIDEO_AGENT_ID)
  return getAgent(id) || getAgent(VIDEO_AGENT_ID) || GENERIC_AGENT
}

const MAX_HISTORY = 40
const MAX_CHARS = 60_000

/** 时间线 → 给模型的历史消息（工具卡片折成一行结果，接在智能体回复里） */
export function timelineToMessages(timeline: TimelineBlock[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  const push = (role: 'user' | 'assistant', text: string) => {
    if (!text.trim()) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n${text}`
    else out.push({ role, content: text })
  }
  for (const b of timeline) {
    if (b.type === 'user') push('user', b.text || '')
    else if (b.type === 'assistant') push('assistant', b.text || '')
    else if (b.type === 'tool') {
      const r = b.result || {}
      const what = r.summary || (r.error ? `失败：${r.error}` : r.ok ? '完成' : '')
      push('assistant', `[${TOOL_LABELS[b.tool || ''] || b.tool}] ${what}`.slice(0, 400))
    }
  }
  const trimmed = out.slice(-MAX_HISTORY).map(m => ({ ...m, content: m.content.slice(-MAX_CHARS) }))
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift()
  return trimmed
}

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

export interface RunOptions {
  model?: string
  configId?: number
  cinematic?: unknown
}

/** 发一条消息并在后台开跑；同一会话同时只跑一个 */
export async function startRun(sessionId: number, text: string, opts: RunOptions = {}): Promise<void> {
  if (runs.has(sessionId)) throw new Error('这个会话正在运行，请等它结束或先停止')
  const session = await getSession(sessionId)
  if (!session) throw new Error('会话不存在')
  const content = text.trim().slice(0, MAX_CHARS)
  if (!content) throw new Error('请输入内容')

  const timeline = [...session.timeline]
  timeline.push({ id: newId(), type: 'user', text: content, at: new Date().toISOString() })
  const title = session.timeline.length ? undefined : content.split(/\r?\n/)[0].slice(0, 30)
  await updateSession(sessionId, { timeline, status: 'running', errorMsg: null, ...(title ? { title } : {}) })

  const run: Run = { controller: new AbortController(), taskIds: new Set() }
  runs.set(sessionId, run)
  execute(session, timeline, run, opts)
    .catch(async (err: any) => {
      // 启动阶段（拼提示词 / 建工具）就出错：写进时间线，别让会话无声无息地停下
      console.error(`[Studio] session ${sessionId} run failed:`, err)
      timeline.push({ id: newId(), type: 'notice', text: describeModelError(err), at: new Date().toISOString() })
      await updateSession(sessionId, { timeline, status: 'error', errorMsg: describeModelError(err) }).catch(() => null)
    })
    .finally(() => runs.delete(sessionId))
}

export async function stopRun(sessionId: number): Promise<boolean> {
  const run = runs.get(sessionId)
  if (!run) return false
  run.controller.abort()
  await cancelRunTasks(run.taskIds)
  return true
}

async function execute(session: StudioSession, timeline: TimelineBlock[], run: Run, opts: RunOptions) {
  const sessionId = session.id
  const agentDef = sessionAgent(session)
  const lang = getContentLanguage()
  const state = { settings: session.settings, bible: session.bible }
  const assets = await syncAssets(await listAssets(sessionId))

  let dirty = false
  let lastSave = 0
  const save = async (force = false) => {
    if (!dirty && !force) return
    const t = Date.now()
    if (!force && t - lastSave < 800) return
    lastSave = t
    dirty = false
    await updateSession(sessionId, { timeline })
  }
  const add = (b: Omit<TimelineBlock, 'id' | 'at'>) => {
    const block = { id: newId(), at: new Date().toISOString(), ...b } as TimelineBlock
    timeline.push(block)
    dirty = true
    return block
  }

  let planBlock: TimelineBlock | null = timeline.slice().reverse().find(b => b.type === 'plan') || null
  const tools = buildStudioTools({
    sessionId,
    signal: run.controller.signal,
    state,
    clipCount: { n: 0 },
    taskIds: run.taskIds,
    model: opts.model,
    configId: opts.configId,
    onPlan: (steps) => {
      // 同一轮里的清单原地更新；新一轮新建
      if (planBlock && timeline.indexOf(planBlock) > lastUserIndex(timeline)) planBlock.steps = steps
      else planBlock = add({ type: 'plan', steps })
      dirty = true
    },
  })

  const cine = opts.cinematic ? cinematicChatDirective(normalizeCinematicSpec(opts.cinematic), lang) : ''
  const instructions = [
    composeAgentInstructions(agentDef, listSkills()),
    state.settings.tools ? studioToolsPrompt(state.settings) : '',
    cine,
    state.settings.tools ? sessionStateNote(state.settings, state.bible, assets) : '',
    buildLanguageDirective(lang),
  ].filter(Boolean).join('\n\n---\n\n')

  const { getTextModelFor } = await import('../../agents/index.js')
  const agent = new Agent({
    id: `studio_${agentDef.id.replace(/-/g, '_')}`,
    name: agentDef.name,
    instructions,
    model: () => getTextModelFor(opts.model, opts.configId),
    ...(state.settings.tools ? { tools } : {}),
  })

  const messages = timelineToMessages(timeline)
  const toolBlocks = new Map<string, TimelineBlock>()
  let textBlock: TimelineBlock | null = null
  let errorMsg: string | null = null
  const heartbeat = setInterval(() => { save().catch(() => null) }, 1000)
  try {
    const out = await agent.stream(messages as any, {
      maxSteps: 40,
      toolCallConcurrency: 6,
      abortSignal: run.controller.signal,
    } as any)
    for await (const chunk of out.fullStream as AsyncIterable<any>) {
      if (run.controller.signal.aborted) break
      const p = chunk?.payload || {}
      if (chunk?.type === 'text-delta') {
        const delta = String(p.text ?? '')
        if (!delta) continue
        if (!textBlock) textBlock = add({ type: 'assistant', text: '' })
        textBlock.text = (textBlock.text || '') + delta
        dirty = true
      } else if (chunk?.type === 'tool-call') {
        textBlock = null
        if (p.toolName === 'update_plan') continue
        const b = add({ type: 'tool', tool: p.toolName, label: TOOL_LABELS[p.toolName] || p.toolName, args: p.args, status: 'running' })
        toolBlocks.set(p.toolCallId, b)
      } else if (chunk?.type === 'tool-result' || chunk?.type === 'tool-error') {
        const b = toolBlocks.get(p.toolCallId)
        if (!b) continue
        const result = chunk.type === 'tool-error' ? { ok: false, error: String(p.error?.message || p.error || '工具出错') } : p.result
        b.result = result
        b.status = result?.ok === false ? 'error' : 'done'
        const ids = [result?.asset_id, ...(Array.isArray(result?.image_asset_ids) ? result.image_asset_ids : [])].filter((x: any) => Number(x) > 0)
        if (ids.length) b.asset_ids = ids
        dirty = true
      } else if (chunk?.type === 'error') {
        throw p.error ?? new Error('模型调用失败')
      }
    }
  } catch (err: any) {
    if (!run.controller.signal.aborted) errorMsg = describeModelError(err)
  } finally {
    clearInterval(heartbeat)
  }
  // 中途停止：还在跑的工具卡片标成停止
  for (const b of toolBlocks.values()) {
    if (b.status === 'running') {
      b.status = 'error'
      b.result = { ok: false, error: run.controller.signal.aborted ? '已停止' : '没有完成' }
    }
  }
  // 时间线里删掉空的文字块
  for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i].type === 'assistant' && !String(timeline[i].text || '').trim()) timeline.splice(i, 1)
  if (run.controller.signal.aborted) add({ type: 'notice', text: '已停止' })
  if (errorMsg) add({ type: 'notice', text: errorMsg })
  await updateSession(sessionId, { timeline, status: errorMsg ? 'error' : 'idle', errorMsg })
}

function lastUserIndex(timeline: TimelineBlock[]): number {
  for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i].type === 'user') return i
  return -1
}
