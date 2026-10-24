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

test('limits follow the episode\'s locked video config, else the active one (unlimited by default)', async () => {
  const locked = await shotLimitsForEpisode(episodeId)
  assert.equal(locked.maxDuration, 8)
  assert.equal(locked.maxPromptBytes, 2000)
  assert.equal(locked.promptBudgetBytes, 1000, '一半留给 Agent，其余给画风词和自动追加的导演指令')
  // 启用的是 aiask Grok：没设上限也按接口自身的 4096 字节给 Agent 预算
  const fallback = await shotLimitsForEpisode(null)
  assert.equal(fallback.maxDuration, 0)
  assert.equal(fallback.maxPromptBytes, 4096)
  assert.equal(fallback.promptBudgetBytes, 2048)
  assert.equal(shotLimitsFrom({ max_prompt_bytes: 8000 }, null, 'xai').maxPromptBytes, 4096)
  const free = shotLimitsFrom({}, null, 'comfyui')
  assert.equal(free.promptBudgetBytes, 0)
  assert.equal(shotLimitsAgentDirective('storyboard_breaker', free, 'zh'), '', '不限制时不追加说明')
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
  assert.match(vp, /under 1000 bytes/)
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
  assert.match(warnings, /#1: video_prompt 1500 字节，超过预算 1000 字节/)

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
  // 正文够长时先截正文结尾，附加指令都保留
  assert.ok(fit.bodyCut)
  assert.deepEqual(fit.removed, [])
  assert.match(fit.prompt, /【物理真实】/)
  assert.match(fit.prompt, /【台词控制】/)
  // 正文已经截到下限还超：物理真实排在画风之后、接上一镜之前去掉
  const short = `小明喝水。\n\n${on}`
  const tight = fitPromptBytes(short, Buffer.byteLength(short) - 30)
  assert.ok(tight.removed.includes('画风一致') || tight.removed.includes('物理真实'))
  assert.match(tight.prompt, /【台词控制】/)
})

test('over the limit: compact directives keep every block at about half the size; continuity is dropped last', () => {
  const input = {
    description: '林晚：「你怎么来了？」陈默：「路过。」', duration: 10,
    blocking: '开场：林晚坐在左侧窗边，陈默站在右侧门口。结尾：陈默坐下。',
    characters: [{ name: '林晚', appearance: '二十五岁女性，鹅蛋脸，黑色长直发，杏眼', styling: '米白色针织开衫' }, { name: '陈默', appearance: '二十八岁男性，短发，剑眉', styling: '深灰色西装' }],
    sceneName: '咖啡厅', previous: { number: 8, blocking: '结尾：林晚独自坐在窗边。' }, previousFrame: { mode: 'reference' as const, index: 1 },
    prompt: '@图片1 咖啡厅。@图片2林晚抬头看向@图片3陈默。', hasStylePreset: true, options: {},
  }
  const full = buildShotDirectives(input)
  const compact = buildShotDirectives({ ...input, compact: true })
  const labels = (s: string) => (s.match(/^【[^】]+】/gm) || []).join('')
  assert.equal(labels(compact), labels(full), '精简版保留同样的指令块')
  assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(full) * 0.65, `${Buffer.byteLength(compact)} vs ${Buffer.byteLength(full)}`)
  assert.match(compact, /@图片1 是上一镜结尾画面/)
  assert.match(compact, /1\. @图片2林晚：「你怎么来了？」/)
  // 极端情况：正文很短、上限很紧，接上一镜仍最后才去
  const prompt = `小明喝水。\n\n${compact}`
  const fit = fitPromptBytes(prompt, Buffer.byteLength(prompt) - 400)
  assert.ok(fit.removed.length > 0)
  assert.ok(!fit.removed.includes('接上一镜'), fit.removed.join(','))
  assert.match(fit.prompt, /【接上一镜】/)
})
