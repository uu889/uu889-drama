import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 临时数据库（必须在导入 db 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-shot-split-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { planShotSplit, splitOverlongShots } = await import('../src/services/shot-split')
const { checkShotTiming } = await import('../src/services/shot-direction')
const { saveDramaShotMax, shotLimitsForEpisode, shotLimitsFrom, shotLimitsAgentDirective } = await import('../src/services/shot-limits')
const { storyboardTiming } = await import('../src/services/storyboard-timing')

// 用户截图里的分镜：5 段「N秒：」，4 句台词合计约 28 秒，分镜却只有 15 秒
const PROMPT = `@老太太 @孩子 @铺子门口
站位：老太太在画面左侧，孩子在右侧。
0-3秒：@铺子门口，中景，@老太太拉着@孩子的手，弯腰说：「我儿子说今儿不去了，累得慌，在家挺尸呢。你要是不困，去铺子里给我睡一宿。」
3-6秒：近景，@老太太指了指铺子里面，说：「那铺子后面有张竹床，铺盖都是现成的。你帮我看一眼门，别让人把铃铛摘了——明儿我给你装一兜子炒黄豆。」
6-9秒：@孩子抬头看她，点头：「行。铃铛响了怎么办？」
9-12秒：@老太太笑了：「响了你就喊。一嗓子我儿子就听见了。」
12-15秒：@孩子走进铺子，回头看了一眼门口的铃铛（无人说话）。`
const DESC = `夜，老街铺子门口。【镜头1】中景，老太太拉着孩子的手，弯腰说：「我儿子说今儿不去了，累得慌，在家挺尸呢。你要是不困，去铺子里给我睡一宿。」【镜头2】近景，老太太指了指铺子里面，说：「那铺子后面有张竹床，铺盖都是现成的。你帮我看一眼门，别让人把铃铛摘了——明儿我给你装一兜子炒黄豆。」【镜头3】孩子抬头看她，点头：「行。铃铛响了怎么办？」老太太笑了：「响了你就喊。一嗓子我儿子就听见了。」【镜头4】孩子走进铺子，回头看了一眼铃铛。`
const NAMES = ['老太太', '孩子']
const QUOTES = ['我儿子说今儿不去了', '那铺子后面有张竹床', '行。铃铛响了怎么办？', '响了你就喊']

let episodeId = 0
let dramaId = 0

before(async () => {
  initDb()
  const ts = new Date().toISOString()
  await db.insert(schema.dramas).values({ title: '测试剧', createdAt: ts, updatedAt: ts })
  dramaId = (await db.select().from(schema.dramas))[0].id
  await db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: '第一集', createdAt: ts, updatedAt: ts })
  episodeId = (await db.select().from(schema.episodes))[0].id
})

test('an overlong shot is split by its lines into consecutive shots within the cap', () => {
  assert.ok(checkShotTiming(DESC, 15, NAMES, PROMPT).neededSeconds > 25)
  const plan = planShotSplit({ description: DESC, videoPrompt: PROMPT, names: NAMES, maxSeconds: 15 })!
  assert.ok(plan, 'should split')
  assert.equal(plan.source, 'prompt')
  assert.equal(plan.parts.length, 3)
  const all = plan.parts.map((p) => p.videoPrompt).join('\n')
  for (const q of QUOTES) assert.equal(all.split(q).length - 1, 1, `每句台词只出现一次：${q}`)
  plan.parts.forEach((p) => {
    assert.ok(p.duration <= 15 && p.duration >= 4, String(p.duration))
    const t = checkShotTiming(p.description, p.duration, NAMES, p.videoPrompt)
    assert.ok(t.neededSeconds <= 15.5, `${t.neededSeconds}`)
    assert.notEqual(t.status, 'too_short')
    // 信息头和站位每段都保留，时间分段从 0 秒重新排到本段时长
    assert.match(p.videoPrompt, /^@老太太 @孩子 @铺子门口\n站位：/)
    assert.match(p.videoPrompt, /\n0-\d+秒：/)
    assert.ok(p.videoPrompt.includes(`-${p.duration}秒：`), p.videoPrompt)
    // 描述跟着切开，场景说明每段都有，【镜头N】从 1 重新编号
    assert.match(p.description, /^夜，老街铺子门口。/)
    assert.doesNotMatch(p.description, /【镜头[2-9]】.*【镜头1】/)
  })
  assert.match(plan.parts[0].description, /我儿子说今儿不去了/)
  assert.doesNotMatch(plan.parts[0].description, /竹床/)
  assert.match(plan.parts[2].description, /铃铛响了怎么办/)
  assert.match(plan.parts[2].videoPrompt, /（无人说话）/, '结尾的无台词动作跟着最后一段')
})

test('a single line that is too long is broken at sentence ends and continued by the same speaker', () => {
  const plan = planShotSplit({ description: DESC, videoPrompt: PROMPT, names: NAMES, maxSeconds: 8 })!
  assert.ok(plan.parts.length >= 5, String(plan.parts.length))
  const cont = plan.parts.filter((p) => /继续说：「/.test(p.videoPrompt))
  assert.ok(cont.length >= 2)
  for (const p of cont) {
    assert.match(p.videoPrompt, /@老太太继续说：「/, '续说的是原来的说话人')
    assert.match(p.description, /老太太继续说：「/)
    assert.equal(checkShotTiming(p.description, p.duration, NAMES, p.videoPrompt).lines[0].speaker, '老太太')
  }
  for (const p of plan.parts) {
    assert.ok(p.duration <= 8)
    assert.ok(checkShotTiming(p.description, p.duration, NAMES, p.videoPrompt).neededSeconds <= 8.5)
    // 引号成对
    assert.equal((p.videoPrompt.match(/「/g) || []).length, (p.videoPrompt.match(/」/g) || []).length, p.videoPrompt)
    assert.equal((p.description.match(/「/g) || []).length, (p.description.match(/」/g) || []).length, p.description)
  }
})

test('shots within the cap are left alone; description-only shots are split by 【镜头N】', () => {
  assert.equal(planShotSplit({ description: '林晚：「你来了。」', names: ['林晚'], maxSeconds: 10 }), null)
  const desc = '咖啡厅，午后。【镜头1】林晚放下杯子，看着陈默说：「你知道我等了你多久吗？三年，整整三年，我每天都来这家店，坐在这个位置。」【镜头2】陈默低头不语。【镜头3】林晚站起来：「我不想再等了。今天你要是不说清楚，我们就到此为止。」陈默抬头：「好，我说。」'
  const plan = planShotSplit({ description: desc, names: ['林晚', '陈默'], maxSeconds: 10 })!
  assert.equal(plan.source, 'description')
  assert.equal(plan.parts.length, 2)
  assert.ok(plan.parts.every((p) => p.videoPrompt === ''), '提示词要按新描述重写')
  assert.match(plan.parts[1].description, /^咖啡厅，午后。\n?【镜头1】陈默低头不语。【镜头2】林晚站起来/)
})

test('the cap defaults to 15s, follows the project setting and the video config (smaller wins)', async () => {
  assert.equal(shotLimitsFrom({}).maxShotSeconds, 15)
  assert.equal(shotLimitsFrom({}).shotCapSource, 'default')
  assert.equal(shotLimitsFrom({ max_duration: 10 }).maxShotSeconds, 10)
  assert.equal(shotLimitsFrom({ max_duration: 10 }, null, null, 6).shotCapSource, 'project')
  assert.equal(shotLimitsFrom({ max_duration: 6 }, null, null, 10).maxShotSeconds, 6)
  assert.equal(shotLimitsFrom({}, null, null, 20).maxShotSeconds, 20)
  // 默认也告诉拆分镜 Agent 单镜上限和台词字数
  const d = shotLimitsAgentDirective('storyboard_breaker', shotLimitsFrom({}), 'zh')
  assert.match(d, /最长 15 秒/)
  assert.match(d, /不超过 50 个字/)
  assert.match(shotLimitsAgentDirective('storyboard_breaker', shotLimitsFrom({}, null, null, 8), 'zh'), /最长 8 秒（本项目设置的单镜上限）.*≤ 24 字/s)

  assert.equal((await shotLimitsForEpisode(episodeId)).maxShotSeconds, 15)
  assert.ok(await saveDramaShotMax(dramaId, 10))
  assert.equal((await shotLimitsForEpisode(episodeId)).maxShotSeconds, 10)
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  assert.equal(JSON.parse(drama.metadata!).shot_max_seconds, 10)
  assert.ok(await saveDramaShotMax(dramaId, null))
  assert.equal((await shotLimitsForEpisode(episodeId)).projectMaxSeconds, null)
  assert.equal(await saveDramaShotMax(99999, 10), false)
})

test('storyboard timing reports over_max with the number of parts', () => {
  const t = storyboardTiming({ description: DESC, videoPrompt: PROMPT, duration: 15 }, NAMES, 15)
  assert.equal(t.over_max, true)
  assert.equal(t.max_seconds, 15)
  assert.equal(t.split_parts, 3)
  assert.equal(t.recommended, 15)
  const ok = storyboardTiming({ description: '孩子：「行。」', duration: 4 }, NAMES, 15)
  assert.equal(ok.over_max, false)
  assert.equal(ok.split_parts, 0)
})

test('splitting in the database renumbers later shots, copies bindings and skips shots with a video', async () => {
  const ts = new Date().toISOString()
  await db.insert(schema.characters).values([
    { dramaId, name: '老太太', createdAt: ts, updatedAt: ts },
    { dramaId, name: '孩子', createdAt: ts, updatedAt: ts },
  ])
  const chars = await db.select().from(schema.characters)
  const ins = async (n: number, extra: Record<string, any>) => {
    await db.insert(schema.storyboards).values({ episodeId, storyboardNumber: n, title: `镜${n}`, duration: 10, createdAt: ts, updatedAt: ts, ...extra })
    const rows = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
    return rows.find((r) => r.storyboardNumber === n)!.id
  }
  const a = await ins(1, { description: '【镜头1】孩子看着铺子（无人说话）' })
  const b = await ins(2, { description: DESC, videoPrompt: PROMPT, duration: 15, sceneId: 7, blocking: '开场：老太太左，孩子右。', firstFrameImage: 'static/f.jpg', lastFrameImage: 'static/l.jpg' })
  const c = await ins(3, { description: '孩子：「好。」', duration: 4 })
  const d = await ins(4, { description: DESC, videoPrompt: PROMPT, duration: 15, videoUrl: 'static/videos/x.mp4' })
  for (const id of [b, d]) for (const ch of chars) await db.insert(schema.storyboardCharacters).values({ storyboardId: id, characterId: ch.id })

  const res = await splitOverlongShots(episodeId)
  assert.equal(res.max_seconds, 15)
  assert.deepEqual(res.split.map((s) => [s.storyboard_id, s.shot_number, s.parts]), [[b, 2, 3]])
  assert.deepEqual(res.skipped.map((s) => [s.storyboard_id, s.reason]), [[d, 'has_video']])
  const rows = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))).sort((x, y) => x.storyboardNumber - y.storyboardNumber)
  assert.deepEqual(rows.map((r) => r.storyboardNumber), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(rows.map((r) => r.id).filter((id) => [a, b, c, d].includes(id)), [a, b, c, d])
  assert.equal(rows[0].id, a)
  assert.equal(rows[1].id, b)
  assert.equal(rows[4].id, c)
  assert.equal(rows[5].id, d)
  const parts = rows.slice(1, 4)
  assert.deepEqual(parts.map((r) => r.title), ['镜2（1/3）', '镜2（2/3）', '镜2（3/3）'])
  assert.ok(parts.every((r) => r.sceneId === 7 && r.blocking === '开场：老太太左，孩子右。' && (r.duration || 0) <= 15))
  assert.equal(parts[0].firstFrameImage, 'static/f.jpg')
  assert.equal(parts[0].lastFrameImage, null)
  assert.equal(parts[2].lastFrameImage, 'static/l.jpg', '原分镜的结尾帧属于最后一段')
  for (const r of parts) {
    const links = await db.select().from(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, r.id))
    assert.equal(links.length, 2)
  }

  // 已有视频的分镜：明确要求时才拆，拆后视频清空要重新生成
  const forced = await splitOverlongShots(episodeId, { storyboardIds: [d], includeWithVideo: true })
  assert.equal(forced.split[0].parts, 3)
  const [dRow] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, d))
  assert.equal(dRow.videoUrl, null)
  assert.equal(dRow.storyboardNumber, 6)
  const total = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))).length
  assert.equal(total, 8)

  // 再跑一次：没有超时的分镜了
  const again = await splitOverlongShots(episodeId)
  assert.equal(again.split.length, 0)
  assert.equal(again.skipped.length, 0)
})
