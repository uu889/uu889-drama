/**
 * 模板库路由 — 一键生成（视觉风格）/ 智能体 / 工作流
 *   GET  /catalog                         三板块概览（数量）
 *   GET  /catalog/styles                  风格库（标出是否已加入我的风格）
 *   POST /catalog/styles/:id/import       加入我的风格（style_presets），已存在直接返回
 *   GET  /catalog/skills                  Skill 列表（不带全文）
 *   GET  /catalog/agents[/:id]            智能体模板
 *   PUT  /catalog/agents/:id              新建 / 覆盖为用户版；DELETE 删除用户版
 *   POST /catalog/agents/:id/chat         SSE：delta { text } / done { text } / error { message }
 *   GET  /catalog/workflows[/:id]         工作流模板
 *   PUT  /catalog/workflows/:id           新建 / 覆盖为用户版；DELETE 删除用户版
 *   POST /catalog/workflows/:id/run       SSE：step { id, index } / delta { step, text } / step-done { id, output } / done { outputs } / error
 *   POST /catalog/handoff                 把文字结果建成一键生成项目（项目 + 第一集原文）
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import { Agent } from '@mastra/core/agent'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { describeModelError } from '../utils/model-error.js'
import { toSnakeCase } from '../utils/transform.js'
import { getActiveConfigId } from '../services/ai.js'
import { getContentLanguage } from '../services/app-settings.js'
import { buildLanguageDirective } from '../agents/language.js'
import { cinematicChatDirective, isCinematicActive, normalizeCinematicSpec, saveDramaCinematic } from '../services/cinematic/index.js'
import {
  CATALOG_ID, GENERIC_AGENT, composeAgentInstructions, deleteUserItem, getAgent, getWorkflow,
  listAgents, listSkills, listStyles, listWorkflows, renderTemplate, saveUserAgent, saveUserWorkflow,
  type CatalogAgent,
} from '../services/catalog.js'

const app = new Hono()

const MAX_MESSAGES = 40
const MAX_MESSAGE_CHARS = 60_000

app.get('/', async (c) => {
  return success(c, {
    styles: listStyles().length,
    skills: listSkills().length,
    agents: listAgents().length,
    workflows: listWorkflows().length,
  })
})

// ── 视觉风格 ──
app.get('/styles', async (c) => {
  const presets = await db.select().from(schema.stylePresets)
  const have = new Set(presets.map(p => p.value))
  return success(c, listStyles().map(s => ({ ...s, imported: have.has(s.id) })))
})

app.post('/styles/:id/import', async (c) => {
  const id = c.req.param('id')
  const style = listStyles().find(s => s.id === id)
  if (!style) return notFound(c, '风格不存在')
  const [dup] = await db.select().from(schema.stylePresets).where(eq(schema.stylePresets.value, id))
  if (dup) return success(c, toSnakeCase(dup))
  const ts = now()
  const res = await db.insert(schema.stylePresets).values({
    name: style.name,
    value: style.id,
    prompt: style.prompt,
    description: style.description || null,
    sortOrder: 100,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.stylePresets).where(eq(schema.stylePresets.id, getInsertId(res)))
  return created(c, toSnakeCase(row))
})

// ── Skill ──
app.get('/skills', (c) => success(c, listSkills().map(({ content, ...rest }) => ({ ...rest, length: content.length }))))

// ── 智能体 ──
app.get('/agents', (c) => success(c, listAgents().map(({ instructions, ...rest }) => rest)))

app.get('/agents/:id', (c) => {
  const agent = getAgent(c.req.param('id'))
  if (!agent) return notFound(c, '智能体不存在')
  const skills = listSkills()
  return success(c, {
    ...agent,
    skill_details: agent.skills.map(id => {
      const s = skills.find(x => x.id === id)
      return s ? { id, name: s.name, description: s.description, missing: false } : { id, name: id, description: '', missing: true }
    }),
  })
})

app.put('/agents/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    return success(c, saveUserAgent({ ...body, id: c.req.param('id') }))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/agents/:id', (c) => {
  if (!deleteUserItem('agents', c.req.param('id'))) return badRequest(c, '内置智能体不能删除（只能删除你自建或改过的版本）')
  return success(c)
})

/** 智能体的完整系统提示词（正文 + skill + 影像参数 + 内容语言） */
function instructionsFor(agent: CatalogAgent, cinematic?: unknown): string {
  const lang = getContentLanguage()
  const cine = cinematic ? cinematicChatDirective(normalizeCinematicSpec(cinematic), lang) : ''
  return [composeAgentInstructions(agent, listSkills()), cine, buildLanguageDirective(lang)]
    .filter(Boolean)
    .join('\n\n')
}

async function buildRunner(agent: CatalogAgent, model?: string, configId?: number, cinematic?: unknown) {
  const { getTextModelFor } = await import('../agents/index.js')
  return new Agent({
    id: `catalog_${agent.id.replace(/-/g, '_')}`,
    name: agent.name,
    instructions: instructionsFor(agent, cinematic),
    model: () => getTextModelFor(model, configId),
  })
}

/** 流式跑一次，增量交给 onDelta；返回整段文字（去掉 <think>） */
async function streamText(
  runner: Agent,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onDelta: (text: string) => Promise<void>,
  isAborted: () => boolean,
): Promise<string> {
  const out = await runner.stream(messages as any, { maxSteps: 1 })
  let text = ''
  for await (const chunk of out.fullStream as AsyncIterable<any>) {
    if (isAborted()) break
    if (chunk?.type === 'text-delta') {
      const delta = String(chunk.payload?.text ?? '')
      if (!delta) continue
      text += delta
      await onDelta(delta)
    } else if (chunk?.type === 'error') {
      throw chunk.payload?.error ?? new Error('模型调用失败')
    }
  }
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function cleanMessages(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }))
}

app.post('/agents/:id/chat', async (c) => {
  const agent = getAgent(c.req.param('id'))
  if (!agent) return notFound(c, '智能体不存在')
  const body = await c.req.json().catch(() => ({}))
  const messages = cleanMessages(body.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') return badRequest(c, '请输入内容')
  const runner = await buildRunner(agent, body.model || undefined, Number(body.config_id) || undefined, body.cinematic)

  return streamSSE(c, async (stream) => {
    let aborted = false
    stream.onAbort(() => { aborted = true })
    const send = async (event: string, data: unknown) => {
      if (aborted) return
      try { await stream.writeSSE({ event, data: JSON.stringify(data) }) } catch { aborted = true }
    }
    try {
      const text = await streamText(runner, messages, t => send('delta', { text: t }), () => aborted)
      if (!aborted) await send('done', { text })
    } catch (err) {
      await send('error', { message: describeModelError(err) })
    }
  })
})

// ── 工作流 ──
app.get('/workflows', (c) => success(c, listWorkflows()))

app.get('/workflows/:id', (c) => {
  const wf = getWorkflow(c.req.param('id'))
  if (!wf) return notFound(c, '工作流不存在')
  const agents = listAgents()
  return success(c, {
    ...wf,
    steps: wf.steps.map(s => ({ ...s, agent_name: s.agent ? (agents.find(a => a.id === s.agent)?.name ?? null) : GENERIC_AGENT.name })),
  })
})

app.put('/workflows/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    return success(c, saveUserWorkflow(c.req.param('id'), body))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/workflows/:id', (c) => {
  if (!deleteUserItem('workflows', c.req.param('id'))) return badRequest(c, '内置工作流不能删除（只能删除你自建或改过的版本）')
  return success(c)
})

app.post('/workflows/:id/run', async (c) => {
  const wf = getWorkflow(c.req.param('id'))
  if (!wf) return notFound(c, '工作流不存在')
  const body = await c.req.json().catch(() => ({}))
  const inputs: Record<string, string> = {}
  for (const input of wf.inputs) {
    const v = String(body.inputs?.[input.key] ?? input.default ?? '').slice(0, MAX_MESSAGE_CHARS).trim()
    if (!v && input.required !== false) return badRequest(c, `请填写「${input.label}」`)
    inputs[input.key] = v
  }
  // 从某一步继续：带上之前各步的结果（前端改了某步输出后重跑后面的步骤）
  const startAt = Math.max(0, wf.steps.findIndex(s => s.id === body.start_step))
  const steps: Record<string, string> = {}
  for (const s of wf.steps.slice(0, startAt)) steps[s.id] = String(body.outputs?.[s.id] ?? '')
  const agents = new Map(listAgents().map(a => [a.id, a]))
  for (const s of wf.steps) {
    if (s.agent && !agents.has(s.agent)) return badRequest(c, `步骤「${s.name}」用的智能体 ${s.agent} 不存在`)
  }
  const model = body.model || undefined
  const configId = Number(body.config_id) || undefined

  return streamSSE(c, async (stream) => {
    let aborted = false
    stream.onAbort(() => { aborted = true })
    const send = async (event: string, data: unknown) => {
      if (aborted) return
      try { await stream.writeSSE({ event, data: JSON.stringify(data) }) } catch { aborted = true }
    }
    let previous = startAt > 0 ? steps[wf.steps[startAt - 1].id] : ''
    for (let i = startAt; i < wf.steps.length; i++) {
      if (aborted) return
      const step = wf.steps[i]
      await send('step', { id: step.id, index: i })
      try {
        const agent = step.agent ? agents.get(step.agent)! : GENERIC_AGENT
        const runner = await buildRunner(agent, model, configId, body.cinematic)
        const prompt = renderTemplate(step.prompt, { inputs, steps, previous })
        const text = await streamText(runner, [{ role: 'user', content: prompt }], t => send('delta', { step: step.id, text: t }), () => aborted)
        if (aborted) return
        if (!text) throw new Error('模型没有输出内容，请换个文字模型再试')
        steps[step.id] = text
        previous = text
        await send('step-done', { id: step.id, output: text })
      } catch (err) {
        await send('error', { step: step.id, message: describeModelError(err) })
        return
      }
    }
    await send('done', { outputs: steps })
  })
})

// ── 交给一键生成：建项目 + 第一集，原文写入 ──
app.post('/handoff', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const content = String(body.content || '').trim()
  if (!content) return badRequest(c, '没有可交给一键生成的内容')
  const title = String(body.title || '').trim().slice(0, 60) || content.split(/\r?\n/).find(Boolean)!.slice(0, 30)
  const imageConfigId = await getActiveConfigId('image')
  const videoConfigId = await getActiveConfigId('video')
  if (!imageConfigId || !videoConfigId) return badRequest(c, '还没有启用的图片 / 视频生成配置，请先到设置里添加')

  let style: string | null = typeof body.style === 'string' && CATALOG_ID.test(body.style) ? body.style : null
  if (style) {
    const [preset] = await db.select().from(schema.stylePresets).where(eq(schema.stylePresets.value, style))
    if (!preset) {
      const cs = listStyles().find(s => s.id === style)
      if (cs) {
        const ts = now()
        await db.insert(schema.stylePresets).values({
          name: cs.name, value: cs.id, prompt: cs.prompt, description: cs.description || null,
          sortOrder: 100, isActive: true, createdAt: ts, updatedAt: ts,
        })
      } else {
        style = null
      }
    }
  }
  const ts = now()
  const dramaRes = await db.insert(schema.dramas).values({
    title,
    style,
    aspectRatio: ['16:9', '9:16', '1:1', 'adaptive'].includes(body.aspect_ratio) ? body.aspect_ratio : '16:9',
    metadata: body.workflow_id ? JSON.stringify({ from_workflow: String(body.workflow_id).slice(0, 64) }) : null,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  })
  const dramaId = getInsertId(dramaRes)
  // 智能体 / 工作流里设的影像参数一起带进项目（一键生成的四个 Agent 和视频生成都会用到）
  if (body.cinematic && typeof body.cinematic === 'object') {
    const spec = normalizeCinematicSpec(body.cinematic)
    if (isCinematicActive(spec)) await saveDramaCinematic(dramaId, spec)
  }
  await db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: 1,
    title: '第1集',
    content,
    imageConfigId,
    videoConfigId,
    resolution: '720p',
    createdAt: ts,
    updatedAt: ts,
  })
  return created(c, { drama_id: dramaId, episode_number: 1 })
})

export default app
