/**
 * Agent 聊天路由 — 非流式版本；剧本改写另有打字机模式（SSE 流式）
 */
import { rewriteSourceText } from '../services/source-attachments.js'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { buildTypewriterMessage, cleanStreamedScript } from '../agents/script-stream.js'
import { validAgentTypes } from '../agents/index.js'
import { buildAgentRequestContext } from '../agents/context.js'
import { mastra } from '../mastra/index.js'
import { success, badRequest } from '../utils/response.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { describeModelError } from '../utils/model-error.js'
import { splitOverlongShots, type SplitResult } from '../services/shot-split.js'

const app = new Hono()

// Mastra v1.17 的 ToolCallChunk / ToolResultChunk 结构：
// { type: 'tool-call', payload: { toolCallId, toolName, args } }
// { type: 'tool-result', payload: { toolCallId, toolName, result, isError } }
function normalizeToolName(entry: any) {
  return entry?.payload?.toolName
    || entry?.toolName
    || entry?.tool?.toolName
    || entry?.tool?.id
    || entry?.name
    || entry?.type
    || null
}

function normalizeToolResult(entry: any) {
  const result = entry?.payload?.result ?? entry?.result ?? entry?.payload?.output ?? entry?.output ?? entry?.data ?? null
  return typeof result === 'string' ? result : JSON.stringify(result)
}

// POST /agent/:type/chat — 非流式 Agent 对话
app.post('/:type/chat', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) {
    return badRequest(c, `无效的 Agent 类型：${agentType}`)
  }

  const body = await c.req.json()
  const { message, drama_id, episode_id } = body

  logTaskStart('Agent', agentType, {
    dramaId: drama_id,
    episodeId: episode_id,
    message,
  })
  logTaskPayload('Agent', `${agentType} input`, body)

  if (!episode_id || !drama_id) {
    logTaskError('Agent', agentType, { reason: 'missing drama_id or episode_id' })
    return badRequest(c, '需要 drama_id 与 episode_id')
  }

  const agent = mastra.getAgent(agentType)
  if (!agent) {
    logTaskError('Agent', agentType, { reason: 'agent not found' })
    return badRequest(c, 'Agent 不存在')
  }

  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })

  const startTime = performance.now()

  try {
    const result = await agent.generate(
      [{ role: 'user', content: message }],
      { maxSteps: 20, requestContext },
    )

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    logTaskSuccess('Agent', agentType, { elapsedSeconds: elapsed })

    // 收集所有 tool calls 和 results
    const toolCalls = result.toolCalls || []
    const toolResults = result.toolResults || []
    const normalizedToolCalls = toolCalls.map((tc: any) => ({
      toolName: normalizeToolName(tc),
      args: tc?.payload?.args ?? tc?.args ?? tc?.input ?? null,
    }))
    const normalizedToolResults = toolResults.map((tr: any) => ({
      toolName: normalizeToolName(tr),
      result: normalizeToolResult(tr),
    }))

    logTaskProgress('Agent', 'tool-summary', {
      agentType,
      toolCalls: normalizedToolCalls.map((tc: any) => tc.toolName),
      toolResults: normalizedToolResults.map((tr: any) => tr.toolName),
    })
    logTaskPayload('Agent', `${agentType} tool-results`, normalizedToolResults)

    // 拆分镜 Agent 不一定按单镜上限拆：拆完后台词仍超过上限的分镜由系统按台词自动拆开（已有视频的不动）
    let autoSplit: SplitResult | null = null
    if (agentType === 'storyboard_breaker') {
      autoSplit = await splitOverlongShots(Number(episode_id)).catch((err: any) => {
        logTaskError('ShotSplit', 'after-breakdown', { episodeId: episode_id, error: err?.message })
        return null
      })
    }

    return success(c, {
      type: 'done',
      text: result.text || '',
      toolCalls: normalizedToolCalls,
      toolResults: normalizedToolResults,
      ...(autoSplit?.split.length ? { auto_split: autoSplit } : {}),
    })
  } catch (err: any) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    const message = describeModelError(err)
    logTaskError('Agent', agentType, { elapsedSeconds: elapsed, error: message })
    console.error(err.stack || err)
    return badRequest(c, message)
  }
})

// POST /agent/script_rewriter/stream — 打字机模式：改写结果边生成边推给前端（SSE），写完保存
// 事件：delta { text } 增量；done { content, word_count } 已保存；error { message }
// 前端主动断开（点「停止」）时不保存
app.post('/script_rewriter/stream', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { drama_id, episode_id } = body
  if (!episode_id || !drama_id) return badRequest(c, '需要 drama_id 与 episode_id')
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episode_id))
  if (!ep) return badRequest(c, '剧集不存在')
  // 原文 + 上传的附件（txt / PDF / Word / 图片识别出的文字）
  const source = (await rewriteSourceText(ep.id, ep.content) || ep.scriptContent || '').trim()
  if (!source) return badRequest(c, '本集还没有原始内容，请先填写原文或上传文件')
  const agent = mastra.getAgent('script_rewriter')
  if (!agent) return badRequest(c, 'Agent 不存在')

  const requestContext = buildAgentRequestContext({
    episodeId: episode_id,
    dramaId: drama_id,
    modelOverride: body.model || undefined,
    textConfigId: body.config_id || undefined,
  })
  logTaskStart('Agent', 'script_rewriter:stream', { dramaId: drama_id, episodeId: episode_id, sourceLength: source.length })
  const startTime = performance.now()

  return streamSSE(c, async (stream) => {
    let aborted = false
    stream.onAbort(() => { aborted = true })
    const send = async (event: string, data: unknown) => {
      if (aborted) return
      try { await stream.writeSSE({ event, data: JSON.stringify(data) }) } catch { aborted = true }
    }
    try {
      const out = await agent.stream(
        [{ role: 'user', content: buildTypewriterMessage(source, typeof body.message === 'string' ? body.message : '') }],
        // 不给工具：模型只能把剧本写成正文，正文才能逐字流式输出
        { maxSteps: 1, activeTools: [], requestContext },
      )
      let text = ''
      for await (const chunk of out.fullStream as AsyncIterable<any>) {
        if (aborted) break
        if (chunk?.type === 'text-delta') {
          const delta = String(chunk.payload?.text ?? '')
          if (!delta) continue
          text += delta
          await send('delta', { text: delta })
        } else if (chunk?.type === 'error') {
          throw chunk.payload?.error ?? new Error('模型调用失败')
        }
      }
      if (aborted) {
        logTaskProgress('Agent', 'script_rewriter:stream-aborted', { episodeId: episode_id, length: text.length })
        return
      }
      const content = cleanStreamedScript(text)
      if (!content) throw new Error('模型没有输出剧本内容，请换个文本模型或改用「一次性生成」再试')
      await db.update(schema.episodes)
        .set({ scriptContent: content, updatedAt: now() })
        .where(eq(schema.episodes.id, episode_id))
      logTaskSuccess('Agent', 'script_rewriter:stream', {
        elapsedSeconds: ((performance.now() - startTime) / 1000).toFixed(1),
        length: content.length,
      })
      await send('done', { content, word_count: content.length })
    } catch (err: any) {
      const message = describeModelError(err)
      logTaskError('Agent', 'script_rewriter:stream', { error: message })
      await send('error', { message })
    }
  })
})

// GET /agent/:type/debug
app.get('/:type/debug', async (c) => {
  const agentType = c.req.param('type')
  if (!validAgentTypes.includes(agentType)) return badRequest(c, '无效的 Agent 类型')
  return success(c, { agent_type: agentType, valid: true })
})

export default app
