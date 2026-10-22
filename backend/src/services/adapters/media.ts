/**
 * 参考素材 → 可上传文件
 * generation.ts 已把本地 static 图片归一化为 data URL，远程素材保持 http(s) URL；
 * 需要 multipart 上传的厂商（aiask /v1/videos、ComfyUI /upload/image）在这里统一转成 Blob。
 */
import { parseDataUrl } from '../../utils/storage.js'

export interface ReferenceFile {
  blob: Blob
  mimeType: string
  filename: string
}

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function parseUrlArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((u) => typeof u === 'string' && u.trim()) : []
  } catch {
    return []
  }
}

export async function loadReferenceFile(ref: string, baseName: string): Promise<ReferenceFile> {
  const value = String(ref || '').trim()
  const inline = parseDataUrl(value)
  if (inline) {
    const ext = MIME_EXT[inline.mimeType] || 'png'
    return {
      blob: new Blob([Buffer.from(inline.data, 'base64')], { type: inline.mimeType }),
      mimeType: inline.mimeType,
      filename: `${baseName}.${ext}`,
    }
  }
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, { signal: AbortSignal.timeout(120_000) })
    if (!resp.ok) throw new Error(`参考图下载失败（HTTP ${resp.status}）：${value}`)
    const mimeType = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim() || 'image/png'
    const ext = MIME_EXT[mimeType] || 'png'
    return {
      blob: new Blob([Buffer.from(await resp.arrayBuffer())], { type: mimeType }),
      mimeType,
      filename: `${baseName}.${ext}`,
    }
  }
  throw new Error(`无法读取参考图（仅支持 data URL 或 http(s) 地址）：${value.slice(0, 80)}`)
}

/**
 * 上传给云端视频接口的参考图瘦身：超过 maxBytes 或长边超过 maxEdge 时转成 JPEG（透明背景铺白）。
 * aiask.me 的 Grok 视频会把上传的图转存后再让上游 wokey.ai 去下载，图越大越容易
 * 「image_download_interrupted（下载参考图时连接断开）」；2048 像素 / 质量 90 的 JPEG 画质差别看不出来。
 * 转换失败时原样返回。
 */
export async function shrinkReferenceFile(
  file: ReferenceFile,
  opts: { maxBytes?: number; maxEdge?: number; quality?: number } = {},
): Promise<ReferenceFile> {
  const maxBytes = opts.maxBytes ?? 1_500_000
  const maxEdge = opts.maxEdge ?? 2048
  try {
    const sharp = (await import('sharp')).default
    const input = Buffer.from(await file.blob.arrayBuffer())
    const meta = await sharp(input).metadata()
    const longEdge = Math.max(meta.width || 0, meta.height || 0)
    if (input.length <= maxBytes && longEdge <= maxEdge) return file
    let img = sharp(input).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    if (meta.hasAlpha) img = img.flatten({ background: '#ffffff' })
    const output = await img.jpeg({ quality: opts.quality ?? 90, mozjpeg: true }).toBuffer()
    if (output.length >= input.length && longEdge <= maxEdge) return file
    return {
      blob: new Blob([new Uint8Array(output)], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      filename: file.filename.replace(/\.[a-z0-9]+$/i, '') + '.jpg',
    }
  } catch {
    return file
  }
}
