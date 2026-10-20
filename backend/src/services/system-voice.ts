/**
 * 系统音（系统流短剧的「系统」角色）
 *
 * 系统流短剧里主角绑定了「系统」：系统会和主角对话、播报任务 / 奖励（「叮！恭喜宿主……」）。
 * 视频模型默认不知道这是一个「只有声音」的角色，生成的视频里没有系统的声音，或者让画面里某个人张嘴说系统的台词。
 *
 * 项目级开关（dramas.metadata.system_voice），开启后：
 * - 剧本改写 / 资产提取 / 分镜拆解 / 提示词生成四个 Agent 的指令里加一段说明：系统台词统一写成「系统：「…」」，
 *   系统是画外电子音、不出图、不绑定为画面人物，视频提示词里写明提示音和声音质感
 * - 生成视频时解析分镜里的系统台词（系统：「…」/ 系统播报：… /【系统：…】/【叮！…】），
 *   【台词控制】里标成画外电子音，并附加【系统音】：先响提示音、声音质感、画面里没人动嘴，可选全息面板（不出现文字）
 * - 字幕里系统台词用【】括起来、换成青蓝色
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { COMMON_SYSTEM_NAMES, systemNamesFor } from './shot-direction.js'
export { isSystemSpeaker } from './shot-direction.js'

export interface SystemVoiceSettings {
  enabled: boolean
  /** 系统在剧本里的叫法（如：系统 / 神豪系统 / 签到系统 / 小爱） */
  name: string
  /** 声音质感 */
  voice: string
  /** 每次开口前的提示音 */
  chime: string
  /** 系统说话时主角面前浮现全息面板（只有光效，不出现文字） */
  panel: boolean
}

export const SYSTEM_VOICE_DEFAULTS: SystemVoiceSettings = {
  enabled: false,
  name: '系统',
  voice: '冰冷清晰的机械电子合成音，中性偏女声，略带金属回响',
  chime: '清脆的「叮」提示音',
  panel: true,
}


function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function normalizeSystemVoice(raw: unknown): SystemVoiceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: r.enabled === true || r.enabled === 1 || r.enabled === 'true',
    name: str(r.name, 20) || SYSTEM_VOICE_DEFAULTS.name,
    voice: str(r.voice, 80) || SYSTEM_VOICE_DEFAULTS.voice,
    chime: str(r.chime, 40) || SYSTEM_VOICE_DEFAULTS.chime,
    panel: r.panel === undefined ? SYSTEM_VOICE_DEFAULTS.panel : r.panel === true || r.panel === 1 || r.panel === 'true',
  }
}

/** 剧本里代表系统说话的名字（自定义名在前，长的在前） */
export function systemSpeakerNames(sv: SystemVoiceSettings | null | undefined): string[] {
  return systemNamesFor(sv)
}


/** 角色表里名叫系统的「角色」：系统开启时只有声音，不出图、不做外观锁定 */
export function isSystemCharacterName(name: string | null | undefined, sv: SystemVoiceSettings | null | undefined): boolean {
  if (!sv?.enabled) return false
  const n = String(name || '').trim()
  return !!n && (n === sv.name || COMMON_SYSTEM_NAMES.includes(n))
}

function parseMetadata(text: string | null | undefined): Record<string, any> {
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export async function getDramaSystemVoice(dramaId: number | null | undefined): Promise<SystemVoiceSettings> {
  if (!dramaId) return { ...SYSTEM_VOICE_DEFAULTS }
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return normalizeSystemVoice(parseMetadata(drama?.metadata).system_voice)
}

export async function getEpisodeSystemVoice(episodeId: number | null | undefined): Promise<SystemVoiceSettings> {
  if (!episodeId) return { ...SYSTEM_VOICE_DEFAULTS }
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return getDramaSystemVoice(ep?.dramaId)
}

/** 保存到 dramas.metadata.system_voice（metadata 里的其他字段原样保留） */
export async function saveDramaSystemVoice(dramaId: number, raw: unknown): Promise<SystemVoiceSettings | null> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return null
  const sv = normalizeSystemVoice(raw)
  const meta = parseMetadata(drama.metadata)
  meta.system_voice = sv
  await db.update(schema.dramas).set({ metadata: JSON.stringify(meta), updatedAt: new Date().toISOString() }).where(eq(schema.dramas.id, dramaId))
  return sv
}

/** 给 Agent 的说明（剧本改写 / 资产提取 / 分镜拆解 / 提示词生成）；没开或该 Agent 不需要时返回 '' */
export function systemVoiceAgentDirective(agentType: string, sv: SystemVoiceSettings | null | undefined, lang?: string | null): string {
  if (!sv?.enabled) return ''
  const zh = !lang || lang === 'zh'
  const n = sv.name
  if (zh) {
    const head = `## 系统音（本项目已开启）\n本剧是系统流：主角绑定了「${n}」。${n}是只有声音的存在（画外电子音，${sv.voice}），每次开口前会响起${sv.chime}。`
    switch (agentType) {
      case 'script_rewriter':
        return `${head}\n- ${n}与主角的对话、任务发布、奖励播报都要保留，单独成行，统一写成：${n}：「台词」（播报也用这个格式，例如 ${n}：「叮！恭喜宿主获得新手大礼包。」）。\n- 不要把${n}的话写成旁白，也不要省略；主角在心里回应${n}时写成：主角名（内心）：「台词」。`
      case 'extractor':
        return `${head}\n- 「${n}」不是需要出图的人物：不要把${n}提取为角色（除非剧本明确描写了${n}有具体可见的实体形象）。`
      case 'storyboard_breaker':
        return `${head}\n- 分镜描述里${n}的话一律写成 ${n}：「台词」，逐字保留，不要改写成旁白；${n}的台词同样计入分镜时长。\n- ${n}不是画面中的人物：不要把${n}绑定为分镜角色；${n}说话时画面里没有人张嘴，主角可以有听到声音的反应（愣住、眼神变化、嘴角上扬）。${sv.panel ? `\n- ${n}说话时可以描写主角面前浮现半透明蓝色全息面板（只有光效和图标，不写面板上的文字）。` : ''}`
      case 'prompt_generator':
        return `${head}\n- 视频提示词里写到${n}说话时，写成：画外先响起${sv.chime}，随后${n}用${sv.voice}说：「台词」——台词逐字保留。\n- 明确写出${n}的声音是画外音：画面中任何人都不动嘴，主角做出听到${n}声音的反应。${sv.panel ? `\n- ${n}说话时主角面前浮现半透明蓝色全息系统面板，只有科幻光效与图标，面板上不出现任何文字。` : ''}\n- 图片提示词不要画出${n}（${n}没有实体形象）。`
      default:
        return ''
    }
  }
  const head = `## System voice (enabled for this project)\nThis is a "system" story: the protagonist is bound to "${n}", a voice-only entity (an off-screen synthetic voice: ${sv.voice}). A chime (${sv.chime}) plays every time it speaks.`
  switch (agentType) {
    case 'script_rewriter':
      return `${head}\n- Keep every line ${n} says (conversations, quests, reward announcements) on its own line, written as ${n}: "line". Never turn them into narration or drop them.`
    case 'extractor':
      return `${head}\n- "${n}" is not a character to draw: do not extract it as a character unless the script describes a visible physical form.`
    case 'storyboard_breaker':
      return `${head}\n- In shot descriptions write ${n}'s lines as ${n}: "line", word for word, and count them in the shot duration.\n- ${n} is not on screen: do not bind it as a shot character; nobody moves their lips when it speaks.${sv.panel ? ' A translucent blue holographic panel (light effects and icons only, no readable text) may appear in front of the protagonist.' : ''}`
    case 'prompt_generator':
      return `${head}\n- When ${n} speaks in a video prompt, write: the chime (${sv.chime}) sounds off-screen, then ${n} says in ${sv.voice}: "line" — word for word.\n- State that it is an off-screen voice: nobody on screen moves their lips; the protagonist reacts to hearing it.${sv.panel ? '\n- A translucent blue holographic system panel appears in front of the protagonist: sci-fi light effects and icons only, no text.' : ''}\n- Do not draw ${n} in image prompts (it has no physical form).`
    default:
      return ''
  }
}
