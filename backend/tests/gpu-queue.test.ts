/**
 * 本地显卡排队：批量生成时一个一个交给 ComfyUI；小显存模板每个视频之间释放显存；
 * ComfyUI 中途退出时等它重启后自动重新提交
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-gpuq-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
process.env.COMFY_DOWN_GRACE_MS = '4000'
const SYS_FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => fs.existsSync(p))
if (SYS_FFMPEG && !process.env.FFMPEG_BIN) {
  process.env.FFMPEG_BIN = SYS_FFMPEG
  process.env.FFPROBE_BIN = SYS_FFMPEG.replace(/ffmpeg$/, 'ffprobe')
}

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { generateVideo } = await import('../src/services/generation')
const q = await import('../src/services/gpu-queue')
const { shouldFreeVramBetween } = await import('../src/services/adapters/comfyui-common')

test('lane: one at a time per machine, positions reported, release is idempotent', async () => {
  q.resetGpuLanes()
  const key = q.gpuLaneKey({ provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188' })!
  assert.equal(key, q.gpuLaneKey({ provider: 'comfyui', baseUrl: 'http://localhost:8189' }), 'localhost 和 127.0.0.1 是同一台')
  assert.equal(q.gpuLaneKey({ provider: 'aiask', baseUrl: 'https://aiask.me' }), null, '云端服务不排队')
  const order: number[] = []
  const positions: Record<number, number[]> = {}
  const run = (id: number) => q.acquireGpuLane(key, id, { kind: 'video', onPosition: (p) => (positions[id] ||= []).push(p) }).then(() => order.push(id))
  await run(1)
  const p2 = run(2)
  const p3 = run(3)
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(order, [1])
  assert.deepEqual(positions[3], [2])
  assert.equal(q.laneNeedsFree(key), false)
  q.releaseGpuLane(1)
  q.releaseGpuLane(1)
  await p2
  assert.deepEqual(order, [1, 2])
  assert.deepEqual(positions[3], [2, 1])
  assert.equal(q.laneNeedsFree(key, true), true, '视频结束后标记需要释放显存')
  assert.equal(q.laneNeedsFree(key), false)
  q.releaseGpuLane(2)
  await p3
  assert.deepEqual(order, [1, 2, 3])
  assert.equal(q.laneLimit({ settings: { max_concurrent: 2 } }), 2)
  assert.equal(q.laneLimit({ settings: {} }), 1)
})

test('free between videos: auto for ≤16G templates, explicit setting wins', () => {
  assert.equal(shouldFreeVramBetween({}, 12), true)
  assert.equal(shouldFreeVramBetween({}, 16), true)
  assert.equal(shouldFreeVramBetween({}, 24), false)
  assert.equal(shouldFreeVramBetween({}, null), false)
  assert.equal(shouldFreeVramBetween({ free_vram_between: false }, 12), false)
  assert.equal(shouldFreeVramBetween({ free_vram_between: true }, 96), true)
})

// ─── 模拟 ComfyUI：每个任务 1.2 秒出片；记录同时在跑几个、释放了几次显存 ───
let VIDEO: Buffer
let active = new Set<string>()
let maxActive = 0
let prompts = 0
let frees = 0
let crashNext = false
let server: http.Server | null = null
let port = 0
const startedAt = new Map<string, number>()

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || ''
  const json = (v: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (url === '/system_stats') return json({ devices: [{ name: 'cuda:0', vram_total: 12 * 1024 ** 3, vram_free: 10 * 1024 ** 3 }] })
    if (url === '/free') { frees++; return json({}) }
    if (url.startsWith('/upload/image')) return json({ name: `u${Date.now()}.png`, subfolder: '', type: 'input' })
    if (url === '/object_info' || url.startsWith('/object_info/')) return json({})
    if (url === '/prompt' && req.method === 'POST') {
      prompts++
      const id = `p${prompts}`
      active.add(id)
      maxActive = Math.max(maxActive, active.size)
      startedAt.set(id, Date.now())
      json({ prompt_id: id, number: prompts, node_errors: {} })
      // 模拟 ComfyUI 在执行这个任务时被显存挤崩退出
      if (crashNext) {
        crashNext = false
        setTimeout(() => { active.clear(); stopServer().then(() => setTimeout(() => startServer(), 2500)) }, 300)
      }
      return
    }
    if (url === '/queue') return json({ queue_running: [...active].map((id, i) => [i, id, {}, {}, []]), queue_pending: [] })
    const h = /^\/history\/(p\d+)/.exec(url)
    if (h) {
      const id = h[1]
      const finished = doneIds.has(id) || (active.has(id) && Date.now() - startedAt.get(id)! >= 1200)
      // 还在跑，或崩溃前的任务（ComfyUI 重启后队列和历史里都没有）
      if (!finished) return json({})
      active.delete(id)
      doneIds.add(id)
      return json({ [id]: { outputs: { 61: { images: [{ filename: `${id}.mp4`, subfolder: 'video', type: 'output' }], animated: [true] } }, status: { status_str: 'success', completed: true, messages: [] } } })
    }
    if (url.startsWith('/view')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': VIDEO.length }); return res.end(VIDEO) }
    res.writeHead(404); res.end()
  })
}
const doneIds = new Set<string>()

function startServer(): Promise<void> {
  server = http.createServer(handler)
  return new Promise((r) => server!.listen(port, '127.0.0.1', () => { port = (server!.address() as any).port; r() }))
}
function stopServer(): Promise<void> {
  const s = server
  server = null
  return new Promise((r) => (s ? (s.closeAllConnections?.(), s.close(() => r())) : r()))
}

before(async () => {
  initDb()
  const f = path.join(DATA, 'clip.mp4')
  execFileSync(process.env.FFMPEG_BIN || 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=1', '-pix_fmt', 'yuv420p', f], { stdio: 'ignore' })
  VIDEO = fs.readFileSync(f)
  await startServer()
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values([
    {
      serviceType: 'video', provider: 'comfyui', name: 'ComfyUI 12G', baseUrl: `http://127.0.0.1:${port}`, apiKey: '',
      model: JSON.stringify(['minimax-h3-12g-768p']), isActive: true, priority: 10, settings: JSON.stringify({ comfyui_template: 'minimax-h3-12g-768p' }),
      createdAt: ts, updatedAt: ts,
    },
  ])
})

after(async () => { await stopServer() })

async function waitDone(id: number, ms = 120_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (row && row.status !== 'processing') return row
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`task ${id} did not finish`)
}

test('batch of 3 videos: ComfyUI only ever runs one, VRAM freed between them, all finish', async () => {
  q.resetGpuLanes()
  const ids = await Promise.all([1, 2, 3].map((n) => generateVideo({ prompt: `镜头${n}：林凡抬头`, duration: 5 })))
  const rows = await Promise.all(ids.map((id) => waitDone(id)))
  assert.deepEqual(rows.map((r) => r.status), ['completed', 'completed', 'completed'], rows.map((r) => r.errorMsg).join(' | '))
  assert.equal(maxActive, 1, 'ComfyUI 同时只收到一个任务')
  assert.equal(prompts, 3)
  assert.equal(frees, 2, '小显存模板：第 2、3 个视频提交前各释放一次显存')
})

test('ComfyUI crashes mid-task: waits for it to come back, resubmits, finishes; the next task waits its turn', async () => {
  q.resetGpuLanes()
  prompts = 0
  maxActive = 0
  active = new Set()
  doneIds.clear()
  startedAt.clear()
  crashNext = true
  const a = await generateVideo({ prompt: '镜头A', duration: 5 })
  const b = await generateVideo({ prompt: '镜头B', duration: 5 })
  const [ra, rb] = [await waitDone(a), await waitDone(b)]
  assert.equal(ra.status, 'completed', String(ra.errorMsg))
  assert.equal(rb.status, 'completed', String(rb.errorMsg))
  assert.equal(prompts, 3, 'A 提交两次（崩溃后重提）+ B 一次')
  assert.equal(maxActive, 1)
})
