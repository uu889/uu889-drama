/**
 * 视频高清化：尺寸换算、模型挑选、快速放大（真实 FFmpeg）、AI 超分（模拟 ComfyUI，逐段提交 + 拼回 + 配回声音）、
 * 拼接时分辨率 / 帧率不一致自动统一
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-upscale-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
const SYS_FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => fs.existsSync(p))
if (SYS_FFMPEG && !process.env.FFMPEG_BIN) {
  process.env.FFMPEG_BIN = SYS_FFMPEG
  process.env.FFPROBE_BIN = SYS_FFMPEG.replace(/ffmpeg$/, 'ffprobe')
}
const FFMPEG = process.env.FFMPEG_BIN || ''

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const up = await import('../src/services/video-upscale')
const { mergeEpisodeVideos, uniformVideoFilters } = await import('../src/services/ffmpeg-merge')
const { resetGpuLanes } = await import('../src/services/gpu-queue')

test('upscale model list: old [[…]] and new ["COMBO", { options }] object_info formats', () => {
  assert.deepEqual(up.comboOptions([['RealESRGAN_x2plus.pth', 'b.pth'], {}]), ['RealESRGAN_x2plus.pth', 'b.pth'])
  assert.deepEqual(up.comboOptions(['COMBO', { options: ['RealESRGAN_x2plus.pth'] }]), ['RealESRGAN_x2plus.pth'])
  assert.deepEqual(up.comboOptions(['COMBO', {}]), [])
  assert.deepEqual(up.comboOptions(undefined), [])
})

test('sizes, paths and model choice', () => {
  assert.deepEqual(up.upscaleDimensions(1344, 768, 1080), { width: 1890, height: 1080 })
  assert.deepEqual(up.upscaleDimensions(768, 1344, 1080), { width: 1080, height: 1890 })
  assert.deepEqual(up.upscaleDimensions(1280, 720, 1080), { width: 1920, height: 1080 })
  assert.equal(up.upscaledPathFor('static/videos/a_sub.mp4', '1080p'), 'static/videos/a_sub_1080p.mp4')
  assert.equal(up.upscaledPathFor('static/videos/a_1080p.mp4', '2160p'), 'static/videos/a_2160p.mp4')
  assert.equal(up.pickUpscaleModel(['4x-UltraSharp.pth', 'RealESRGAN_x2plus.pth']), 'RealESRGAN_x2plus.pth')
  assert.equal(up.pickUpscaleModel(['RealESRGAN_x4plus.pth', 'foo.pth']), 'RealESRGAN_x4plus.pth')
  assert.equal(up.pickUpscaleModel([]), null)
  assert.deepEqual(up.normalizeUpscaleOptions({ engine: 'x', target: '8k' }), { engine: 'auto', target: '1080p' })
  const wf = up.buildUpscaleWorkflow('a.mp4', 'RealESRGAN_x2plus.pth', { width: 1890, height: 1080 }, 'p')
  for (const [id, node] of Object.entries<any>(wf)) {
    for (const v of Object.values(node.inputs)) if (Array.isArray(v)) assert.ok(wf[String(v[0])], `${id} → ${v[0]}`)
  }
  assert.deepEqual(wf['6'].inputs.fps, ['2', 2], '帧率沿用原视频')
})

function makeClip(rel: string, w: number, h: number, seconds: number, fps = 24, audio = true) {
  const abs = path.join(DATA, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=${fps}:duration=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-shortest'] : []), abs)
  execFileSync(FFMPEG, args, { stdio: 'ignore' })
  return rel
}

let episodeId = 0
async function addShot(n: number, videoUrl: string) {
  const ts = new Date().toISOString()
  const res: any = await db.insert(schema.storyboards).values({ episodeId, storyboardNumber: n, title: `镜${n}`, videoUrl, duration: 3, createdAt: ts, updatedAt: ts } as any)
  return Number(res.lastInsertRowid)
}

async function waitDone(id: number, ms = 120_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const [row] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (row && row.status !== 'processing') return row
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('task did not finish')
}

// ─── 模拟 ComfyUI：放大模型列表 + 视频节点；/view 时用 FFmpeg 把上传的片段放大到工作流里的目标尺寸 ───
const uploads = new Map<string, Buffer>()
const prompts: any[] = []
let server: http.Server
let comfyBase = ''
let comfyModels: string[] = ['RealESRGAN_x2plus.pth']

before(async () => {
  initDb()
  server = http.createServer((req, res) => {
    const url = req.url || ''
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const json = (v: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
      const body = Buffer.concat(chunks)
      if (url === '/system_stats') return json({ devices: [{ vram_total: 12e9, vram_free: 10e9 }] })
      // 新版 ComfyUI（UpscaleModelLoader 已改成 V3 节点）：["COMBO", { options }]
      if (url === '/object_info/UpscaleModelLoader') return json({ UpscaleModelLoader: { input: { required: { model_name: ['COMBO', { options: comfyModels }] } } } })
      if (url === '/upload/image') {
        const name = /filename="([^"]+)"/.exec(body.toString('latin1'))![1]
        const start = body.indexOf(Buffer.from('\r\n\r\n', 'latin1'), body.indexOf(Buffer.from(`filename="${name}"`))) + 4
        const end = body.indexOf(Buffer.from('\r\n--', 'latin1'), start)
        uploads.set(name, body.subarray(start, end))
        return json({ name, subfolder: '', type: 'input' })
      }
      if (url === '/prompt') {
        const wf = JSON.parse(body.toString()).prompt
        prompts.push(wf)
        return json({ prompt_id: `u${prompts.length}`, number: prompts.length, node_errors: {} })
      }
      const h = /^\/history\/u(\d+)/.exec(url)
      if (h) {
        const n = Number(h[1])
        return json({ [`u${n}`]: { outputs: { 7: { images: [{ filename: `up_${n}.mp4`, subfolder: 'uu889-upscale', type: 'output' }], animated: [true] } }, status: { status_str: 'success', completed: true } } })
      }
      const v = /^\/view\?.*filename=up_(\d+)\.mp4/.exec(url)
      if (v) {
        const wf = prompts[Number(v[1]) - 1]
        const src = path.join(DATA, `comfy_in_${v[1]}.mp4`)
        const out = path.join(DATA, `comfy_out_${v[1]}.mp4`)
        fs.writeFileSync(src, uploads.get(wf['1'].inputs.file)!)
        const { width, height } = wf['5'].inputs
        execFileSync(FFMPEG, ['-y', '-i', src, '-vf', `scale=${width}:${height}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { stdio: 'ignore' })
        const buf = fs.readFileSync(out)
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length })
        return res.end(buf)
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  comfyBase = `http://127.0.0.1:${(server.address() as any).port}`
  const ts = new Date().toISOString()
  await db.insert(schema.dramas).values({ title: '高清化', createdAt: ts, updatedAt: ts } as any)
  const res: any = await db.insert(schema.episodes).values({ dramaId: 1, episodeNumber: 1, title: '第1集', createdAt: ts, updatedAt: ts } as any)
  episodeId = Number(res.lastInsertRowid)
})

after(() => { server.close() })

test('fast upscale (no ComfyUI): 640×360 → 1920×1080, audio kept, becomes the current video, original kept', { skip: !FFMPEG }, async () => {
  resetGpuLanes()
  const src = makeClip('static/videos/fast.mp4', 640, 360, 3)
  const sb = await addShot(1, src)
  const id = await up.startUpscale(sb, { engine: 'auto', target: '1080p' })
  const row = await waitDone(id)
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(row.localPath, 'static/videos/fast_1080p.mp4')
  assert.equal(row.model, '快速放大（FFmpeg）')
  const info = await up.probeVideo(path.join(DATA, row.localPath!))
  assert.deepEqual([info.width, info.height, info.hasAudio], [1920, 1080, true])
  assert.ok(fs.existsSync(path.join(DATA, src)), '原视频保留')
  const [s] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb))
  assert.equal(s.videoUrl, row.localPath)
  // 已经 1080p：不用再高清化
  await assert.rejects(up.startUpscale(sb, { target: '1080p' }), /不低于 1080p/)
})

test('AI upscale through ComfyUI: cut into 2 s pieces, each upscaled, joined back with the original audio', { skip: !FFMPEG }, async () => {
  resetGpuLanes()
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values({ serviceType: 'video', provider: 'comfyui', name: 'ComfyUI', baseUrl: comfyBase, apiKey: '', model: JSON.stringify(['minimax-h3-12g-768p']), isActive: true, priority: 1, createdAt: ts, updatedAt: ts })
  const info = await up.upscaleInfo(episodeId)
  assert.equal(info.model, 'RealESRGAN_x2plus.pth')
  const src = makeClip('static/videos/ai.mp4', 672, 384, 5)
  const sb = await addShot(2, src)
  const id = await up.startUpscale(sb, { engine: 'ai', target: '1080p' })
  const row = await waitDone(id)
  assert.equal(row.status, 'completed', String(row.errorMsg))
  assert.equal(row.model, 'AI 超分（RealESRGAN_x2plus.pth）')
  assert.equal(prompts.length, 3, '5 秒切成 3 段')
  assert.equal(prompts[0]['3'].inputs.model_name, 'RealESRGAN_x2plus.pth')
  assert.deepEqual([prompts[0]['5'].inputs.width, prompts[0]['5'].inputs.height], [1890, 1080])
  const out = await up.probeVideo(path.join(DATA, row.localPath!))
  assert.deepEqual([out.width, out.height, out.hasAudio], [1890, 1080, true])
  assert.ok(Math.abs(out.duration - 5) < 0.3, `时长 ${out.duration}`)
})

test('auto with ComfyUI but no upscale model: falls back to fast upscale and says why', { skip: !FFMPEG }, async () => {
  resetGpuLanes()
  comfyModels = []
  const before = prompts.length
  const sb = await addShot(3, makeClip('static/videos/nomodel.mp4', 640, 360, 2))
  const row = await waitDone(await up.startUpscale(sb, { engine: 'auto' }))
  assert.equal(row.status, 'completed')
  assert.equal(row.model, '快速放大（FFmpeg）')
  assert.match(String(row.errorMsg), /没有放大模型.*已改用快速放大/)
  assert.equal(prompts.length, before)
  // 指定 AI 时直接失败并告诉怎么装模型
  const sb2 = await addShot(4, makeClip('static/videos/nomodel2.mp4', 640, 360, 2))
  const row2 = await waitDone(await up.startUpscale(sb2, { engine: 'ai' }))
  assert.equal(row2.status, 'failed')
  assert.match(String(row2.errorMsg), /upscale_models.*RealESRGAN_x2plus/)
})

test('merge: shots with different sizes / frame rates are unified instead of breaking the film', { skip: !FFMPEG }, async () => {
  const a = makeClip('static/videos/m1.mp4', 1920, 1080, 2, 24)
  const b = makeClip('static/videos/m2.mp4', 1280, 720, 2, 16, false)
  assert.deepEqual(await uniformVideoFilters([a, b].map((r) => path.join(DATA, r))), [
    'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black', 'setsar=1', 'fps=24',
  ])
  assert.deepEqual(await uniformVideoFilters([a, a].map((r) => path.join(DATA, r))), [])
  const ts = new Date().toISOString()
  const res: any = await db.insert(schema.episodes).values({ dramaId: 1, episodeNumber: 2, title: '第2集', createdAt: ts, updatedAt: ts } as any)
  const ep2 = Number(res.lastInsertRowid)
  for (const [n, v] of [[1, a], [2, b]] as const) {
    await db.insert(schema.storyboards).values({ episodeId: ep2, storyboardNumber: n, title: `m${n}`, videoUrl: v, duration: 2, createdAt: ts, updatedAt: ts } as any)
  }
  const mergeId = await mergeEpisodeVideos(ep2, 1)
  const t0 = Date.now()
  let row: any
  while (Date.now() - t0 < 60_000) {
    ;[row] = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.id, mergeId))
    if (row.status !== 'processing') break
    await new Promise((r) => setTimeout(r, 200))
  }
  assert.equal(row.status, 'completed', row.errorMsg)
  const info = await up.probeVideo(path.join(DATA, row.mergedUrl))
  assert.deepEqual([info.width, info.height, Math.round(info.fps), info.hasAudio], [1920, 1080, 24, true], '没声音的镜头补静音，整片有音轨')
  assert.ok(Math.abs(info.duration - 4) < 0.3, `时长 ${info.duration}`)
})
