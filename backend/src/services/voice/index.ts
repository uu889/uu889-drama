/**
 * 语音模型入口：解析语音配置 → 解析音色（预置 / 克隆）→ 校验 → 调服务商 → 存到 static/voice/
 * 克隆音色库（voice_clones 表）：family = sovits（aiask.me gpt-sovits 与本地 GPT-SoVITS 共用参考音频）/ volcengine
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { getActiveConfig, getConfigById, type AIConfig } from '../ai.js'
import { STORAGE_ROOT } from '../../utils/paths.js'
import { getAbsolutePath } from '../../utils/storage.js'
import { ffmpeg } from '../../utils/ffmpeg.js'
import { defaultVoiceFor, isCloneModel, VOLC_ICL_RESOURCES } from './catalog.js'
import { checkSynthesisText, describeCheck, type VoiceCheck } from './validate.js'
import { synthesizeWithProvider, type ResolvedVoice } from './providers.js'

export type CloneFamily = 'sovits' | 'volcengine'

export function cloneFamilyOf(provider: string): CloneFamily | null {
  if (provider === 'aiask' || provider === 'gptsovits') return 'sovits'
  if (provider === 'volcengine') return 'volcengine'
  return null
}

export class VoiceInputError extends Error {
  constructor(public check: VoiceCheck) {
    super(describeCheck(check))
  }
}

/** 读音频时长（秒）；ffprobe 不可用时 null */
export function probeDurationSec(absPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      ffmpeg.ffprobe(absPath, (err: any, data: any) => {
        const d = Number(data?.format?.duration)
        resolve(!err && Number.isFinite(d) && d > 0 ? d : null)
      })
    } catch {
      resolve(null)
    }
  })
}

export async function resolveVoiceConfig(configId?: number | null): Promise<AIConfig> {
  const cfg = (configId ? await getConfigById(configId) : null) || (await getActiveConfig('voice'))
  if (!cfg) throw new Error('未配置语音模型，请先到「设置 → AI 服务」添加并启用语音模型')
  return cfg
}

type CloneRow = typeof schema.voiceClones.$inferSelect

export async function getClone(id: number): Promise<CloneRow | null> {
  const [row] = await db.select().from(schema.voiceClones).where(eq(schema.voiceClones.id, id))
  return row || null
}

/** 克隆音色 → 合成用的音色参数 */
export function voiceFromClone(cfg: Pick<AIConfig, 'provider' | 'model'>, clone: CloneRow): ResolvedVoice {
  const family = cloneFamilyOf(cfg.provider)
  if (family !== clone.family) {
    throw new Error(`音色「${clone.name}」属于${clone.family === 'volcengine' ? '火山声音复刻' : 'GPT-SoVITS'}，当前语音配置用不了`)
  }
  if (clone.status !== 'ready') {
    throw new Error(clone.status === 'training' ? `音色「${clone.name}」还在训练，请稍后再试` : `音色「${clone.name}」不可用：${clone.errorMsg || '训练失败'}`)
  }
  if (clone.family === 'volcengine') {
    const resource = (VOLC_ICL_RESOURCES as readonly string[]).includes(cfg.model) ? cfg.model : clone.resourceId || 'seed-icl-1.0'
    return { voice: clone.speakerId || '', volcResource: resource }
  }
  const abs = clone.refAudioPath ? getAbsolutePath(clone.refAudioPath) : ''
  if (!abs || !fs.existsSync(abs)) throw new Error(`音色「${clone.name}」的参考音频文件不见了，请重新上传`)
  return { voice: `clone-${clone.id}`, refAudioPath: abs, refText: clone.refText || '', refLang: clone.refLang || 'zh' }
}

export interface SpeechInput {
  configId?: number | null
  /** 设置页还没保存的配置（试听用），优先于 configId */
  config?: AIConfig | null
  text: string
  /** 预置音色 ID（edge-tts / 火山） */
  voice?: string
  /** 克隆音色（voice_clones.id） */
  cloneId?: number | null
  speed?: number | null
  textLang?: string
}

export interface SpeechOutput {
  url: string
  provider: string
  model: string
  voice: string
  duration: number | null
}

export async function synthesizeSpeech(input: SpeechInput): Promise<SpeechOutput> {
  const cfg = input.config || await resolveVoiceConfig(input.configId)
  const clone = isCloneModel(cfg.provider, cfg.model) || !!input.cloneId
  let voice: ResolvedVoice
  if (input.cloneId) {
    const row = await getClone(input.cloneId)
    if (!row) throw new VoiceInputError({ errors: ['克隆音色不存在，可能已被删除'], warnings: [] })
    voice = voiceFromClone(cfg, row)
  } else {
    voice = { voice: (input.voice || '').trim() || String(cfg.settings?.default_voice || '') || defaultVoiceFor(cfg.provider, cfg.model) }
  }
  const check = checkSynthesisText({
    text: input.text,
    clone: clone && cfg.provider !== 'volcengine',
    speed: input.speed,
    voice: voice.voice || voice.refAudioPath,
    needVoice: true,
  })
  if (check.errors.length) throw new VoiceInputError(check)

  const speed = input.speed ?? (Number(cfg.settings?.default_speed) || null)
  const result = await synthesizeWithProvider(cfg, { text: input.text.trim(), voice, speed, textLang: input.textLang })
  const dir = path.join(STORAGE_ROOT, 'voice')
  fs.mkdirSync(dir, { recursive: true })
  const file = `${uuid()}${result.ext}`
  fs.writeFileSync(path.join(dir, file), result.buffer)
  const duration = await probeDurationSec(path.join(dir, file))
  return { url: `static/voice/${file}`, provider: cfg.provider, model: cfg.model, voice: voice.voice, duration }
}

/** 保存克隆用的参考音频到 static/voice-refs/ */
export function saveReferenceAudio(buffer: Buffer, originalName: string): string {
  const dir = path.join(STORAGE_ROOT, 'voice-refs')
  fs.mkdirSync(dir, { recursive: true })
  const ext = (path.extname(originalName) || '.wav').toLowerCase().slice(0, 6)
  const file = `${uuid()}${ext}`
  fs.writeFileSync(path.join(dir, file), buffer)
  return `static/voice-refs/${file}`
}

export function toCloneDto(r: CloneRow) {
  return {
    id: r.id,
    family: r.family,
    config_id: r.configId,
    name: r.name,
    speaker_id: r.speakerId,
    resource_id: r.resourceId,
    ref_audio_url: r.refAudioPath,
    ref_text: r.refText,
    ref_lang: r.refLang,
    duration: r.duration,
    status: r.status,
    error_msg: r.errorMsg,
    demo_url: r.demoUrl,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }
}

