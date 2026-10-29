/**
 * 单个分镜段落的上限：视频配置里的「最长视频时长 / 提示词最大长度」是**每个分镜（一次视频生成）**的上限，
 * 不是拼接后成片的总长。拆分镜、写视频提示词时就按这个写，而不是等到提交时再截。
 *
 * 用哪一个视频配置：该集锁定的 video_config_id，没有就用当前启用的视频配置。两项默认都不限制（0）。
 * 单镜时长另有「生效上限」maxShotSeconds，永远有值：项目设置（dramas.metadata.shot_max_seconds，视频页「单镜上限」）
 * 与视频配置 max_duration 取小的；都没设按 15 秒（主流视频模型单次最多 15 秒）。拆分镜 Agent 总会收到这个上限，
 * 拆完后超过上限的分镜由 shot-split.ts 按台词自动拆开。
 * 提示词预算给 Agent 写的 video_prompt 留 45%：生成时还会追加项目画风词（限长时最多 600 字节）和【台词控制】【人物外观锁定】【画质】【接上一镜】等导演指令
 * （限长时一律用精简版，约 1.2~1.8KB）。Grok（aiask / xai）接口自身最多 4096 字节，没设或设得更大时按 4096 算。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { videoLimits, type VideoLimits } from './video-limits.js'

export interface ShotLimits extends VideoLimits {
  /** Agent 写 video_prompt 的字节预算（0 = 不限） */
  promptBudgetBytes: number
  /** 配置名（说明里用） */
  configName: string | null
  /** 单镜时长生效上限（秒，总有值）：项目设置与视频配置取小的，都没设 = DEFAULT_SHOT_MAX_SECONDS */
  maxShotSeconds: number
  /** 生效上限从哪来：config = 视频配置 max_duration；project = 项目设置；default = 默认 15 秒 */
  shotCapSource: 'config' | 'project' | 'default'
  /** 项目设置的单镜上限（没设为 null） */
  projectMaxSeconds: number | null
}

export const PROMPT_BUDGET_RATIO = 0.45
const GROK_MAX_PROMPT_BYTES = 4096
/** 没有任何设置时的单镜上限：主流视频模型（Grok / 可灵 / Seedance / Veo 等）单次最多 15 秒左右 */
export const DEFAULT_SHOT_MAX_SECONDS = 15
export const SHOT_MAX_RANGE = { min: 3, max: 120 }

/** 项目设置的单镜上限：3~120 的整数，其他值（含 0 / 空）= 不设 */
export function normalizeShotMax(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(SHOT_MAX_RANGE.max, Math.max(SHOT_MAX_RANGE.min, n))
}

/** 一个分镜里台词（含旁白）合计最多多少字：按每秒约 4.5 字、留出开场与收尾估算（15 秒 ≈ 50 字） */
export function shotDialogueCharBudget(maxSeconds: number): number {
  return Math.max(8, Math.round((maxSeconds - 1.5) * 3.7))
}

export function shotLimitsFrom(
  settings: Record<string, any> | null | undefined,
  configName: string | null = null,
  provider?: string | null,
  projectMax?: number | null,
): ShotLimits {
  const l = videoLimits(settings)
  if (provider === 'aiask' || provider === 'xai') {
    l.maxPromptBytes = l.maxPromptBytes > 0 ? Math.min(l.maxPromptBytes, GROK_MAX_PROMPT_BYTES) : GROK_MAX_PROMPT_BYTES
  }
  const project = normalizeShotMax(projectMax)
  const cfg = l.maxDuration > 0 ? l.maxDuration : 0
  const [maxShotSeconds, shotCapSource]: [number, ShotLimits['shotCapSource']] = project && cfg
    ? (cfg < project ? [cfg, 'config'] : [project, 'project'])
    : project ? [project, 'project'] : cfg ? [cfg, 'config'] : [DEFAULT_SHOT_MAX_SECONDS, 'default']
  return {
    ...l,
    promptBudgetBytes: l.maxPromptBytes > 0 ? Math.max(600, Math.floor(l.maxPromptBytes * PROMPT_BUDGET_RATIO)) : 0,
    configName,
    maxShotSeconds,
    shotCapSource,
    projectMaxSeconds: project,
  }
}

function parseSettings(raw: unknown): Record<string, any> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, any>
  try { return JSON.parse(String(raw)) } catch { return null }
}

async function dramaMetadata(dramaId: number | null | undefined): Promise<Record<string, any> | null> {
  if (!dramaId) return null
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return null
  const meta = parseSettings(drama.metadata)
  return meta && !Array.isArray(meta) ? meta : {}
}

/** 项目设置的单镜上限（dramas.metadata.shot_max_seconds）；没设为 null */
export async function getDramaShotMax(dramaId: number | null | undefined): Promise<number | null> {
  return normalizeShotMax((await dramaMetadata(dramaId))?.shot_max_seconds)
}

/** 保存项目的单镜上限（null / 0 = 清除，跟随视频配置或默认 15 秒）；项目不存在返回 false */
export async function saveDramaShotMax(dramaId: number, raw: unknown): Promise<boolean> {
  const meta = await dramaMetadata(dramaId)
  if (!meta) return false
  const v = normalizeShotMax(raw)
  if (v) meta.shot_max_seconds = v
  else delete meta.shot_max_seconds
  await db.update(schema.dramas).set({ metadata: JSON.stringify(meta), updatedAt: new Date().toISOString() }).where(eq(schema.dramas.id, dramaId))
  return true
}

/** 某一集用的视频配置的单镜上限（含项目设置的单镜时长上限） */
export async function shotLimitsForEpisode(episodeId: number | null | undefined): Promise<ShotLimits> {
  const rows = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.serviceType, 'video'))
  let cfg: (typeof rows)[number] | undefined
  let projectMax: number | null = null
  if (episodeId) {
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    if (ep?.videoConfigId) cfg = rows.find((r) => r.id === ep.videoConfigId)
    projectMax = await getDramaShotMax(ep?.dramaId)
  }
  cfg ??= rows.filter((r) => r.isActive).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
  return shotLimitsFrom(parseSettings(cfg?.settings), cfg?.name ?? null, cfg?.provider, projectMax)
}

/** 单镜上限从哪来（给 Agent 的说明用） */
function capSourceText(limits: ShotLimits, zh: boolean): string {
  if (limits.shotCapSource === 'config') return zh ? `视频配置${limits.configName ? `「${limits.configName}」` : ''}的单镜上限` : `the per-shot limit of the video config${limits.configName ? ` "${limits.configName}"` : ''}`
  if (limits.shotCapSource === 'project') return zh ? '本项目设置的单镜上限' : 'the per-shot limit set for this project'
  return zh ? '默认上限：主流视频模型单次最多生成 15 秒' : 'the default: mainstream video models generate at most 15 seconds per request'
}

/** 追加给拆分镜 / 视频提示词 Agent 的说明：单镜时长上限总会写（默认 15 秒）；提示词预算设了才写 */
export function shotLimitsAgentDirective(agentType: string, limits: ShotLimits, lang?: string | null): string {
  const zh = !lang || lang === 'zh'
  const max = limits.maxShotSeconds || DEFAULT_SHOT_MAX_SECONDS
  const min = Math.min(4, max)
  const words = shotDialogueCharBudget(max)
  const budget = limits.promptBudgetBytes
  const chars = Math.floor(budget / 3)
  const subShots = max <= 6 ? 2 : max <= 10 ? 3 : 4
  if (agentType === 'storyboard_breaker') {
    return zh
      ? [
          `## 单镜时长上限（每个分镜段落）`,
          `每个分镜段落就是一次视频生成，最长 ${max} 秒（${capSourceText(limits, true)}）：duration 必须在 ${min}-${max} 秒之间，不得超过 ${max} 秒（这是单个分镜的上限，不是整集成片的长度）。前面规则里写的「4-15 秒」一律按 ${min}-${max} 秒执行，「每段台词 ≤ 50 字」一律按 ≤ ${words} 字执行。`,
          `- 每个分镜段落的台词（含旁白）合计不超过 ${words} 个字（每秒约 4.5 字，还要留开场和收尾）。台词 + 动作在 ${max} 秒内演不完时，在台词或动作的自然停顿处拆成两个（或更多）连续的分镜段落，同场景接戏，不要压缩台词、也不要超时。`,
          `- 一句台词本身就超过 ${words} 字时，在句号 / 逗号处断开，分到连续的分镜段落（后一段写「某某继续说：「…」」），中间可以插听者的反应。`,
          `- 一个分镜段落里子镜头和动作要少而清楚：${max} 秒内最多 ${subShots} 个子镜头，每个子镜头只做一件事。`,
          `- 保存后台词仍超过 ${max} 秒的段落会被系统按台词机械地切开（不如你按剧情拆得自然），所以请自己拆好。`,
          ...(budget ? [`- 如果填写 video_prompt：每条不超过 ${budget} 字节（UTF-8，约 ${chars} 个汉字），生成时系统还会追加导演指令，总长不能超过 ${limits.maxPromptBytes} 字节。`] : []),
        ].join('\n')
      : [
          `## Per-shot duration limit`,
          `Each shot is one video generation and lasts at most ${max} seconds (${capSourceText(limits, false)}): every shot's duration must be ${min}-${max} seconds and never above ${max} (this is the per-shot limit, not the length of the episode). Wherever the rules above say "4-15 seconds", use ${min}-${max} seconds; wherever they say "at most 50 characters of dialogue", use ${words}.`,
          `- Keep the dialogue (including narration) of one shot within about ${Math.round(max * 2.2)} words. If the dialogue and action do not fit in ${max} seconds, split them at a natural pause into two (or more) consecutive shots in the same location. Never squeeze the dialogue or exceed the limit.`,
          `- If a single line is too long by itself, break it at a sentence boundary and continue it in the next shot ("X continues: \"...\""), optionally with a listener reaction in between.`,
          `- Keep sub-shots and actions few and clear: at most ${subShots} sub-shots in ${max} seconds, one action each.`,
          `- After saving, any shot whose dialogue still needs more than ${max} seconds is split mechanically by the system (less natural than your own split), so split it yourself.`,
          ...(budget ? [`- If you write video_prompt: keep each under ${budget} bytes (UTF-8); directives are appended at generation time and the total must stay under ${limits.maxPromptBytes} bytes.`] : []),
        ].join('\n')
  }
  if (agentType === 'prompt_generator') {
    return zh
      ? [
          `## 视频接口上限（每条视频）`,
          `- 视频时长以分镜 duration 为准，最多 ${max} 秒；时间分段不得超出 duration。`,
          ...(budget ? [`- 每条 video_prompt 不超过 ${budget} 字节（UTF-8，一个汉字 3 字节，约 ${chars} 个汉字）：其余约 ${limits.maxPromptBytes - budget} 字节已经留给系统自动追加的画风词和【台词控制】【人物外观锁定】【画质】【接上一镜】【物理真实】等指令，加起来不能超过视频接口的 ${limits.maxPromptBytes} 字节上限，超了正文结尾会被截掉。写短句、写看得见的动作，不要重复描写外貌、画风、画质和物理要求（系统会自动补）；换行也算 2 字节，少分行。`] : []),
        ].join('\n')
      : [
          `## Video API limit (per video)`,
          `- The video length is the shot duration, at most ${max} seconds; time segments must not exceed it.`,
          ...(budget ? [`- Keep each video_prompt under ${budget} bytes (UTF-8): the remaining ~${limits.maxPromptBytes - budget} bytes are reserved for the style words and directives ([Dialogue control], [Character lock], [Quality], [Continuity], [Physics]) appended automatically; the total must stay under the ${limits.maxPromptBytes}-byte API limit or the end of the text gets cut. Use short sentences and visible actions; do not repeat appearance, style, quality or physics rules (added automatically); each line break counts as 2 bytes, so use few.`] : []),
        ].join('\n')
  }
  return ''
}
