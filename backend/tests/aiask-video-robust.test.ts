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
process.env.MODERATION_RETRY_MS = '30'

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { generateVideo, describeSubmitError } = await import('../src/services/generation')
const { isBusyMessage, isModerationFailure, isUpstreamBusy, moderationRetries, retryAfterMs } = await import('../src/services/upstream-busy')
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
type Scenario = 'normal' | 'poll-failed-but-done' | 'poll-404-but-done' | 'busy-after-accept' | 'download-interrupted'
  | 'moderation-after-accept' | 'moderation-always' | 'moderation-on-submit'
let scenario: Scenario = 'normal'
let seq = 0
let running = 0
let maxRunning = 0
let rejected = 0
let submits = 0
let lastSubmit: any = null
let rejectMultiRef = false
let lastMode: string | null = null
const tasks = new Map<string, { polls: number; done: boolean; busyFail: boolean; modFail?: boolean }>()
const MODERATION_MSG = '内容未通过审核，请调整提示词或切换模型后重试'
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
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      if (url === '/v1/videos' && req.method === 'POST') {
        submits++
        if (running >= 2) { rejected++; return json(429, { error: { message: 'Too many concurrent video tasks' } }) }
        try { lastSubmit = JSON.parse(raw) } catch { lastSubmit = null }
        // 模拟某个模型不接受多参考图
        if (rejectMultiRef && /name="mode"\r\n\r\nmultimodal_reference/.test(raw)) {
          return json(400, { error: { message: 'mode multimodal_reference is not supported for this model' } })
        }
        if (/name="mode"/.test(raw)) lastMode = /name="mode"\r\n\r\n([a-z_]+)/.exec(raw)?.[1] || null
        // Grok 上游：提示词超过 4096 字节直接 400
        if (lastSubmit && Buffer.byteLength(String(lastSubmit.prompt || '')) > 4096) {
          return json(400, { error: { message: '提示词过长。Grok视频最多支持4096字节的UTF-8文本，请缩短后重试。' } })
        }
        if (scenario === 'moderation-on-submit' && submits === 1) return json(400, { error: { message: MODERATION_MSG } })
        const id = `v${++seq}`
        running++
        maxRunning = Math.max(maxRunning, running)
        tasks.set(id, { polls: 0, done: false, busyFail: (scenario === 'busy-after-accept' || scenario === 'download-interrupted') && seq === 1,
          modFail: scenario === 'moderation-always' || (scenario === 'moderation-after-accept' && seq === 1) })
        return json(202, { id, object: 'video', status: 'in_progress' })
      }
      const content = /^\/v1\/videos\/(v\d+)\/content$/.exec(url)
      if (content) {
        const t = tasks.get(content[1])
        if (!t?.done || t.busyFail || t.modFail) return json(404, { error: { message: 'not ready' } })
        res.writeHead(200, { 'Content-Type': 'video/mp4' })
        return res.end(MP4)
      }
      const poll = /^\/v1\/videos\/(v\d+)$/.exec(url)
      if (poll) {
        const id = poll[1]
        const t = tasks.get(id)
        if (!t) return json(404, { error: { message: 'not found' } })
        t.polls++
        if (t.modFail && t.polls >= 2) {
          finish(id)
          return json(200, { id, status: 'failed', error: { message: MODERATION_MSG } })
        }
        if (t.busyFail && t.polls >= 2) {
          finish(id)
          return json(200, { id, status: 'failed', error: { message: scenario === 'download-interrupted'
            ? 'Failed to downloade the provided image (image_downloade_error=image_download_interrupted): the connection drpped while downloading the image. Please retry or host the image on a more reliabe nedpoint.'
            : 'upstream concurrency limit exceeded' } })
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

test('upstream failed to download the reference image: resubmitted automatically, no 2-minute re-check first', async () => {
  reset('download-interrupted')
  seq = 0
  tasks.clear()
  const t0 = Date.now()
  const row = await waitDone(await generateVideo({ prompt: '天台对峙', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(submits, 2)
  assert.ok(Date.now() - t0 < 10_000)
})

test('long Chinese prompt is fitted under the byte limit and duration clamped to the configured max', async () => {
  reset('normal')
  const prompt = '小明推门进来，' + '雨水顺着外套往下滴，镜头缓缓推进。'.repeat(250) + '\n\n【台词控制】本段只有 1 句话：\n1. 小明：「我回来了。」\n【画风一致】画面清晰锐利。'
  assert.ok(Buffer.byteLength(prompt) > 4096)
  // 默认不限制：只按 Grok 接口自身的 4096 字节 / 15 秒
  const free = await waitDone(await generateVideo({ prompt, duration: 20 }))
  assert.equal(free.status, 'completed', String(free.errorMsg))
  assert.ok(Buffer.byteLength(lastSubmit.prompt) <= 4096, `sent ${Buffer.byteLength(lastSubmit.prompt)} bytes`)
  assert.equal(lastSubmit.duration_seconds, 15)

  // 设置了单镜上限：按设置精简、夹时长，并在任务里说明
  await db.update(schema.aiServiceConfigs).set({ settings: JSON.stringify({ max_duration: 10, max_prompt_bytes: 3000 }) }).where(eq(schema.aiServiceConfigs.provider, 'aiask'))
  try {
    const row = await waitDone(await generateVideo({ prompt, duration: 20 }))
    assert.equal(row.status, 'completed', String(row.errorMsg))
    assert.ok(Buffer.byteLength(lastSubmit.prompt) <= 3000, `sent ${Buffer.byteLength(lastSubmit.prompt)} bytes`)
    assert.equal(lastSubmit.duration_seconds, 10)
    assert.match(String(row.errorMsg), /超过上限 3000 字节/)
    assert.match(String(row.errorMsg), /按 10 秒生成/)
  } finally {
    await db.update(schema.aiServiceConfigs).set({ settings: null }).where(eq(schema.aiServiceConfigs.provider, 'aiask'))
  }
})

test('model rejects multiple reference images: falls back to single-image video once and notes it', async () => {
  reset('normal')
  rejectMultiRef = true
  try {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const row = await waitDone(await generateVideo({ prompt: '@图片1咖啡厅，@图片2小明坐下', duration: 5, referenceImageUrls: [PNG, PNG] } as any))
    assert.equal(row.status, 'completed', String(row.errorMsg))
    assert.equal(lastMode, 'image_to_video')
    assert.match(String(row.errorMsg), /不接受多张参考图/)
  } finally {
    rejectMultiRef = false
  }
})

test('moderation detection and retry count setting', () => {
  assert.ok(isModerationFailure('内容未通过审核，请调整提示词或切换模型后重试'))
  assert.ok(isModerationFailure('[failed] content moderation blocked'))
  assert.ok(isModerationFailure('OutputVideoSensitiveContentDetected'))
  assert.ok(!isModerationFailure('insufficient balance'))
  assert.ok(!isModerationFailure('upstream concurrency limit exceeded'))
  assert.equal(moderationRetries(null), 2)
  assert.equal(moderationRetries({ moderation_retries: 0 }), 0)
  assert.equal(moderationRetries({ moderation_retries: '3' }), 3)
  assert.equal(moderationRetries({ moderation_retries: 99 }), 5)
})

test('Grok moderation misjudged once after accept: resubmitted automatically and noted', async () => {
  reset('moderation-after-accept')
  seq = 0
  tasks.clear()
  const row = await waitDone(await generateVideo({ prompt: '分镜 #6', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(submits, 2)
  assert.match(String(row.errorMsg), /审核未通过，自动原样重新提交 1 次后生成成功/)
})

test('moderation rejected at submit: resubmitted once and completes', async () => {
  reset('moderation-on-submit')
  seq = 0
  tasks.clear()
  const row = await waitDone(await generateVideo({ prompt: '分镜 #7', duration: 5 }))
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(submits, 2)
  assert.match(String(row.errorMsg), /提交时审核未通过/)
})

test('moderation keeps failing: gives up after the configured retries (default 2)', async () => {
  reset('moderation-always')
  seq = 0
  tasks.clear()
  try {
    const row = await waitDone(await generateVideo({ prompt: '分镜 #8', duration: 5 }))
    assert.equal(row.status, 'failed')
    assert.equal(submits, 3)
    assert.match(String(row.errorMsg), /自动重试 2 次后仍失败/)
    assert.match(String(row.errorMsg), /审核/)
  } finally {
    scenario = 'normal'
  }
})

test('submit errors keep the real cause instead of a bare "fetch failed"', () => {
  const err = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND aiask.me'), { code: 'ENOTFOUND' }) })
  assert.match(describeSubmitError(err, 'https://aiask.me'), /连接 aiask\.me 失败（ENOTFOUND getaddrinfo ENOTFOUND aiask\.me）/)
  assert.match(describeSubmitError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), 'https://aiask.me'), /aiask\.me 超时/)
  assert.equal(describeSubmitError(new Error('API error 400: bad ratio'), 'https://aiask.me'), 'API error 400: bad ratio')
})
