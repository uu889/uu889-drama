/**
 * 创作会话的画面一贯性：设定匹配、参考图顺序、@图片N 标记、提示词附加的锁定块、接戏代数上限、网页解析
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-studio-'))
fs.cpSync(path.resolve(import.meta.dirname, '../workspace/catalog'), path.join(WS, 'catalog'), { recursive: true })
process.env.WORKSPACE_PATH = WS

const c = await import('../src/services/studio/consistency')
const { parseHtml, isPrivateIp } = await import('../src/services/studio/web')
const { targetSize, motionFilter } = await import('../src/services/studio/render')
const { timelineToMessages } = await import('../src/services/studio/runner')
const cat = await import('../src/services/catalog')

const bible = c.upsertEntry(c.upsertEntry(c.upsertEntry({ style: '电影感写实，冷青色调', style_id: null, entries: [] },
  { name: '林小雨', type: 'character', description: '22 岁，鹅蛋脸，齐肩黑发', styling: '米白风衣', path: 'static/images/lin.png', asset_id: 1 }),
  { name: '咖啡馆', type: 'scene', description: '落地窗在左，吧台在右', path: 'static/images/cafe.png', asset_id: 2 }),
  { name: '陈默', type: 'character', description: '30 岁，寸头，戴眼镜', path: null, asset_id: null })

test('设定按名字匹配：括号注释、@ 号、空白都不影响', () => {
  assert.equal(c.findEntry(bible, '林小雨（女主）')?.name, '林小雨')
  assert.equal(c.findEntry(bible, '@咖啡馆')?.type, 'scene')
  assert.equal(c.findEntry(bible, '小雨'), null)
})

test('同名同类覆盖设定（换设定图），不同类可以同名', () => {
  const b = c.upsertEntry(bible, { name: '林小雨', type: 'character', description: '换了发型', path: 'static/images/lin2.png' })
  assert.equal(b.entries.filter(e => e.name === '林小雨').length, 1)
  assert.equal(c.findEntry(b, '林小雨')?.path, 'static/images/lin2.png')
})

test('参考图：角色在前、场景其次、显式素材最后；没设定图的跳过；去重并限量', () => {
  const refs = c.pickReferences({
    bible,
    names: ['咖啡馆'],
    prompt: '林小雨和陈默在咖啡馆对视',
    extra: [{ path: 'static/x.png', label: '用户图', type: 'asset' }, { path: 'static/images/lin.png', label: '重复', type: 'asset' }],
  })
  assert.deepEqual(refs.map(r => r.label), ['林小雨', '咖啡馆', '用户图'])
  assert.equal(c.pickReferences({ bible, names: ['林小雨', '咖啡馆'], max: 1 }).length, 1)
})

test('@名字 / 名字 → @图片N名字，已标记的不重复，没有参考图的名字去掉 @', () => {
  const refs = c.pickReferences({ bible, names: ['林小雨', '咖啡馆'] })
  assert.equal(c.tagReferences('@林小雨推门走进咖啡馆，@陈默抬头', refs), '@图片1林小雨推门走进@图片2咖啡馆，陈默抬头')
  assert.equal(c.tagReferences('@图片1林小雨坐下', refs), '@图片1林小雨坐下')
})

test('生图提示词：画风基调开头、参考图说明、外观锁定、设定图要求', () => {
  const refs = c.pickReferences({ bible, names: ['林小雨'] })
  const p = c.buildImagePrompt({ prompt: '林小雨坐在窗边', bible, purpose: 'keyframe', refs, entries: c.shotEntries(bible, ['林小雨']) })
  assert.ok(p.startsWith('【画风】电影感写实'))
  assert.match(p, /@图片1林小雨坐在窗边/)
  assert.match(p, /【参考图】图片1=林小雨（角色设定图）/)
  assert.match(p, /【外观锁定】\n林小雨：22 岁，鹅蛋脸，齐肩黑发；米白风衣/)
  const sheet = c.buildImagePrompt({ prompt: '林小雨', bible, purpose: 'character', refs: [], entries: [] })
  assert.match(sheet, /角色设定图：单人全身正面站姿/)
})

test('视频提示词：画风 + 人物外观锁定 + 场景一致 + 画风一致 + 画质 + 物理；接上一镜时写明', () => {
  const entries = c.shotEntries(bible, ['林小雨', '咖啡馆'])
  const refs = c.pickReferences({ bible, names: ['林小雨', '咖啡馆'] })
  const p = c.buildVideoPrompt({ prompt: '林小雨端起咖啡，镜头缓慢推近', bible, refs, entries, duration: 6, continued: true })
  for (const block of ['【画风】', '【参考图】', '【接上一镜】', '【人物外观锁定】', '【场景一致】', '【画风一致】', '【画质】', '【物理真实】', '【台词控制】']) {
    assert.ok(p.includes(block), `缺少 ${block}`)
  }
  assert.match(p, /@图片1林小雨/)
  const keyed = c.buildVideoPrompt({ prompt: '林小雨端起咖啡', bible, refs, entries, duration: 6, firstFrame: true })
  assert.match(keyed, /【首帧】/)
  assert.ok(!keyed.includes('@图片') && !keyed.includes('【参考图】'), '有首帧时不写 @图片N / 参考图说明')
  assert.match(keyed, /【人物外观锁定】[\s\S]*林小雨：22 岁/)
  const silent = c.buildVideoPrompt({ prompt: '空镜', bible, refs: [], entries: [], duration: 4, audio: false })
  assert.ok(!silent.includes('【台词控制】'))
})

test('接戏：首帧取上一镜结尾帧，代数 +1；超过上限改作参考图', () => {
  const a = c.planFirstFrame({ fromVideo: { endFrame: 'static/v_last.jpg', chainDepth: 0 } })
  assert.deepEqual([a.firstFrame, a.chainDepth, a.continued], ['static/v_last.jpg', 1, true])
  const b = c.planFirstFrame({ fromVideo: { endFrame: 'static/v_last.jpg', chainDepth: 2 }, max: 2 })
  assert.equal(b.firstFrame, null)
  assert.equal(b.referenceFrame, 'static/v_last.jpg')
  assert.equal(b.chainDepth, 0)
  assert.match(b.note, /参考图/)
  const k = c.planFirstFrame({ image: 'static/key.png' })
  assert.deepEqual([k.firstFrame, k.chainDepth], ['static/key.png', 0])
})

test('设置规范化：非法画幅 / 时长回退默认，部分更新保留原值', () => {
  const s = c.normalizeSettings({ aspect_ratio: '2:1', clip_seconds: 99, tools: false })
  assert.equal(s.aspect_ratio, '9:16')
  assert.equal(s.clip_seconds, 15)
  assert.equal(s.tools, false)
  const t = c.normalizeSettings({ resolution: '1080p' }, s)
  assert.equal(t.resolution, '1080p')
  assert.equal(t.tools, false)
  assert.equal(c.imageSizeFor('9:16'), '1080x1920')
})

test('剪辑：画幅 + 分辨率换算像素、图片动效滤镜', () => {
  assert.deepEqual(targetSize('9:16', '720p'), { width: 720, height: 1280 })
  assert.deepEqual(targetSize('16:9', '1080p'), { width: 1920, height: 1080 })
  assert.match(motionFilter('zoom_in', 120, 720, 1280), /zoompan=.*d=120:s=720x1280/)
})

test('历史消息：工具卡片折成一行结果，开头不是用户消息时去掉', () => {
  const msgs = timelineToMessages([
    { id: '0', type: 'assistant', text: '欢迎', at: '' },
    { id: '1', type: 'user', text: '做个视频', at: '' },
    { id: '2', type: 'assistant', text: '好的', at: '' },
    { id: '3', type: 'tool', tool: 'generate_video', result: { ok: true, summary: '#5 片段「镜头1」' }, at: '' },
    { id: '4', type: 'user', text: '再快一点', at: '' },
  ])
  assert.equal(msgs.length, 3)
  assert.equal(msgs[0].role, 'user')
  assert.match(msgs[1].content, /好的\n\[生成视频\] #5 片段「镜头1」/)
})

test('网页解析：标题 / 描述 / 正文 / 图片（相对地址补全，过滤图标）', () => {
  const html = '<html><head><title>T</title><meta property="og:image" content="/a.jpg"><meta name="description" content="好物 &amp; 推荐"></head><body><script>x</script><p>卖点一</p><img src="icon.svg"><img data-src="https://cdn.x.com/b.png"></body></html>'
  const r = parseHtml(html, 'https://shop.example.com/p/1')
  assert.equal(r.title, 'T')
  assert.equal(r.description, '好物 & 推荐')
  assert.match(r.text, /卖点一/)
  assert.deepEqual(r.images, ['https://shop.example.com/a.jpg', 'https://cdn.x.com/b.png'])
  assert.ok(isPrivateIp('192.168.1.2') && isPrivateIp('127.0.0.1') && isPrivateIp('::ffff:10.0.0.1'))
  assert.ok(!isPrivateIp('8.8.8.8'))
})

test('模板库：视频智能体 / 一贯性 skill / 工作流 video 字段都能读出来，引用都存在', () => {
  const agents = cat.listAgents()
  const skills = new Set(cat.listSkills().map(s => s.id))
  assert.ok(skills.has('visual-consistency'))
  for (const id of ['video-director', 'quick-video', 'image-to-video', 'video-restyle', 'url-to-video']) {
    const a = agents.find(x => x.id === id)
    assert.ok(a, `缺少智能体 ${id}`)
    for (const s of a!.skills) assert.ok(skills.has(s), `${id} 引用的 skill ${s} 不存在`)
  }
  const ids = new Set(agents.map(a => a.id))
  for (const wf of cat.listWorkflows()) {
    if (wf.video?.agent) assert.ok(ids.has(wf.video.agent), `${wf.id} 的 video.agent 不存在`)
    for (const s of wf.steps) if (s.agent) assert.ok(ids.has(s.agent), `${wf.id} 步骤 ${s.id} 的智能体不存在`)
  }
  const wf = cat.getWorkflow('idea-to-video')!
  assert.equal(wf.video?.agent, 'video-director')
  assert.equal(wf.video?.aspect_ratio, '9:16')
  assert.match(cat.renderTemplate(wf.video!.prompt!, { inputs: {}, steps: { storyboard: 'S' } }), /\n\nS$/)
})
