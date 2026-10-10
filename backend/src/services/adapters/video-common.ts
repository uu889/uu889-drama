/**
 * 视频适配器共用工具
 */
import type { AIConfig, DownloadRequest } from './types'
import { joinProviderUrl } from './url'

/**
 * 网关视频成片的下载方式（aiask.me 通用视频任务、xAI 原生 / aiask Grok 分组共用）：
 * - 相对地址（如 /v1/videos/{id}/content）：按配置的 Base URL 补全并带 API Key
 * - 与 Base URL 同域的绝对地址：带 API Key
 * - 第三方直链（CDN / xAI 临时地址）：不带 Key，避免泄露
 */
export function gatewayVideoDownload(config: AIConfig, videoUrl: string): DownloadRequest {
  const auth = { 'Authorization': `Bearer ${config.apiKey}` }
  if (/^https?:\/\//i.test(videoUrl)) {
    let sameHost = false
    try { sameHost = new URL(videoUrl).host === new URL(config.baseUrl).host } catch { /* 非法地址按第三方处理 */ }
    return { url: videoUrl, headers: sameHost ? auth : undefined, fallbackExt: '.mp4' }
  }
  const path = videoUrl.startsWith('/') ? videoUrl : `/${videoUrl}`
  const url = path.startsWith('/v1/')
    ? joinProviderUrl(config.baseUrl, '/v1', path.slice(3))
    : new URL(path, config.baseUrl).toString()
  return { url, headers: auth, fallbackExt: '.mp4' }
}

/**
 * 工作台把分镜提示词里的 @角色名 解析成「@图片N角色名」（N 从 1 开始，对应参考图顺序）。
 * Grok Imagine（xAI 参考图生视频）用 <IMAGE_0>、<IMAGE_1>… 指代参考图：
 * 把 @图片N 换成 <IMAGE_{N-1}>，保留后面的名字；超出参考图数量的编号原样保留。
 */
export function toGrokImageRefs(prompt: string, referenceCount: number): string {
  return prompt.replace(/@图片(\d+)/g, (match, raw: string) => {
    const n = Number(raw)
    return n >= 1 && n <= referenceCount ? `<IMAGE_${n - 1}>` : match
  })
}
