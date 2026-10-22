import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-typewriter-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { db, initDb, schema, getInsertId } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { default: agentRoutes } = await import('../src/routes/agent')
const { buildTypewriterMessage, cleanStreamedScript } = await import('../src/agents/script-stream')

test('cleanStreamedScript strips think blocks, code fences and a short preamble', () => {
  assert.equal(cleanStreamedScript('<think>嗯</think>\n```markdown\n## S1 | 内景 · 客厅 | 夜\n小明：你好\n```'), '## S1 | 内景 · 客厅 | 夜\n小明：你好')
  assert.equal(cleanStreamedScript('好的，以下是改写后的剧本：\n\n## S1 | 外景 · 街道 | 日\n动作'), '## S1 | 外景 · 街道 | 日\n动作')
  assert.equal(cleanStreamedScript('## S1 | 内景 · 卧室 | 晨'), '## S1 | 内景 · 卧室 | 晨')
  assert.match(buildTypewriterMessage('原文内容'), /不要调用任何工具[\s\S]*【原始内容】\n\n原文内容$/)
})

// ─── 模拟 OpenAI 兼容的流式 chat/completions ───
const PIECES = ['## S1 | 内景 · 客厅 | 夜\n', '小明推门进来。\n', '小明：（喘气）我回来了。']
let lastBody: any = null
let server: http.Server
let episodeId = 0
let dramaId = 0

before(async () => {
  initDb()
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      lastBody = JSON.parse(raw || '{}')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'test-model' }
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
      for (const p of PIECES) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: p }, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values({ serviceType: 'text', provider: 'openai', name: 'fake', baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, apiKey: 'k', model: JSON.stringify(['test-model']), isActive: true, priority: 1, createdAt: ts, updatedAt: ts })
  dramaId = getInsertId(await db.insert(schema.dramas).values({ title: '测试剧', createdAt: ts, updatedAt: ts } as any))
  episodeId = getInsertId(await db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: '第一集', content: '小明深夜回家。', createdAt: ts, updatedAt: ts } as any))
})

after(() => server?.close())

test('typewriter rewrite streams deltas over SSE, sends no tools, then saves the script', async () => {
  const resp = await agentRoutes.request('/script_rewriter/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drama_id: dramaId, episode_id: episodeId }),
  })
  assert.equal(resp.status, 200)
  const text = await resp.text()
  const events = text.split('\n\n').filter(Boolean).map((block) => ({
    event: /event: (\S+)/.exec(block)?.[1],
    data: JSON.parse(/data: (.*)/.exec(block)?.[1] || 'null'),
  }))
  const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.text)
  assert.deepEqual(deltas, PIECES)
  const done = events.find((e) => e.event === 'done')
  assert.equal(done?.data.content, PIECES.join(''))
  assert.ok(!lastBody.tools?.length, '打字机模式不带工具')
  assert.equal(lastBody.stream, true)
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  assert.equal(ep.scriptContent, PIECES.join(''))
})
