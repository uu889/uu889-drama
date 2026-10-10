/**
 * 本地生图服务（ComfyUI / Stable Diffusion WebUI / Fooocus）共用工具
 */
import { parseDataUrl } from '../../utils/storage.js'

/** 通用 SD 负向提示词（本地生图未配置负向提示词时使用） */
export const LOCAL_DEFAULT_NEGATIVE_PROMPT = 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry'

/**
 * 项目尺寸（如 1920x1080）→ 本地 SD 系模型适合的出图尺寸：
 * 保持画面比例，总像素约为 baseSize²（SDXL 1024、SD1.5 512），宽高对齐到 64 的倍数。
 * 例：1920x1080 @1024 → 1344x768；1080x1920 → 768x1344；1024x1024 → 1024x1024
 */
export function localImageDimensions(size?: string | null, baseSize = 1024): { width: number; height: number } {
  const [w, h] = String(size || '').toLowerCase().split('x').map(Number)
  const ratio = w > 0 && h > 0 ? w / h : 1
  const base = Number.isFinite(baseSize) && baseSize >= 256 ? baseSize : 1024
  const area = base * base
  const align = (v: number) => Math.max(64, Math.round(v / 64) * 64)
  return { width: align(Math.sqrt(area * ratio)), height: align(Math.sqrt(area / ratio)) }
}

/** 配置里的数字设置：非法或越界时用默认值 */
export function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function textSetting(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 模型名为空 / default / current 时表示"沿用服务当前加载的模型" */
export function isDefaultModel(model?: string | null): boolean {
  return !model || /^(default|current|默认)$/i.test(model.trim())
}

/**
 * 本地服务鉴权：Key 形如「用户名:密码」时按 HTTP Basic（SD WebUI --api-auth），否则 Bearer；
 * 同时带 X-API-KEY（Fooocus-API --apikey）。未填 Key 不带任何鉴权头。
 */
export function localAuthHeaders(apiKey?: string | null): Record<string, string> {
  const key = (apiKey || '').trim()
  if (!key) return {}
  if (key.includes(':')) return { 'Authorization': `Basic ${Buffer.from(key).toString('base64')}` }
  return { 'Authorization': `Bearer ${key}`, 'X-API-KEY': key }
}

/** 本地服务地址 + 路径（保留查询串） */
export function localUrl(baseUrl: string, fallbackBase: string, pathWithQuery: string): string {
  const base = (baseUrl || fallbackBase).replace(/\/+$/, '')
  return `${base}${pathWithQuery.startsWith('/') ? '' : '/'}${pathWithQuery}`
}

/** data URL → 纯 base64（本地服务多数不认 data: 前缀）；http(s) 地址原样返回 */
export function toRawBase64OrUrl(ref: string): string {
  const parsed = parseDataUrl(ref)
  return parsed ? parsed.data : ref
}

/** 去掉可能存在的 data: 前缀 */
export function stripDataPrefix(b64: string): string {
  return String(b64 || '').replace(/^data:[^;]+;base64,/, '')
}
