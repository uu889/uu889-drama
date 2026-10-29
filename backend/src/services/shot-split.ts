/**
 * 超过单镜上限的分镜按台词自动拆开
 *
 * 一个分镜就是一次视频生成，主流视频模型单次最多 15 秒（或视频配置 / 项目设置的单镜上限，见 shot-limits.ts maxShotSeconds）。
 * 拆分镜 Agent 虽然被要求「台词演不完就拆段」，但并不总听话（一段塞进 100 多字台词，要 27 秒才说得完）。
 * 这里在 Agent 拆完之后（routes/agent.ts）、批量写完视频提示词之后（video-prompts.ts），以及用户点「自动拆开」时
 * （POST /episodes/:id/split-long-shots）做确定性的兜底：
 *
 * 1. 按本镜真正要演的台词来源（视频提示词有台词用提示词，否则用分镜描述，与 shotDialogueLines 一致）切成小单元：
 *    「0-3秒：」时间分段行 →【镜头N】→ 换行 → 句子；单元里台词仍超过上限的，再按句号 / 逗号把这句台词断开，
 *    后面的写成「某某继续说：「…」」。
 * 2. 单元按顺序分组，每组台词（开场 + 台词 + 停顿 + 收尾，无台词单元按 2 秒）不超过上限，组数最少、各组尽量均匀。
 * 3. 每组成为一个分镜：时间分段重新从 0 秒排、【镜头N】重新编号；提示词开头的信息头 / 站位行与结尾的全局说明每段都保留；
 *    分镜描述按台词所在位置切开（找不到台词时用这一段的提示词改写成描述）。
 * 4. 第一段沿用原分镜（图片 / 首帧留在第一段，结尾帧移到最后一段），其余段落插在后面，后续分镜依次顺延编号；
 *    场景、角色、道具、站位、氛围、图片提示词都复制过去。
 *
 * 已有视频的分镜默认不拆（拆了视频就对不上），正在生成视频的分镜不拆。
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import { isChinesePrompt, parseShotDialogue, planDialogue, speechSeconds, systemNamesFor, type DialogueLine } from './shot-direction.js'
import { shotLimitsForEpisode } from './shot-limits.js'
import { getEpisodeSystemVoice } from './system-voice.js'

/** 没有台词的单元（动作 / 反应）在一段里大约占的秒数；分组时最少按 1 秒算（可以压缩），定时长时按 2 秒 */
const SILENT_UNIT_SECONDS = 2
const SILENT_FIT_SECONDS = 1
/** 开场 + 收尾（与 planDialogue 一致） */
const LEAD_TAIL_SECONDS = 1.5
/** 超过上限多少秒才拆（与时长提示一致） */
const OVER_TOLERANCE = 0.5

const QUOTE_PAIRS: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"' }
const OPEN_QUOTES = Object.keys(QUOTE_PAIRS)
const CLOSE_QUOTES = new Set(Object.values(QUOTE_PAIRS))

/** 「0-3秒：」「3秒：」「0s-3s:」「【0-3秒】」 */
const TIME_MARK_RE = /^\s*【?\s*\d+(?:\.\d+)?\s*(?:秒|s|S)?\s*(?:[-~～—–至到]\s*\d+(?:\.\d+)?\s*)?(?:秒|s|S|sec)\s*(?:】\s*[:：]?|[:：])\s*/
const SHOT_MARK_RE = /【镜头\s*\d+\s*】/g
/** 时间分段之后、不属于最后一段的全局说明行 */
const GLOBAL_LINE_RE = /^\s*(?:【|全程|整体|画风|风格|画质|字幕|音效|背景音乐|BGM|无字幕|竖屏|横屏|注意|要求|Style|Overall|No subtitles)/i

interface DialogueOpts { systemNames?: string[]; systemLabel?: string }

interface Unit {
  text: string
  lines: DialogueLine[]
}

interface Layout {
  kind: 'time' | 'shot' | 'line' | 'sentence'
  preamble: string
  trailer: string
  units: Unit[]
  /** 时间标记用「秒」还是 s */
  secondsLabel: '秒' | 's'
}

export interface ShotSplitPart {
  videoPrompt: string
  description: string
  duration: number
  /** 这一段演完需要的秒数（估算） */
  neededSeconds: number
}

export interface ShotSplitPlan {
  source: 'prompt' | 'description'
  neededSeconds: number
  maxSeconds: number
  parts: ShotSplitPart[]
}

/** 一组单元演完需要的秒数：台词按 planDialogue，没台词的单元每个 silentSeconds 秒 */
function groupCost(units: Unit[], silentSeconds = SILENT_FIT_SECONDS): number {
  const lines = units.flatMap((u) => u.lines)
  return (lines.length ? planDialogue(lines).neededSeconds : 0) + units.filter((u) => !u.lines.length).length * silentSeconds
}

/**
 * 按顺序分组，每组 cost ≤ cap：先贪心求出最少组数，再在不增加组数的前提下把阈值压到最低，让各组长短尽量均匀
 * （避免拆成 14 秒 + 3 秒）。单个元素本身超过 cap 时单独成组。
 */
function balancedGroups<T>(items: T[], cost: (group: T[]) => number, cap: number): T[][] {
  const run = (limit: number) => {
    const groups: T[][] = []
    let cur: T[] = []
    for (const it of items) {
      if (cur.length && cost([...cur, it]) > limit) {
        groups.push(cur)
        cur = []
      }
      cur.push(it)
    }
    if (cur.length) groups.push(cur)
    return groups
  }
  const best = run(cap)
  if (best.length <= 1) return best
  let lo = Math.max(...items.map((it) => cost([it])), 0)
  let hi = cap
  if (lo >= hi) return best
  let pick = best
  for (let i = 0; i < 24 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2
    const g = run(mid)
    if (g.length <= best.length) { pick = g; hi = mid } else lo = mid
  }
  return pick
}

/** 在引号外的句末（。！？；换行）或闭引号后切开；不含台词的小句并到下一句（动作 + 台词一起） */
function splitSentences(text: string): string[] {
  const pieces: string[] = []
  let depth: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const top = depth[depth.length - 1]
    if (top && ch === top) {
      depth.pop()
      if (!depth.length) {
        // 闭引号后紧跟的句末标点归到这一句
        let j = i + 1
        while (j < text.length && /[。！？!?；;…，,]/.test(text[j])) j++
        pieces.push(text.slice(start, j))
        start = j
        i = j - 1
      }
      continue
    }
    if (OPEN_QUOTES.includes(ch) && !(ch === '"' && top === '"')) {
      depth.push(QUOTE_PAIRS[ch])
      continue
    }
    if (!depth.length && /[。！？!?；;\n]/.test(ch)) {
      pieces.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) pieces.push(text.slice(start))
  if (depth.length) return [text]
  return pieces.filter((p) => p.trim())
}

/** 台词文字按句号 / 逗号 / 字数断成每块说话时长 ≤ limit 秒 */
function chunkSpeech(text: string, limit: number): string[] {
  const bySep = (s: string, re: RegExp) => s.split(re).filter((x) => x.trim())
  const atoms: string[] = []
  for (const sentence of bySep(text, /(?<=[。！？!?…；;]|\.\s)/)) {
    if (speechSeconds(sentence) <= limit) { atoms.push(sentence); continue }
    for (const clause of bySep(sentence, /(?<=[，,、])/)) {
      if (speechSeconds(clause) <= limit) { atoms.push(clause); continue }
      const n = Math.max(4, Math.floor(limit * 4.5 * 0.9))
      for (let i = 0; i < clause.length; i += n) atoms.push(clause.slice(i, i + n))
    }
  }
  return balancedGroups(atoms, (g) => speechSeconds(g.join('')), limit).map((g) => g.join('').trim())
}

function continuePrefix(line: DialogueLine, text: string, zh: boolean): string {
  if (line.kind === 'narration') return zh ? '旁白：' : 'Narration: '
  if (line.kind === 'system') return `${line.speaker}${zh ? '：' : ': '}`
  const name = line.speaker
  const ref = name && text.includes(`@${name}`) ? `@${name}` : name
  if (!ref) return zh ? '继续说：' : 'continues: '
  return zh ? `${ref}继续说：` : `${ref} continues: `
}

/** 一句台词太长：在台词内部断开，后面的块写成「某某继续说：「…」」 */
function splitQuoteUnit(unit: Unit, cap: number, names: string[], opts: DialogueOpts, zh: boolean): Unit[] | null {
  if (unit.lines.length !== 1) return null
  const line = unit.lines[0]
  const at = unit.text.indexOf(line.text)
  if (at < 0) return null
  const open = unit.text[at - 1]
  const close = QUOTE_PAIRS[open]
  const before = close ? unit.text.slice(0, at - 1) : unit.text.slice(0, at)
  const endAt = close ? unit.text.indexOf(close, at + line.text.length) : at + line.text.length - 1
  const after = endAt >= 0 ? unit.text.slice(endAt + 1) : ''
  const chunks = chunkSpeech(line.text, Math.max(1.5, cap - LEAD_TAIL_SECONDS))
  if (chunks.length < 2) return null
  const o = close ? open : zh ? '「' : '"'
  const c = close || (zh ? '」' : '"')
  const cont = continuePrefix(line, unit.text, zh)
  return chunks.map((chunk, i) => {
    const text = i === 0
      ? `${before}${o}${chunk}${c}`
      : `${cont}${o}${chunk}${c}${i === chunks.length - 1 ? after : ''}`
    const lines = parseShotDialogue(text, names, opts)
    return { text, lines: lines.length ? lines : [{ ...line, text: chunk, seconds: speechSeconds(chunk) }] }
  })
}

/** 单元本身超过上限：先按句子拆，还超就在台词内部断开 */
function explodeUnit(unit: Unit, cap: number, names: string[], opts: DialogueOpts, zh: boolean, depth = 0): Unit[] {
  if (groupCost([unit]) <= cap || depth > 3) return [unit]
  const sentences = splitSentences(unit.text)
  if (sentences.length > 1) {
    // 不含台词的小句并到下一句（结尾的并到上一句）
    const merged: string[] = []
    let pending = ''
    for (const s of sentences) {
      const text = pending + s
      if (!parseShotDialogue(s, names, opts).length) { pending = text; continue }
      merged.push(text)
      pending = ''
    }
    if (pending) merged.length ? (merged[merged.length - 1] += pending) : merged.push(pending)
    if (merged.length > 1) {
      return merged.flatMap((text) => explodeUnit({ text, lines: parseShotDialogue(text, names, opts) }, cap, names, opts, zh, depth + 1))
    }
  }
  return splitQuoteUnit(unit, cap, names, opts, zh) || [unit]
}

function toUnit(text: string, names: string[], opts: DialogueOpts): Unit {
  return { text, lines: parseShotDialogue(text, names, opts) }
}

/** 文本切成单元：时间分段行 >【镜头N】> 换行 > 句子 */
function layoutOf(text: string, names: string[], opts: DialogueOpts): Layout {
  const secondsLabel: Layout['secondsLabel'] = /\d\s*秒/.test(text) || isChinesePrompt(text) ? '秒' : 's'
  const rows = text.split('\n')
  const marked = rows.map((r, i) => (TIME_MARK_RE.test(r) ? i : -1)).filter((i) => i >= 0)
  if (marked.length >= 2) {
    let preamble = rows.slice(0, marked[0]).join('\n')
    const units: Unit[] = []
    if (parseShotDialogue(preamble, names, opts).length) {
      units.push(toUnit(preamble, names, opts))
      preamble = ''
    }
    const last = marked[marked.length - 1]
    let tailFrom = rows.length
    while (tailFrom - 1 > last && (GLOBAL_LINE_RE.test(rows[tailFrom - 1]) || !rows[tailFrom - 1].trim())) tailFrom--
    marked.forEach((from, k) => {
      const to = k + 1 < marked.length ? marked[k + 1] : tailFrom
      units.push(toUnit(rows.slice(from, to).join('\n').replace(/\n+$/, ''), names, opts))
    })
    return { kind: 'time', preamble, trailer: rows.slice(tailFrom).join('\n').trim(), units, secondsLabel }
  }
  const shotAt = [...text.matchAll(SHOT_MARK_RE)].map((m) => m.index ?? 0)
  if (shotAt.length >= 2) {
    let preamble = text.slice(0, shotAt[0])
    const units: Unit[] = []
    if (parseShotDialogue(preamble, names, opts).length) {
      units.push(toUnit(preamble, names, opts))
      preamble = ''
    }
    shotAt.forEach((from, k) => units.push(toUnit(text.slice(from, shotAt[k + 1] ?? text.length), names, opts)))
    return { kind: 'shot', preamble, trailer: '', units, secondsLabel }
  }
  const lines = rows.filter((r) => r.trim())
  if (lines.length >= 2) return { kind: 'line', preamble: '', trailer: '', units: lines.map((r) => toUnit(r, names, opts)), secondsLabel }
  return { kind: 'sentence', preamble: '', trailer: '', units: splitSentences(text).map((s) => toUnit(s, names, opts)), secondsLabel }
}

/** 【镜头N】从 1 重新编号 */
function renumberShots(text: string): string {
  let n = 0
  return text.replace(SHOT_MARK_RE, () => `【镜头${++n}】`)
}

function fmtSec(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/** 时间分段按每个单元的台词长短重新从 0 排到 duration */
function retime(units: Unit[], duration: number, label: Layout['secondsLabel']): string[] {
  const weights = units.map((u) => (u.lines.length ? u.lines.reduce((s, l) => s + l.seconds, 0) + 0.6 : SILENT_UNIT_SECONDS))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const fine = duration / units.length < 1.5
  let acc = 0
  let prev = 0
  return units.map((u, i) => {
    acc += weights[i]
    let end = i === units.length - 1 ? duration : (acc / total) * duration
    end = fine ? Math.round(end * 10) / 10 : Math.round(end)
    if (end <= prev) end = Math.min(duration, prev + (fine ? 0.5 : 1))
    const head = label === '秒' ? `${fmtSec(prev)}-${fmtSec(end)}秒：` : `${fmtSec(prev)}-${fmtSec(end)}s: `
    prev = end
    const [first, ...rest] = u.text.split('\n')
    return [head + first.replace(TIME_MARK_RE, '').trimStart(), ...rest].join('\n')
  })
}

function partDuration(cost: number, cap: number): number {
  return Math.min(cap, Math.max(Math.min(4, cap), Math.ceil(cost)))
}

function joinUnits(layout: Layout, texts: string[]): string {
  const sep = layout.kind === 'time' || layout.kind === 'line' ? '\n' : ''
  return [layout.preamble.replace(/\s+$/, ''), texts.join(sep).trim(), layout.trailer].filter((s) => s.trim()).join('\n')
}

/** 提示词单元改写成描述：去掉时间标记和 @ 引用符 */
function promptToDescription(units: Unit[]): string {
  return units
    .map((u) => u.text.split('\n').map((r) => r.replace(TIME_MARK_RE, '').replace(/@(?=[^\s@])/g, '').trim()).filter(Boolean).join(''))
    .join('')
}

function lineKey(line: DialogueLine): string {
  return line.text.replace(/\s+/g, ' ').trim().slice(0, 8)
}

/**
 * 分镜描述按各段第一句台词的位置切开（台词在描述里是原句，提示词里也是原句）。
 * 返回每段的描述；没有台词的段（除第一段）返回 null，由调用方用提示词改写。找不到台词返回 null。
 */
function cutDescription(desc: string, groups: Unit[][], zh: boolean): Array<string | null> | null {
  const cuts: Array<{ group: number; at: number; close?: string; prefix?: string }> = []
  let pos = 0
  let prevEnd = 0
  for (let g = 0; g < groups.length; g++) {
    const lines = groups[g].flatMap((u) => u.lines)
    lines.forEach((line, li) => {
      if (pos < 0) return
      const key = lineKey(line)
      const p = key ? desc.indexOf(key, pos) : -1
      if (p < 0) { pos = -1; return }
      if (li === 0 && g > 0) {
        const prevChar = desc[p - 1]
        if (OPEN_QUOTES.includes(prevChar)) {
          // 正常的一句新台词：切在说话人前面（同一个【镜头N】从镜头标记开始，否则从上一个句末 / 逗号之后）
          const q = p - 1
          const shot = desc.lastIndexOf('【镜头', q)
          let at: number
          if (shot >= prevEnd && shot > 0) at = shot
          else {
            at = prevEnd
            for (let i = q - 1; i >= prevEnd; i--) {
              if (/[。！？!?.\n」』”，,；;]/.test(desc[i])) { at = i + 1; break }
            }
          }
          cuts.push({ group: g, at })
        } else {
          // 同一句长台词的后半段：在台词中间切开，前一段补上闭引号，后一段补「某某继续说：「」
          let open = ''
          let openAt = -1
          for (const o of OPEN_QUOTES) {
            const k = desc.lastIndexOf(o, p)
            if (k > openAt) { openAt = k; open = o }
          }
          const close = open ? QUOTE_PAIRS[open] : ''
          const closedBetween = close && desc.indexOf(close, openAt + 1) >= 0 && desc.indexOf(close, openAt + 1) < p
          if (!open || closedBetween) cuts.push({ group: g, at: p })
          else cuts.push({ group: g, at: p, close, prefix: `${continuePrefix(line, desc, zh)}${open}` })
        }
      }
      const closeAt = OPEN_QUOTES.includes(desc[p - 1]) ? desc.indexOf(QUOTE_PAIRS[desc[p - 1]], p) : -1
      prevEnd = closeAt >= 0 ? closeAt + 1 : p + key.length
      pos = p + key.length
    })
    if (pos < 0) return null
  }
  if (cuts.some((c, i) => i > 0 && c.at < cuts[i - 1].at)) return null
  const out: Array<string | null> = groups.map(() => null)
  const shotAt = desc.search(SHOT_MARK_RE)
  const pre = shotAt > 0 ? desc.slice(0, shotAt) : ''
  const sharedPre = pre.trim() && !parseShotDialogue(pre).length ? pre : ''
  let from = 0
  let carry = ''
  const owners = [0, ...cuts.map((c) => c.group)]
  const bounds = [...cuts.map((c) => c.at), desc.length]
  owners.forEach((owner, i) => {
    let text = carry + desc.slice(from, bounds[i])
    const cut = cuts[i]
    if (cut?.close) text = text.replace(/\s+$/, '') + cut.close
    carry = cut?.prefix || ''
    from = bounds[i]
    if (i > 0 && sharedPre && !text.startsWith(sharedPre)) text = sharedPre + text
    out[owner] = renumberShots(text.trim())
  })
  return out
}

/**
 * 按单镜上限规划拆分：台词演完需要的时长不超过上限（+0.5 秒）时返回 null；拆不开（只有一句、断不开）也返回 null
 */
export function planShotSplit(input: {
  description?: string | null
  videoPrompt?: string | null
  names?: string[]
  maxSeconds: number
  systemNames?: string[]
  systemLabel?: string
}): ShotSplitPlan | null {
  const cap = Math.max(3, Number(input.maxSeconds) || 15)
  const names = input.names || []
  const opts: DialogueOpts = { systemNames: input.systemNames, systemLabel: input.systemLabel }
  const prompt = String(input.videoPrompt || '')
  const description = String(input.description || '')
  const promptLines = parseShotDialogue(prompt, names, opts)
  const source: ShotSplitPlan['source'] = promptLines.length ? 'prompt' : 'description'
  const text = source === 'prompt' ? prompt : description
  const lines = source === 'prompt' ? promptLines : parseShotDialogue(description, names, opts)
  if (!lines.length) return null
  const needed = planDialogue(lines).neededSeconds
  if (needed <= cap + OVER_TOLERANCE) return null

  const zh = isChinesePrompt(text) || /[一-鿿]/.test(text)
  const layout = layoutOf(text, names, opts)
  const units = layout.units.flatMap((u) => explodeUnit(u, cap, names, opts, zh))
  const groups = balancedGroups(units, groupCost, cap)
  if (groups.length < 2) return null

  const durations = groups.map((g) => partDuration(groupCost(g, SILENT_UNIT_SECONDS), cap))
  const texts = groups.map((g, i) => {
    const body = layout.kind === 'time' ? retime(g, durations[i], layout.secondsLabel) : g.map((u) => u.text)
    const joined = joinUnits(layout, body)
    return layout.kind === 'shot' ? renumberShots(joined) : joined
  })

  let descriptions: Array<string | null>
  if (source === 'description') descriptions = texts
  else descriptions = (description.trim() ? cutDescription(description, groups, zh) : null) || groups.map(() => null)
  return {
    source,
    neededSeconds: needed,
    maxSeconds: cap,
    parts: groups.map((g, i) => ({
      videoPrompt: source === 'prompt' ? texts[i] : '',
      description: descriptions[i] ?? promptToDescription(g),
      duration: durations[i],
      neededSeconds: Math.round(Math.min(cap, groupCost(g, SILENT_UNIT_SECONDS)) * 10) / 10,
    })),
  }
}

export interface SplitResult {
  max_seconds: number
  /** 拆开的分镜：原分镜号 → 拆成几段 */
  split: Array<{ storyboard_id: number; shot_number: number; parts: number; needed_seconds: number }>
  /** 超时但没拆的分镜及原因：has_video 已有视频；generating 正在生成；unsplittable 断不开 */
  skipped: Array<{ storyboard_id: number; shot_number: number; reason: 'has_video' | 'generating' | 'unsplittable' }>
  /** 新增的分镜 id（第一段沿用原分镜 id） */
  created_ids: number[]
  total: number
}

function splitTitle(title: string | null | undefined, i: number, n: number): string {
  const base = String(title || '').replace(/（\d+\/\d+）$/, '').trim() || '分镜'
  return `${base}（${i}/${n}）`
}

/**
 * 把本集台词超过单镜上限的分镜拆开（storyboardIds 只处理这些；includeWithVideo 已有视频的也拆，拆后需要重新生成）
 */
export async function splitOverlongShots(
  episodeId: number,
  opts: { storyboardIds?: number[]; includeWithVideo?: boolean } = {},
): Promise<SplitResult> {
  const limits = await shotLimitsForEpisode(episodeId)
  const cap = limits.maxShotSeconds
  const sv = await getEpisodeSystemVoice(episodeId)
  const systemNames = sv.enabled ? systemNamesFor(sv) : []
  const rows = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId)).orderBy(schema.storyboards.storyboardNumber))
    .filter((r) => !r.deletedAt)
  const result: SplitResult = { max_seconds: cap, split: [], skipped: [], created_ids: [], total: rows.length }
  if (!rows.length) return result
  const ids = rows.map((r) => r.id)
  const charLinks = await db.select().from(schema.storyboardCharacters).where(inArray(schema.storyboardCharacters.storyboardId, ids))
  const propLinks = await db.select().from(schema.storyboardProps).where(inArray(schema.storyboardProps.storyboardId, ids))
  const chars = await db.select().from(schema.characters)
  const nameOf = new Map(chars.map((c) => [c.id, c.name]))
  const running = new Set((await db.select().from(schema.sysTask)
    .where(and(inArray(schema.sysTask.storyboardId, ids), inArray(schema.sysTask.status, ['pending', 'processing']))))
    .map((t) => t.storyboardId))

  const plans = new Map<number, ShotSplitPlan>()
  for (const row of rows) {
    if (opts.storyboardIds?.length && !opts.storyboardIds.includes(row.id)) continue
    const names = charLinks.filter((l) => l.storyboardId === row.id).map((l) => nameOf.get(l.characterId)).filter((n): n is string => !!n)
    const lines = parseShotDialogue(row.videoPrompt, names, { systemNames })
    const needed = planDialogue(lines.length ? lines : parseShotDialogue(row.description, names, { systemNames })).neededSeconds
    if (needed <= cap + OVER_TOLERANCE) continue
    if (running.has(row.id)) { result.skipped.push({ storyboard_id: row.id, shot_number: row.storyboardNumber, reason: 'generating' }); continue }
    if (row.videoUrl && !opts.includeWithVideo) { result.skipped.push({ storyboard_id: row.id, shot_number: row.storyboardNumber, reason: 'has_video' }); continue }
    const plan = planShotSplit({ description: row.description, videoPrompt: row.videoPrompt, names, maxSeconds: cap, systemNames, systemLabel: sv.name })
    if (!plan) { result.skipped.push({ storyboard_id: row.id, shot_number: row.storyboardNumber, reason: 'unsplittable' }); continue }
    plans.set(row.id, plan)
  }
  if (!plans.size) return result

  const ts = now()
  let offset = 0
  for (const row of rows) {
    const plan = plans.get(row.id)
    const number = row.storyboardNumber + offset
    if (!plan) {
      if (offset) await db.update(schema.storyboards).set({ storyboardNumber: number, updatedAt: ts }).where(eq(schema.storyboards.id, row.id))
      continue
    }
    const n = plan.parts.length
    const [first, ...rest] = plan.parts
    await db.update(schema.storyboards).set({
      storyboardNumber: number,
      title: splitTitle(row.title, 1, n),
      description: first.description,
      videoPrompt: first.videoPrompt || null,
      duration: first.duration,
      lastFrameImage: null,
      ...(row.videoUrl ? { videoUrl: null, subtitleUrl: null, composedVideoUrl: null, status: 'pending' } : {}),
      updatedAt: ts,
    }).where(eq(schema.storyboards.id, row.id))
    const chIds = charLinks.filter((l) => l.storyboardId === row.id).map((l) => l.characterId)
    const prIds = propLinks.filter((l) => l.storyboardId === row.id).map((l) => l.propId)
    for (let i = 0; i < rest.length; i++) {
      const part = rest[i]
      const res = await db.insert(schema.storyboards).values({
        episodeId,
        sceneId: row.sceneId,
        storyboardNumber: number + i + 1,
        title: splitTitle(row.title, i + 2, n),
        location: row.location,
        time: row.time,
        shotType: row.shotType,
        angle: row.angle,
        movement: row.movement,
        result: row.result,
        atmosphere: row.atmosphere,
        imagePrompt: row.imagePrompt,
        videoPrompt: part.videoPrompt || null,
        bgmPrompt: row.bgmPrompt,
        soundEffect: row.soundEffect,
        description: part.description,
        blocking: row.blocking,
        duration: part.duration,
        referenceImages: row.referenceImages,
        lastFrameImage: i === rest.length - 1 ? row.lastFrameImage : null,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      })
      const newId = getInsertId(res)
      result.created_ids.push(newId)
      for (const characterId of chIds) await db.insert(schema.storyboardCharacters).values({ storyboardId: newId, characterId })
      for (const propId of prIds) await db.insert(schema.storyboardProps).values({ storyboardId: newId, propId })
    }
    result.split.push({ storyboard_id: row.id, shot_number: number, parts: n, needed_seconds: plan.neededSeconds })
    logTaskProgress('ShotSplit', 'split', { episodeId, storyboardId: row.id, shot: number, needed: plan.neededSeconds, cap, parts: plan.parts.map((p) => p.duration).join('+') })
    offset += n - 1
  }

  const all = (await db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))).filter((r) => !r.deletedAt)
  const total = all.reduce((s, r) => s + (r.duration || 0), 0)
  await db.update(schema.episodes).set({ duration: Math.ceil(total / 60), updatedAt: ts }).where(eq(schema.episodes.id, episodeId))
  result.total = all.length
  logTaskSuccess('ShotSplit', 'episode', { episodeId, cap, split: result.split.length, created: result.created_ids.length })
  return result
}
