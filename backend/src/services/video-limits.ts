/**
 * 视频接口的上限：最长时长（秒）、提示词最大长度（UTF-8 字节）。
 *
 * 每个视频配置可在设置页改（settings.max_duration / settings.max_prompt_bytes），都是单个分镜（一次生成）的上限；
 * 不设或 0 = 不限制（默认）。接口自己的硬上限另由适配器处理（如 Grok 最多 4096 字节、15 秒，
 * 见 video-common.ts fitGrokPrompt / aiask-video.ts normalizeAiaskDuration）。按字节算：一个汉字 3 字节。
 *
 * 提示词超长时 fitPromptBytes 按重要性精简，而不是直接截断丢掉结尾：
 * 先压缩空白，再依次去掉附加的导演指令块（画风 → 场景 → 物理 → 站位 → 接戏 → 人物外观 → 系统音），
 * 最后才在句子边界截短正文；【台词控制】最后才动（防止模型自己编台词）。
 */

/** 0 = 不限制 */
export const DEFAULT_MAX_DURATION = 0
export const DEFAULT_MAX_PROMPT_BYTES = 0

export interface VideoLimits {
  /** 0 = 不限 */
  maxDuration: number
  /** 0 = 不限 */
  maxPromptBytes: number
}

export function videoLimits(settings: Record<string, any> | null | undefined): VideoLimits {
  const dur = Number(settings?.max_duration)
  const bytes = settings?.max_prompt_bytes
  const b = Number(bytes)
  return {
    maxDuration: Number.isFinite(dur) && dur >= 1 ? Math.floor(dur) : DEFAULT_MAX_DURATION,
    maxPromptBytes: bytes === null || bytes === undefined || bytes === '' || !Number.isFinite(b) || b < 0
      ? DEFAULT_MAX_PROMPT_BYTES
      : Math.floor(b),
  }
}

/** 时长超过上限时按上限（maxDuration <= 0 不限）；返回 null 表示没传时长 */
export function clampDuration(duration: unknown, maxDuration: number): number | null {
  const d = Number(duration)
  if (!Number.isFinite(d) || d <= 0) return null
  return maxDuration > 0 ? Math.min(d, maxDuration) : d
}

export const utf8Bytes = (s: string) => Buffer.byteLength(s, 'utf8')

/** 按 UTF-8 字节截短，不切断字符；尽量停在句子 / 换行边界（边界离结尾太远时直接按字符截） */
export function truncateBytes(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const n = utf8Bytes(ch)
    if (used + n > maxBytes) break
    out += ch
    used += n
  }
  const cut = Math.max(out.lastIndexOf('\n'), ...['。', '！', '？', '；', '. ', '! ', '? ', '; '].map((p) => {
    const i = out.lastIndexOf(p)
    return i < 0 ? -1 : i + p.trimEnd().length - 1
  }))
  if (cut >= out.length * 0.7) out = out.slice(0, cut + 1)
  return out.trimEnd()
}

/** 导演指令块（shot-direction.ts buildShotDirectives），按去掉的先后顺序 */
const DROP_ORDER: Array<{ re: RegExp; label: string }> = [
  { re: /^(【画风一致】|\[Style lock\])/, label: '画风一致' },
  { re: /^(【场景一致】|\[Scene lock\])/, label: '场景一致' },
  { re: /^(【物理真实】|\[Physics\])/, label: '物理真实' },
  { re: /^(【人物站位】|\[Blocking\])/, label: '人物站位' },
  { re: /^(【接上一镜】|\[Continuity\])/, label: '接上一镜' },
  { re: /^(【人物外观锁定】|\[Character lock\])/, label: '人物外观锁定' },
  { re: /^(【系统音】|\[System voice\])/, label: '系统音' },
]
const BLOCK_START = /^(【[^】]{2,8}】|\[(Dialogue control|System voice|Character lock|Scene lock|Style lock|Blocking|Continuity|Physics)\])/

export interface FitResult {
  prompt: string
  trimmed: boolean
  fromBytes: number
  toBytes: number
  /** 去掉的指令块 */
  removed: string[]
  /** 正文被截短 */
  bodyCut: boolean
}

/** 让提示词不超过 maxBytes（UTF-8）；maxBytes <= 0 不限制 */
export function fitPromptBytes(prompt: string, maxBytes: number): FitResult {
  const original = String(prompt || '')
  const fromBytes = utf8Bytes(original)
  const result = (p: string, removed: string[], bodyCut: boolean): FitResult =>
    ({ prompt: p, trimmed: p !== original, fromBytes, toBytes: utf8Bytes(p), removed, bodyCut })
  if (maxBytes <= 0 || fromBytes <= maxBytes) return result(original, [], false)

  // 1. 压缩空白
  let text = original.split('\n').map((l) => l.replace(/[ \t　]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (utf8Bytes(text) <= maxBytes) return result(text, [], false)

  // 2. 拆出正文和后面的指令块（指令块从行首的【xx】/ [Xxx] 开始，直到下一个块）
  const lines = text.split('\n')
  // 正文里也可能有【镜头1】之类：只从第一个能识别的导演指令开始算指令块
  const firstBlock = lines.findIndex((l) => /^(【(台词控制|系统音|人物外观锁定|场景一致|画风一致|人物站位|接上一镜|物理真实)】|\[(Dialogue control|System voice|Character lock|Scene lock|Style lock|Blocking|Continuity|Physics)\])/.test(l))
  const body = (firstBlock < 0 ? lines : lines.slice(0, firstBlock)).join('\n').trim()
  const blocks: string[] = []
  if (firstBlock >= 0) {
    for (const line of lines.slice(firstBlock)) {
      if (BLOCK_START.test(line) || !blocks.length) blocks.push(line)
      else blocks[blocks.length - 1] += `\n${line}`
    }
  }
  const join = (b: string, bl: string[]) => [b, bl.join('\n')].filter(Boolean).join('\n\n')

  // 3. 依次去掉次要的指令块
  const removed: string[] = []
  let kept = blocks.map((b) => b.trim()).filter(Boolean)
  for (const { re, label } of DROP_ORDER) {
    if (utf8Bytes(join(body, kept)) <= maxBytes) break
    const before = kept.length
    kept = kept.filter((b) => !re.test(b))
    if (kept.length < before) removed.push(label)
  }
  if (utf8Bytes(join(body, kept)) <= maxBytes) return result(join(body, kept), removed, false)

  // 4. 还超：截短正文，给剩下的指令块（台词控制）留位置；正文至少留一半
  const blockBytes = kept.length ? utf8Bytes(kept.join('\n')) + 2 : 0
  const bodyBudget = maxBytes - blockBytes
  if (bodyBudget >= maxBytes * 0.5) return result(join(truncateBytes(body, bodyBudget), kept), removed, true)
  // 台词控制本身太长：整体截短（正文在前）
  return result(truncateBytes(join(body, kept), maxBytes), removed, true)
}

/** 给用户看的精简说明 */
export function describeFit(fit: FitResult, maxBytes: number): string {
  const what = [
    fit.removed.length ? `去掉了附加指令【${fit.removed.join('】【')}】` : '',
    fit.bodyCut ? '截短了正文结尾' : '',
  ].filter(Boolean).join('，') || '压缩了空白'
  return `提示词 ${fit.fromBytes} 字节，超过上限 ${maxBytes} 字节（UTF-8，一个汉字 3 字节），已精简到 ${fit.toBytes} 字节：${what}`
}
