/**
 * 镜头导演指令：解决 AI 视频「补台词胡言乱语」「人物 / 场景 / 画风飘」「不接戏」三类问题
 *
 * 1. 台词计时：从分镜 description 里解析台词 / 旁白，按语速估算说话时长；
 *    生成视频时附加【台词控制】——只许说这几句、逐字一致、说完闭嘴，空余时间明确写成「无人说话」，
 *    不让视频模型自己补台词；拆分镜时按台词时长校正段落时长。
 * 2. 一致性锁定：附加【人物外观锁定】（参考图 + 外观 / 服装文字）、【场景一致】、【画风一致】。
 * 3. 接戏：附加【人物站位】（分镜 blocking 字段）与【接上一镜】（同场景上一镜的结尾状态 / 结尾画面，
 *    遵守 180 度轴线，人物左右位置不变）。
 *
 * 文字语言跟随视频提示词：含中文用中文指令，否则用英文指令（视频模型都能读懂英文）。
 */

export interface DialogueLine {
  /** dialogue = 角色台词；narration = 旁白（画外音）；system = 系统流的「系统」（画外电子音，开启系统音时才会出现） */
  kind: 'dialogue' | 'narration' | 'system'
  speaker: string
  text: string
  /** 估算说话秒数 */
  seconds: number
}

export interface DialoguePlan {
  lines: DialogueLine[]
  /** 台词本身的说话时长合计 */
  speechSeconds: number
  /** 完整演完需要的时长（开场 + 台词 + 换人停顿 + 收尾） */
  neededSeconds: number
}

// 语速：中日韩按 4.5 字 / 秒（偏慢，留出表演），拉丁文按 2.5 词 / 秒
const CJK_CHARS_PER_SECOND = 4.5
const LATIN_WORDS_PER_SECOND = 2.5
const MIN_LINE_SECONDS = 0.8
const LEAD_SECONDS = 0.5
const TAIL_SECONDS = 1
const SAME_SPEAKER_GAP = 0.4
const TURN_GAP = 0.8
/** 有台词的分镜里允许的「无人说话」秒数；超过就容易被模型补台词 */
export const MAX_IDLE_SECONDS = 3

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/g
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g
const QUOTE_PAIRS: Record<string, string> = { '\u300c': '\u300d', '\u300e': '\u300f', '\u201c': '\u201d', '"': '"' }
const QUOTE_OPEN = Object.keys(QUOTE_PAIRS).join('')
/** 说话动词 / 标记（中英日韩） */
const SPEECH_MARKER_RE = /(说|說|道|问|問|答|喊|叫|吼|念|嘀咕|低语|says?|said|asks?|asked|replies|replied|shouts?|whispers?|言う|言った|話す|叫ぶ|囁く|말한다|말했다|외친다|묻는다|속삭인다)\s*[:：]?\s*$/i
const COLON_END_RE = /[:：]\s*$/
const NARRATION_RE = /^(旁白|画外音|旁述|narration|narrator|voice-?over|v\.o\.|ナレーション|내레이션)\s*$/i
const NARRATION_INLINE_RE = /(旁白|画外音|narration|narrator|voice-?over|ナレーション|내레이션)\s*[:：]\s*([^\n【]+)/gi
const CLAUSE_BREAK_RE = /[。！？!?；;，,\n】\]]/

/** 剧本里系统说话的常见叫法 */
export const COMMON_SYSTEM_NAMES = ['系统', '系统音', '系统提示', '系统提示音', '系统播报', '系统声音', 'System']

/** 开启系统音时，代表系统说话的名字（自定义名在内，长的在前）；没开返回 [] */
export function systemNamesFor(sv: { enabled?: boolean; name?: string } | null | undefined): string[] {
  if (!sv?.enabled) return []
  return [...new Set([sv.name || '', ...COMMON_SYSTEM_NAMES].filter(Boolean))].sort((a, b) => b.length - a.length)
}

/** 说话人是不是系统（「神豪系统」「系统冷冷地」都算） */
export function isSystemSpeaker(speaker: string | null | undefined, names: string[]): boolean {
  const s = String(speaker || '').trim()
  if (!s || !names.length) return false
  return names.some((n) => s === n || s.startsWith(n) || (n.length >= 2 && s.includes(n)))
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** 一句话的说话秒数 */
export function speechSeconds(text: string): number {
  const cjk = (text.match(CJK_RE) || []).length
  const words = (text.match(LATIN_WORD_RE) || []).length
  const strongPauses = (text.match(/[。！？!?…]/g) || []).length
  const softPauses = (text.match(/[，,、；;]/g) || []).length
  const raw = cjk / CJK_CHARS_PER_SECOND + words / LATIN_WORDS_PER_SECOND + strongPauses * 0.25 + softPauses * 0.12
  return Math.round(Math.max(MIN_LINE_SECONDS, raw) * 10) / 10
}

function cleanSpeaker(raw: string, knownNames: string[]): string {
  const text = raw.replace(/[\s*#>\-·•]+/g, ' ').trim()
  // 优先匹配已知角色名（取最长，避免「小明」命中「小明月」）
  const hits = knownNames.filter((n) => n && text.includes(n)).sort((a, b) => b.length - a.length)
  if (hits.length) return hits[0]
  return text
    .replace(SPEECH_MARKER_RE, '')
    .replace(/(对|對|向|朝)\S{0,8}$/, '')
    .replace(/(低声|轻声|小声|大声|冷冷地|笑着|哭着|愤怒地|平静地|压低声音|冷笑|苦笑)+$/, '')
    .replace(/(は|が|이|가|은|는)$/, '')
    .replace(/[:：]$/, '')
    .trim()
    .slice(-12)
}

/**
 * 从分镜描述中按出现顺序解析台词与旁白。
 * 支持：小明说：「…」 / 小明：「…」 / Ming says: "…" / 小明は言う：「…」 / 小明이 말한다: 「…」 / 旁白：… / Narration: …
 */
export function parseShotDialogue(
  description: string | null | undefined,
  knownNames: string[] = [],
  opts: { systemNames?: string[]; systemLabel?: string } = {},
): DialogueLine[] {
  const text = String(description || '')
  if (!text.trim()) return []
  const found: Array<DialogueLine & { at: number }> = []
  const systemNames = (opts.systemNames || []).filter(Boolean)
  const systemLabel = opts.systemLabel || systemNames[0] || ''
  // 系统名也当作已知说话人（「系统播报：「…」」取到「系统」）
  if (systemNames.length) knownNames = [...knownNames, ...systemNames]
  const covered: Array<[number, number]> = []

  // 1. 引号台词：引号前（同一分句内）必须有说话标记或冒号
  for (let i = 0; i < text.length; i++) {
    const open = text[i]
    if (!QUOTE_OPEN.includes(open)) continue
    const close = QUOTE_PAIRS[open]
    const end = text.indexOf(close, i + 1)
    if (end < 0) break
    const quote = text.slice(i + 1, end).trim()
    // 往前取到分句边界
    let start = i
    while (start > 0 && !CLAUSE_BREAK_RE.test(text[start - 1]) && i - start < 40) start--
    const before = text.slice(start, i)
    if (quote && (SPEECH_MARKER_RE.test(before) || COLON_END_RE.test(before))) {
      const label = before.replace(/[:：]\s*$/, '').trim()
      const isNarration = NARRATION_RE.test(label)
      let speaker = isNarration ? '' : cleanSpeaker(label, knownNames)
      // 「小红坐下，笑着说：…」：说话人在前一个分句里——在同一句（到句号 / 换行 / 【 为止）往前找最近的已知角色名
      if (!isNarration && !knownNames.includes(speaker)) {
        let s = i
        while (s > 0 && !/[。！？!?\n【]/.test(text[s - 1]) && i - s < 120) s--
        const sentence = text.slice(s, i)
        let best = ''
        let bestAt = -1
        for (const name of knownNames) {
          if (!name) continue
          const at = sentence.lastIndexOf(name)
          if (at > bestAt || (at === bestAt && name.length > best.length)) { best = name; bestAt = at }
        }
        if (best && bestAt >= 0) speaker = best
      }
      const isSystem = !isNarration && isSystemSpeaker(speaker, systemNames)
      found.push({
        at: i,
        kind: isNarration ? 'narration' : isSystem ? 'system' : 'dialogue',
        speaker: isSystem ? systemLabel : speaker,
        text: quote,
        seconds: speechSeconds(quote),
      })
      covered.push([start, end])
    }
    i = end
  }

  // 1b. 系统流常见的不带引号写法：【系统：……】【叮！……】 / 系统播报：……（只在开启系统音时识别）
  if (systemNames.length) {
    const inQuote = (at: number) => covered.some(([a, b]) => at >= a && at <= b)
    const alt = systemNames.map(escapeRe).join('|')
    const push = (at: number, raw: string) => {
      const line = raw.trim().replace(/^[「『“"]|[」』”"]$/g, '').replace(/[。.]+$/, '').trim()
      if (line && !inQuote(at)) found.push({ at, kind: 'system', speaker: systemLabel, text: line, seconds: speechSeconds(line) })
    }
    for (const m of text.matchAll(new RegExp(`【\\s*(?:${alt})[^【】:：]{0,6}[:：]([^【】]+)】`, 'g'))) push(m.index ?? 0, m[1])
    for (const m of text.matchAll(/【\s*(叮[^【】]+)】/g)) push(m.index ?? 0, m[1])
    for (const m of text.matchAll(new RegExp(`(?:^|[\\s。！？!?；;，,】])(?:${alt})(?:播报|提示音?|音|声音)?\\s*[:：]\\s*([^\\n【「『“"][^\\n【]*)`, 'g'))) {
      push((m.index ?? 0) + 1, m[1])
    }
  }

  // 2. 不带引号的旁白：旁白：内容（带引号的已在上一步处理）
  for (const m of text.matchAll(NARRATION_INLINE_RE)) {
    const content = m[2].trim()
    if (!content || QUOTE_OPEN.includes(content[0])) continue
    const line = content.replace(/[。.]+$/, '').trim()
    if (line) found.push({ at: m.index ?? 0, kind: 'narration', speaker: '', text: line, seconds: speechSeconds(line) })
  }

  return found.sort((a, b) => a.at - b.at).map(({ at: _at, ...line }) => line)
}

/** 演完这些台词需要的时长：开场 0.5 秒 + 台词 + 同人停顿 0.4 / 换人停顿 0.8 + 收尾 1 秒 */
export function planDialogue(lines: DialogueLine[]): DialoguePlan {
  if (!lines.length) return { lines, speechSeconds: 0, neededSeconds: 0 }
  let speech = 0
  let gaps = 0
  lines.forEach((line, i) => {
    speech += line.seconds
    if (i > 0) gaps += line.speaker === lines[i - 1].speaker ? SAME_SPEAKER_GAP : TURN_GAP
  })
  const needed = LEAD_SECONDS + speech + gaps + TAIL_SECONDS
  return { lines, speechSeconds: Math.round(speech * 10) / 10, neededSeconds: Math.round(needed * 10) / 10 }
}

/** 按台词推荐的分镜时长（整秒，3~15）；没有台词返回 null */
export function recommendShotDuration(description: string | null | undefined, knownNames: string[] = []): number | null {
  const plan = planDialogue(parseShotDialogue(description, knownNames))
  if (!plan.lines.length) return null
  return Math.min(15, Math.max(3, Math.ceil(plan.neededSeconds)))
}

/** 时长与台词的匹配情况：too_short 演不完；too_long 空余时间过多，模型容易补台词 */
export function checkShotTiming(description: string | null | undefined, duration: number, knownNames: string[] = []) {
  const plan = planDialogue(parseShotDialogue(description, knownNames))
  const idle = Math.round((duration - plan.neededSeconds) * 10) / 10
  const status: 'ok' | 'too_short' | 'too_long' | 'silent' = !plan.lines.length
    ? 'silent'
    : idle < -0.5 ? 'too_short' : idle > MAX_IDLE_SECONDS ? 'too_long' : 'ok'
  return { ...plan, duration, idleSeconds: idle, status, recommended: plan.lines.length ? Math.min(15, Math.max(3, Math.ceil(plan.neededSeconds))) : null }
}

export function isChinesePrompt(text: string | null | undefined): boolean {
  const s = String(text || '')
  const han = (s.match(/[一-鿿]/g) || []).length
  const kana = (s.match(/[぀-ヿ]/g) || []).length
  const hangul = (s.match(/[가-힯]/g) || []).length
  return han > 0 && han >= (kana + hangul) * 2
}

/** 视频提示词里已有的 @图片N名字 → 名字 → 引用标记，指令里沿用同一个标记 */
export function collectRefTokens(prompt: string | null | undefined, names: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const text = String(prompt || '')
  for (const name of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = text.match(new RegExp(`@图片(\\d+)${escaped}`))
    if (m) out[name] = `@图片${m[1]}${name}`
    else if (new RegExp(`@${escaped}`).test(text)) out[name] = `@${name}`
  }
  return out
}

export interface ShotCharacter {
  name: string
  appearance?: string | null
  styling?: string | null
}

export interface ShotDirectionInput {
  /** 当前分镜 */
  description?: string | null
  duration: number
  blocking?: string | null
  characters: ShotCharacter[]
  sceneName?: string | null
  /** 同场景的上一镜（不同场景时不传） */
  previous?: { number: number; blocking?: string | null; description?: string | null } | null
  /** 上一镜结尾画面怎么用：first_frame = 作为首帧；reference = 作为第 index 张参考图 */
  previousFrame?: { mode: 'first_frame' | 'reference'; index?: number } | null
  /** 已经解析好 @图片N 的视频提示词（用来沿用引用标记、判断语言） */
  prompt: string
  hasStylePreset?: boolean
  options: { dialogueLock?: boolean; appearanceLock?: boolean; continuity?: boolean; physicsLock?: boolean }
  /**
   * 精简版：视频接口限制了提示词长度（如 Grok 4096 字节）时用，同样的约束写得更短（约一半），
   * 免得提交时为了凑长度整块去掉【接上一镜】【画风一致】等
   */
  compact?: boolean
  /** 系统音（系统流）：开启时分镜里系统的台词按画外电子音处理 */
  systemVoice?: { enabled: boolean; name: string; voice: string; chime: string; panel: boolean } | null
}

/** 系统音说明（本镜有系统台词时附加） */
function systemVoiceBlock(sv: NonNullable<ShotDirectionInput['systemVoice']>, zh: boolean): string {
  return zh
    ? `【系统音】${sv.name === '系统' ? '系统是主角绑定的金手指' : `${sv.name}是主角绑定的系统`}，只有声音、不在画面里：${sv.name}每次开口前先响起${sv.chime}，声音为${sv.voice}，清晰响亮、不被环境音盖住；${sv.name}说话时画面中任何人都不动嘴，主角做出听到${sv.name}声音的反应（愣住、眼神变化、微微侧头）。${sv.panel ? `${sv.name}说话时主角面前浮现半透明蓝色全息系统面板，只有科幻光效与图标，面板上不出现任何文字。` : ''}`
    : `[System voice] ${sv.name} is the system bound to the protagonist — a voice only, never on screen. Every time it speaks, ${sv.chime} plays first, then a clear, prominent ${sv.voice} that is not buried under ambient sound. Nobody on screen moves their lips while ${sv.name} speaks; the protagonist reacts to hearing it (pauses, eyes shift, head tilts).${sv.panel ? ' A translucent blue holographic system panel appears in front of the protagonist while it speaks: sci-fi light effects and icons only, no text.' : ''}`
}

function clip(text: string | null | undefined, max: number): string {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** 从站位说明里取「结尾」部分（没有明确结尾就整段） */
function endState(blocking: string | null | undefined): string {
  const s = String(blocking || '').trim()
  if (!s) return ''
  const m = s.match(/(结尾|收尾|结束时|最后|ending|end state|at the end)[^:：]{0,6}[:：]\s*([\s\S]+)/i)
  return clip(m ? m[2] : s, 160)
}

export const PHYSICS_ZH = '【物理真实】动作符合真实物理：重力向下，脚踩实地面、重心稳定，走路不滑步、不漂浮；手接触物体时真实抓握、受力，物体不穿过身体或彼此穿插，不凭空出现、消失或变形；人物肢体数量和比例始终正常，手指完整；动作速度自然连贯，不瞬移、不倒放、不突然加速；头发、衣摆、液体随动作和重力自然摆动。'
export const PHYSICS_EN = '[Physics] Motion obeys real physics: gravity pulls down, feet stay planted with stable balance, no sliding or floating while walking; hands really grip and push objects, nothing passes through bodies or other objects, nothing appears, vanishes or morphs; limbs and fingers stay complete and correctly proportioned; movement is smooth at natural speed, no teleporting, reversing or sudden speed-ups; hair, clothing and liquids move naturally with motion and gravity.'
export const PHYSICS_ZH_COMPACT = '【物理真实】符合重力与受力：脚踩实地，不漂浮、不滑步；手真实抓握，物体不穿模、不凭空出现或变形；肢体手指完整，动作速度自然。'
export const PHYSICS_EN_COMPACT = '[Physics] Real gravity and contact: feet planted, no floating or sliding; hands really grip; nothing clips through, appears from nowhere or morphs; limbs and fingers intact; natural speed.'

/** 精简版【台词控制】：约束不变（只说这几句、逐字、不加词、其余时间闭嘴），说明写短 */
function compactDialogueBlock(plan: ReturnType<typeof planDialogue>, duration: number, zh: boolean, ref: (name: string) => string): string {
  if (!plan.lines.length) {
    return zh ? '【台词控制】本段没有台词和旁白：全程无人开口、不做说话口型。' : '[Dialogue control] No dialogue or narration: nobody speaks or moves their lips.'
  }
  const list = plan.lines.map((l, i) => {
    const who = l.kind === 'narration'
      ? (zh ? '旁白（画外音）' : 'Narration (V.O.)')
      : l.kind === 'system'
        ? (zh ? `${l.speaker}（画外电子音）` : `${l.speaker} (off-screen synthetic voice)`)
        : ref(l.speaker || (zh ? '角色' : 'Character'))
    return zh ? `${i + 1}. ${who}：「${l.text}」` : `${i + 1}. ${who}: "${l.text}"`
  })
  const hasNarration = plan.lines.some((l) => l.kind === 'narration')
  return zh
    ? [`【台词控制】本段 ${duration} 秒只有这 ${plan.lines.length} 句，按顺序各说一次、逐字一致，不加、不改、不重复：`, ...list,
      `其余时间无人说话，不说话的人闭嘴，用倾听、对视、停顿填满。${hasNarration ? '旁白时画面人物不动嘴。' : ''}`].join('\n')
    : [`[Dialogue control] This ${duration}s shot has ONLY these ${plan.lines.length} line(s), each said once, in order, word for word; add or change nothing:`, ...list,
      `Otherwise nobody speaks; listeners keep their mouths closed and react with looks and pauses.${hasNarration ? ' No lip movement during narration.' : ''}`].join('\n')
}

/** 生成附加在视频提示词后面的导演指令（没有可加的内容时返回 ''） */
export function buildShotDirectives(input: ShotDirectionInput): string {
  const zh = isChinesePrompt(input.prompt) || (!input.prompt && isChinesePrompt(input.description))
  const names = input.characters.map((c) => c.name).filter(Boolean)
  const tokens = collectRefTokens(input.prompt, [...names, input.sceneName || ''])
  const ref = (name: string) => tokens[name] || name
  const blocks: string[] = []
  const duration = Math.max(1, Math.round(input.duration || 0))
  const sv = input.systemVoice?.enabled ? input.systemVoice : null
  const sysNames = systemNamesFor(sv)
  const allLines = parseShotDialogue(input.description, names, { systemNames: sysNames, systemLabel: sv?.name })

  const compact = input.compact === true

  // ── 台词控制 ──
  if (input.options.dialogueLock !== false) {
    const plan = planDialogue(allLines)
    if (compact) {
      blocks.push(compactDialogueBlock(plan, duration, zh, ref))
    } else if (!plan.lines.length) {
      blocks.push(zh
        ? '【台词控制】本段没有任何台词和旁白：所有人物全程不开口说话、不做说话口型，只有动作、表情与环境音。'
        : '[Dialogue control] This shot has NO dialogue and NO narration: nobody speaks or moves their lips at any time; only actions, expressions and ambient sound.')
    } else {
      const idle = Math.max(0, Math.round((duration - plan.speechSeconds) * 10) / 10)
      const list = plan.lines.map((l, i) => {
        const who = l.kind === 'narration'
          ? (zh ? '旁白（画外音）' : 'Narration (voice-over)')
          : l.kind === 'system'
            ? (zh ? `${l.speaker}（画外电子音）` : `${l.speaker} (off-screen synthetic voice)`)
            : ref(l.speaker || (zh ? '角色' : 'Character'))
        return zh ? `${i + 1}. ${who}：「${l.text}」（约 ${l.seconds} 秒）` : `${i + 1}. ${who}: "${l.text}" (~${l.seconds}s)`
      })
      const hasNarration = plan.lines.some((l) => l.kind === 'narration')
      blocks.push(zh
        ? [
          `【台词控制】本段共 ${duration} 秒，只有以下 ${plan.lines.length} 句话（合计约 ${plan.speechSeconds} 秒），必须按顺序各说一次、逐字一致；不得增加、改写、重复或补充任何台词，不得出现无意义的说话声：`,
          ...list,
          `其余约 ${idle} 秒没有任何人说话：没在说话的人物闭嘴、嘴唇不动，用倾听、对视、点头、呼吸、停顿等表情与动作填满，只保留环境音。每句之间留短暂停顿，说话人与听者轮流反应，不要抢话、不要叠在一起说。`,
          ...(hasNarration ? ['旁白是画外音，不是画面中任何人说的：念旁白时画面人物不动嘴。'] : []),
          ...(plan.neededSeconds > duration + 0.5 ? ['台词较满：语速自然偏快，但必须完整说完。'] : []),
        ].join('\n')
        : [
          `[Dialogue control] This ${duration}s shot contains ONLY the following ${plan.lines.length} line(s) (~${plan.speechSeconds}s in total). Say each exactly once, in order, word for word. Do not add, rephrase, repeat or improvise any speech, and no gibberish:`,
          ...list,
          `For the remaining ~${idle}s nobody speaks: characters who are not talking keep their mouths closed and fill the time with listening, eye contact, nods, breathing and pauses; ambient sound only. Leave a short beat between lines and let speaker and listener react in turn — no overlapping speech.`,
          ...(hasNarration ? ['Narration is an off-screen voice-over: no on-screen character moves their lips during it.'] : []),
          ...(plan.neededSeconds > duration + 0.5 ? ['The lines are tight: speak slightly faster but finish every line.'] : []),
        ].join('\n'))
    }
  }

  // ── 系统音 ──
  if (sv && allLines.some((l) => l.kind === 'system')) blocks.push(systemVoiceBlock(sv, zh))

  // ── 人物外观 / 场景 / 画风 一致 ──
  if (input.options.appearanceLock !== false) {
    const chars = input.characters.filter((c) => c.name && !(sv && sysNames.includes(c.name)))
    if (chars.length && compact) {
      const rows = chars.map((c) => {
        const desc = [clip(c.appearance, 45), clip(c.styling, 35)].filter(Boolean).join(zh ? '；' : '; ')
        return desc ? `${ref(c.name)}${zh ? '：' : ': '}${desc}` : ref(c.name)
      })
      blocks.push(zh
        ? `【人物外观锁定】脸、发型、服装、体型与各自参考图一致，全片不变：\n${rows.join('\n')}`
        : `[Character lock] Face, hair, outfit and build match each reference image for the whole shot:\n${rows.join('\n')}`)
    } else if (chars.length) {
      const rows = chars.map((c) => {
        const desc = [clip(c.appearance, 90), clip(c.styling, 70)].filter(Boolean).join(zh ? '；' : '; ')
        return desc ? `${ref(c.name)}：${desc}` : ref(c.name)
      })
      blocks.push(zh
        ? `【人物外观锁定】以下人物的脸型五官、发型发色、服装配饰、体型与年龄必须与各自参考图完全一致，全片不变、不换装、不变脸：\n${rows.join('\n')}`
        : `[Character lock] Faces, hair, outfits, accessories, body type and age must match each character's reference image exactly and stay identical for the whole shot — no outfit or face changes:\n${rows.map((r) => r.replace('：', ': ')).join('\n')}`)
    }
    if (input.sceneName && compact) {
      blocks.push(zh
        ? `【场景一致】布局、陈设与光线以 ${ref(input.sceneName)} 为准。`
        : `[Scene lock] Layout, furniture and lighting follow ${ref(input.sceneName)}.`)
    } else if (input.sceneName) {
      blocks.push(zh
        ? `【场景一致】场景布局、陈设、门窗位置与光线方向以 ${ref(input.sceneName)} 为准，与同场景其他镜头保持一致。`
        : `[Scene lock] Layout, furniture, doors / windows and light direction follow ${ref(input.sceneName)} and match the other shots in this location.`)
    }
    if (compact) {
      blocks.push(zh
        ? '【画风一致】画风、色调与参考图一致，不换画风；画面清晰、细节丰富。'
        : '[Style lock] Same style and colors as the references, no style switch; sharp and detailed.')
    } else blocks.push(zh
      ? `【画风一致】${input.hasStylePreset ? '严格保持开头指定的画风，' : ''}画风、色调、光影质感与参考图一致，全片不得切换成其他画风（如写实 / 动漫 / 3D 互换）；画面清晰锐利、细节丰富，人物五官、发丝与服装面料纹理清楚，不要虚焦、涂抹感、磨皮或塑料感。`
      : `[Style lock] ${input.hasStylePreset ? 'Keep the style given at the start. ' : ''}Art style, color grading and lighting match the reference images; never switch styles (e.g. realistic ↔ anime ↔ 3D). Keep the image sharp and richly detailed — clear facial features, hair strands and fabric texture; no soft-focus blur, smeared detail, airbrushed or plastic look.`)
  }

  // ── 站位与接戏 ──
  if (input.options.continuity !== false) {
    const blocking = clip(input.blocking, compact ? 120 : 220)
    if (blocking) {
      blocks.push(zh ? `【人物站位】${blocking}` : `[Blocking] ${blocking}`)
    }
    if ((input.previous || input.previousFrame) && compact) {
      const prevEnd = clip(endState(input.previous?.blocking), 80)
      const lines: string[] = []
      if (input.previousFrame?.mode === 'first_frame') {
        lines.push(zh ? '从首帧（上一镜结尾画面）直接开始，站位、朝向、服装、光线与首帧一致。' : 'Start from the given first frame (last frame of the previous shot); same positions, facing, outfits and light.')
      } else if (input.previousFrame?.mode === 'reference') {
        const tag = `@图片${input.previousFrame.index || 1}`
        lines.push(zh ? `${tag} 是上一镜结尾画面：开场站位、朝向、服装、光线与它一致，人物左右关系不变。` : `${tag} is the previous shot's last frame: open with the same positions, facing, outfits and light; keep left/right order.`)
      }
      if (prevEnd) lines.push(zh ? `上一镜结尾：${prevEnd.replace(/[。.]?$/, '。')}` : `Previous shot ended: ${prevEnd.replace(/\.?$/, '.')}`)
      lines.push(zh ? '遵守 180 度轴线，人物不凭空消失或换位。' : 'Keep the 180-degree rule; nobody vanishes or swaps places.')
      blocks.push(zh ? `【接上一镜】${lines.join('')}` : `[Continuity] ${lines.join(' ')}`)
    } else if (input.previous || input.previousFrame) {
      const prevEnd = endState(input.previous?.blocking)
      const lines: string[] = []
      if (input.previousFrame?.mode === 'first_frame') {
        lines.push(zh
          ? '视频从给定的首帧（上一镜结尾画面）直接开始，开场人物站位、朝向、服装与光线和首帧完全一致，再开始本镜动作。'
          : 'Start directly from the given first frame (the last frame of the previous shot): opening positions, facing, outfits and lighting match it exactly, then begin this shot\'s action.')
      } else if (input.previousFrame?.mode === 'reference') {
        const tag = `@图片${input.previousFrame.index || 1}`
        lines.push(zh
          ? `${tag} 是上一镜的结尾画面：本镜开场的人物站位、朝向、服装、光线与它保持一致（可以换景别和机位，但不能改变人物左右关系）。`
          : `${tag} is the last frame of the previous shot: open with the same positions, facing, outfits and lighting (shot size and camera may change, the left/right arrangement may not).`)
      }
      if (prevEnd) lines.push(zh ? `上一镜结尾状态：${prevEnd.replace(/[。.]?$/, '。')}` : `End of previous shot: ${prevEnd.replace(/\.?$/, '.')}`)
      lines.push(zh
        ? '遵守 180 度轴线：同一场对话中人物在画面中的左右位置保持不变，视线方向连贯；不要让已出场人物凭空消失或换位置。'
        : 'Keep the 180-degree rule: characters stay on the same screen side through the conversation with consistent eyelines; nobody vanishes or swaps places.')
      blocks.push(zh ? `【接上一镜】${lines.join('')}` : `[Continuity] ${lines.join(' ')}`)
    }
  }

  // ── 物理真实：开源 / 量化 / 少步数的视频模型（如本地 MiniMax H3 小显存档）容易穿模、漂浮、变形 ──
  if (input.options.physicsLock !== false) {
    blocks.push(compact ? (zh ? PHYSICS_ZH_COMPACT : PHYSICS_EN_COMPACT) : (zh ? PHYSICS_ZH : PHYSICS_EN))
  }

  return blocks.join('\n')
}
