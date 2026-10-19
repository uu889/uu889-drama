import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'

// 临时数据目录 / 数据库；有系统 ffmpeg 时用它跑真实烧录（必须在导入 ffmpeg 工具之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-sub-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
const SYS_FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => fs.existsSync(p))
if (SYS_FFMPEG && !process.env.FFMPEG_BIN) {
  process.env.FFMPEG_BIN = SYS_FFMPEG
  process.env.FFPROBE_BIN = SYS_FFMPEG.replace(/ffmpeg$/, 'ffprobe')
}

const sub = await import('../src/services/subtitles')
const { parseShotDialogue } = await import('../src/services/shot-direction')

const DESC = '夜晚，街边算命摊。张三坐下，笑着说：“老先生，您给我算算，今天宜不宜出门？我有一笔很重要的生意要谈，心里实在没底。”李四摇着扇子答：“宜，大吉。”旁白：这是他命运转折的开始。'

test('options: off unless enabled, unknown values fall back to defaults', () => {
  assert.equal(sub.normalizeSubtitleOptions(undefined), null)
  assert.equal(sub.normalizeSubtitleOptions({ enabled: false, style: 'box' }), null)
  assert.deepEqual(sub.normalizeSubtitleOptions({ enabled: true }), { style: 'classic', size: 'medium', position: 'bottom', speaker: false })
  assert.deepEqual(sub.normalizeSubtitleOptions({ enabled: true, style: 'pink', size: 'large', position: 'top', speaker: true }), { style: 'pink', size: 'large', position: 'top', speaker: true })
  assert.equal(sub.normalizeSubtitleOptions({ enabled: true, style: 'neon' })!.style, 'classic')
})

test('wrapping: breaks at punctuation, never wider than the line', () => {
  const lines = sub.wrapText('老先生，您给我算算，今天宜不宜出门？我有一笔很重要的生意要谈。', 12)
  for (const l of lines) assert.ok(sub.textWidthEm(l) <= 12, l)
  assert.equal(lines.join(''), '老先生，您给我算算，今天宜不宜出门？我有一笔很重要的生意要谈。')
  assert.match(lines[0], /，$/)
  assert.deepEqual(sub.wrapText('Hello world, this is a test', 8).every((l) => sub.textWidthEm(l) <= 8), true)
})

test('timing: lines in speaking order, speaker prefix, long lines split, everything ends before the video does', () => {
  const lines = parseShotDialogue(DESC, ['张三', '李四'])
  // 镜头够长：按估算时长排开
  const roomy = sub.buildSubtitleCues(lines, 20, { speaker: true }, 18)
  assert.match(roomy[0].lines[0], /^张三：老先生/)
  assert.ok(roomy.some((c) => c.lines.join('') === '李四：宜，大吉。'))
  assert.equal(roomy[roomy.length - 1].lines.join(''), '这是他命运转折的开始', '旁白不加名字')
  for (let i = 1; i < roomy.length; i++) assert.ok(roomy[i].start >= roomy[i - 1].end - 0.01)
  for (const c of roomy) assert.ok(c.lines.length <= 2)
  // 镜头太短：压缩，但每句都留够阅读时间
  const tight = sub.buildSubtitleCues(lines, 6, { speaker: false }, 18)
  assert.ok(tight[tight.length - 1].end <= 6)
  const short = tight.find((c) => c.lines.join('') === '宜，大吉。')!
  assert.ok(short.end - short.start >= 1, `短句显示 ${short.end - short.start} 秒`)
  assert.deepEqual(sub.buildSubtitleCues([], 5, { speaker: false }), [])
})

test('SRT output', () => {
  const srt = sub.cuesToSrt([{ start: 0.5, end: 2.25, lines: ['第一行', '第二行'] }, { start: 61.2, end: 63, lines: ['x'] }])
  assert.equal(srt, '1\n00:00:00,500 --> 00:00:02,250\n第一行\n第二行\n\n2\n00:01:01,200 --> 00:01:03,000\nx\n')
})

test('drawtext: Windows font paths are escaped, styles map to drawtext options, top / bottom placement', () => {
  assert.equal(sub.filterPath('C:\\Windows\\Fonts\\msyhbd.ttc'), "'C\\:/Windows/Fonts/msyhbd.ttc'")
  const cues = [{ start: 0.5, end: 2, lines: ['第一行', '第二行'] }]
  const layout = { width: 720, height: 1280, fontfile: 'C:\\Windows\\Fonts\\msyh.ttc', textFile: (c: number, l: number) => `C:\\Temp\\c${c}_${l}.txt` }
  const box = sub.buildDrawtextFilter(cues, { style: 'box', size: 'medium', position: 'bottom', speaker: false }, layout)
  const parts = box.split(/,(?=drawtext=)/)
  assert.equal(parts.length, 2, '每行一个 drawtext')
  assert.match(parts[0], /fontfile='C\\:\/Windows\/Fonts\/msyh\.ttc'/)
  assert.match(parts[0], /textfile='C\\:\/Temp\/c0_0\.txt'/)
  assert.match(parts[0], /box=1:boxcolor=black@0\.55/)
  assert.match(parts[0], /enable='between\(t,0\.5,2\)'/)
  const y = (s: string) => Number(/:y=(\d+)/.exec(s)![1])
  assert.ok(y(parts[0]) < y(parts[1]) && y(parts[1]) > 1280 * 0.6, '底部、第一行在上')
  const top = sub.buildDrawtextFilter(cues, { style: 'pink', size: 'large', position: 'top', speaker: false }, layout)
  assert.ok(y(top) < 1280 * 0.2)
  assert.match(top, /bordercolor=0xFF3D7F/)
  assert.equal(sub.subtitledPathFor('static/videos/abc.mp4'), 'static/videos/abc_sub.mp4')
})

// ─── 真实烧录 + 完整生成流程（需要系统 ffmpeg 和中文字体） ───

const canBurn = !!SYS_FFMPEG && !!sub.findSubtitleFont()

let server: http.Server
let base = ''
let videoBytes: Buffer
before(async () => {
  if (!canBurn) return
  const src = path.join(DATA, 'src.mp4')
  execFileSync(SYS_FFMPEG!, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', src])
  videoBytes = fs.readFileSync(src)
  // 模拟 ComfyUI：提交即完成，/view 返回上面这段视频
  server = http.createServer((req, res) => {
    const url = req.url || ''
    const json = (v: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
    if (url === '/prompt') return json({ prompt_id: 'p1', number: 1, node_errors: {} })
    if (url.startsWith('/history/')) return json({ p1: { status: { status_str: 'success', completed: true }, outputs: { '61': { videos: [{ filename: 'shot.mp4', subfolder: 'video', type: 'output' }] } } } })
    if (url.startsWith('/view')) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': videoBytes.length }); res.end(videoBytes); return }
    if (url === '/queue') return json({ queue_running: [], queue_pending: [] })
    res.writeHead(404); res.end('{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as any).port}`
})
after(() => { server?.close() })

test('burn: real ffmpeg writes a subtitled copy with audio and an SRT, the original stays', { skip: !canBurn && '没有系统 ffmpeg 或中文字体' }, async () => {
  const dir = path.join(DATA, 'static', 'videos')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(DATA, 'src.mp4'), path.join(dir, 'burn.mp4'))
  const lines = parseShotDialogue(DESC, ['张三', '李四'])
  const out = await sub.burnSubtitles('static/videos/burn.mp4', lines, { style: 'classic', size: 'medium', position: 'bottom', speaker: true })
  assert.ok(out)
  assert.equal(out!.video, 'static/videos/burn_sub.mp4')
  assert.ok(fs.existsSync(path.join(dir, 'burn.mp4')), '原视频保留')
  const streams = execFileSync(process.env.FFPROBE_BIN!, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(dir, 'burn_sub.mp4')]).toString().trim().split('\n')
  assert.deepEqual(streams.sort(), ['audio', 'video'])
  assert.match(fs.readFileSync(path.join(dir, 'burn_sub.srt'), 'utf8'), /^1\n00:00:00,\d{3} --> .*\n张三：老先生/)
  // 有字幕的画面和原画面不同（字幕区域有像素变化）
  const frame = (f: string) => execFileSync(SYS_FFMPEG!, ['-loglevel', 'error', '-ss', '1', '-i', path.join(dir, f), '-frames:v', '1', '-vf', 'crop=iw:ih*0.3:0:ih*0.7,scale=64:16', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  const a = frame('burn.mp4'); const b = frame('burn_sub.mp4')
  let diff = 0
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
  assert.ok(diff / a.length > 3, `字幕区域平均差 ${diff / a.length}`)
  assert.equal(await sub.burnSubtitles('static/videos/burn.mp4', [], { style: 'classic', size: 'medium', position: 'bottom', speaker: false }), null, '没有台词不生成')
})

test('generation flow: subtitle option on a shot → storyboard gets the subtitled video + SRT, continuity end frame has no subtitles', { skip: !canBurn && '没有系统 ffmpeg 或中文字体' }, async () => {
  const { db, initDb, schema } = await import('../src/db/index')
  const { eq } = await import('drizzle-orm')
  const { generateVideo } = await import('../src/services/generation')
  initDb()
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values({ serviceType: 'video', provider: 'comfyui', name: 'ComfyUI', baseUrl: base, apiKey: '', model: JSON.stringify(['wan2.2-ti2v-5b']), isActive: true, priority: 10, createdAt: ts, updatedAt: ts })
  const [ch] = await db.insert(schema.characters).values({ dramaId: 1, name: '张三', createdAt: ts, updatedAt: ts } as any).returning()
  const [ch2] = await db.insert(schema.characters).values({ dramaId: 1, name: '李四', createdAt: ts, updatedAt: ts } as any).returning()
  const [sb] = await db.insert(schema.storyboards).values({ episodeId: 1, storyboardNumber: 1, description: DESC, createdAt: ts, updatedAt: ts } as any).returning()
  await db.insert(schema.storyboardCharacters).values([{ storyboardId: sb.id, characterId: ch.id }, { storyboardId: sb.id, characterId: ch2.id }])

  const id = await generateVideo({ storyboardId: sb.id, prompt: '街边算命', duration: 5, subtitle: { enabled: true, style: 'yellow', speaker: true } })
  const t0 = Date.now()
  let task: any
  while (Date.now() - t0 < 60_000) {
    ;[task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (task.status !== 'processing') break
    await new Promise((r) => setTimeout(r, 300))
  }
  assert.equal(task.status, 'completed', task.errorMsg)
  assert.match(task.localPath, /_sub\.mp4$/)
  const [after] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
  assert.equal(after.videoUrl, task.localPath)
  assert.match(String(after.subtitleUrl), /_sub\.srt$/)
  const { getAbsolutePath } = await import('../src/utils/storage')
  const subVideo = getAbsolutePath(after.videoUrl!)
  const raw = subVideo.replace(/_sub\.mp4$/, '.mp4')
  assert.ok(fs.existsSync(raw), '原视频还在')
  // 接戏结尾帧：带字幕版本的 _last.jpg 是从原视频复制的（和原视频的一模一样）
  const lastSub = subVideo.replace(/\.mp4$/, '_last.jpg')
  const lastRaw = raw.replace(/\.mp4$/, '_last.jpg')
  assert.ok(fs.existsSync(lastSub) && fs.existsSync(lastRaw))
  assert.deepEqual(fs.readFileSync(lastSub), fs.readFileSync(lastRaw))
  assert.match(fs.readFileSync(getAbsolutePath(after.subtitleUrl!), 'utf8'), /张三：/)
})
