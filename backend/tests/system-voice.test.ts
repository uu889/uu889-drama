/**
 * 系统音（系统流的「系统」角色）：台词解析、导演指令、Agent 说明、字幕、项目设置读写
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-sysv-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { parseShotDialogue, buildShotDirectives, systemNamesFor, planDialogue } = await import('../src/services/shot-direction')
const sv = await import('../src/services/system-voice')
const sub = await import('../src/services/subtitles')

const ON = sv.normalizeSystemVoice({ enabled: true })
const NAMES = systemNamesFor(ON)

test('settings: off by default, defaults filled in, custom name kept', () => {
  assert.equal(sv.normalizeSystemVoice(undefined).enabled, false)
  assert.equal(sv.normalizeSystemVoice({ enabled: 'true' }).enabled, true)
  const custom = sv.normalizeSystemVoice({ enabled: true, name: '神豪系统', voice: '', panel: false })
  assert.equal(custom.name, '神豪系统')
  assert.equal(custom.voice, sv.SYSTEM_VOICE_DEFAULTS.voice)
  assert.equal(custom.panel, false)
  assert.deepEqual(systemNamesFor({ enabled: false, name: '系统' }), [])
  assert.ok(systemNamesFor(custom).includes('神豪系统'))
})

test('parsing: quoted / bracketed / 叮 / unquoted system lines become system voice, others stay dialogue', () => {
  const desc = '林凡愣在原地。系统：「叮！检测到宿主情绪剧烈波动，新手任务发布。」林凡低声说：「谁在说话？」【叮！任务奖励：一百万现金。】系统播报：倒计时十秒开始'
  const lines = parseShotDialogue(desc, ['林凡'], { systemNames: NAMES, systemLabel: '系统' })
  assert.deepEqual(lines.map((l) => [l.kind, l.speaker]), [['system', '系统'], ['dialogue', '林凡'], ['system', '系统'], ['system', '系统']])
  assert.equal(lines[2].text, '叮！任务奖励：一百万现金')
  assert.equal(lines[3].text, '倒计时十秒开始')
  // 没开系统音：系统的话按普通台词，不额外识别不带引号的写法
  const off = parseShotDialogue(desc, ['林凡'])
  assert.deepEqual(off.map((l) => l.kind), ['dialogue', 'dialogue'])
  // 【系统：「…」】只算一次
  const once = parseShotDialogue('【系统：「签到成功。」】', [], { systemNames: NAMES, systemLabel: '系统' })
  assert.equal(once.length, 1)
  assert.equal(once[0].kind, 'system')
  // 自定义名字
  const named = parseShotDialogue('小爱说：「主人，任务完成啦。」', [], { systemNames: systemNamesFor({ enabled: true, name: '小爱' }), systemLabel: '小爱' })
  assert.equal(named[0].kind, 'system')
  // 系统台词同样计入时长
  assert.ok(planDialogue(lines).neededSeconds > 5)
})

test('directives: system lines are an off-screen voice with chime, nobody lip-syncs, no appearance lock for the system', () => {
  const base = {
    description: '林凡抬头。系统：「叮！恭喜宿主获得神级签到卡。」林凡说：「真的假的？」',
    duration: 8,
    characters: [{ name: '林凡', appearance: '黑色短发' }, { name: '系统', appearance: '' }],
    prompt: '林凡站在街头',
    options: {},
  }
  const out = buildShotDirectives({ ...base, systemVoice: ON })
  assert.match(out, /1\. 系统（画外电子音）：「叮！恭喜宿主获得神级签到卡。」/)
  assert.match(out, /【系统音】/)
  assert.match(out, /「叮」提示音/)
  assert.match(out, /画面中任何人都不动嘴/)
  assert.match(out, /全息系统面板/)
  assert.doesNotMatch(out, /【人物外观锁定】[^【]*系统/)
  // 关闭面板
  assert.doesNotMatch(buildShotDirectives({ ...base, systemVoice: { ...ON, panel: false } }), /全息/)
  // 没开系统音：没有【系统音】，系统按普通角色
  const off = buildShotDirectives({ ...base, systemVoice: null })
  assert.doesNotMatch(off, /【系统音】|画外电子音/)
  // 台词锁定关掉也照样加系统音说明
  assert.match(buildShotDirectives({ ...base, systemVoice: ON, options: { dialogueLock: false } }), /【系统音】/)
  // 本镜没有系统台词：不加
  assert.doesNotMatch(buildShotDirectives({ ...base, description: '林凡说：「走吧。」', systemVoice: ON }), /【系统音】/)
  // 英文提示词用英文
  const en = buildShotDirectives({ ...base, prompt: 'Lin stands on the street', description: 'System: "Ding! Reward unlocked." Lin says: "What?"', systemVoice: ON })
  assert.match(en, /\[System voice\]/)
})

test('agent directives: each agent gets its own instructions only when enabled', () => {
  assert.equal(sv.systemVoiceAgentDirective('storyboard_breaker', sv.normalizeSystemVoice({})), '')
  for (const type of ['script_rewriter', 'extractor', 'storyboard_breaker', 'prompt_generator']) {
    const text = sv.systemVoiceAgentDirective(type, ON, 'zh')
    assert.match(text, /系统音（本项目已开启）/, type)
  }
  assert.match(sv.systemVoiceAgentDirective('script_rewriter', ON), /系统：「台词」/)
  assert.match(sv.systemVoiceAgentDirective('extractor', ON), /不要把系统提取为角色/)
  assert.match(sv.systemVoiceAgentDirective('prompt_generator', ON), /画外先响起清脆的「叮」提示音/)
  assert.match(sv.systemVoiceAgentDirective('prompt_generator', ON, 'en'), /System voice/)
  assert.equal(sv.systemVoiceAgentDirective('other', ON), '')
})

test('subtitles: system lines are bracketed and coloured', () => {
  const lines = sub.storyboardDialogue('系统：「叮！签到成功。」林凡说：「好。」', ['林凡'], ON)
  const cues = sub.buildSubtitleCues(lines, 6, { speaker: true })
  assert.equal(cues[0].lines.join(''), '【叮！签到成功。】')
  assert.equal(cues[0].system, true)
  assert.equal(cues[1].lines.join(''), '林凡：好。')
  assert.equal(cues[1].system, undefined)
  const filter = sub.buildDrawtextFilter(cues, { style: 'classic', size: 'medium', position: 'bottom', speaker: true }, { width: 1280, height: 720, fontfile: '/f.ttf', textFile: (c, l) => `/t/${c}_${l}.txt` })
  const [first, second] = filter.split(',drawtext=')
  assert.match(first, new RegExp(`fontcolor=${sub.SYSTEM_SUBTITLE_COLOR}`))
  assert.match(second, /fontcolor=white/)
})

test('project setting: saved in drama metadata without touching other metadata', async () => {
  const { db, schema } = await import('../src/db/index')
  const ts = new Date().toISOString()
  await db.insert(schema.dramas).values({ title: '系统流', metadata: JSON.stringify({ keep: 1 }), createdAt: ts, updatedAt: ts } as any)
  const [drama] = await db.select().from(schema.dramas)
  assert.equal((await sv.getDramaSystemVoice(drama.id)).enabled, false)
  const saved = await sv.saveDramaSystemVoice(drama.id, { enabled: true, name: '签到系统' })
  assert.equal(saved!.name, '签到系统')
  const again = await sv.getDramaSystemVoice(drama.id)
  assert.equal(again.enabled, true)
  assert.equal(again.name, '签到系统')
  const [row] = await db.select().from(schema.dramas)
  assert.equal(JSON.parse(row.metadata!).keep, 1)
  assert.equal(await sv.saveDramaSystemVoice(99999, { enabled: true }), null)
  assert.equal(sv.isSystemCharacterName('签到系统', again), true)
  assert.equal(sv.isSystemCharacterName('林凡', again), false)
})
