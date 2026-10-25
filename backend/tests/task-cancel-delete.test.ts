import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// 临时数据库（必须在导入 db 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-task-cancel-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
process.env.AIASK_VIDEO_POLL_MS = '30'

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { generateVideo, cancelTask } = await import('../src/services/generation')
const { TASK_CANCELLED_MESSAGE } = await import('../src/services/task-cancel')
const { deleteTaskWithFiles, taskFileFamily } = await import('../src/services/task-files')

// 模拟 aiask.me /v1/videos：任务一直在生成，release 之后才完成
let submits = 0
let seq = 0
let release = false
let server: http.Server
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64)])

before(async () => {
  initDb()
  server = http.createServer((req, res) => {
    const url = req.url || ''
    const json = (code: number, v: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
    req.on('data', () => {})
    req.on('end', () => {
      if (url === '/v1/videos' && req.method === 'POST') {
        submits++
        return json(202, { id: `v${++seq}`, status: 'in_progress' })
      }
      if (/^\/v1\/videos\/v\d+\/content$/.test(url)) {
        if (!release) return json(404, { error: { message: 'not ready' } })
        res.writeHead(200, { 'Content-Type': 'video/mp4' })
        return res.end(MP4)
      }
      const poll = /^\/v1\/videos\/(v\d+)$/.exec(url)
      if (poll) return json(200, { id: poll[1], status: release ? 'completed' : 'in_progress', progress: 10 })
      res.writeHead(404); res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values([
    // 上游一次只交 1 个，第二个任务在本地排队
    { serviceType: 'video', provider: 'aiask', name: 'aiask', baseUrl: base, apiKey: 'sk-test', model: JSON.stringify(['grok-imagine-video-1.5-lite']), isActive: true, priority: 100, settings: JSON.stringify({ max_concurrent: 1 }), createdAt: ts, updatedAt: ts },
  ])
})

after(() => server?.close())

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function row(id: number) {
  const [r] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  return r
}
async function waitFor(cond: () => Promise<boolean>, ms = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await cond()) return
    await sleep(30)
  }
  throw new Error('timeout')
}

test('cancel: queued task never submits, running task stops polling, results are not written back', async () => {
  const a = await generateVideo({ prompt: '镜头一', duration: 5 })
  const b = await generateVideo({ prompt: '镜头二', duration: 5 })
  await waitFor(async () => submits === 1 && !!(await row(a))?.taskId)
  await sleep(100)
  assert.equal(submits, 1, '第二个在本地排队')

  // 排队中的取消：离开队列，不再提交
  const rb = await cancelTask(b)
  assert.equal(rb.ok, true)
  assert.equal((await row(b)).status, 'failed')
  assert.equal((await row(b)).errorMsg, TASK_CANCELLED_MESSAGE)

  // 已提交的取消：停止轮询；之后上游完成也不会写回
  const ra = await cancelTask(a)
  assert.equal(ra.ok, true)
  release = true
  await sleep(300)
  const done = await row(a)
  assert.equal(done.status, 'failed')
  assert.equal(done.errorMsg, TASK_CANCELLED_MESSAGE)
  assert.equal(done.localPath, null)
  assert.equal(submits, 1, '取消后排队的任务没有被提交')

  // 已结束的任务不能再取消
  assert.equal((await cancelTask(a)).ok, false)
  assert.equal((await cancelTask(999_999)).status, null)

  // 名额已释放：新任务照常完成
  const c = await generateVideo({ prompt: '镜头三', duration: 5 })
  await waitFor(async () => (await row(c))?.status === 'completed')
})

test('file family: original, poster, end frame, subtitled copy and srt; upscale result is separate', () => {
  const fam = taskFileFamily('video', 'static/videos/x_sub.mp4').sort()
  for (const f of ['x.mp4', 'x_poster.jpg', 'x_last.jpg', 'x_sub.mp4', 'x_sub.srt', 'x_sub_poster.jpg', 'x_sub_last.jpg']) {
    assert.ok(fam.includes(`static/videos/${f}`), f)
  }
  assert.ok(!fam.some((f) => f.includes('1080p')))
  assert.deepEqual(taskFileFamily('image', 'static/images/a.png'), ['static/images/a.png', 'static/images/a_thumb.webp'])
  assert.deepEqual(taskFileFamily('video', 'https://cdn.example.com/a.mp4'), [])
  assert.deepEqual(taskFileFamily('video', 'static/../../etc/passwd'), [])
})

test('delete with files: removes the video files, switches the shot to the next video, keeps shared files', async () => {
  const dir = path.join(DATA, 'static', 'videos')
  fs.mkdirSync(dir, { recursive: true })
  const touch = (name: string) => fs.writeFileSync(path.join(dir, name), 'x'.repeat(100))
  for (const n of ['old.mp4', 'old_poster.jpg', 'old_last.jpg', 'new.mp4', 'new_poster.jpg', 'new_sub.mp4', 'new_sub.srt', 'new_sub_poster.jpg', 'new_1080p.mp4', 'dup.mp4']) touch(n)
  const ts = new Date().toISOString()
  const later = new Date(Date.now() + 1000).toISOString()
  const [sb] = await db.insert(schema.storyboards).values({ episodeId: 1, storyboardNumber: 1, videoUrl: 'static/videos/new_sub.mp4', subtitleUrl: 'static/videos/new_sub.srt', createdAt: ts, updatedAt: ts } as any).returning()
  const ins = async (localPath: string, createdAt: string) => {
    const [r] = await db.insert(schema.sysTask).values({ type: 'video', provider: 'aiask', storyboardId: sb.id, prompt: 'p', status: 'completed', localPath, createdAt, updatedAt: createdAt } as any).returning()
    return r.id as number
  }
  const oldId = await ins('static/videos/old.mp4', ts)
  const newId = await ins('static/videos/new_sub.mp4', later)
  const dupA = await ins('static/videos/dup.mp4', ts)
  await ins('static/videos/dup.mp4', ts)

  // 删正在用的那条：带字幕版、原视频、封面、字幕都删掉；分镜改用另一条，字幕清空
  const r = await deleteTaskWithFiles(newId)
  assert.equal(r.deleted, true)
  assert.equal(r.files, 5)
  assert.equal(r.bytes, 500)
  for (const n of ['new.mp4', 'new_poster.jpg', 'new_sub.mp4', 'new_sub.srt', 'new_sub_poster.jpg']) assert.ok(!fs.existsSync(path.join(dir, n)), n)
  assert.ok(fs.existsSync(path.join(dir, 'new_1080p.mp4')), '高清化结果是另一条记录，不动')
  const [after] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
  assert.ok(['static/videos/old.mp4', 'static/videos/dup.mp4'].includes(after.videoUrl!))
  assert.equal(after.subtitleUrl, null)

  // 同一个文件还被另一条记录引用：只删记录
  const d = await deleteTaskWithFiles(dupA)
  assert.equal(d.keptFiles, true)
  assert.ok(fs.existsSync(path.join(dir, 'dup.mp4')))

  // 只删记录（keep files）
  const k = await deleteTaskWithFiles(oldId, false)
  assert.equal(k.files, 0)
  assert.ok(fs.existsSync(path.join(dir, 'old.mp4')))
})
