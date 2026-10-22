import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// 临时数据库（必须在导入 db 之前设置）；轮询 / 复查 / 繁忙重试的间隔调短
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-aiask-video-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
process.env.AIASK_VIDEO_POLL_MS = '30'
process.env.AIASK_VIDEO_CONFIRM_MS = '30'
process.env.UPSTREAM_BUSY_RETRY_MS = '30'

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { generateVideo } = await import('../src/services/generation')
const { isBusyMessage, isUpstreamBusy, retryAfterMs } = await import('../src/services/upstream-busy')
const { cloudLaneKey, cloudLaneLimit } = await import('../src/services/gpu-queue')

test('busy detection: concurrency / rate limit retried, auth / balance / moderation not', () => {
  assert.ok(isUpstreamBusy(429, ''))
  assert.ok(isUpstreamBusy(400, '{"error":{"message":"Concurrent task limit reached"}}'))
  assert.ok(isUpstreamBusy(503, 'upstream overloaded, try again later'))
  assert.ok(isUpstreamBusy(500, '当前并发数已满，请稍后再试'))
  assert.ok(!isUpstreamBusy(401, 'rate limit'))
  assert.ok(!isUpstreamBusy(429, 'insufficient balance'))
  assert.ok(!isUpstreamBusy(400, 'invalid prompt'))
  assert.ok(isBusyMessage('[failed] concurrency limit exceeded'))
  assert.ok(!isBusyMessage('[failed] content moderation blocked'))
  assert.equal(retryAfterMs('5'), 5000)
  assert.equal(retryAfterMs('abc'), null)
})

test('cloud lane: aiask video queues (default 2, configurable), others do not', () => {
  assert.equal(cloudLaneKey({ provider: 'aiask', baseUrl: 'https://aiask.me' }, 'video'), 'cloud:aiask:aiask.me:video')
  assert.equal(cloudLaneKey({ provider: 'aiask', baseUrl: 'https://aiask.me' }, 'image'), null)
  assert.equal(cloudLaneKey({ provider: 'xai', baseUrl: 'https://api.x.ai' }, 'video'), null)
  assert.equal(cloudLaneLimit({ provider: 'aiask', settings: null }), 2)
  assert.equal(cloudLaneLimit({ provider: 'aiask', settings: { max_concurrent: 4 } }), 4)
})

// ─── 模拟 aiask.me /v1/videos：上游同时最多 2 个，超出 429；状态接口按场景出错 ───
type Scenario = 'normal' | 'poll-failed-but-done' | 'poll-404-but-done' | 'busy-after-accept'
let scenario: Scenario = 'normal'
let seq = 0
let running = 0
let maxRunning = 0
let rejected = 0
let submits = 0
const tasks = new Map<string, { polls: number; done: boolean; busyFail: boolean }>()
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)])
let server: http.Server
let base = ''

function finish(id: string) {
  const t = tasks.get(id)!
  if (!t.done) { t.done = true; running-- }
}

before(async () => {
  initDb()
  server = http.createServer((req, res) => {
    const url = req.url || ''
    const json = (code: number, v: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
    req.resume()
    req.on('end', () => {
      if (url === '/v1/videos' && req.method === 'POST') {
        submits++
        if (running >= 2) { rejected++; return json(429, { error: { message: 'Too many concurrent video tasks' } }) }
        const id = `v${++seq}`
        running++
        maxRunning = Math.max(maxRunning, running)
        tasks.set(id, { polls: 0, done: false, busyFail: scenario === 'busy-after-accept' && seq === 1 })
        return json(202, { id, object: 'video', status: 'in_progress' })
      }
      const content = /^\/v1\/videos\/(v\d+)\/content$/.exec(url)
      if (content) {
        const t = tasks.get(content[1])
        if (!t?.done || t.busyFail) return json(404, { error: { message: 'not ready' } })
        res.writeHead(200, { 'Content-Type': 'video/mp4' })
        return res.end(MP4)
      }
      const poll = /^\/v1\/videos\/(v\d+)$/.exec(url)
      if (poll) {
        const id = poll[1]
        const t = tasks.get(id)
        if (!t) return json(404, { error: { message: 'not found' } })
        t.polls++
        if (t.busyFail && t.polls >= 2) {
          finish(id)
          return json(200, { id, status: 'failed', error: { message: 'upstream concurrency limit exceeded' } })
        }
        if (t.polls < 3) return json(200, { id, status: 'in_progress', progress: t.polls * 30 })
        finish(id)
        // 已生成好，但状态接口报失败 / 404（用户反馈：wokey.ai 上看其实成功了）
        if (scenario === 'poll-failed-but-done') return json(200, { id, status: 'failed', error: { message: 'status sync error' } })
        if (scenario === 'poll-404-but-done') return json(404, { error: { message: 'task not found' } })
        return json(200, { id, status: 'completed' })
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as any).port}`
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values([
    { serviceType: 'video', provider: 'aiask', name: 'aiask.me Grok Video', baseUrl: base, apiKey: 'sk-test', model: JSON.stringify(['grok-imagine-video-1.5-lite']), isActive: true, priority: 100, createdAt: ts, updatedAt: ts },
  ])
})

after(() => server?.close())

async function waitDone(id: number, ms = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (row && row.status !== 'processing') return row
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('task did not finish')
}

function reset(s: Scenario) {
  scenario = s
  maxRunning = 0
  rejected = 0
  submits = 0
}

test('batch of 6 videos: at most 2 sent to upstream at a time, all complete', async () => {
  reset('normal')
  const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => generateVideo({ prompt: `镜头 ${i + 1}`, duration: 5 })))
  const rows = await Promise.all(ids.map((id) => waitDone(id)))
  for (const row of rows) assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(maxRunning, 2)
  assert.equal(rejected, 0, '排队提交，不会撞上并发上限')
})

test('status reports failed but the video was generated: downloads it instead of failing', async () => {
  reset('poll-failed-but-done')
  const row = await waitDone(await generateVideo({ prompt: '雨夜街头', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
})

test('status endpoint keeps returning 404 but the video exists: downloads it', async () => {
  reset('poll-404-but-done')
  const row = await waitDone(await generateVideo({ prompt: '天台对峙', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
})

test('accepted, then failed with a concurrency error: resubmitted automatically', async () => {
  reset('busy-after-accept')
  seq = 0
  tasks.clear()
  const row = await waitDone(await generateVideo({ prompt: '咖啡馆重逢', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(submits, 2)
  assert.equal(row.taskId, 'v2')
})

test('queue set above the upstream limit: rejected submits wait and retry, all complete', async () => {
  reset('normal')
  await db.update(schema.aiServiceConfigs).set({ settings: JSON.stringify({ max_concurrent: 4 }) }).where(eq(schema.aiServiceConfigs.provider, 'aiask'))
  try {
    const ids = await Promise.all(Array.from({ length: 4 }, (_, i) => generateVideo({ prompt: `并发 ${i + 1}`, duration: 5 })))
    const rows = await Promise.all(ids.map((id) => waitDone(id)))
    for (const row of rows) assert.equal(row.status, 'completed', String(row.errorMsg))
    assert.ok(rejected > 0, '上游拒绝过（429）')
    assert.equal(maxRunning, 2)
  } finally {
    await db.update(schema.aiServiceConfigs).set({ settings: null }).where(eq(schema.aiServiceConfigs.provider, 'aiask'))
  }
})
