/**
 * 统一错误提示入口 — 把裸技术错误（Failed to fetch / API error 500: {...} /
 * 上游错误码 / ffmpeg 输出 / SDK 英文原文）映射为用户可读的友好文案。
 *
 * - mapError(err, { fallback? }): 返回友好文案（内联展示复用同一函数）
 * - toastError(err, { fallback?, duration? }): toast.error(mapError(...))，错误统一 5s
 * - 后端返回的短中文友好 message（如「镜头不存在」）原样透传
 * - 原始错误不展示，排障走 DevTools（useApi 已 console.error）
 */
import { toast } from 'vue-sonner'
import { i18n } from '~/composables/i18n'

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params)

/** 内容审核特征（从 episode.vue 的 videoModerationHint 上移，全站复用） */
export const MODERATION_RE = /sensitive|moderation|真人|人脸|real[\s_-]?person|审核|内容.*(违规|不合规|未通过)|content[\s_-]?policy|risk[\s_-]?control|violation|blocked/i

const NETWORK_RE = /failed to fetch|network ?error|load failed|network request failed|fetch failed/i
const NONJSON_RE = /unexpected token|not valid json|failed to parse/i
const SERVER5XX_RE = /(^|\D)5\d{2}(\D|$)|internal server error|服务器内部错误/i
const AUTH_RE = /(^|\D)40[13](\D|$)|unauthorized|forbidden|invalid[\s_-]?api[\s_-]?key|authentication|鉴权/i
const RATELIMIT_RE = /(^|\D)429(\D|$)|rate[\s_-]?limit|too many requests|quota|额度不足|insufficient/i
const TIMEOUT_RE = /timeout|timed out|polling exceeded|超时/i
/** 技术特征：出现即判定不可直接透传给用户 */
const TECHY_RE = /[{}\[\]<>]|https?:\/\/|\b(error|errno|exception|code|stack|undefined|null)\b|[a-z]+_[a-z]+/i
const CJK_RE = /[一-鿿]/
/** 与 backend/src/utils/model-error.ts describeModelError 的格式一致：文本模型调用失败（HTTP 400）：<上游原因> */
const MODEL_ERROR_RE = /^文本模型调用失败(?:（HTTP (\d{3})）)?：([\s\S]*)$/
/** 后端整理过的 ComfyUI 中文提示（工作流格式 / 校验失败 / 任务丢失等），长度不定但可直接给用户看 */
const COMFY_MESSAGE_RE = /^(?:自动重试 \d+ 次后仍失败。)?ComfyUI[\s\S]*[一-鿿]/

function clip(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 模型调用错误：按 HTTP 状态给本地化提示，其余带上游原因（参数不支持、模型不存在等） */
function mapModelError(status: number, detail: string): string {
  if (MODERATION_RE.test(detail)) return t('errors.moderation')
  if (status === 401) return t('errors.auth')
  if (status === 429) return t('errors.rateLimit')
  // 5xx 或网关返回 HTML 错误页：原文对用户没有意义
  if (status >= 500 || /^\s*</.test(detail)) return status >= 500 ? t('errors.unavailable') : t('errors.requestFailed', { status })
  if (!detail) return status ? t('errors.requestFailed', { status }) : t('errors.unknown')
  return status ? t('errors.modelFailed', { status, detail: clip(detail) }) : t('errors.modelFailedPlain', { detail: clip(detail) })
}

function messageOf(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || String(err)
  const anyErr = err as { message?: unknown; error_msg?: unknown; errorMsg?: unknown }
  return String(anyErr.message ?? anyErr.error_msg ?? anyErr.errorMsg ?? err)
}

/**
 * 错误 → 友好文案。分类按优先级短路：
 * 网络 → 非JSON → 审核 → 鉴权 → 限频 → 5xx → 超时 → 短中文透传 → 状态码 → 兜底
 */
export function mapError(err: unknown, opts?: { fallback?: string }): string {
  const msg = messageOf(err).trim()
  if (!msg) return opts?.fallback ? t(opts.fallback) : t('errors.unknown')

  if (err instanceof TypeError && NETWORK_RE.test(msg)) return t('errors.network')
  // 后端整理过的模型调用错误 / ComfyUI 提示：展示具体原因，否则会被下面的技术特征判定
  // 吞成"操作失败，请重试"，用户无从排查
  const modelErr = MODEL_ERROR_RE.exec(msg)
  if (modelErr) return mapModelError(Number(modelErr[1] || 0), modelErr[2].trim())
  if (COMFY_MESSAGE_RE.test(msg)) return clip(msg)
  if (err instanceof SyntaxError || NONJSON_RE.test(msg)) return t('errors.server')
  if (MODERATION_RE.test(msg)) return t('errors.moderation')
  if (AUTH_RE.test(msg)) return t('errors.auth')
  if (RATELIMIT_RE.test(msg)) return t('errors.rateLimit')
  if (SERVER5XX_RE.test(msg)) return t('errors.unavailable')
  if (TIMEOUT_RE.test(msg)) return t('errors.timeout')

  // 后端友好中文（短、含中文、无技术特征）直接透传
  if (msg.length <= 40 && CJK_RE.test(msg) && !TECHY_RE.test(msg)) return msg

  if (/^\d{3}$/.test(msg)) return t('errors.requestFailed', { status: msg })

  return opts?.fallback ? t(opts.fallback) : t('errors.unknown')
}

/** 统一错误 toast（默认 5s，比成功提示长） */
export function toastError(err: unknown, opts?: { fallback?: string; duration?: number }): void {
  const message = mapError(err, opts)
  // 带上游原因的长提示多留几秒，便于看清或截图
  toast.error(message, { duration: opts?.duration ?? (message.length > 40 ? 10000 : 5000) })
}
