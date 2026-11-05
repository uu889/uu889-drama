/**
 * 影像参数（Cinematic Spec）：清洗、按参考格式渲染、Agent / 对话指令、视频【影像底座】、预设文件、
 * AI 结果合并、项目存取与同步、时间戳分镜行能被拆分镜识别
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-cine-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-cine-ws-'))
fs.cpSync(path.resolve(import.meta.dirname, '../workspace/catalog'), path.join(WS, 'catalog'), { recursive: true })
process.env.WORKSPACE_PATH = WS

const cine = await import('../src/services/cinematic/index')
const opts = await import('../src/services/cinematic/options')
const { planShotSplit } = await import('../src/services/shot-split')
const { buildShotDirectives } = await import('../src/services/shot-direction')
const { fitPromptBytes } = await import('../src/services/video-limits')

const preset = () => cine.listPresets().find((p) => p.id === 'wuxia-cold-river')!.spec

test('选项表：id 唯一、每项都有作用说明，色调预设占比合计 100', () => {
  for (const [key, list] of Object.entries(opts.CINEMATIC_OPTIONS)) {
    if (!Array.isArray(list)) continue
    const ids = list.map((o: any) => o.id)
    assert.equal(new Set(ids).size, ids.length, `${key} 有重复 id`)
    for (const o of list as any[]) {
      assert.ok(o.label, `${key}.${o.id} 缺 label`)
      assert.ok(o.desc, `${key}.${o.id} 缺 desc`)
      if (key === 'palettes') assert.equal(o.colors.reduce((s: number, c: any) => s + c.percent, 0), 100, o.id)
    }
  }
  assert.ok(opts.CAMERA_MOVES.length >= 25)
  assert.ok(opts.STYLE_ANCHORS.length >= 30)
})

test('清洗：丢掉未知 id、坏色值、非站内地址，空名字的人物 / 道具去掉', () => {
  const s = cine.normalizeCinematicSpec({
    enabled: 'true',
    visual: { camera_ids: ['venice-2', 'nope', 'venice-2'], palette: [{ name: '青黛', hex: '1b333e', percent: 160 }, { hex: 'zzz' }] },
    characters: [{ name: '女侠', image_url: 'javascript:alert(1)' }, { name: '' }],
    props: [{ name: '剑', image_url: '/static/uploads/a.png' }],
  })
  assert.equal(s.enabled, true)
  assert.deepEqual(s.visual.camera_ids, ['venice-2'])
  assert.deepEqual(s.visual.palette, [{ name: '青黛', hex: '#1B333E', percent: 100 }])
  assert.equal(s.characters.length, 1)
  assert.equal(s.characters[0].image_url, '')
  assert.equal(s.props[0].image_url, '/static/uploads/a.png')
  assert.equal(cine.isCinematicActive(cine.normalizeCinematicSpec({ enabled: true })), false)
})

test('内置预设都能读出来，寒江孤舟示例按参考格式渲染六大块', () => {
  const presets = cine.listPresets()
  assert.ok(presets.length >= 7)
  for (const p of presets) assert.ok(cine.isCinematicActive(p.spec), p.id)
  const spec = { ...preset(), characters: preset().characters.map((c, i) => i === 0 ? { ...c, image_url: '/static/uploads/girl.png', voice_ref: 'syq1_trim_0-5000ms' } : c) }
  const text = cine.renderCinematicSpec(spec, { lang: 'zh', refs: 'image' })
  for (const h of ['[全局视觉与硬件底座', '[核心人物锚定', '[三维场景与空间逻辑锚定', '[关键道具与资产', '[面部明暗与立体塑造', '[动态时间戳分镜剧本']) {
    assert.ok(text.includes(h), h)
  }
  assert.match(text, /风格锚定：徐克导演美学 • 写实新国风武侠（清冷苍茫水墨意境与江湖市井黑色幽默反差）/)
  assert.match(text, /Sony VENICE 2（shot on Sony VENICE 2）：8\.6K 全画幅，细节清楚却不生硬/)
  assert.match(text, /35mm lens with 63° FOV/)
  assert.match(text, /构图画幅：16:9 anamorphic ratio（16:9 变形宽银幕）/)
  assert.match(text, /60% 寒江青黛色（#1B333E） \+ 30% 迷雾灰白与船木枯褐（#8B9DA5） \+ 10% 粗麻暗棕与古铜微光（#4A2E1B）/)
  assert.match(text, /女侠：参考@image的五官长相和发型。20岁左右清冷飒爽女侠，鹅蛋脸/)
  assert.match(text, /音色参考@syq1_trim_0-5000ms，@syq1_trim_0-5000ms 仅作为女侠的音色/)
  assert.match(text, /船头侧（靠前）：女侠斜坐于乌篷前口边缘/)
  assert.match(text, /女侠配剑：乌木剑鞘.*全程固定于女侠左腰。/)
  assert.match(text, /主光位与光比：江面漫射天光自船篷开口呈45度侧逆光切入篷内，3:1 戏剧光比/)
  assert.match(text, /硬性技术约束：4K film render, zero AI smoothing, no 3D CG plastic look/)
  assert.match(text, /【0\.0s-2\.5s】/)
  assert.match(text, /声音：不需要配乐/)
})

test('一键生成：四个 Agent 各拿需要的部分；参考图写 @名字；没开时不加', () => {
  const spec = { ...preset(), enabled: true }
  const ext = cine.cinematicAgentDirective('extractor', spec, 'zh')
  assert.match(ext, /appearance.*styling.*必须以设定为准/)
  assert.doesNotMatch(ext, /动态时间戳分镜剧本/)
  const sb = cine.cinematicAgentDirective('storyboard_breaker', spec, 'zh')
  assert.match(sb, /【0\.0s-2\.5s】开头/)
  assert.match(sb, /动态时间戳分镜剧本/)
  const withImg = { ...spec, props: spec.props.map((p) => ({ ...p, image_url: '/static/x.png' })) }
  assert.match(cine.cinematicAgentDirective('prompt_generator', withImg, 'zh'), /女侠配剑（@女侠配剑）/)
  assert.equal(cine.cinematicAgentDirective('storyboard_breaker', { ...spec, enabled: false }, 'zh'), '')
  assert.equal(cine.cinematicAgentDirective('unknown', spec, 'zh'), '')
  assert.match(cine.cinematicAgentDirective('prompt_generator', spec, 'en'), /Cinematic parameters/)
})

test('智能体 / 工作流：系统提示词附加整份参数，参考图写 @image', () => {
  const spec = { ...preset(), enabled: true, scene: { ...preset().scene, image_url: '/static/s.png' } }
  const d = cine.cinematicChatDirective(spec, 'zh')
  assert.match(d, /## 影像参数（用户锁定，必须遵守）/)
  assert.match(d, /环境与空间定义（参考@image的场景）：浓雾弥漫/)
  assert.equal(cine.cinematicChatDirective(null, 'zh'), '')
})

test('视频：【影像底座】完整版 / 精简版，限长时最先去掉', () => {
  const spec = { ...preset(), enabled: true }
  const full = cine.cinematicVideoBlock(spec, true, false)
  const compact = cine.cinematicVideoBlock(spec, true, true)
  assert.match(full, /^【影像底座】风格：徐克导演美学/)
  assert.match(full, /色调：60% 寒江青黛色（#1B333E）/)
  assert.match(full, /明暗交界/)
  assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(full))
  assert.doesNotMatch(compact, /明暗交界/)
  assert.match(cine.cinematicVideoBlock(spec, false, true), /^\[Cinematic baseline\] Style: Tsui Hark aesthetic/)

  const directives = buildShotDirectives({
    description: '女侠望向江面。', duration: 6, characters: [], prompt: '女侠望向江面',
    cinematic: { full, compact }, options: {},
  })
  assert.ok(directives.includes(full))
  assert.ok(!buildShotDirectives({ description: 'x', duration: 6, characters: [], prompt: 'x', cinematic: { full, compact }, options: { cinematicLock: false } }).includes('影像底座'))

  const prompt = `${'女侠望向江面，雾气流动。'.repeat(30)}\n\n${directives}`
  const fit = fitPromptBytes(prompt, Buffer.byteLength(directives) + 200)
  assert.equal(fit.removed[0], '影像底座')
  assert.ok(!fit.prompt.includes('【影像底座】'))
})

test('时间戳分镜行（［0.0s - 2.5s］ / 【0.0s-2.5s】）能被拆分镜识别并重新排时间', () => {
  const lines = [
    '【0.0s-5.0s】（侧面中全景横移）：女侠说：「这里意境这么好，要不要一起唱首歌？我们沿着江一路往下，看看今晚的月亮能不能照到对岸的渡口。」',
    '［5.0s - 10.0s］（急推）：矮胖强盗说：「我唱你马，你等着，等我挣开这根绳子，第一个就把你扔下船去喂鱼，看你还笑不笑得出来！」',
    '[10.0s-15.0s]（拉焦）：高瘦强盗说：「大哥你小声点，她手里有剑，咱们俩加起来也打不过她一根手指头，先忍一忍等靠岸再说。」',
  ].join('\n')
  const plan = planShotSplit({ videoPrompt: lines, names: ['女侠', '矮胖强盗', '高瘦强盗'], maxSeconds: 10 })
  assert.ok(plan && plan.parts.length >= 2)
  for (const part of plan!.parts) assert.match(String(part.videoPrompt), /^0-\d+(\.\d)?s: |^0-\d+(\.\d)?秒：/m)
})

test('AI 生成结果：取出 JSON，生成的块整块替换，保留已上传的参考图和音色', () => {
  assert.deepEqual(cine.extractJsonObject('好的\n```json\n{"a":1}\n```'), { a: 1 })
  assert.throws(() => cine.extractJsonObject('没有'), /JSON/)
  const current = cine.normalizeCinematicSpec({
    enabled: true,
    characters: [{ id: 'c9', name: '女侠', age: '18岁', image_url: '/static/g.png', voice_ref: 'v1' }],
    lighting: { key_light: '旧主光' },
  })
  const next = cine.mergeGenerated(current, {
    characters: [{ name: '女侠', age: '20岁左右', face: '鹅蛋脸' }, { name: '船家', age: '50岁' }],
    lighting: { key_light: '新主光' },
  }, ['characters'])
  assert.equal(next.characters[0].age, '20岁左右')
  assert.equal(next.characters[0].image_url, '/static/g.png')
  assert.equal(next.characters[0].voice_ref, 'v1')
  assert.equal(next.characters[0].id, 'c9')
  assert.equal(next.characters[1].name, '船家')
  assert.equal(next.lighting.key_light, '旧主光', '没要求生成的块不动')
  const prompt = cine.buildGenerationPrompt(['visual', 'lighting'], '故事', current)
  assert.match(prompt, /venice-2=Sony VENICE 2/)
  assert.match(prompt, /side-back-45=45° 侧逆光/)
  assert.doesNotMatch(prompt, /"characters": \[\{ "name"/)
})

test('项目：存在 drama metadata（不动其他字段），同步人物 / 场景 / 道具到项目', async () => {
  const { db, schema } = await import('../src/db/index')
  const { eq } = await import('drizzle-orm')
  const ts = new Date().toISOString()
  await db.insert(schema.dramas).values({ title: '寒江', metadata: JSON.stringify({ keep: 1 }), createdAt: ts, updatedAt: ts } as any)
  const [drama] = await db.select().from(schema.dramas)
  await db.insert(schema.characters).values({ dramaId: drama.id, name: '女侠', appearance: '旧', imageUrl: '/static/old.png', createdAt: ts, updatedAt: ts })
  assert.equal((await cine.getDramaCinematic(drama.id)).enabled, false)
  const saved = await cine.saveDramaCinematic(drama.id, { ...preset(), enabled: true })
  assert.equal(saved!.characters.length, 4)
  const [row] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, drama.id))
  assert.equal(JSON.parse(row.metadata!).keep, 1)
  assert.equal(await cine.saveDramaCinematic(99999, {}), null)

  const spec = { ...saved!, characters: saved!.characters.map((c) => ({ ...c, image_url: '/static/new.png' })) }
  const r = await cine.applyCinematicToProject(drama.id, spec)
  assert.deepEqual([r.characters_updated, r.characters_created, r.scenes_created, r.props_created], [1, 3, 1, 3])
  const chars = await db.select().from(schema.characters).where(eq(schema.characters.dramaId, drama.id))
  const girl = chars.find((c) => c.name === '女侠')!
  assert.match(girl.appearance!, /20岁左右清冷飒爽女侠，鹅蛋脸/)
  assert.match(girl.styling!, /高盘凌乱丸子头/)
  assert.equal(girl.imageUrl, '/static/old.png', '已有图不覆盖')
  assert.equal(chars.find((c) => c.name === '船家')!.imageUrl, '/static/new.png')
  const [scene] = await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, drama.id))
  assert.equal(scene.location, '寒江乌篷船')
  assert.match(scene.prompt, /船尾侧（最后方露天甲板）：老船家站立撑篙划船/)
  const again = await cine.applyCinematicToProject(drama.id, spec)
  assert.deepEqual([again.characters_created, again.scenes_updated, again.props_updated], [0, 1, 3])
})
