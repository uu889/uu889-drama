/**
 * 语音模型（文字转语音 / 声音克隆）服务商目录 —— 设置页与后端共用的常量
 *
 * 服务商（ai_service_configs.provider，service_type = 'voice'）：
 * - aiask      aiask.me：模型 edge-tts（预置音色）/ gpt-sovits（声音克隆，需参考音频 + 参考文本）
 * - edgetts    本地 edge-tts：Base URL 填 openai-edge-tts 服务地址（/v1/audio/speech）；留空则调用本机 `edge-tts` 命令行
 * - gptsovits  本地 GPT-SoVITS：api_v2.py（默认 http://127.0.0.1:9880，POST /tts）
 * - volcengine 火山引擎豆包语音：模型填资源 ID（seed-tts-2.0 / seed-tts-1.0 预置音色，seed-icl-2.0 / seed-icl-1.0 声音复刻）
 */

export const VOICE_PROVIDERS = ['aiask', 'edgetts', 'gptsovits', 'volcengine'] as const
export type VoiceProvider = typeof VOICE_PROVIDERS[number]

export const AIASK_VOICE_MODELS = ['edge-tts', 'gpt-sovits'] as const

/** 模型是否是「声音克隆」类（需要先登记参考音频 / 复刻音色） */
export function isCloneModel(provider: string, model: string): boolean {
  const m = (model || '').toLowerCase()
  if (provider === 'gptsovits') return true
  if (provider === 'aiask') return /sovits/.test(m)
  if (provider === 'volcengine') return /icl|clone|megatts/.test(m)
  return false
}

/** 该服务商是否支持声音克隆 */
export function providerSupportsClone(provider: string): boolean {
  return provider === 'aiask' || provider === 'gptsovits' || provider === 'volcengine'
}

/** edge-tts 常用音色（微软 Edge 在线朗读，免费；完整列表 `edge-tts --list-voices`） */
export const EDGE_TTS_VOICES: { id: string; label: string; lang: string }[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女，温暖）', lang: 'zh' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女，活泼）', lang: 'zh' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男，阳光少年）', lang: 'zh' },
  { id: 'zh-CN-YunjianNeural', label: '云健（男，激情解说）', lang: 'zh' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（男，新闻播音）', lang: 'zh' },
  { id: 'zh-CN-YunxiaNeural', label: '云夏（男童）', lang: 'zh' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北（女，东北话）', lang: 'zh' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮（女，陕西话）', lang: 'zh' },
  { id: 'zh-HK-HiuMaanNeural', label: '曉曼（女，粤语）', lang: 'yue' },
  { id: 'zh-HK-WanLungNeural', label: '雲龍（男，粤语）', lang: 'yue' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻（女，台湾）', lang: 'zh' },
  { id: 'zh-TW-YunJheNeural', label: '雲哲（男，台湾）', lang: 'zh' },
  { id: 'en-US-JennyNeural', label: 'Jenny (female, English)', lang: 'en' },
  { id: 'en-US-GuyNeural', label: 'Guy (male, English)', lang: 'en' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami（女，日语）', lang: 'ja' },
  { id: 'ja-JP-KeitaNeural', label: 'Keita（男，日语）', lang: 'ja' },
  { id: 'ko-KR-SunHiNeural', label: 'SunHi（女，韩语）', lang: 'ko' },
]
export const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural'

/** 火山引擎豆包语音合成大模型常用预置音色（voice_type / speaker；控制台「音色列表」可查全部） */
export const VOLC_PRESET_VOICES: { id: string; label: string }[] = [
  { id: 'zh_female_wanqudashu_moon_bigtts', label: '湾区大叔（女声）' },
  { id: 'zh_female_wanwanxiaohe_moon_bigtts', label: '湾湾小何' },
  { id: 'zh_female_shuangkuaisisi_moon_bigtts', label: '爽快思思' },
  { id: 'zh_female_tianmeixiaoyuan_moon_bigtts', label: '甜美小源' },
  { id: 'zh_male_wennuanahu_moon_bigtts', label: '温暖阿虎' },
  { id: 'zh_male_shaonianzixin_moon_bigtts', label: '少年梓辛' },
  { id: 'zh_male_jingqiangkanye_moon_bigtts', label: '京腔侃爷' },
]
export const DEFAULT_VOLC_VOICE = VOLC_PRESET_VOICES[0].id
export const VOLC_TTS_RESOURCES = ['seed-tts-2.0', 'seed-tts-1.0'] as const
export const VOLC_ICL_RESOURCES = ['seed-icl-2.0', 'seed-icl-1.0'] as const

/** GPT-SoVITS 支持的语言（text_lang / prompt_lang） */
export const SOVITS_LANGS = ['zh', 'en', 'ja', 'ko', 'yue', 'auto'] as const
export type SovitsLang = typeof SOVITS_LANGS[number]

/** 火山声音复刻 language 编号 */
export const VOLC_CLONE_LANG: Record<string, number> = { zh: 0, en: 1, ja: 2, es: 3, id: 4, pt: 5, ko: 8 }

export const VOICE_BASE_URLS: Record<VoiceProvider, string> = {
  aiask: 'https://aiask.me',
  edgetts: '',
  gptsovits: 'http://127.0.0.1:9880',
  volcengine: 'https://openspeech.bytedance.com',
}

/** 该服务商/模型的默认音色（未在设置里指定 default_voice 时） */
export function defaultVoiceFor(provider: string, model: string): string {
  if (provider === 'volcengine' && !isCloneModel(provider, model)) return DEFAULT_VOLC_VOICE
  if (provider === 'edgetts' || (provider === 'aiask' && !isCloneModel(provider, model))) return DEFAULT_EDGE_VOICE
  return ''
}
