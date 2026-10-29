import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildShotDirectives,
  checkShotTiming,
  collectRefTokens,
  parseShotDialogue,
  planDialogue,
  recommendShotDuration,
  speechSeconds,
} from '../src/services/shot-direction'

const ZH = `【镜头1】咖啡厅中景，小明低头看手机，手指敲桌面。
【镜头2】门口，小红推门进来。小明抬头说：「你终于来了。」
【镜头3】小红坐下，笑着说：「路上堵车，抱歉。」旁白：那天的雨下得很大。`

test('parses zh / en / ja / ko dialogue and narration in order, with speakers', () => {
  const zh = parseShotDialogue(ZH, ['小明', '小红'])
  assert.deepEqual(zh.map((l) => [l.kind, l.speaker, l.text]), [
    ['dialogue', '小明', '你终于来了。'],
    ['dialogue', '小红', '路上堵车，抱歉。'],
    ['narration', '', '那天的雨下得很大'],
  ])
  const en = parseShotDialogue('[Shot 1] Ming looks up. Ming says: "You finally came." Narration: It rained hard.', ['Ming'])
  assert.deepEqual(en.map((l) => [l.kind, l.speaker, l.text]), [['dialogue', 'Ming', 'You finally came.'], ['narration', '', 'It rained hard']])
  assert.equal(parseShotDialogue('【镜头1】ミンは言う：「やっと来たね」', ['ミン'])[0].speaker, 'ミン')
  assert.equal(parseShotDialogue('【镜头1】민이가 말한다: 「드디어 왔네」', ['민이'])[0].speaker, '민이')
  // 引号但不是台词（没有说话标记 / 冒号）
  assert.deepEqual(parseShotDialogue('【镜头1】他看着窗外，“这雨真大”几个字写在纸上。', []), [])
  assert.deepEqual(parseShotDialogue('', []), [])
})

test('speech timing: 5 seconds of lines in a 10 second shot is flagged as too long', () => {
  assert.ok(speechSeconds('你终于来了。') >= 1.2 && speechSeconds('你终于来了。') <= 1.8)
  assert.equal(speechSeconds('好'), 0.8)
  const twentyChars = '我已经等你很久了你怎么现在才来我们快走吧'
  const desc = `【镜头1】小明说：「${twentyChars}」`
  const plan = planDialogue(parseShotDialogue(desc, ['小明']))
  assert.ok(plan.speechSeconds > 4 && plan.speechSeconds < 5.5)
  const long = checkShotTiming(desc, 10, ['小明'])
  assert.equal(long.status, 'too_long')
  assert.ok(long.recommended! >= 6 && long.recommended! <= 8)
  assert.equal(checkShotTiming(desc, long.recommended!, ['小明']).status, 'ok')
  assert.equal(checkShotTiming(desc, 3, ['小明']).status, 'too_short')
  assert.equal(checkShotTiming('【镜头1】空镜，雨落在窗上。', 6).status, 'silent')
  assert.equal(recommendShotDuration('【镜头1】空镜'), null)
})

test('directives: dialogue lock lists only the scripted lines and forbids extra speech', () => {
  const out = buildShotDirectives({
    description: ZH,
    duration: 10,
    characters: [{ name: '小明', appearance: '25岁短发男生', styling: '灰色连帽卫衣' }, { name: '小红' }],
    sceneName: '咖啡厅',
    prompt: '出场人物：@图片2小明、@图片3小红；场景：@图片1咖啡厅。',
    options: {},
  })
  assert.match(out, /【台词控制】本段共 10 秒，只有以下 3 句话/)
  assert.match(out, /1\. @图片2小明：「你终于来了。」/)
  assert.match(out, /2\. @图片3小红：「路上堵车，抱歉。」/)
  assert.match(out, /旁白（画外音）/)
  assert.match(out, /不得增加、改写、重复或补充任何台词/)
  assert.match(out, /其余约 \d+(\.\d)? 秒没有任何人说话/)
  assert.match(out, /【人物外观锁定】[\s\S]*@图片2小明：25岁短发男生；灰色连帽卫衣/)
  assert.match(out, /【场景一致】.*@图片1咖啡厅/)
  assert.match(out, /【画风一致】/)
  assert.doesNotMatch(out, /【接上一镜】/)

  const silent = buildShotDirectives({ description: '【镜头1】空镜', duration: 5, characters: [], prompt: '雨夜街道', options: { appearanceLock: false } })
  assert.match(silent, /本段没有任何台词和旁白/)
  assert.doesNotMatch(silent, /画风一致/)

  const en = buildShotDirectives({ description: 'Ming says: "Hi."', duration: 4, characters: [{ name: 'Ming' }], prompt: 'Ming waves at the camera.', options: {} })
  assert.match(en, /\[Dialogue control\] This 4s shot contains ONLY the following 1 line/)
  assert.match(en, /\[Character lock\]/)
})

test('directives: blocking and continuity with the previous shot', () => {
  const ref = buildShotDirectives({
    description: ZH,
    duration: 8,
    blocking: '开场：小明坐画面左侧窗边。结尾：两人隔桌对视。',
    characters: [{ name: '小明' }],
    sceneName: '咖啡厅',
    previous: { number: 3, blocking: '开场：……。结尾：小明坐在窗边低头看手机' },
    previousFrame: { mode: 'reference', index: 1 },
    prompt: '@图片3小明 在 @图片2咖啡厅',
    options: { dialogueLock: false, appearanceLock: false },
  })
  assert.match(ref, /【人物站位】开场：小明坐画面左侧窗边/)
  assert.match(ref, /【接上一镜】@图片1 是上一镜的结尾画面/)
  assert.match(ref, /上一镜结尾状态：小明坐在窗边低头看手机。/)
  assert.match(ref, /180 度轴线/)
  const first = buildShotDirectives({
    description: '', duration: 5, characters: [], prompt: '中文', previous: { number: 1 }, previousFrame: { mode: 'first_frame' }, options: { dialogueLock: false, appearanceLock: false },
  })
  assert.match(first, /视频从给定的首帧（上一镜结尾画面）直接开始/)
  const off = buildShotDirectives({ description: ZH, duration: 8, characters: [], prompt: '中文', previous: { number: 1 }, options: { dialogueLock: false, appearanceLock: false, continuity: false, physicsLock: false, qualityLock: false } })
  assert.equal(off, '')
})

test('ref tokens follow the resolved @图片N names in the prompt', () => {
  assert.deepEqual(collectRefTokens('@图片2小明 看着 @图片3小红，@咖啡厅', ['小明', '小红', '咖啡厅', '路人']), {
    小明: '@图片2小明', 小红: '@图片3小红', 咖啡厅: '@咖啡厅',
  })
})

test('quality directive is its own block: always appended (also in compact mode) and never dropped when fitting', async () => {
  const { fitPromptBytes } = await import('../src/services/video-limits')
  const base = { description: '【镜头1】小明喝水（无人说话）', duration: 5, characters: [{ name: '小明', appearance: '短发' }], sceneName: '客厅', prompt: '小明喝水。', options: {} }
  for (const compact of [false, true]) {
    const d = buildShotDirectives({ ...base, compact })
    assert.match(d, /【画质】画面清晰锐利、细节丰富/)
    assert.doesNotMatch(d.split('\n').find((l) => l.startsWith('【画风一致】')) || '', /清晰/)
    const prompt = `小明喝水。\n\n${d}`
    const fit = fitPromptBytes(prompt, 420)
    assert.match(fit.prompt, /【画质】/)
    assert.ok(!fit.removed.includes('画质'))
  }
  assert.doesNotMatch(buildShotDirectives({ ...base, options: { qualityLock: false } }), /【画质】/)
})

test('timing follows the video prompt lines when the description carries the whole monologue', () => {
  // 分镜描述带着整段剧本台词，视频提示词只截了本镜要说的一句
  const desc = '【镜头1】深夜灶火下，老太太揉面，对孩子说：「我儿子在镇口开杂货铺，铺子门檐上挂了个铜铃铛，拳头那么大，红绳系着。前些日子出了邪事——半夜有人来偷铃铛，人刚摸上去，铃铛就响，我儿子从后屋拎着擀面杖冲出来，人跑了，铃铛还在。」孩子停下筷子，老太太接着说：「上回又来了一个，这回铃铛没响，可第二天一早，门檐上的红绳断了，铃铛却还挂在那儿，比原先更亮了，像被谁擦过一遍似的。」'
  const prompt = '@农家院子，深夜平视中近景：@老太太在左侧案板揉面，@孩子在右侧灶前持碗，灶火暖橙、背景浓黑。老太太讲述铜铃屡次响、偷铃人捂耳逃走的怪事；她说：「我儿子在镇口开杂货铺，铺子门檐上挂了个铜铃铛，拳头那么大，红绳系着。」\n切孩子反应近景，孩子嚼馍变慢，老太太画外继续描述第三次偷铃。（无人说话）'
  const names = ['老太太', '孩子']
  const fromDesc = checkShotTiming(desc, 15, names)
  assert.equal(fromDesc.source, 'description')
  assert.equal(fromDesc.status, 'too_short')
  const t = checkShotTiming(desc, 15, names, prompt)
  assert.equal(t.source, 'prompt')
  assert.equal(t.lines.length, 1)
  assert.equal(t.lines[0].speaker, '老太太')
  assert.ok(t.neededSeconds < 12, String(t.neededSeconds))
  assert.notEqual(t.status, 'too_short')
  // 视频提示词没写台词：按描述
  assert.equal(checkShotTiming(desc, 15, names, '@老太太揉面，孩子看着她。').source, 'description')
  // 【台词控制】也只锁提示词里那一句
  const dir = buildShotDirectives({ description: desc, duration: 15, characters: names.map((name) => ({ name })), prompt, options: {} })
  assert.match(dir, /只有以下 1 句话/)
  assert.doesNotMatch(dir, /前些日子出了邪事/)
})

test('an unclosed quote does not swallow the action text and the next line', () => {
  // 第一句漏了闭引号：不能一路吞到下一句的」
  const desc = '【镜头1】老太太揉面，说：「我儿子在镇口开杂货铺，铺子门檐上挂了个铜铃铛。孩子停下筷子，盯着灶火看了很久很久，火苗一跳一跳的，屋外的风把窗纸吹得哗哗响。【镜头2】孩子问：「后来呢？」'
  const lines = parseShotDialogue(desc, ['老太太', '孩子'])
  assert.equal(lines.length, 2)
  assert.equal(lines[0].speaker, '老太太')
  // 漏了闭引号就分不清台词在哪结束，最多到下一个【镜头N】 / 下一句开引号为止
  assert.ok(lines[0].text.startsWith('我儿子在镇口开杂货铺') && !lines[0].text.includes('后来呢') && !lines[0].text.includes('镜头2'))
  assert.equal(lines[1].speaker, '孩子')
  assert.equal(lines[1].text, '后来呢？')
  // 没有句末标点、直接接下一句开引号
  const b = parseShotDialogue('小明说：「你好 小红说：「你也好」', ['小明', '小红'])
  assert.deepEqual(b.map((l) => [l.speaker, l.text]), [['小明', '你好 小红说：'], ['小红', '你也好']])
})
