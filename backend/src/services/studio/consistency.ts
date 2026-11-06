/**
 * 创作会话的画面一贯性（纯函数，tests/studio-consistency.test.ts 覆盖）
 *
 * 做法参照 uu889-video 的导演工作流，并在代码里强制执行，不只靠提示词：
 * 1. 设定先行：有固定角色 / 场景 / 道具时先出设定图（create_reference），外观描述锁定进「一贯性设定」（bible）
 * 2. 统一画风：所有图片 / 视频提示词开头都是同一段画风基调（bible.style），画幅 / 分辨率全片统一
 * 3. 参考图自动带上：关键帧、视频按提到的角色 / 场景 / 道具自动附设定图（角色在前），提示词里 @名字 → @图片N名字
 * 4. 关键帧优先：先出首帧图（带参考图），再图生视频
 * 5. 接上一镜：首帧可以直接用上一个视频的结尾帧；接戏代数有上限（每代图生视频都会放大压缩块 / 锐化 / 偏色），
 *    超过上限改作参考图，不再当首帧
 * 6. 视频提示词附加【人物外观锁定】【场景一致】【画风一致】【画质】【物理真实】等导演指令（shot-direction.ts 同一套）
 */
import { buildShotDirectives, isChinesePrompt } from '../shot-direction.js'
import { MAX_FIRST_FRAME_GENERATIONS } from '../chain-depth.js'

export type BibleType = 'character' | 'scene' | 'prop'

export interface BibleEntry {
  name: string
  type: BibleType
  /** 锁定的外观 / 布局描述：后面每个镜头都按这段写 */
  description: string
  /** 服装 / 配色等补充（角色） */
  styling?: string
  /** 设定图素材 id 与本地路径 */
  asset_id?: number | null
  path?: string | null
}

export interface StudioBible {
  /** 画风基调：每张图、每段视频提示词的开头 */
  style: string
  /** 风格库 id（catalog/styles），选了才有 */
  style_id?: string | null
  entries: BibleEntry[]
}

export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
export const RESOLUTIONS = ['480p', '720p', '1080p'] as const

export interface StudioSettings {
  aspect_ratio: string
  resolution: string
  /** 单镜默认秒数 */
  clip_seconds: number
  /** 单次对话最多提交的视频片段数（视频按秒计费） */
  max_clips: number
  image_config_id?: number | null
  video_config_id?: number | null
  image_model?: string | null
  video_model?: string | null
  /** 允许智能体生成图片 / 视频（关掉 = 纯文字对话） */
  tools: boolean
  /** 视频自带同期声（关掉 = 无声片段，后面配旁白 / 音乐） */
  generate_audio: boolean
  /** 工作流会话用哪个智能体出片（智能体会话就是它自己） */
  agent_id?: string | null
}

export const DEFAULT_SETTINGS: StudioSettings = {
  aspect_ratio: '9:16',
  resolution: '720p',
  clip_seconds: 6,
  max_clips: 12,
  tools: true,
  generate_audio: true,
}

export function normalizeSettings(raw: unknown, base: StudioSettings = DEFAULT_SETTINGS): StudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const num = (v: unknown, min: number, max: number, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d
  }
  const id = (v: unknown, d: number | null | undefined) => (v === null ? null : Number(v) > 0 ? Number(v) : d ?? null)
  const model = (v: unknown, d: string | null | undefined) => (v === null || v === '' ? null : typeof v === 'string' ? v.slice(0, 120) : d ?? null)
  return {
    aspect_ratio: (RATIOS as readonly string[]).includes(r.aspect_ratio) ? r.aspect_ratio : base.aspect_ratio,
    resolution: (RESOLUTIONS as readonly string[]).includes(r.resolution) ? r.resolution : base.resolution,
    clip_seconds: num(r.clip_seconds, 1, 15, base.clip_seconds),
    max_clips: num(r.max_clips, 1, 60, base.max_clips),
    image_config_id: id(r.image_config_id, base.image_config_id),
    video_config_id: id(r.video_config_id, base.video_config_id),
    image_model: model(r.image_model, base.image_model),
    video_model: model(r.video_model, base.video_model),
    tools: typeof r.tools === 'boolean' ? r.tools : base.tools,
    generate_audio: typeof r.generate_audio === 'boolean' ? r.generate_audio : base.generate_audio,
    agent_id: typeof r.agent_id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(r.agent_id) ? r.agent_id : base.agent_id ?? null,
  }
}

export function emptyBible(): StudioBible {
  return { style: '', style_id: null, entries: [] }
}

export function normalizeBible(raw: unknown): StudioBible {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const entries: BibleEntry[] = (Array.isArray(r.entries) ? r.entries : [])
    .filter((e: any) => e && typeof e.name === 'string' && e.name.trim() && ['character', 'scene', 'prop'].includes(e.type))
    .map((e: any) => ({
      name: String(e.name).trim().slice(0, 40),
      type: e.type as BibleType,
      description: String(e.description || '').slice(0, 800),
      styling: e.styling ? String(e.styling).slice(0, 400) : undefined,
      asset_id: Number(e.asset_id) > 0 ? Number(e.asset_id) : null,
      path: typeof e.path === 'string' && e.path ? e.path : null,
    }))
  return {
    style: String(r.style || '').slice(0, 1200),
    style_id: typeof r.style_id === 'string' && r.style_id ? r.style_id : null,
    entries,
  }
}

/** 名字比较：去掉括号注释、空白、大小写（「林小雨（女主）」=「林小雨」） */
export function normalizeName(name: string): string {
  return String(name || '')
    .replace(/[（(][^（()）]*[）)]/g, '')
    .replace(/^@+/, '')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
}

export function findEntry(bible: StudioBible, name: string, type?: BibleType): BibleEntry | null {
  const key = normalizeName(name)
  if (!key) return null
  return bible.entries.find(e => normalizeName(e.name) === key && (!type || e.type === type)) || null
}

/** 新增或更新一条设定（同名同类覆盖：外观改了、设定图重出） */
export function upsertEntry(bible: StudioBible, entry: BibleEntry): StudioBible {
  const key = normalizeName(entry.name)
  const rest = bible.entries.filter(e => !(normalizeName(e.name) === key && e.type === entry.type))
  return { ...bible, entries: [...rest, entry] }
}

/** 提示词里出现的设定名字（@名字 或直接写名字都算），按出现顺序 */
export function mentionedEntries(bible: StudioBible, text: string): BibleEntry[] {
  const body = String(text || '')
  const hits: Array<{ e: BibleEntry; at: number }> = []
  for (const e of bible.entries) {
    const at = body.indexOf(e.name)
    if (at >= 0) hits.push({ e, at })
  }
  return hits.sort((a, b) => a.at - b.at).map(h => h.e)
}

export interface RefImage {
  /** static/... 本地路径 */
  path: string
  /** 设定名字（自动参考图）或素材名 */
  label: string
  type: BibleType | 'asset'
}

const TYPE_ORDER: Record<RefImage['type'], number> = { character: 0, scene: 1, prop: 2, asset: 3 }

/**
 * 本镜要带的参考图：点名的设定 + 提示词里提到的设定 + 显式给的素材；角色在前，然后场景、道具、其它素材，去重，最多 max 张
 */
export function pickReferences(input: {
  bible: StudioBible
  names?: string[]
  prompt?: string
  extra?: RefImage[]
  max?: number
}): RefImage[] {
  const max = Math.max(0, input.max ?? 6)
  const entries: BibleEntry[] = []
  const add = (e: BibleEntry | null) => {
    if (e && !entries.includes(e)) entries.push(e)
  }
  for (const n of input.names || []) add(findEntry(input.bible, n))
  for (const e of mentionedEntries(input.bible, input.prompt || '')) add(e)
  const refs: RefImage[] = entries
    .filter(e => e.path)
    .map(e => ({ path: e.path!, label: e.name, type: e.type }))
  for (const x of input.extra || []) refs.push(x)
  const seen = new Set<string>()
  return refs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => TYPE_ORDER[a.r.type] - TYPE_ORDER[b.r.type] || a.i - b.i)
    .map(x => x.r)
    .filter(r => (seen.has(r.path) ? false : (seen.add(r.path), true)))
    .slice(0, max)
}

/** 本镜涉及的设定（点名 + 提示词提到的），用于外观锁定 */
export function shotEntries(bible: StudioBible, names: string[] = [], prompt = ''): BibleEntry[] {
  const out: BibleEntry[] = []
  for (const n of names) {
    const e = findEntry(bible, n)
    if (e && !out.includes(e)) out.push(e)
  }
  for (const e of mentionedEntries(bible, prompt)) if (!out.includes(e)) out.push(e)
  return out
}

/**
 * 提示词里的 @名字 / 名字 → @图片N名字（N = 参考图里的序号，从 1 开始），适配器再换成各家的写法（Grok <IMAGE_n>）。
 * 已经写成 @图片N 的不动；名字没在参考图里的去掉 @ 号
 */
export function tagReferences(prompt: string, refs: RefImage[], offset = 0): string {
  let out = String(prompt || '')
  const labels = refs.map((r, i) => ({ name: r.label, n: i + 1 + offset })).filter(x => x.name).sort((a, b) => b.name.length - a.name.length)
  for (const { name, n } of labels) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`@图片\\d+${esc}`).test(out)) continue
    const at = new RegExp(`@${esc}`)
    if (at.test(out)) out = out.replace(at, `@图片${n}${name}`)
    else {
      // 中文没有词边界：前一个字不是 @ 或数字（@图片2名字）就算提到
      const plain = new RegExp(`(^|[^@\\d])${esc}`, 'u')
      out = out.replace(plain, (_m, pre: string) => `${pre}@图片${n}${name}`)
    }
  }
  return out.replace(/@(?!图片\d)(\S{1,20}?)(?=[\s，。,.：:；;、！!？?」"）)]|$)/gu, '$1')
}

function clip(text: string | null | undefined, max: number): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** 参考图说明一行：图片1=林小雨（角色设定图），图片2=咖啡馆（场景设定图）… */
export function referenceLegend(refs: RefImage[], zh: boolean, offset = 0): string {
  if (!refs.length) return ''
  const kind = (t: RefImage['type']) => zh
    ? ({ character: '角色设定图', scene: '场景设定图', prop: '道具设定图', asset: '参考图' } as const)[t]
    : ({ character: 'character sheet', scene: 'location sheet', prop: 'prop sheet', asset: 'reference' } as const)[t]
  const items = refs.map((r, i) => zh ? `图片${i + 1 + offset}=${r.label}（${kind(r.type)}）` : `image ${i + 1 + offset} = ${r.label} (${kind(r.type)})`)
  return zh ? `【参考图】${items.join('，')}。人物长相、服装、场景布局与对应参考图保持一致。` : `[References] ${items.join(', ')}. Keep faces, outfits and layouts identical to the matching reference.`
}

/** 外观锁定（关键帧 / 设定图用）：每个出场设定一行 */
export function appearanceLock(entries: BibleEntry[], zh: boolean): string {
  const rows = entries
    .filter(e => e.description || e.styling)
    .map(e => `${e.name}${zh ? '：' : ': '}${[clip(e.description, 160), clip(e.styling, 100)].filter(Boolean).join(zh ? '；' : '; ')}`)
  if (!rows.length) return ''
  return zh ? `【外观锁定】\n${rows.join('\n')}` : `[Appearance lock]\n${rows.join('\n')}`
}

export type ImagePurpose = 'keyframe' | 'character' | 'scene' | 'prop' | 'free'

const SHEET_HINT: Record<'character' | 'scene' | 'prop', { zh: string; en: string }> = {
  character: {
    zh: '角色设定图：单人全身正面站姿，干净纯色浅灰背景，光线均匀柔和，五官、发型、服装细节清楚，不要文字和水印。',
    en: 'Character sheet: one person, full body, front view, plain light-grey background, even soft light, clear face, hair and outfit details, no text or watermark.',
  },
  scene: {
    zh: '场景设定图：空镜，不出现人物，交代空间布局、主要陈设、门窗位置与光线方向，不要文字。',
    en: 'Location sheet: empty set without people, showing layout, key furniture, doors / windows and light direction, no text.',
  },
  prop: {
    zh: '道具设定图：单个物件居中，干净纯色背景，材质与细节清楚，不要文字。',
    en: 'Prop sheet: single object centered on a plain background, clear material and details, no text.',
  },
}

const QUALITY_IMG_ZH = '高细节，高清晰度。'
const QUALITY_IMG_EN = 'Highly detailed, sharp focus.'

/** 生图提示词：画风基调 + 正文 + 参考图说明 + 外观锁定（+ 设定图要求） */
export function buildImagePrompt(input: {
  prompt: string
  bible: StudioBible
  purpose: ImagePurpose
  refs: RefImage[]
  entries: BibleEntry[]
}): string {
  const zh = isChinesePrompt(input.prompt) || isChinesePrompt(input.bible.style)
  const body = tagReferences(input.prompt.trim(), input.refs)
  const parts: string[] = []
  if (input.bible.style) parts.push(zh ? `【画风】${input.bible.style}` : `[Style] ${input.bible.style}`)
  parts.push(body)
  if (input.purpose === 'character' || input.purpose === 'scene' || input.purpose === 'prop') {
    parts.push(zh ? SHEET_HINT[input.purpose].zh : SHEET_HINT[input.purpose].en)
  }
  const legend = referenceLegend(input.refs, zh)
  if (legend) parts.push(legend)
  const lock = appearanceLock(input.entries, zh)
  if (lock) parts.push(lock)
  parts.push(zh ? QUALITY_IMG_ZH : QUALITY_IMG_EN)
  return parts.filter(Boolean).join('\n')
}

/** 视频提示词：画风基调 + 正文（@图片N）+ 参考图说明 + 导演指令（台词控制 / 外观锁定 / 场景一致 / 画风一致 / 画质 / 物理真实） */
export function buildVideoPrompt(input: {
  prompt: string
  bible: StudioBible
  refs: RefImage[]
  entries: BibleEntry[]
  duration: number
  /** 首帧来自上一镜结尾帧 */
  continued?: boolean
  /** 接口限制了提示词长度：导演指令用精简版 */
  compact?: boolean
  /** 视频有声音时才写【台词控制】 */
  audio?: boolean
  /** 有首帧（关键帧 / 接戏帧）：多数接口这时只收首帧、不收参考图，提示词不写 @图片N，改成以首帧为准 */
  firstFrame?: boolean
}): string {
  const zh = isChinesePrompt(input.prompt) || isChinesePrompt(input.bible.style)
  const body = input.firstFrame ? input.prompt.trim() : tagReferences(input.prompt.trim(), input.refs)
  const parts: string[] = []
  if (input.bible.style) parts.push(zh ? `【画风】${clip(input.bible.style, input.compact ? 160 : 400)}` : `[Style] ${clip(input.bible.style, input.compact ? 240 : 600)}`)
  parts.push(body)
  if (input.firstFrame && !input.continued) {
    parts.push(zh
      ? '【首帧】首帧是本镜关键帧（已按角色 / 场景设定图绘制）：人物长相、服装、场景布局、画风与首帧保持一致，只让画面动起来，不重画、不换人。'
      : '[First frame] The first frame is this shot\'s keyframe (drawn from the character / location sheets): keep faces, outfits, layout and style exactly as in it; only animate, never redraw or recast.')
  } else if (!input.firstFrame) {
    const legend = referenceLegend(input.refs, zh)
    if (legend) parts.push(legend)
  }
  if (input.continued) {
    parts.push(zh
      ? '【接上一镜】首帧就是上一镜的最后一帧：人物位置、姿态、服装、光线从这一帧自然延续，不跳变。'
      : '[Continuity] The first frame is the last frame of the previous shot: positions, poses, outfits and light continue from it without jumps.')
  }
  const characters = input.entries.filter(e => e.type === 'character').map(e => ({ name: e.name, appearance: e.description, styling: e.styling }))
  const scene = input.entries.find(e => e.type === 'scene')
  const directives = buildShotDirectives({
    description: input.prompt,
    duration: input.duration,
    characters,
    sceneName: scene?.name || null,
    prompt: body,
    hasStylePreset: !!input.bible.style,
    compact: !!input.compact,
    options: {
      dialogueLock: input.audio !== false,
      appearanceLock: true,
      continuity: false,
      physicsLock: true,
      qualityLock: true,
      cinematicLock: false,
    },
  })
  if (directives) parts.push(directives)
  return parts.filter(Boolean).join('\n\n')
}

export interface FirstFramePlan {
  /** 作首帧的图片路径（null = 不用首帧） */
  firstFrame: string | null
  /** 改作参考图的接戏帧 */
  referenceFrame: string | null
  /** 这段视频的接戏代数（首帧取自上一段视频结尾帧时 = 上一段 + 1） */
  chainDepth: number
  continued: boolean
  note: string
}

/**
 * 首帧怎么用：
 * - 首帧是图片（关键帧）：直接用，接戏代数 0
 * - 首帧是视频（接上一镜）：取结尾帧；接戏代数 = 那段视频的代数 + 1，超过上限改作第 1 张参考图（不当首帧，画质不再逐代劣化）
 */
export function planFirstFrame(input: {
  image?: string | null
  fromVideo?: { endFrame: string | null; chainDepth: number } | null
  max?: number
}): FirstFramePlan {
  const max = input.max ?? MAX_FIRST_FRAME_GENERATIONS
  if (input.fromVideo) {
    const end = input.fromVideo.endFrame
    if (!end) return { firstFrame: input.image || null, referenceFrame: null, chainDepth: 0, continued: false, note: '上一段视频没有结尾帧，没有接上' }
    const depth = input.fromVideo.chainDepth + 1
    if (depth > max) {
      return {
        firstFrame: input.image || null,
        referenceFrame: end,
        chainDepth: 0,
        continued: false,
        note: `已经连续接了 ${input.fromVideo.chainDepth} 代首帧，这次把上一镜结尾帧改作参考图（再当首帧会越接越糊、越来越艳）`,
      }
    }
    return { firstFrame: end, referenceFrame: null, chainDepth: depth, continued: true, note: '' }
  }
  return { firstFrame: input.image || null, referenceFrame: null, chainDepth: 0, continued: false, note: '' }
}

/** 画幅 → 生图尺寸 */
export function imageSizeFor(ratio: string): string {
  switch (ratio) {
    case '9:16': return '1080x1920'
    case '1:1': return '1024x1024'
    case '4:3': return '1440x1080'
    case '3:4': return '1080x1440'
    case '21:9': return '2520x1080'
    default: return '1920x1080'
  }
}

/** 给模型看的设定摘要（每轮放进上下文） */
export function bibleDigest(bible: StudioBible): string {
  const lines: string[] = []
  lines.push(`画风基调：${bible.style ? clip(bible.style, 300) : '（未设定，第一次出图前用 set_look 定下来）'}`)
  if (!bible.entries.length) lines.push('设定：（还没有角色 / 场景 / 道具设定图）')
  for (const e of bible.entries) {
    const t = { character: '角色', scene: '场景', prop: '道具' }[e.type]
    lines.push(`- ${t}「${e.name}」${e.asset_id ? `设定图 #${e.asset_id}` : '（还没有设定图）'}：${clip([e.description, e.styling].filter(Boolean).join('；'), 160)}`)
  }
  return lines.join('\n')
}
