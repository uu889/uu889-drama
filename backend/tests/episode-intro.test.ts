/**
 * 拼接导出的片头：参数校验、滤镜、真实 FFmpeg 生成片头并拼到成片最前面
 */
import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-intro-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
const SYS_FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => fs.existsSync(p))
if (SYS_FFMPEG && !process.env.FFMPEG_BIN) {
  process.env.FFMPEG_BIN = SYS_FFMPEG
  process.env.FFPROBE_BIN = SYS_FFMPEG.replace(/ffmpeg$/, 'ffprobe')
}
const FFMPEG = process.env.FFMPEG_BIN || ''
const intro = await import('../src/services/episode-intro')
const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { mergeEpisodeVideos } = await import('../src/services/ffmpeg-merge')
const { probeVideo } = await import('../src/services/video-upscale')

before(() => initDb())

test('options: off when disabled, duration clamped, image must be a local static image', () => {
  assert.equal(intro.normalizeIntroOptions(null), null)
  assert.equal(intro.normalizeIntroOptions({ enabled: false, title: 'x' }), null)
  assert.deepEqual(intro.normalizeIntroOptions({ enabled: true }), { duration: 2, image: null, title: '', subtitle: '', font: null, size: 1, color: '#FFFFFF', box: true, shadow: true, y: 0.7 })
  const o = intro.normalizeIntroOptions({ enabled: true, duration: 9, image: '/static/images/cover.png', title: '  第 3 集   重逢 ', subtitle: '我的剧' })!
  assert.equal(o.duration, 5)
  assert.equal(o.image, 'static/images/cover.png')
  assert.equal(o.title, '第 3 集 重逢')
  assert.equal(intro.normalizeIntroOptions({ duration: 0.2 })!.duration, 1)
  assert.equal(intro.normalizeIntroOptions({ image: 'static/../uu889.sqlite3' })!.image, null)
  assert.equal(intro.normalizeIntroOptions({ image: 'https://x.com/a.png' })!.image, null)
})

test('style options: size / position clamped, color must be hex, font must be a known id', () => {
  const s = intro.normalizeIntroOptions({ size: 5, y: 0, color: 'ff8800', box: false, font: 'sys:simhei' })!
  assert.equal(s.size, 2)
  assert.equal(s.y, 0.1)
  assert.equal(s.color, '#FF8800')
  assert.equal(s.box, false)
  assert.equal(s.font, 'sys:simhei')
  const bad = intro.normalizeIntroOptions({ color: 'red;x', font: '/etc/passwd', size: 'x' })!
  assert.equal(bad.color, '#FFFFFF')
  assert.equal(bad.font, null)
  assert.equal(bad.size, 1)
  assert.equal(intro.normalizeIntroOptions({ font: 'static/fonts/../x.ttf' })!.font, null)
  assert.equal(intro.normalizeIntroOptions({ font: 'static/fonts/a1b2c3-my.ttf' })!.font, 'static/fonts/a1b2c3-my.ttf')
})

test('style filter: color, size, band only around the text, position follows y', () => {
  const base = intro.normalizeIntroOptions({ title: '第 1 集', subtitle: '剧名' })!
  const t = { width: 1280, height: 720, fps: 24 }
  const files = { fontfile: '/f.ttf', titleFile: '/t.txt', subtitleFile: '/s.txt' }
  const def = intro.buildIntroFilter(base, t, files)
  const band = /drawbox=x=0:y=(\d+):w=1280:h=(\d+)/.exec(def)!
  assert.ok(Number(band[1]) > 300 && Number(band[1]) + Number(band[2]) < 720, '背景条只盖住文字那一块')
  assert.match(def, /fontcolor=0xFFFFFF/)
  const big = intro.buildIntroFilter({ ...base, size: 2, color: '#FFCC00' }, t, files)
  assert.match(big, /fontcolor=0xFFCC00/)
  const size = (f: string) => Math.max(...[...f.matchAll(/fontsize=(\d+)/g)].map((m) => Number(m[1])))
  assert.ok(size(big) > size(def) * 1.8)
  assert.doesNotMatch(intro.buildIntroFilter({ ...base, box: false }, t, files), /drawbox/)
  assert.match(def, /borderw=\d+.*shadowx=\d+/)
  assert.doesNotMatch(intro.buildIntroFilter({ ...base, shadow: false }, t, files), /borderw|shadowx/)
  assert.equal(intro.normalizeIntroOptions({ shadow: false })!.shadow, false)
  const titleY = (f: string) => Number([...f.matchAll(/:y=(\d+)/g)].pop()![1])
  const top = intro.buildIntroFilter({ ...base, y: 0.2 }, t, files)
  assert.ok(titleY(top) < 200 && titleY(def) > 400)
  // 放到最底部也不出画面
  const bottom = intro.buildIntroFilter({ ...base, y: 0.9, size: 2 }, t, files)
  assert.ok(titleY(bottom) + size(bottom) <= 720)
})

test('fonts: lists only fonts present here, uploaded fonts can be saved / resolved / deleted', async () => {
  const fonts = await import('../src/services/intro-fonts')
  const before = fonts.listIntroFonts()
  for (const f of before) assert.ok(f.family || f.url)
  await assert.rejects(fonts.saveIntroFont(new ArrayBuffer(2048), 'x.exe'), /ttf/)
  const sys = before.find((f) => !f.uploaded)
  const src = sys ? fonts.resolveIntroFont(sys.id)! : null
  const data = src ? fs.readFileSync(src) : Buffer.alloc(4096, 1)
  const up = await fonts.saveIntroFont(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, '我的 字体.ttf')
  assert.match(up.id, /^static\/fonts\/[0-9a-z]+-我的_字体\.ttf$/)
  assert.ok(fonts.listIntroFonts().some((f) => f.id === up.id && f.uploaded))
  assert.ok(fonts.resolveIntroFont(up.id)!.endsWith('.ttf'))
  assert.equal(fonts.deleteIntroFont('static/../uu889.sqlite3'), false)
  assert.equal(fonts.deleteIntroFont(up.id), true)
  assert.ok(!fonts.listIntroFonts().some((f) => f.id === up.id))
})

test('filter: covers the frame, text only with a font, fades in and out', () => {
  const opts = intro.normalizeIntroOptions({ duration: 2, title: '第 1 集', subtitle: '剧名' })!
  const withText = intro.buildIntroFilter(opts, { width: 1280, height: 720, fps: 24 }, { fontfile: '/f.ttf', titleFile: '/t.txt', subtitleFile: '/s.txt' })
  assert.match(withText, /force_original_aspect_ratio=increase/)
  assert.match(withText, /crop=1280:720/)
  assert.equal(withText.match(/drawtext=/g)?.length, 2)
  assert.match(withText, /fade=t=out:st=1\.70:d=0\.3/)
  const noFont = intro.buildIntroFilter(opts, { width: 720, height: 1280, fps: 24 }, { fontfile: null })
  assert.doesNotMatch(noFont, /drawtext|drawbox/)
})

function makeVideo(file: string, seconds: number, size = '320x180') {
  execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=24:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { stdio: 'ignore' })
}

test('merge with intro: 2s intro is prepended at the clip size, cover image optional', { skip: !FFMPEG }, async () => {
  const dir = path.join(DATA, 'static', 'videos')
  fs.mkdirSync(dir, { recursive: true })
  makeVideo(path.join(dir, 'a.mp4'), 2)
  makeVideo(path.join(dir, 'b.mp4'), 2)
  fs.mkdirSync(path.join(DATA, 'static', 'images'), { recursive: true })
  execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=600x900', '-frames:v', '1', path.join(DATA, 'static', 'images', 'cover.png')], { stdio: 'ignore' })
  const ts = new Date().toISOString()
  for (const [n, v] of [[1, 'a'], [2, 'b']] as const) {
    await db.insert(schema.storyboards).values({ episodeId: 7, storyboardNumber: n, videoUrl: `static/videos/${v}.mp4`, createdAt: ts, updatedAt: ts } as any)
  }
  const wait = async (id: number) => {
    for (let i = 0; i < 600; i++) {
      const [m] = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.id, id))
      if (m?.status !== 'processing') return m
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('merge timeout')
  }
  for (const image of [null, 'static/images/cover.png']) {
    const id = await mergeEpisodeVideos(7, 1, undefined, null, intro.normalizeIntroOptions({ duration: 2, image, title: '第 7 集 · 重逢', subtitle: '测试剧', color: '#FFD000', y: 0.4 })!)
    const m = await wait(id)
    assert.equal(m.status, 'completed', String(m.errorMsg))
    const info = await probeVideo(path.join(DATA, m.mergedUrl!))
    assert.equal(info.width, 320)
    assert.equal(info.height, 180)
    assert.ok(info.duration >= 5.8 && info.duration <= 6.3, `duration ${info.duration}`)
    assert.ok(info.hasAudio)
  }
  // 临时文件都清掉了
  assert.deepEqual(fs.readdirSync(path.join(DATA, 'static', 'temp')).filter((f) => f.includes('intro') || f.endsWith('.txt')), [])
})
