/**
 * 语音模型：校验规则、各服务商请求构造、火山流式解析，以及 /voices 接口端到端（本地假服务）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-voice-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const v = await import('../src/services/voice/validate')
const p = await import('../src/services/voice/providers')
const cat = await import('../src/services/voice/catalog')
const { isOfficialProvider } = await import('../src/services/ai')
const { db, schema } = await import('../src/db/index')
const voices = (await import('../src/routes/voices')).default

test('voice providers are official for the voice service type', () => {
  for (const prov of ['aiask', 'edgetts', 'gptsovits', 'volcengine']) assert.ok(isOfficialProvider('voice', prov), prov)
  assert.ok(!isOfficialProvider('voice', 'openai'))
  assert.ok(cat.isCloneModel('aiask', 'gpt-sovits'))
  assert.ok(!cat.isCloneModel('aiask', 'edge-tts'))
  assert.ok(cat.isCloneModel('volcengine', 'seed-icl-2.0'))
  assert.ok(!cat.isCloneModel('volcengine', 'seed-tts-2.0'))
  assert.equal(cat.defaultVoiceFor('aiask', 'edge-tts'), cat.DEFAULT_EDGE_VOICE)
  assert.equal(cat.defaultVoiceFor('volcengine', 'seed-tts-1.0'), cat.DEFAULT_VOLC_VOICE)
})

test('GPT-SoVITS reference: 3~10 seconds, reference text required, language checked', () => {
  const ok = v.checkSovitsReference({ name: '林凡', fileName: 'a.wav', size: 1000, durationSec: 5, refText: '今天天气真不错，我们出去走走吧', refLang: 'zh' })
  assert.deepEqual(ok.errors, [])
  const short = v.checkSovitsReference({ name: '林凡', fileName: 'a.wav', size: 1000, durationSec: 2.1, refText: '你好你好', refLang: 'zh' })
  assert.match(short.errors.join(), /太短/)
  const long = v.checkSovitsReference({ name: '林凡', fileName: 'a.mp3', size: 1000, durationSec: 12, refText: '你好你好', refLang: 'zh' })
  assert.match(long.errors.join(), /太长/)
  const noText = v.checkSovitsReference({ name: '', fileName: 'a.aac', size: 0, durationSec: null, refText: ' ', refLang: 'xx' })
  assert.equal(noText.errors.length, 4) // 名称、音频、参考文本、语言
  const mismatch = v.checkSovitsReference({ fileName: 'a.wav', size: 10, durationSec: 9, refText: '好', refLang: 'zh' })
  assert.ok(mismatch.warnings.length >= 1)
  const unknownDuration = v.checkSovitsReference({ fileName: 'a.wav', size: 10, durationSec: null, refText: '今天天气真不错', refLang: 'zh' })
  assert.deepEqual(unknownDuration.errors, [])
  assert.match(unknownDuration.warnings.join(), /读不出/)
})

test('Volcengine clone + synthesis text checks', () => {
  assert.deepEqual(v.checkVolcClone({ name: 'a', speakerId: 'S_abc123', fileName: 'r.mp3', size: 100, durationSec: 15 }).errors, [])
  assert.match(v.checkVolcClone({ speakerId: 'abc', fileName: 'r.mp3', size: 100, durationSec: 15 }).warnings.join(), /S_/)
  assert.match(v.checkVolcClone({ speakerId: '', fileName: 'r.flac', size: 100, durationSec: 1 }).errors.join(), /音色 ID.*格式.*太短/)
  assert.match(v.checkSynthesisText({ text: '', clone: false }).errors.join(), /请输入/)
  assert.match(v.checkSynthesisText({ text: '字'.repeat(1001), clone: true }).errors.join(), /1000/)
  assert.deepEqual(v.checkSynthesisText({ text: '字'.repeat(1001), clone: false }).errors, [])
  assert.match(v.checkSynthesisText({ text: '……', clone: false }).errors.join(), /没有可以朗读/)
  assert.match(v.checkSynthesisText({ text: '你好', clone: false, speed: 3 }).errors.join(), /语速/)
  assert.match(v.checkSynthesisText({ text: '你好', clone: true, voice: '', needVoice: true }).errors.join(), /克隆音色/)
})

test('request builders: aiask edge-tts / gpt-sovits, GPT-SoVITS api_v2, Volcengine', () => {
  const ref = path.join(DATA, 'ref.wav')
  fs.writeFileSync(ref, Buffer.from('RIFFfake'))
  const edge = p.buildAiaskSpeechBody({ provider: 'aiask', baseUrl: '', apiKey: 'k', model: 'edge-tts' }, { text: '你好', voice: { voice: 'zh-CN-YunxiNeural' }, speed: 1.2 })
  assert.deepEqual(edge, { model: 'edge-tts', input: '你好', response_format: 'mp3', speed: 1.2, voice: 'zh-CN-YunxiNeural' })
  const sovits = p.buildAiaskSpeechBody({ provider: 'aiask', baseUrl: '', apiKey: 'k', model: 'gpt-sovits' }, { text: '你好', voice: { voice: 'clone-1', refAudioPath: ref, refText: '参考', refLang: 'zh' } })
  assert.match(sovits.ref_audio, /^data:audio\/wav;base64,/)
  assert.equal(sovits.prompt_text, '参考')
  assert.equal(sovits.text_lang, 'auto')
  assert.throws(() => p.buildAiaskSpeechBody({ provider: 'aiask', baseUrl: '', apiKey: 'k', model: 'gpt-sovits' }, { text: '你好', voice: { voice: '' } }), /参考音频/)
  const local = p.buildSovitsBody({ text: '你好', voice: { voice: '', refAudioPath: ref, refText: '参考', refLang: 'ja' }, speed: 0.9 })
  assert.equal(local.ref_audio_path, ref)
  assert.equal(local.prompt_lang, 'ja')
  assert.equal(local.speed_factor, 0.9)
  assert.equal(p.edgeRate(1.25), '+25%')
  assert.equal(p.edgeRate(0.8), '-20%')
  assert.equal(p.volcSpeechRate(2), 100)
  assert.equal(p.volcSpeechRate(0.5), -50)
  assert.equal(p.volcSpeechRate(3), 100)
  const legacy = p.volcHeaders({ provider: 'volcengine', baseUrl: '', apiKey: 'tok', model: 'seed-tts-1.0', settings: { volc_app_id: '123' } }, 'seed-tts-1.0')
  assert.equal(legacy['X-Api-App-Id'], '123')
  assert.equal(legacy['X-Api-Access-Key'], 'tok')
  const modern = p.volcHeaders({ provider: 'volcengine', baseUrl: '', apiKey: 'key', model: 'seed-tts-2.0' }, 'seed-icl-2.0')
  assert.equal(modern['X-Api-Key'], 'key')
  assert.equal(modern['X-Api-Resource-Id'], 'seed-icl-2.0')
  assert.equal(p.volcCloneModelType('seed-icl-2.0'), 4)
  assert.equal(p.volcCloneModelType('seed-icl-1.0'), 1)
})

test('Volcengine stream parsing: concatenated chunks, end code, errors', () => {
  const a = Buffer.from('abc').toString('base64')
  const b = Buffer.from('def').toString('base64')
  const stream = `{"code":0,"message":"","data":"${a}"}\n{"code":0,"data":"${b}"}{"code":20000000,"message":"OK","data":null}`
  assert.equal(p.collectVolcAudio(stream).toString(), 'abcdef')
  assert.throws(() => p.collectVolcAudio('{"code":45000000,"message":"speaker not found"}'), /45000000.*seed-icl/)
  assert.throws(() => p.collectVolcAudio('{"code":20000000,"message":"OK"}'), /没有返回音频/)
  assert.match(p.describeVoiceHttpError(401, '{"error":{"message":"bad key"}}'), /鉴权失败.*bad key/)
})

/** 用内置 ffmpeg 生成指定秒数的 wav；没有 ffmpeg 时返回 null（跳过端到端里依赖时长的部分） */
function makeWav(seconds: number): Buffer | null {
  let ffmpegBin: string | null = process.env.FFMPEG_BIN || null
  try { ffmpegBin ||= createRequire(import.meta.url)('ffmpeg-static') } catch { /* 没装 */ }
  if (!ffmpegBin) return null
  const out = path.join(DATA, `tone-${seconds}.wav`)
  const r = spawnSync(ffmpegBin, ['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, out], { stdio: 'ignore' })
  return r.status === 0 ? fs.readFileSync(out) : null
}

test('end to end: GPT-SoVITS clone validation + synthesis against a fake api_v2 server', async () => {
  let lastBody: any = null
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => { raw += d })
    req.on('end', () => {
      lastBody = raw ? JSON.parse(raw) : null
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(Buffer.alloc(2048, 1))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  const ts = new Date().toISOString()
  db.insert(schema.aiServiceConfigs).values({
    serviceType: 'voice', provider: 'gptsovits', name: 'local sovits', baseUrl: `http://127.0.0.1:${port}`, apiKey: '',
    model: JSON.stringify(['gpt-sovits']), priority: 1, isActive: true, createdAt: ts, updatedAt: ts,
  }).run()
  const [cfg] = db.select().from(schema.aiServiceConfigs).all().filter((r) => r.serviceType === 'voice')

  try {
    const wav5 = makeWav(5)
    const wav12 = makeWav(12)
    if (wav12) {
      const form = new FormData()
      form.set('config_id', String(cfg.id))
      form.set('name', '太长')
      form.set('ref_text', '今天天气真不错')
      form.set('ref_lang', 'zh')
      form.set('audio', new File([wav12], 'long.wav', { type: 'audio/wav' }))
      const r = await voices.request('/clones', { method: 'POST', body: form })
      assert.equal(r.status, 400)
      const j: any = await r.json()
      assert.match(j.message, /太长/)
      assert.equal(fs.readdirSync(path.join(DATA, 'static', 'voice-refs')).length, 0, '校验不过的参考音频要删掉')
    }

    const form = new FormData()
    form.set('config_id', String(cfg.id))
    form.set('name', '林凡')
    form.set('ref_text', '今天天气真不错，我们出去走走吧')
    form.set('ref_lang', 'zh')
    form.set('audio', new File([wav5 || Buffer.from('RIFF....WAVE')], 'ref.wav', { type: 'audio/wav' }))
    const created = await voices.request('/clones', { method: 'POST', body: form })
    assert.equal(created.status, 201)
    const clone: any = (await created.json()).data
    assert.equal(clone.family, 'sovits')
    assert.equal(clone.status, 'ready')

    const noVoice = await voices.request('/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config_id: cfg.id, text: '你好' }) })
    assert.equal(noVoice.status, 400)
    assert.match(((await noVoice.json()) as any).message, /克隆音色/)

    const tts = await voices.request('/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config_id: cfg.id, text: '你好，世界', clone_id: clone.id }) })
    assert.equal(tts.status, 200)
    const out: any = (await tts.json()).data
    assert.match(out.url, /^static\/voice\/.+\.wav$/)
    assert.equal(lastBody.prompt_text, '今天天气真不错，我们出去走走吧')
    assert.ok(fs.existsSync(lastBody.ref_audio_path))

    const del = await voices.request(`/clones/${clone.id}`, { method: 'DELETE' })
    assert.equal(del.status, 200)
    assert.ok(!fs.existsSync(lastBody.ref_audio_path))
  } finally {
    server.close()
  }
})

test('aiask text model list upgrade only touches untouched legacy lists', async () => {
  const { upgradeAiaskTextModels, AIASK_TEXT_MODELS, LEGACY_AIASK_TEXT_MODEL_LISTS } = await import('../src/db/sqlite-schema')
  const Database = (await import('better-sqlite3')).default
  const mem = new Database(':memory:')
  mem.exec(`CREATE TABLE ai_service_configs (id INTEGER PRIMARY KEY, service_type TEXT, provider TEXT, model TEXT, updated_at TEXT)`)
  const ins = mem.prepare('INSERT INTO ai_service_configs (service_type, provider, model, updated_at) VALUES (?, ?, ?, ?)')
  ins.run('text', 'aiask', JSON.stringify(LEGACY_AIASK_TEXT_MODEL_LISTS[0]), '')
  const picked = ['claude-opus-5-5', ...LEGACY_AIASK_TEXT_MODEL_LISTS[0].filter((m) => m !== 'claude-opus-5-5')]
  ins.run('text', 'aiask', JSON.stringify(picked), '')
  ins.run('image', 'aiask', JSON.stringify(LEGACY_AIASK_TEXT_MODEL_LISTS[0]), '')
  upgradeAiaskTextModels(mem)
  const rows = mem.prepare('SELECT model FROM ai_service_configs ORDER BY id').all().map((r: any) => JSON.parse(r.model))
  assert.deepEqual(rows[0], AIASK_TEXT_MODELS)
  assert.equal(rows[0][0], 'gpt-6-astra')
  assert.deepEqual(rows[1], picked)
  assert.deepEqual(rows[2], LEGACY_AIASK_TEXT_MODEL_LISTS[0])
})
