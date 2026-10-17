import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// 临时数据库（必须在导入 db 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-oom-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { generateVideo } = await import('../src/services/generation')
const { describeComfyExecutionError, describeComfyOutOfMemory, isComfyOutOfMemory, COMFY_OOM_RETRIES } = await import('../src/services/adapters/comfyui-common')

// 用户截图里的原文（PyTorch CUDA OOM）
const OOM = 'CUDA out of memory. Tried to allocate 126.00 MiB. GPU 0 has a total capacity of 83.05 GiB of which 36.56 MiB is free. Process 555662 has 69.28 GiB memory in use. Including non-PyTorch memory, this process has 13.70 GiB memory in use. Of the allocated memory 12.9 GiB is allocated by PyTorch.'

test('OOM message: conclusion and fixes first, other processes named, raw text last', () => {
  const msg = describeComfyOutOfMemory('CLIPLoader', OOM)
  assert.match(msg, /^ComfyUI 显存不足（CLIPLoader 加载时）：显卡共 83\.\d GB，只剩 37 MB，ComfyUI 自己占用 13\.7 GB，其他程序占用 69\.3 GB（进程 555662）。/)
  assert.match(msg, /关掉同一张显卡上的其他程序/)
  assert.match(msg, /--highvram/)
  assert.ok(msg.endsWith(`原始错误：CLIPLoader ${OOM}`))
  // 只列出自己（单进程时 PyTorch 也会列出自己）
  const single = describeComfyOutOfMemory('KSampler', 'CUDA out of memory. GPU 0 has a total capacity of 23.6 GiB of which 20.00 MiB is free. Process 1 has 23.5 GiB memory in use. Including non-PyTorch memory, this process has 23.5 GiB memory in use.')
  assert.match(single, /ComfyUI 自己占用 23\.5 GB。/)
  assert.doesNotMatch(single, /其他程序占用/)
  // 被截断、没有「this process」时也能读
  assert.match(describeComfyOutOfMemory('CLIPLoader', 'CUDA out of memory. Process 9 has 69.28 GiB memory in use'), /进程：9 占 69\.3 GB/)
  assert.ok(isComfyOutOfMemory(describeComfyExecutionError({ node_type: 'CLIPLoader', exception_message: OOM })))
})

// ─── 模拟 ComfyUI：每次执行都显存不足（或第 2 次起换成别的错误） ───
let prompts = 0
let frees: string[] = []
let vramFree = 1 * 1024 ** 3
let mode: 'always-oom' | 'oom-then-other' = 'always-oom'
const servers: http.Server[] = []

function fakeComfy(name: string) {
  return http.createServer((req, res) => {
    const url = req.url || ''
    const json = (v: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (url === '/free' && req.method === 'POST') {
        frees.push(`${name}:${body}`)
        vramFree += 60 * 1024 ** 3 // 卸载模型后空出显存
        return json({})
      }
      if (url === '/system_stats') return json({ devices: [{ name: 'cuda:0', vram_total: 83 * 1024 ** 3, vram_free: vramFree }] })
      if (url === '/prompt' && req.method === 'POST') { prompts++; return json({ prompt_id: `p${prompts}`, number: prompts, node_errors: {} }) }
      if (url === '/queue') return json({ queue_running: [], queue_pending: [] })
      if (url === '/object_info') return json({})
      const h = /^\/history\/(p\d+)/.exec(url)
      if (h) {
        const n = Number(h[1].slice(1))
        const message = mode === 'oom-then-other' && n > 1 ? 'Expected all tensors to be on the same device' : OOM
        return json({ [h[1]]: { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'CLIPLoader', exception_message: message, current_inputs: {} }]] } } })
      }
      res.writeHead(404); res.end()
    })
  })
}

let base = ''
let peer = ''
before(async () => {
  initDb()
  for (const name of ['video', 'image']) {
    const s = fakeComfy(name)
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
    servers.push(s)
  }
  base = `http://127.0.0.1:${(servers[0].address() as any).port}`
  peer = `http://localhost:${(servers[1].address() as any).port}`
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values([
    { serviceType: 'video', provider: 'comfyui', name: 'ComfyUI 视频', baseUrl: base, apiKey: '', model: JSON.stringify(['wan2.2-ti2v-5b']), isActive: true, priority: 10, createdAt: ts, updatedAt: ts },
    // 同一台机器上生图用的另一个 ComfyUI：显存不足时一起释放
    { serviceType: 'image', provider: 'comfyui', name: 'ComfyUI 生图', baseUrl: peer, apiKey: '', model: JSON.stringify(['sdxl']), isActive: true, priority: 10, createdAt: ts, updatedAt: ts },
  ])
})

after(() => { for (const s of servers) s.close() })

async function waitDone(id: number, ms = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (row && row.status !== 'processing') return row
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('task did not finish')
}

test('ComfyUI out of memory: frees VRAM on every ComfyUI of that machine, resubmits, then fails with a readable message', async () => {
  prompts = 0
  frees = []
  mode = 'always-oom'
  const id = await generateVideo({ prompt: '清晨阳光下的街道', duration: 5 })
  const row = await waitDone(id)
  assert.equal(row.status, 'failed')
  assert.equal(prompts, 1 + COMFY_OOM_RETRIES, '原任务 + 自动重试')
  assert.equal(frees.filter((f) => f.startsWith('video:')).length, COMFY_OOM_RETRIES)
  assert.equal(frees.filter((f) => f.startsWith('image:')).length, COMFY_OOM_RETRIES, '同一台机器上的另一个 ComfyUI 也释放')
  assert.match(frees[0], /"unload_models":true/)
  assert.equal(row.taskId, `p${prompts}`, '记录的是最后一次提交的任务')
  assert.match(String(row.errorMsg), new RegExp(`^自动重试 ${COMFY_OOM_RETRIES} 次后仍失败。ComfyUI 显存不足`))
})

test('ComfyUI out of memory once, then a different error: no more retries for non-memory errors', async () => {
  prompts = 0
  frees = []
  mode = 'oom-then-other'
  const id = await generateVideo({ prompt: '街边算命摊', duration: 5 })
  const row = await waitDone(id)
  assert.equal(row.status, 'failed')
  assert.equal(prompts, 2)
  assert.match(String(row.errorMsg), /^自动重试 1 次后仍失败。ComfyUI 执行失败：CLIPLoader Expected all tensors/)
})
