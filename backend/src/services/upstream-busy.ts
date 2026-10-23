/**
 * 上游「繁忙」判断：并发数已满、限流、排队已满等——任务本身没问题，过一会儿原样再交就能成功。
 *
 * aiask.me 的 Grok 视频转给 wokey.ai，批量提交时超出账号同时生成数的任务会被拒绝（HTTP 429，
 * 或 4xx / 5xx 带 concurrency / rate limit 文案），也可能先接收、随后状态变成 failed 并带同样的原因。
 * 这类失败不该让分镜直接失败：提交时等一会儿重交，轮询时报这种失败也重新提交。
 */

const BUSY_PATTERNS = [
  /concurren/i,
  /rate[ _-]?limit/i,
  /too many (requests|tasks|jobs)/i,
  /\bbusy\b/i,
  /overload/i,
  /at capacity|capacity (exceeded|limit)|no (available )?capacity/i,
  /quota of (concurrent|parallel)/i,
  /(queue|slots?) (is )?(full|exhausted)/i,
  /try again later|retry later|please retry/i,
  /并发/,
  /限流|频率|太频繁|过于频繁/,
  /繁忙|拥挤|排队已满|队列已满/,
  /稍后(再)?(试|重试)/,
]

/**
 * 上游临时故障：上游下载我们给的参考图时断线 / 超时（aiask.me 的 Grok 视频报
 * image_download_interrupted「the connection dropped while downloading the image」）、
 * 内部连接重置等。任务本身没问题，重新提交通常就能成功。
 */
const TRANSIENT_PATTERNS = [
  /image_download|download(ing)? the (provided )?image|failed to download/i,
  /connection (was )?(dropped|reset|closed|interrupted)|ECONNRESET|socket hang up/i,
  /(upstream|gateway|read) time(d)?[ -]?out|timed out while/i,
  /temporar(il)?y unavailable|internal (server )?error, please retry/i,
  /下载(参考)?图(片)?失败|连接(被)?(中断|重置|断开)/,
]

/** 文案是不是「上游临时故障」（如上游下载参考图断线），重交一次通常就好 */
export function isTransientFailure(text: string | null | undefined): boolean {
  const s = String(text || '')
  if (!s || NOT_BUSY_PATTERNS.some((re) => re.test(s))) return false
  return TRANSIENT_PATTERNS.some((re) => re.test(s))
}

const MODERATION_PATTERNS = [
  /content (policy|moderation)|moderation|safety (check|filter|system)|(sensitive|unsafe) content|SensitiveContent/i,
  /审核|违规|敏感/,
]

/**
 * 文案是不是「内容审核未通过」。Grok 等模型的审核有随机性，内容本身没问题时原样重交常常就过了；
 * 鉴权 / 额度类错误优先（文案里同时出现时不算审核）
 */
export function isModerationFailure(text: string | null | undefined): boolean {
  const s = String(text || '')
  if (!s || NOT_BUSY_PATTERNS.slice(0, 2).some((re) => re.test(s))) return false
  return MODERATION_PATTERNS.some((re) => re.test(s))
}

/** 审核未通过时自动原样重交的次数：视频配置 settings.moderation_retries（0 关闭），默认 2 */
export function moderationRetries(settings: Record<string, any> | null | undefined): number {
  const raw = settings?.moderation_retries
  if (raw === undefined || raw === null || raw === '') return 2
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5) : 2
}

/** 鉴权 / 额度类错误：重试没用 */
const NOT_BUSY_PATTERNS = [
  /insufficient|余额|额度不足|quota exceeded for|billing|balance/i,
  /invalid (api )?key|unauthori[sz]ed|forbidden|无效的?\s*(api\s*)?key|令牌/i,
  /content (policy|moderation)|safety|审核|违规|敏感/i,
]

/** 文案是不是「上游繁忙」 */
export function isBusyMessage(text: string | null | undefined): boolean {
  const s = String(text || '')
  if (!s) return false
  if (NOT_BUSY_PATTERNS.some((re) => re.test(s))) return false
  return BUSY_PATTERNS.some((re) => re.test(s))
}

/** HTTP 响应是不是「上游繁忙」：429 一律算；其它 4xx / 5xx 看文案（401 鉴权失败不算） */
export function isUpstreamBusy(status: number, bodyText: string | null | undefined): boolean {
  if (status === 401) return false
  if (status === 429) return !NOT_BUSY_PATTERNS.some((re) => re.test(String(bodyText || '')))
  if (status < 400) return false
  return isBusyMessage(bodyText) || isTransientFailure(bodyText)
}

/** Retry-After 头（秒数或 HTTP 日期）→ 毫秒，限制在 1 秒到 3 分钟；没有 / 非法返回 null */
export function retryAfterMs(header: string | null | undefined): number | null {
  const raw = String(header || '').trim()
  if (!raw) return null
  let ms = Number(raw) * 1000
  if (!Number.isFinite(ms)) {
    const at = Date.parse(raw)
    if (!Number.isFinite(at)) return null
    ms = at - Date.now()
  }
  return Math.min(180_000, Math.max(1_000, ms))
}
