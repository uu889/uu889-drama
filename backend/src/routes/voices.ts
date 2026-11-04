/**
 * 语音模型接口 /api/v1/voices
 * - GET  /meta                    预置音色、克隆提示、限制（设置页用）
 * - POST /tts                     合成（config_id 或未保存的 config；voice 预置音色 / clone_id 克隆音色）
 * - GET  /clones?family=          克隆音色列表
 * - POST /clones                  新建克隆音色（multipart：config_id, name, audio, ref_text, ref_lang, speaker_id, resource_id）
 * - POST /clones/:id/refresh      火山复刻：刷新训练状态
 * - PUT  /clones/:id              改名 / 改参考文本
 * - DELETE /clones/:id
 */
import { Hono } from 'hono'
import fs from 'fs'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, badRequest, notFound, now } from '../utils/response.js'
import { getConfigById, parseConfigSettings, type AIConfig } from '../services/ai.js'
import { getAbsolutePath } from '../utils/storage.js'
import {
  AIASK_VOICE_MODELS, EDGE_TTS_VOICES, SOVITS_LANGS, VOLC_ICL_RESOURCES, VOLC_PRESET_VOICES, VOLC_TTS_RESOURCES, VOICE_BASE_URLS,
} from '../services/voice/catalog.js'
import {
  checkSovitsReference, checkVolcClone, CLONE_AUDIO_MAX_BYTES, SOVITS_REF_MAX_SECONDS, SOVITS_REF_MIN_SECONDS, SOVITS_REF_TEXT_MAX,
  SOVITS_TEXT_MAX, SPEED_RANGE, TTS_TEXT_MAX, VOICE_CLONE_TIPS, VOLC_CLONE_RECOMMENDED, type VoiceCheck,
} from '../services/voice/validate.js'
import {
  cloneFamilyOf, getClone, probeDurationSec, saveReferenceAudio, synthesizeSpeech, toCloneDto, VoiceInputError,
} from '../services/voice/index.js'
import { queryVolcClone, uploadVolcClone } from '../services/voice/providers.js'
import { logTaskError, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

function checkFailed(c: any, check: VoiceCheck) {
  return c.json({ code: 400, message: check.errors.join('；'), errors: check.errors, warnings: check.warnings }, 400)
}

app.get('/meta', (c) => success(c, {
  aiask_models: AIASK_VOICE_MODELS,
  edge_voices: EDGE_TTS_VOICES,
  volc_voices: VOLC_PRESET_VOICES,
  volc_tts_resources: VOLC_TTS_RESOURCES,
  volc_icl_resources: VOLC_ICL_RESOURCES,
  sovits_langs: SOVITS_LANGS,
  base_urls: VOICE_BASE_URLS,
  tips: VOICE_CLONE_TIPS,
  limits: {
    sovits_ref_min_seconds: SOVITS_REF_MIN_SECONDS,
    sovits_ref_max_seconds: SOVITS_REF_MAX_SECONDS,
    sovits_ref_text_max: SOVITS_REF_TEXT_MAX,
    clone_audio_max_bytes: CLONE_AUDIO_MAX_BYTES,
    volc_recommended_seconds: VOLC_CLONE_RECOMMENDED,
    sovits_text_max: SOVITS_TEXT_MAX,
    tts_text_max: TTS_TEXT_MAX,
    speed_range: SPEED_RANGE,
  },
}))

/** 设置页未保存的表单 → AIConfig（试听用） */
function inlineConfig(raw: any): AIConfig | null {
  if (!raw || typeof raw !== 'object' || !raw.provider) return null
  const models = Array.isArray(raw.model) ? raw.model : [raw.model].filter(Boolean)
  const settings = typeof raw.settings === 'string' ? parseConfigSettings(raw.settings) : (raw.settings || {})
  for (const key of ['volc_app_id', 'edge_tts_command', 'default_voice', 'default_speed']) {
    if (raw[key] != null && raw[key] !== '') settings[key] = raw[key]
  }
  return { provider: String(raw.provider), baseUrl: String(raw.base_url || ''), apiKey: String(raw.api_key || ''), model: String(models[0] || ''), settings }
}

app.post('/tts', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const speed = body.speed === '' || body.speed == null ? null : Number(body.speed)
  try {
    const out = await synthesizeSpeech({
      configId: body.config_id ? Number(body.config_id) : null,
      config: inlineConfig(body.config),
      text: String(body.text || ''),
      voice: body.voice ? String(body.voice) : undefined,
      cloneId: body.clone_id ? Number(body.clone_id) : null,
      speed,
      textLang: body.text_lang ? String(body.text_lang) : undefined,
    })
    logTaskSuccess('Voice', 'tts-done', { provider: out.provider, model: out.model, voice: out.voice, duration: out.duration })
    return success(c, out)
  } catch (e: any) {
    if (e instanceof VoiceInputError) return checkFailed(c, e.check)
    logTaskError('Voice', 'tts-failed', { error: e.message })
    return badRequest(c, e.message || '语音合成失败')
  }
})

app.get('/clones', async (c) => {
  const family = c.req.query('family')
  let rows = await db.select().from(schema.voiceClones)
  if (family) rows = rows.filter((r) => r.family === family)
  rows.sort((a, b) => b.id - a.id)
  return success(c, rows.map(toCloneDto))
})

app.post('/clones', async (c) => {
  const body = await c.req.parseBody()
  const configId = Number(body.config_id || 0)
  const cfg = configId ? await getConfigById(configId) : null
  const provider = cfg?.provider || String(body.provider || '')
  const family = cloneFamilyOf(provider)
  if (!family) return badRequest(c, '这个语音服务不支持声音克隆（支持：aiask.me gpt-sovits、本地 GPT-SoVITS、火山引擎声音复刻）')
  if (family === 'volcengine' && !cfg) return badRequest(c, '火山声音复刻需要先保存语音配置（App ID / Access Key）')

  const file = body.audio instanceof File ? body.audio : null
  const name = String(body.name || '').trim()
  const fileName = file?.name || ''
  const size = file?.size || 0
  if (file && size > CLONE_AUDIO_MAX_BYTES) return checkFailed(c, { errors: ['音频不能超过 10MB'], warnings: [] })

  // 先存下来读时长，校验不过再删掉
  const rel = file ? saveReferenceAudio(Buffer.from(await file.arrayBuffer()), fileName) : ''
  const abs = rel ? getAbsolutePath(rel) : ''
  const durationSec = abs ? await probeDurationSec(abs) : null
  const discard = () => { if (abs) fs.rmSync(abs, { force: true }) }

  const ts = now()
  if (family === 'sovits') {
    const refText = String(body.ref_text || '').trim()
    const refLang = String(body.ref_lang || 'zh')
    const check = checkSovitsReference({ name, fileName, size, durationSec, refText, refLang })
    if (check.errors.length) { discard(); return checkFailed(c, check) }
    const res = await db.insert(schema.voiceClones).values({
      family, configId: configId || null, name, refAudioPath: rel, refText, refLang, duration: durationSec,
      status: 'ready', createdAt: ts, updatedAt: ts,
    })
    const row = await getClone(getInsertId(res))
    return c.json({ code: 201, data: { ...toCloneDto(row!), warnings: check.warnings }, message: 'created' }, 201)
  }

  // 火山声音复刻：上传训练
  const speakerId = String(body.speaker_id || '').trim()
  const resource = (VOLC_ICL_RESOURCES as readonly string[]).includes(String(body.resource_id)) ? String(body.resource_id)
    : (VOLC_ICL_RESOURCES as readonly string[]).includes(cfg!.model) ? cfg!.model : 'seed-icl-1.0'
  const check = checkVolcClone({ name, speakerId, fileName, size, durationSec })
  if (check.errors.length) { discard(); return checkFailed(c, check) }
  try {
    await uploadVolcClone(cfg!, { speakerId, filePath: abs, lang: String(body.ref_lang || 'zh'), resource })
  } catch (e: any) {
    discard()
    logTaskError('Voice', 'volc-clone-upload-failed', { speakerId, error: e.message })
    return badRequest(c, e.message)
  }
  const res = await db.insert(schema.voiceClones).values({
    family, configId, name, speakerId, resourceId: resource, refAudioPath: rel, refLang: String(body.ref_lang || 'zh'),
    duration: durationSec, status: 'training', createdAt: ts, updatedAt: ts,
  })
  const row = await getClone(getInsertId(res))
  return c.json({ code: 201, data: { ...toCloneDto(row!), warnings: check.warnings }, message: 'created' }, 201)
})

app.post('/clones/:id/refresh', async (c) => {
  const row = await getClone(Number(c.req.param('id')))
  if (!row) return notFound(c)
  if (row.family !== 'volcengine') return success(c, toCloneDto(row))
  const cfg = row.configId ? await getConfigById(row.configId) : null
  if (!cfg) return badRequest(c, '这个音色对应的火山语音配置已删除或停用')
  try {
    const st = await queryVolcClone(cfg, row.speakerId || '', row.resourceId || 'seed-icl-1.0')
    await db.update(schema.voiceClones).set({
      status: st.status, errorMsg: st.message || null, demoUrl: st.demoUrl || row.demoUrl, updatedAt: now(),
    }).where(eq(schema.voiceClones.id, row.id))
    return success(c, toCloneDto((await getClone(row.id))!))
  } catch (e: any) {
    return badRequest(c, e.message)
  }
})

app.put('/clones/:id', async (c) => {
  const row = await getClone(Number(c.req.param('id')))
  if (!row) return notFound(c)
  const body = await c.req.json().catch(() => ({}))
  const updates: Record<string, any> = { updatedAt: now() }
  if ('name' in body) {
    const name = String(body.name || '').trim()
    if (!name || name.length > 40) return badRequest(c, '音色名称 1~40 个字')
    updates.name = name
  }
  if (row.family === 'sovits' && ('ref_text' in body || 'ref_lang' in body)) {
    const refText = 'ref_text' in body ? String(body.ref_text || '').trim() : row.refText || ''
    const refLang = 'ref_lang' in body ? String(body.ref_lang || '') : row.refLang || 'zh'
    // 只改文字：音频沿用原来的（文件名 / 大小按已通过校验处理）
    const check = checkSovitsReference({ fileName: 'ref.wav', size: 1, durationSec: row.duration ?? null, refText, refLang })
    if (check.errors.length) return checkFailed(c, check)
    updates.refText = refText
    updates.refLang = refLang
  }
  await db.update(schema.voiceClones).set(updates).where(eq(schema.voiceClones.id, row.id))
  return success(c, toCloneDto((await getClone(row.id))!))
})

app.delete('/clones/:id', async (c) => {
  const row = await getClone(Number(c.req.param('id')))
  if (!row) return notFound(c)
  await db.delete(schema.voiceClones).where(eq(schema.voiceClones.id, row.id))
  if (row.refAudioPath) fs.rmSync(getAbsolutePath(row.refAudioPath), { force: true })
  return success(c)
})

export default app
