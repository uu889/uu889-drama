/**
 * 网页读取（网址转视频）：只允许公网地址（防止智能体被引导去访问内网），限制大小与跳转次数
 */
import dns from 'node:dns/promises'
import net from 'node:net'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7))
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error(`不是有效的网址：${raw}`) }
  if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http / https 网址')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw new Error(`无法解析域名：${host}`)
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('不允许访问内网地址')
  return u
}

export async function fetchPublic(url: string, opts: { maxBytes?: number; accept?: string; timeout?: number; signal?: AbortSignal } = {}) {
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(current)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new Error('网页请求超时')), opts.timeout ?? 25_000)
    const onAbort = () => ctrl.abort(opts.signal?.reason)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(current, {
        headers: { 'User-Agent': UA, Accept: opts.accept || '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
        redirect: 'manual',
        signal: ctrl.signal,
      })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).href
        continue
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        size += chunk.length
        if (size > maxBytes) throw new Error(`内容超过 ${Math.round(maxBytes / 1048576)}MB`)
        chunks.push(Buffer.from(chunk))
      }
      return { finalUrl: current, contentType: res.headers.get('content-type') || '', buffer: Buffer.concat(chunks) }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new Error('跳转次数过多')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
}

/** 网页 → 标题 / 描述 / 正文 / 图片地址（纯函数，测试覆盖） */
export function parseHtml(html: string, baseUrl: string) {
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i')
    return decodeEntities((html.match(re)?.[1] || html.match(re2)?.[1] || '').trim())
  }
  const title = meta('og:title') || decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim())
  const description = meta('og:description') || meta('description')
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1).join('\n')
  const imgs: string[] = []
  const push = (src: string) => {
    if (!src || src.startsWith('data:')) return
    try {
      const u = new URL(decodeEntities(src), baseUrl).href
      if (/\.(svg|gif|ico)(\?|$)/i.test(u) || /sprite|icon|logo-?small|avatar|pixel|tracking/i.test(u)) return
      if (!imgs.includes(u)) imgs.push(u)
    } catch { /* 忽略 */ }
  }
  push(meta('og:image'))
  for (const m of html.matchAll(/<img[^>]+?(?:data-src|data-original|src)=["']([^"']+)["']/gi)) push(m[1])
  return { title, description, text: text.slice(0, 6000), images: imgs }
}
