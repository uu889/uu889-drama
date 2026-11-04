/**
 * 语音合成各服务商的请求构造与响应解析
 *
 * - aiask.me：OpenAI 兼容 `POST /v1/audio/speech`（model = edge-tts / gpt-sovits）；
 *   gpt-sovits 额外带参考音频（data URL）、参考文本与语言（字段名沿用 GPT-SoVITS：ref_audio / prompt_text / prompt_lang / text_lang）
 * - 本地 edge-tts：Base URL 有值时走 openai-edge-tts 服务的 `/v1/audio/speech`；留空调用本机 `edge-tts` 命令行
 * - 本地 GPT-SoVITS：api_v2.py `POST /tts`（ref_audio_path 是 GPT-SoVITS 所在机器上的路径）
 * - 火山引擎：豆包语音合成 V3 单向流式 HTTP `POST /api/v3/tts/unidirectional`（逐行 JSON，data 为 base64 音频，
 *   结束 code 20000000）；声音复刻 `POST /api/v1/mega_tts/audio/upload` + `POST /api/v1/mega_tts/status`
 *   鉴权：填了 App ID 用旧版控制台 X-Api-App-Id + X-Api-Access-Key（复刻接口 Authorization: Bearer;token），没填按新版控制台 X-Api-Key
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { joinProviderUrl } from '../adapters/url.js'
import { isCloneModel, VOLC_CLONE_LANG } from './catalog.js'

export interface VoiceServiceConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  settings?: Record<string, any> | null
}

export interface ResolvedVoice {
  /** 预置音色 ID / 火山音色 ID（复刻音色为 speaker_id）；GPT-SoVITS 为空 */
  voice: string
  /** GPT-SoVITS 参考音频（本机绝对路径） */
  refAudioPath?: string
  refText?: string
  refLang?: string
  /** 火山复刻音色用哪个资源（seed-icl-1.0 / seed-icl-2.0） */
  volcResource?: string
}

export interface SynthesisRequest {
  text: string
  voice: ResolvedVoice
  speed?: number | null
  /** 合成语言（GPT-SoVITS text_lang），默认 auto */
  textLang?: string
  signal?: AbortSignal
}

export interface SynthesisResult {
  buffer: Buffer
  ext: string
}

const TIMEOUT_MS = 180_000

function bearer(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function audioExtFromType(ct: string | null, fallback: string): string {
  const t = (ct || '').toLowerCase()
  if (t.includes('wav')) return '.wav'
  if (t.includes('mpeg') || t.includes('mp3')) return '.mp3'
  if (t.includes('ogg') || t.includes('opus')) return '.ogg'
  if (t.includes('aac')) return '.aac'
  if (t.includes('flac')) return '.flac'
  return fallback
}

/** 从错误响应里取一句人能看懂的话 */
export function describeVoiceHttpError(status: number, bodyText: string): string {
  let msg = ''
  try {
    const j = JSON.parse(bodyText)
    msg = j?.error?.message || j?.message || j?.detail || j?.error || j?.BaseResp?.StatusMessage || ''
    if (typeof msg !== 'string') msg = JSON.stringify(msg)
  } catch {
    msg = bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  msg = msg.slice(0, 300)
  if (status === 401 || status === 403) return `鉴权失败（${status}）：请检查 API Key${msg ? `。原文：${msg}` : ''}`
  if (status === 404) return `接口不存在（404）：请检查 Base URL，或该服务不支持这个模型${msg ? `。原文：${msg}` : ''}`
  if (status === 429) return `请求太频繁或额度不足（429）${msg ? `：${msg}` : ''}`
  return `语音合成失败（${status}）${msg ? `：${msg}` : ''}`
}

/** 解析 JSON 形式返回的音频（url / base64 两种） */
async function audioFromJson(json: any, signal?: AbortSignal): Promise<SynthesisResult> {
  const b64 = json?.audio || json?.data?.audio || json?.b64_json || json?.data?.[0]?.b64_json
  if (typeof b64 === 'string' && b64.length > 32) {
    const raw = b64.replace(/^data:[^,]+,/, '')
    return { buffer: Buffer.from(raw, 'base64'), ext: /^data:audio\/wav/.test(b64) ? '.wav' : '.mp3' }
  }
  const url = json?.url || json?.audio_url || json?.data?.url || json?.data?.[0]?.url
  if (typeof url === 'string' && /^https?:/.test(url)) {
    const r = await fetch(url, { signal })
    if (!r.ok) throw new Error(`下载合成音频失败（${r.status}）`)
    return { buffer: Buffer.from(await r.arrayBuffer()), ext: audioExtFromType(r.headers.get('content-type'), '.mp3') }
  }
  throw new Error(`语音服务没有返回音频：${JSON.stringify(json).slice(0, 200)}`)
}

async function readAudioResponse(resp: Response, fallbackExt: string, signal?: AbortSignal): Promise<SynthesisResult> {
  const ct = resp.headers.get('content-type') || ''
  if (!resp.ok) throw new Error(describeVoiceHttpError(resp.status, await resp.text()))
  if (ct.includes('json')) return audioFromJson(await resp.json(), signal)
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.length < 64) throw new Error('语音服务返回的音频是空的')
  return { buffer, ext: audioExtFromType(ct, fallbackExt) }
}

function fileToDataUrl(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase() || 'wav'
  const mime = ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

// ─── aiask.me ─────────────────────────────────────────────

export function buildAiaskSpeechBody(cfg: VoiceServiceConfig, req: SynthesisRequest): Record<string, any> {
  const body: Record<string, any> = {
    model: cfg.model || 'edge-tts',
    input: req.text,
    response_format: 'mp3',
  }
  if (req.speed != null && req.speed !== 1) body.speed = req.speed
  if (isCloneModel('aiask', cfg.model)) {
    if (!req.voice.refAudioPath) throw new Error('gpt-sovits 需要克隆音色：请先上传参考音频创建音色')
    body.ref_audio = fileToDataUrl(req.voice.refAudioPath)
    body.prompt_text = req.voice.refText || ''
    body.prompt_lang = req.voice.refLang || 'zh'
    body.text_lang = req.textLang || 'auto'
    body.voice = req.voice.voice || 'clone'
  } else {
    body.voice = req.voice.voice
  }
  return body
}

async function synthesizeAiask(cfg: VoiceServiceConfig, req: SynthesisRequest): Promise<SynthesisResult> {
  const resp = await fetch(joinProviderUrl(cfg.baseUrl || 'https://aiask.me', '/v1', '/audio/speech'), {
    method: 'POST',
    headers: { ...bearer(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAiaskSpeechBody(cfg, req)),
    signal: req.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })
  return readAudioResponse(resp, '.mp3', req.signal)
}

// ─── 本地 edge-tts ─────────────────────────────────────────

/** 倍速 → edge-tts 的 --rate（+25% / -10%） */
export function edgeRate(speed?: number | null): string {
  const pct = Math.round(((speed ?? 1) - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

function runEdgeCli(command: string, req: SynthesisRequest): Promise<SynthesisResult> {
  const out = path.join(os.tmpdir(), `uu889-edge-${uuid()}.mp3`)
  const textFile = path.join(os.tmpdir(), `uu889-edge-${uuid()}.txt`)
  fs.writeFileSync(textFile, req.text, 'utf8')
  const args = ['--voice', req.voice.voice, '--file', textFile, `--rate=${edgeRate(req.speed)}`, '--write-media', out]
  return new Promise((resolve, reject) => {
    let stderr = ''
    let child
    try {
      child = spawn(command, args, { windowsHide: true, shell: process.platform === 'win32' })
    } catch (e: any) {
      fs.rmSync(textFile, { force: true })
      reject(new Error(`无法运行 edge-tts：${e.message}`))
      return
    }
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS)
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (e: any) => {
      clearTimeout(timer)
      fs.rmSync(textFile, { force: true })
      reject(new Error(e.code === 'ENOENT'
        ? '找不到 edge-tts 命令：请先 `pip install edge-tts`，或在配置里填 edge-tts 命令的完整路径 / openai-edge-tts 服务地址'
        : `运行 edge-tts 失败：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      fs.rmSync(textFile, { force: true })
      if (code === 0 && fs.existsSync(out)) {
        const buffer = fs.readFileSync(out)
        fs.rmSync(out, { force: true })
        resolve({ buffer, ext: '.mp3' })
      } else {
        fs.rmSync(out, { force: true })
        reject(new Error(`edge-tts 合成失败（退出码 ${code}）：${stderr.trim().slice(-300) || '无输出'}`))
      }
    })
  })
}

async function synthesizeEdge(cfg: VoiceServiceConfig, req: SynthesisRequest): Promise<SynthesisResult> {
  if (!cfg.baseUrl) return runEdgeCli(String(cfg.settings?.edge_tts_command || 'edge-tts'), req)
  const resp = await fetch(joinProviderUrl(cfg.baseUrl, '/v1', '/audio/speech'), {
    method: 'POST',
    headers: { ...bearer(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model || 'tts-1', input: req.text, voice: req.voice.voice, response_format: 'mp3', speed: req.speed ?? 1 }),
    signal: req.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })
  return readAudioResponse(resp, '.mp3', req.signal)
}

// ─── 本地 GPT-SoVITS（api_v2.py）──────────────────────────

export function buildSovitsBody(req: SynthesisRequest): Record<string, any> {
  if (!req.voice.refAudioPath) throw new Error('GPT-SoVITS 需要克隆音色：请先上传参考音频创建音色')
  return {
    text: req.text,
    text_lang: req.textLang || 'auto',
    ref_audio_path: req.voice.refAudioPath,
    prompt_text: req.voice.refText || '',
    prompt_lang: req.voice.refLang || 'zh',
    text_split_method: 'cut5',
    batch_size: 1,
    speed_factor: req.speed ?? 1,
    media_type: 'wav',
    streaming_mode: false,
  }
}

async function synthesizeSovits(cfg: VoiceServiceConfig, req: SynthesisRequest): Promise<SynthesisResult> {
  const resp = await fetch(joinProviderUrl(cfg.baseUrl || 'http://127.0.0.1:9880', '', '/tts'), {
    method: 'POST',
    headers: { ...bearer(cfg.apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSovitsBody(req)),
    signal: req.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })
  return readAudioResponse(resp, '.wav', req.signal)
}

// ─── 火山引擎 ─────────────────────────────────────────────

export function volcHeaders(cfg: VoiceServiceConfig, resourceId: string): Record<string, string> {
  const appId = String(cfg.settings?.volc_app_id || '').trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': uuid(),
  }
  if (appId) {
    headers['X-Api-App-Id'] = appId
    headers['X-Api-Access-Key'] = cfg.apiKey
  } else {
    headers['X-Api-Key'] = cfg.apiKey
  }
  return headers
}

/** 倍速 → 火山 speech_rate（-50~100，100 = 2 倍速，-50 = 0.5 倍速） */
export function volcSpeechRate(speed?: number | null): number {
  return Math.max(-50, Math.min(100, Math.round(((speed ?? 1) - 1) * 100)))
}

export function volcResourceFor(cfg: VoiceServiceConfig, voice: ResolvedVoice): string {
  if (voice.volcResource) return voice.volcResource
  return cfg.model || 'seed-tts-1.0'
}

export function buildVolcTtsBody(req: SynthesisRequest): Record<string, any> {
  return {
    user: { uid: 'uu889-drama' },
    req_params: {
      text: req.text,
      speaker: req.voice.voice,
      audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: volcSpeechRate(req.speed) },
    },
  }
}

/** 拆开连续的 JSON 对象（逐行或首尾相连都行） */
export function splitJsonStream(text: string): any[] {
  const out: any[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))) } catch { /* 跳过坏块 */ }
        start = -1
      }
    }
  }
  return out
}

/** 火山 V3 流式响应 → 音频（code 0 带 data，20000000 结束；其它 code 为错误） */
export function collectVolcAudio(text: string): Buffer {
  const chunks: Buffer[] = []
  for (const obj of splitJsonStream(text)) {
    const code = Number(obj?.code ?? 0)
    if (code !== 0 && code !== 20000000) {
      throw new Error(`火山语音合成失败（${code}）：${obj?.message || '未知错误'}${code === 45000000 || /speaker|voice/i.test(obj?.message || '') ? '。请检查音色 ID 与资源 ID 是否匹配（复刻音色用 seed-icl-*）' : ''}`)
    }
    if (typeof obj?.data === 'string' && obj.data) chunks.push(Buffer.from(obj.data, 'base64'))
  }
  if (!chunks.length) throw new Error('火山语音合成没有返回音频')
  return Buffer.concat(chunks)
}

async function synthesizeVolc(cfg: VoiceServiceConfig, req: SynthesisRequest): Promise<SynthesisResult> {
  const resp = await fetch(joinProviderUrl(cfg.baseUrl || 'https://openspeech.bytedance.com', '', '/api/v3/tts/unidirectional'), {
    method: 'POST',
    headers: volcHeaders(cfg, volcResourceFor(cfg, req.voice)),
    body: JSON.stringify(buildVolcTtsBody(req)),
    signal: req.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(describeVoiceHttpError(resp.status, text))
  return { buffer: collectVolcAudio(text), ext: '.mp3' }
}

function volcCloneHeaders(cfg: VoiceServiceConfig, resourceId: string): Record<string, string> {
  const appId = String(cfg.settings?.volc_app_id || '').trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Resource-Id': resourceId }
  if (appId) headers.Authorization = `Bearer;${cfg.apiKey}`
  else headers['X-Api-Key'] = cfg.apiKey
  return headers
}

/** model_type：1 = 声音复刻 ICL 1.0，4 = ICL 2.0 */
export function volcCloneModelType(resource: string): number {
  return /2\.0/.test(resource) ? 4 : 1
}

export async function uploadVolcClone(cfg: VoiceServiceConfig, input: { speakerId: string; filePath: string; lang: string; resource: string }) {
  const appId = String(cfg.settings?.volc_app_id || '').trim()
  const ext = path.extname(input.filePath).slice(1).toLowerCase()
  const body = {
    appid: appId || undefined,
    speaker_id: input.speakerId,
    audios: [{ audio_bytes: fs.readFileSync(input.filePath).toString('base64'), audio_format: ext }],
    source: 2,
    language: VOLC_CLONE_LANG[input.lang] ?? 0,
    model_type: volcCloneModelType(input.resource),
  }
  const resp = await fetch(joinProviderUrl(cfg.baseUrl || 'https://openspeech.bytedance.com', '', '/api/v1/mega_tts/audio/upload'), {
    method: 'POST',
    headers: volcCloneHeaders(cfg, input.resource),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(describeVoiceHttpError(resp.status, text))
  const json = JSON.parse(text || '{}')
  const code = Number(json?.BaseResp?.StatusCode ?? 0)
  if (code !== 0) throw new Error(`火山声音复刻上传失败（${code}）：${json?.BaseResp?.StatusMessage || '未知错误'}`)
}

/** 训练状态：0 NotFound 1 Training 2 Success 3 Failed 4 Active */
export async function queryVolcClone(cfg: VoiceServiceConfig, speakerId: string, resource: string): Promise<{ status: 'training' | 'ready' | 'failed'; demoUrl?: string; message?: string }> {
  const appId = String(cfg.settings?.volc_app_id || '').trim()
  const resp = await fetch(joinProviderUrl(cfg.baseUrl || 'https://openspeech.bytedance.com', '', '/api/v1/mega_tts/status'), {
    method: 'POST',
    headers: volcCloneHeaders(cfg, resource),
    body: JSON.stringify({ appid: appId || undefined, speaker_id: speakerId }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(describeVoiceHttpError(resp.status, text))
  const json = JSON.parse(text || '{}')
  const code = Number(json?.BaseResp?.StatusCode ?? 0)
  if (code !== 0) throw new Error(`查询复刻状态失败（${code}）：${json?.BaseResp?.StatusMessage || '未知错误'}`)
  const s = Number(json?.status)
  if (s === 2 || s === 4) return { status: 'ready', demoUrl: json?.demo_audio || undefined }
  if (s === 3) return { status: 'failed', message: '火山训练失败：请换一段更清晰的录音重新上传' }
  if (s === 0) return { status: 'failed', message: '火山没有找到这个音色 ID：请确认已在控制台购买，并且 App ID / Key 属于同一个账号' }
  return { status: 'training' }
}

// ─── 入口 ─────────────────────────────────────────────────

export async function synthesizeWithProvider(cfg: VoiceServiceConfig, req: SynthesisRequest): Promise<SynthesisResult> {
  switch (cfg.provider) {
    case 'aiask': return synthesizeAiask(cfg, req)
    case 'edgetts': return synthesizeEdge(cfg, req)
    case 'gptsovits': return synthesizeSovits(cfg, req)
    case 'volcengine': return synthesizeVolc(cfg, req)
    default: throw new Error(`不支持的语音服务商：${cfg.provider}`)
  }
}
