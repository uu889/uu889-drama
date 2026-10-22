/**
 * 单个分镜段落的上限：视频配置里的「最长视频时长 / 提示词最大长度」是**每个分镜（一次视频生成）**的上限，
 * 不是拼接后成片的总长。拆分镜、写视频提示词时就按这个写，而不是等到提交时再截。
 *
 * 用哪一个视频配置：该集锁定的 video_config_id，没有就用当前启用的视频配置。
 * 提示词预算给 Agent 写的 video_prompt 留 60%：生成时还会追加【台词控制】【人物外观锁定】等导演指令。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { DEFAULT_MAX_DURATION, videoLimits, type VideoLimits } from './video-limits.js'

export interface ShotLimits extends VideoLimits {
  /** Agent 写 video_prompt 的字节预算（0 = 不限） */
  promptBudgetBytes: number
  /** 配置名（说明里用） */
  configName: string | null
}

export const PROMPT_BUDGET_RATIO = 0.6

export function shotLimitsFrom(settings: Record<string, any> | null | undefined, configName: string | null = null): ShotLimits {
  const l = videoLimits(settings)
  return {
    ...l,
    promptBudgetBytes: l.maxPromptBytes > 0 ? Math.max(600, Math.floor(l.maxPromptBytes * PROMPT_BUDGET_RATIO)) : 0,
    configName,
  }
}

function parseSettings(raw: unknown): Record<string, any> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, any>
  try { return JSON.parse(String(raw)) } catch { return null }
}

/** 某一集用的视频配置的单镜上限 */
export async function shotLimitsForEpisode(episodeId: number | null | undefined): Promise<ShotLimits> {
  const rows = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.serviceType, 'video'))
  let cfg: (typeof rows)[number] | undefined
  if (episodeId) {
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    if (ep?.videoConfigId) cfg = rows.find((r) => r.id === ep.videoConfigId)
  }
  cfg ??= rows.filter((r) => r.isActive).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
  return shotLimitsFrom(parseSettings(cfg?.settings), cfg?.name ?? null)
}

/** 追加给拆分镜 / 视频提示词 Agent 的说明（默认 15 秒 / 4090 字节也写，让 Agent 明确知道上限） */
export function shotLimitsAgentDirective(agentType: string, limits: ShotLimits, lang?: string | null): string {
  const zh = !lang || lang === 'zh'
  const max = limits.maxDuration
  const budget = limits.promptBudgetBytes
  const chars = Math.floor(budget / 3)
  if (agentType === 'storyboard_breaker') {
    return zh
      ? [
          `## 视频接口上限（每个分镜段落）`,
          `视频生成服务每次最多生成 ${max} 秒：每个分镜段落的 duration 必须在 ${Math.min(4, max)}-${max} 秒之间，不得超过 ${max} 秒（这是单个分镜的上限，不是整集成片的长度）。${max !== DEFAULT_MAX_DURATION ? `前面规则里写的「4-15 秒」一律按 ${Math.min(4, max)}-${max} 秒执行。` : ''}`,
          `- 台词 + 动作在 ${max} 秒内演不完时，在台词或动作的自然停顿处拆成两个（或更多）连续的分镜段落，同场景接戏，不要压缩台词、也不要超时。`,
          `- 一个分镜段落里子镜头和动作要少而清楚：${max} 秒内最多 ${max <= 6 ? 2 : max <= 10 ? 3 : 4} 个子镜头，每个子镜头只做一件事。`,
          ...(budget ? [`- 如果填写 video_prompt：每条不超过 ${budget} 字节（UTF-8，约 ${chars} 个汉字），生成时系统还会追加导演指令，总长不能超过 ${limits.maxPromptBytes} 字节。`] : []),
        ].join('\n')
      : [
          `## Video API limit (per shot)`,
          `The video service generates at most ${max} seconds per request: every shot's duration must be ${Math.min(4, max)}-${max} seconds and never above ${max} (this is the per-shot limit, not the length of the episode). ${max !== DEFAULT_MAX_DURATION ? `Wherever the rules above say "4-15 seconds", use ${Math.min(4, max)}-${max} seconds.` : ''}`,
          `- If the dialogue and action do not fit in ${max} seconds, split them at a natural pause into two (or more) consecutive shots in the same location. Never squeeze the dialogue or exceed the limit.`,
          `- Keep sub-shots and actions few and clear: at most ${max <= 6 ? 2 : max <= 10 ? 3 : 4} sub-shots in ${max} seconds, one action each.`,
          ...(budget ? [`- If you write video_prompt: keep each under ${budget} bytes (UTF-8); directives are appended at generation time and the total must stay under ${limits.maxPromptBytes} bytes.`] : []),
        ].join('\n')
  }
  if (agentType === 'prompt_generator') {
    return zh
      ? [
          `## 视频接口上限（每条视频）`,
          `- 视频时长以分镜 duration 为准，最多 ${max} 秒；时间分段不得超出 duration。`,
          ...(budget ? [`- 每条 video_prompt 不超过 ${budget} 字节（UTF-8，一个汉字 3 字节，约 ${chars} 个汉字）：生成时系统还会追加【台词控制】【人物外观锁定】等指令，加起来不能超过视频接口的 ${limits.maxPromptBytes} 字节上限，超了会被截掉。写短句、写看得见的动作，不要重复描写外貌和画风（系统会自动补）。`] : []),
        ].join('\n')
      : [
          `## Video API limit (per video)`,
          `- The video length is the shot duration, at most ${max} seconds; time segments must not exceed it.`,
          ...(budget ? [`- Keep each video_prompt under ${budget} bytes (UTF-8): directives such as [Dialogue control] and [Character lock] are appended at generation time and the total must stay under the ${limits.maxPromptBytes}-byte API limit or it gets cut. Use short sentences and visible actions; do not repeat appearance or style (added automatically).`] : []),
        ].join('\n')
  }
  return ''
}
