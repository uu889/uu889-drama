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
  const off = buildShotDirectives({ description: ZH, duration: 8, characters: [], prompt: '中文', previous: { number: 1 }, options: { dialogueLock: false, appearanceLock: false, continuity: false, physicsLock: false } })
  assert.equal(off, '')
})

test('ref tokens follow the resolved @图片N names in the prompt', () => {
  assert.deepEqual(collectRefTokens('@图片2小明 看着 @图片3小红，@咖啡厅', ['小明', '小红', '咖啡厅', '路人']), {
    小明: '@图片2小明', 小红: '@图片3小红', 咖啡厅: '@咖啡厅',
  })
})
