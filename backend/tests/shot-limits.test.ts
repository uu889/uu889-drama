import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 临时数据库（必须在导入 db 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-shot-limits-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { db, initDb, schema } = await import('../src/db/index')
const { eq } = await import('drizzle-orm')
const { shotLimitsForEpisode, shotLimitsAgentDirective, shotLimitsFrom } = await import('../src/services/shot-limits')
const { buildShotDirectives } = await import('../src/services/shot-direction')
const { fitPromptBytes } = await import('../src/services/video-limits')
const { storyboardTools } = await import('../src/agents/tools/storyboard-tools')
const { buildAgentRequestContext } = await import('../src/agents/context')

let episodeId = 0
let dramaId = 0

before(async () => {
  initDb()
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values([
    { serviceType: 'video', provider: 'aiask', name: '默认视频', baseUrl: 'https://aiask.me', apiKey: 'k', model: '["grok-imagine-video-1.5"]', isActive: true, priority: 100, createdAt: ts, updatedAt: ts },
    { serviceType: 'video', provider: 'comfyui', name: '本地 H3', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model: '["minimax-h3"]', isActive: true, priority: 1, settings: JSON.stringify({ max_duration: 8, max_prompt_bytes: 2000 }), createdAt: ts, updatedAt: ts },
  ])
  const cfgs = await db.select().from(schema.aiServiceConfigs)
  const local = cfgs.find((c) => c.provider === 'comfyui')!
  await db.insert(schema.dramas).values({ title: '测试剧', createdAt: ts, updatedAt: ts })
  dramaId = (await db.select().from(schema.dramas))[0].id
  await db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: '第一集', videoConfigId: local.id, createdAt: ts, updatedAt: ts })
  episodeId = (await db.select().from(schema.episodes))[0].id
})

test('limits follow the episode\'s locked video config, else the active one (defaults 15 s / 4090 bytes)', async () => {
  const locked = await shotLimitsForEpisode(episodeId)
  assert.equal(locked.maxDuration, 8)
  assert.equal(locked.maxPromptBytes, 2000)
  assert.equal(locked.promptBudgetBytes, 1200, '60% 留给 Agent，其余给自动追加的导演指令')
  const fallback = await shotLimitsForEpisode(null)
  assert.equal(fallback.maxDuration, 15)
  assert.equal(fallback.maxPromptBytes, 4090)
  assert.equal(shotLimitsFrom({ max_prompt_bytes: 0 }).promptBudgetBytes, 0)
})

test('storyboard / video-prompt agents are told the per-shot limits', () => {
  const l = shotLimitsFrom({ max_duration: 8, max_prompt_bytes: 2000 })
  const sb = shotLimitsAgentDirective('storyboard_breaker', l, 'zh')
  assert.match(sb, /不得超过 8 秒/)
  assert.match(sb, /不是整集成片的长度/)
  assert.match(sb, /拆成两个/)
  assert.match(sb, /按 4-8 秒执行/)
  const vp = shotLimitsAgentDirective('prompt_generator', l, 'en')
  assert.match(vp, /under 1200 bytes/)
  assert.equal(shotLimitsAgentDirective('extractor', l, 'zh'), '')
})

test('save_storyboards clamps a shot to the video API limit and asks the agent to split it', async () => {
  const requestContext = buildAgentRequestContext({ episodeId, dramaId })
  const lines = Array.from({ length: 4 }, (_, i) => `小明说：「这是第${i + 1}句很长很长的台词，需要好几秒才能说完整。」`).join('')
  const res: any = await (storyboardTools.saveStoryboards as any).execute({
    replace_existing: true,
    storyboards: [
      { shot_number: 1, title: '长对白', description: `【镜头1】${lines}`, duration: 14, video_prompt: '雨'.repeat(500) },
      { shot_number: 2, title: '短', description: '【镜头1】小明点头（无人说话）', duration: 5 },
    ],
  }, { requestContext })
  assert.ok(!res.error, res.error)
  const rows = await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
  assert.equal(rows.find((r) => r.storyboardNumber === 1)!.duration, 8)
  assert.equal(rows.find((r) => r.storyboardNumber === 2)!.duration, 5)
  const warnings = res.timing_warnings.join('\n')
  assert.match(warnings, /#1: .*超过视频接口单镜上限 8 秒/)
  assert.match(warnings, /#1: video_prompt 1500 字节，超过预算 1200 字节/)

  const id = rows.find((r) => r.storyboardNumber === 2)!.id
  const upd: any = await (storyboardTools.updateStoryboard as any).execute({ storyboard_id: id, duration: 12 }, { requestContext })
  assert.match(upd.warnings[0], /已改为 8 秒/)
  const [row] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  assert.equal(row.duration, 8)
})

test('physics directive is appended by default, can be turned off, and is dropped early when over the byte limit', () => {
  const base = { description: '【镜头1】小明拿起杯子喝水（无人说话）', duration: 5, characters: [], prompt: '0-3秒：小明拿起杯子。', options: {} }
  const on = buildShotDirectives(base)
  assert.match(on, /【物理真实】/)
  assert.match(on, /不滑步、不漂浮/)
  assert.doesNotMatch(buildShotDirectives({ ...base, options: { physicsLock: false } }), /物理真实/)
  const en = buildShotDirectives({ ...base, description: 'Tom drinks.', prompt: '0-3s: Tom picks up a cup.' })
  assert.match(en, /\[Physics\]/)
  const full = `${'小明拿起杯子，慢慢喝水。'.repeat(20)}\n\n${on}`
  const fit = fitPromptBytes(full, Buffer.byteLength(full) - 50)
  assert.ok(fit.removed.includes('物理真实') || fit.removed.includes('画风一致'))
  assert.match(fit.prompt, /【台词控制】/)
})
