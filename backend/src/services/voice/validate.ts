/**
 * 语音合成 / 声音克隆的输入校验与提示（纯函数，测试覆盖）
 *
 * GPT-SoVITS（aiask.me 的 gpt-sovits 与本地 GPT-SoVITS 用同一套规则）：
 *   参考音频 3~10 秒（GPT-SoVITS 超出这个范围直接拒绝）、≤10MB、wav / mp3 / m4a / flac / ogg；
 *   参考文本必填，必须与参考音频里说的话一字不差（不一致时克隆出来的声音会跑调、吞字）；
 *   参考语言与合成语言 zh / en / ja / ko / yue / auto。
 * 火山声音复刻：音频 ≤10MB、wav / mp3 / ogg / m4a / aac / pcm，建议 10~30 秒，少于 3 秒拒绝；音色 ID 在控制台购买（S_ 开头）。
 * 错误（errors）拦住提交，提醒（warnings）照常提交但告诉用户。
 */
import { SOVITS_LANGS } from './catalog.js'

export interface VoiceCheck {
  errors: string[]
  warnings: string[]
}

export const SOVITS_REF_MIN_SECONDS = 3
export const SOVITS_REF_MAX_SECONDS = 10
export const SOVITS_REF_TEXT_MAX = 200
export const CLONE_AUDIO_MAX_BYTES = 10 * 1024 * 1024
export const SOVITS_AUDIO_EXTS = ['wav', 'mp3', 'm4a', 'flac', 'ogg']
export const VOLC_AUDIO_EXTS = ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'pcm']
export const VOLC_CLONE_MIN_SECONDS = 3
export const VOLC_CLONE_RECOMMENDED: [number, number] = [10, 30]
export const VOICE_NAME_MAX = 40
/** 单次合成的文字上限（字符）：GPT-SoVITS 长文本又慢又容易崩，按 1000 字；其它 5000 字 */
export const SOVITS_TEXT_MAX = 1000
export const TTS_TEXT_MAX = 5000
export const SPEED_RANGE: [number, number] = [0.5, 2]

/** 设置页 / 克隆对话框显示的提示（与校验规则同源） */
export const VOICE_CLONE_TIPS: Record<'sovits' | 'volcengine', string[]> = {
  sovits: [
    `参考音频 ${SOVITS_REF_MIN_SECONDS}~${SOVITS_REF_MAX_SECONDS} 秒，只有一个人说话，吐字清晰，没有背景音乐、混响和杂音`,
    '参考文本必须和参考音频里说的话一字不差（标点可以不同），否则克隆出的声音会跑调、吞字',
    '参考语言选音频里说的语言；中英混说选 auto',
    `支持 ${SOVITS_AUDIO_EXTS.join(' / ')}，不超过 10MB`,
    '只克隆你本人或已获授权的声音，不得用于冒充他人',
  ],
  volcengine: [
    '先在火山引擎控制台「声音复刻」购买音色，得到 S_ 开头的音色 ID',
    `录音建议 ${VOLC_CLONE_RECOMMENDED[0]}~${VOLC_CLONE_RECOMMENDED[1]} 秒，安静环境、一个人说话、情绪平稳`,
    `支持 ${VOLC_AUDIO_EXTS.join(' / ')}（pcm 须为 24k 单声道），不超过 10MB`,
    '上传后需要训练，状态变成「可用」后才能合成；同一个音色 ID 可重新上传覆盖',
    '只克隆你本人或已获授权的声音，不得用于冒充他人',
  ],
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

function fmtSec(n: number) {
  return `${Math.round(n * 10) / 10} 秒`
}

export function checkVoiceName(name: string, check: VoiceCheck) {
  const n = (name || '').trim()
  if (!n) check.errors.push('请填写音色名称')
  else if (n.length > VOICE_NAME_MAX) check.errors.push(`音色名称不超过 ${VOICE_NAME_MAX} 个字`)
}

/**
 * GPT-SoVITS 参考音频 + 参考文本校验（aiask.me gpt-sovits / 本地 GPT-SoVITS）
 * durationSec 为 null 表示读不出时长（ffprobe 不可用）：提醒但不拦
 */
export function checkSovitsReference(input: {
  name?: string
  fileName: string
  size: number
  durationSec: number | null
  refText: string
  refLang: string
}): VoiceCheck {
  const check: VoiceCheck = { errors: [], warnings: [] }
  if (input.name !== undefined) checkVoiceName(input.name, check)
  const ext = extOf(input.fileName)
  if (!input.fileName || !input.size) check.errors.push('请上传参考音频')
  else {
    if (!SOVITS_AUDIO_EXTS.includes(ext)) check.errors.push(`参考音频格式不支持（.${ext || '?'}），请用 ${SOVITS_AUDIO_EXTS.join(' / ')}`)
    if (input.size > CLONE_AUDIO_MAX_BYTES) check.errors.push('参考音频不能超过 10MB')
    if (input.durationSec == null) check.warnings.push(`读不出参考音频时长，请确认在 ${SOVITS_REF_MIN_SECONDS}~${SOVITS_REF_MAX_SECONDS} 秒之间`)
    else if (input.durationSec < SOVITS_REF_MIN_SECONDS) check.errors.push(`参考音频太短（${fmtSec(input.durationSec)}），需要 ${SOVITS_REF_MIN_SECONDS}~${SOVITS_REF_MAX_SECONDS} 秒`)
    else if (input.durationSec > SOVITS_REF_MAX_SECONDS) check.errors.push(`参考音频太长（${fmtSec(input.durationSec)}），需要 ${SOVITS_REF_MIN_SECONDS}~${SOVITS_REF_MAX_SECONDS} 秒，请剪出其中一句`)
  }
  const text = (input.refText || '').trim()
  if (!text) check.errors.push('请填写参考文本：参考音频里说的原话')
  else {
    if (text.length > SOVITS_REF_TEXT_MAX) check.errors.push(`参考文本不超过 ${SOVITS_REF_TEXT_MAX} 个字（参考音频只有 ${SOVITS_REF_MAX_SECONDS} 秒）`)
    if (text.length < 4) check.warnings.push('参考文本很短，请确认与参考音频内容一致')
    // 10 秒内正常语速约 2~6 字 / 秒；差太多基本是文本和音频对不上
    if (input.durationSec && input.durationSec > 0) {
      const rate = [...text.replace(/[\s\p{P}]/gu, '')].length / input.durationSec
      if (/[一-鿿]/.test(text) && (rate > 9 || rate < 0.8)) {
        check.warnings.push('参考文本字数与音频时长对不上，请确认文本就是音频里说的原话')
      }
    }
  }
  if (!SOVITS_LANGS.includes((input.refLang || '') as any)) check.errors.push(`参考语言须为 ${SOVITS_LANGS.join(' / ')}`)
  return check
}

/** 火山声音复刻上传校验 */
export function checkVolcClone(input: {
  name?: string
  speakerId: string
  fileName: string
  size: number
  durationSec: number | null
}): VoiceCheck {
  const check: VoiceCheck = { errors: [], warnings: [] }
  if (input.name !== undefined) checkVoiceName(input.name, check)
  const sid = (input.speakerId || '').trim()
  if (!sid) check.errors.push('请填写火山控制台里的音色 ID（S_ 开头）')
  else if (!/^[A-Za-z0-9_-]{2,64}$/.test(sid)) check.errors.push('音色 ID 只能包含字母、数字、下划线和短横线')
  else if (!/^S_/.test(sid)) check.warnings.push('火山声音复刻的音色 ID 一般以 S_ 开头，请确认填写正确')
  const ext = extOf(input.fileName)
  if (!input.fileName || !input.size) check.errors.push('请上传录音')
  else {
    if (!VOLC_AUDIO_EXTS.includes(ext)) check.errors.push(`录音格式不支持（.${ext || '?'}），请用 ${VOLC_AUDIO_EXTS.join(' / ')}`)
    if (input.size > CLONE_AUDIO_MAX_BYTES) check.errors.push('录音不能超过 10MB')
    if (input.durationSec != null) {
      if (input.durationSec < VOLC_CLONE_MIN_SECONDS) check.errors.push(`录音太短（${fmtSec(input.durationSec)}），建议 ${VOLC_CLONE_RECOMMENDED[0]}~${VOLC_CLONE_RECOMMENDED[1]} 秒`)
      else if (input.durationSec < VOLC_CLONE_RECOMMENDED[0] || input.durationSec > VOLC_CLONE_RECOMMENDED[1] * 2) {
        check.warnings.push(`录音 ${fmtSec(input.durationSec)}，建议 ${VOLC_CLONE_RECOMMENDED[0]}~${VOLC_CLONE_RECOMMENDED[1]} 秒效果最好`)
      }
    }
  }
  return check
}

/** 合成文字 / 语速校验 */
export function checkSynthesisText(input: { text: string; clone: boolean; speed?: number | null; voice?: string; needVoice?: boolean }): VoiceCheck {
  const check: VoiceCheck = { errors: [], warnings: [] }
  const text = (input.text || '').trim()
  const max = input.clone ? SOVITS_TEXT_MAX : TTS_TEXT_MAX
  if (!text) check.errors.push('请输入要合成的文字')
  else if ([...text].length > max) check.errors.push(`单次合成不超过 ${max} 个字，请分段合成`)
  else if (!/[\p{L}\p{N}]/u.test(text)) check.errors.push('文字里没有可以朗读的内容')
  if (input.speed != null && (!Number.isFinite(input.speed) || input.speed < SPEED_RANGE[0] || input.speed > SPEED_RANGE[1])) {
    check.errors.push(`语速须在 ${SPEED_RANGE[0]}~${SPEED_RANGE[1]} 倍之间`)
  }
  if (input.needVoice && !(input.voice || '').trim()) {
    check.errors.push(input.clone ? '请先选择一个克隆音色（没有就先上传参考音频创建）' : '请选择音色')
  }
  return check
}

/** 校验结果 → 一句话错误（给接口 400 用） */
export function describeCheck(check: VoiceCheck): string {
  return check.errors.join('；')
}
