/**
 * 原始内容附件：上传 txt / PDF / Word / 图片给 AI 改写。
 *
 * 上传后在后台提取文字存进 episode_attachments.text：
 * - txt / md / srt / csv：直接读（UTF-8，乱码多时按 GB18030 再读，兼容 Windows 记事本存的 GBK）
 * - PDF：unpdf 取文字层；扫描版（没有文字层）提示转成图片上传
 * - Word .docx：mammoth 取正文；老的 .doc 提示另存为 .docx
 * - 图片：交给当前文本模型识别（逐字提取文字，漫画 / 截图再按顺序描述画面），模型不支持图片时提示换模型
 * 改写时（打字机 / 一次性两种都是）把原文和附件文字拼在一起交给 AI，见 rewriteSourceText。
 *
 * 数量：每集最多 10 个文件、单个 20MB；交给 AI 的附件文字合计最多 10 万字（约等于一本中篇的几章，
 * 再多改写质量会明显下降、也容易超出模型上下文），超出部分截掉并告诉用户。
 */
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { DATA_ROOT } from '../utils/paths.js'
import { saveUploadedFile } from '../utils/storage.js'
import { now } from '../utils/response.js'
import { logTaskWarn } from '../utils/task-logger.js'

export const ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxFileBytes: 20 * 1024 * 1024,
  /** 交给 AI 的附件文字合计上限（字符） */
  maxTotalChars: 100_000,
}

export type AttachmentKind = 'text' | 'pdf' | 'docx' | 'image'

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.srt', '.csv', '.text'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function attachmentKind(name: string, mime = ''): AttachmentKind | null {
  const ext = path.extname(name).toLowerCase()
  // 有扩展名就只看扩展名（浏览器 / curl 给的 MIME 不可靠，如 .doc 会被报成 text/plain）
  if (ext) {
    if (TEXT_EXT.has(ext)) return 'text'
    if (ext === '.pdf') return 'pdf'
    if (ext === '.docx') return 'docx'
    if (IMAGE_EXT.has(ext)) return 'image'
    return null
  }
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime.startsWith('image/')) return 'image'
  return null
}

/** 不支持的格式给出可操作的提示 */
export function unsupportedReason(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.doc') return '老版 Word（.doc）读不了：请在 Word 里「另存为」.docx 再上传'
  if (['.wps', '.pages', '.rtf', '.odt'].includes(ext)) return `${ext} 读不了：请另存为 .docx 或 PDF 再上传`
  if (['.heic', '.heif'].includes(ext)) return 'HEIC 图片读不了：请转成 JPG / PNG 再上传'
  return `不支持 ${ext || '这种'} 文件：支持 txt / md / PDF / Word（.docx）/ 图片（JPG / PNG / WebP）`
}

/** 文本文件解码：UTF-8（去 BOM），替换字符多时按 GB18030 读 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  const utf8 = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '')
  const bad = (utf8.match(/�/g) || []).length
  if (bad > 0 && bad / Math.max(1, utf8.length) > 0.001) {
    try { return new TextDecoder('gb18030').decode(buf) } catch { /* 没有 GB18030 解码器时用 UTF-8 结果 */ }
  }
  return utf8
}

/** 整理提取出的文字：统一换行、去掉行尾空白、压缩多余空行 */
export function tidyText(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t　]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf')
  let text: string | string[]
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    ;({ text } = await extractText(pdf, { mergePages: false }))
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (/password/i.test(msg)) throw new Error('这个 PDF 有密码保护：请去掉密码后再上传')
    throw new Error(`PDF 读不了（文件可能损坏或不完整：${msg.slice(0, 80)}）：请重新导出 PDF，或另存为 Word / txt 再上传`)
  }
  const pages = Array.isArray(text) ? text : [String(text || '')]
  const out = tidyText(pages.map((p) => tidyText(p)).filter(Boolean).join('\n\n'))
  if (out.replace(/\s/g, '').length < 2) {
    throw new Error('这个 PDF 没有文字层（多半是扫描件或图片 PDF）：请把页面截图 / 导出成图片后上传，AI 会识别图片里的文字')
  }
  return out
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth: any = (await import('mammoth')).default ?? (await import('mammoth'))
  let value = ''
  try {
    ;({ value } = await mammoth.extractRawText({ buffer: buf }))
  } catch (err: any) {
    throw new Error(`Word 文件读不了（${String(err?.message || err).slice(0, 80)}）：确认是 .docx 格式（老的 .doc 请在 Word 里另存为 .docx），或另存为 PDF / txt 再上传`)
  }
  const out = tidyText(value)
  if (!out) throw new Error('Word 文件里没有读到文字（可能全是图片）：请把内容截图上传')
  return out
}

const IMAGE_INSTRUCTIONS = [
  '你是素材整理助手。用户上传的图片是改写短剧剧本用的原始素材，可能是小说 / 网文截图、漫画页、聊天记录、手写稿、分镜草图或场景照片。',
  '1. 先逐字提取图片里的全部文字，保持原来的段落、对话顺序和说话人；看不清的字用「□」代替，不要编造。',
  '2. 如果图片有情节画面（漫画、分镜、照片），再按阅读顺序简要描述每格 / 每处画面：出场人物、动作、表情、场景。',
  '只输出整理结果（文字在前，画面描述放在「【画面】」之后），不要开场白和解释。',
].join('\n')

async function extractImage(buf: Buffer, model?: string, configId?: number): Promise<string> {
  // 缩到长边 2000 像素以内的 JPEG：识别足够清楚，也不会超出接口的图片大小限制
  const sharp = (await import('sharp')).default
  const jpeg = await sharp(buf, { animated: false }).rotate()
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer()
  const { Agent } = await import('@mastra/core/agent')
  const { getTextModelFor } = await import('../agents/index.js')
  const agent = new Agent({
    id: 'source_image_reader',
    name: 'Source Image Reader',
    instructions: IMAGE_INSTRUCTIONS,
    model: () => getTextModelFor(model, configId),
  })
  let result: any
  try {
    result = await agent.generate([{
      role: 'user',
      content: [
        { type: 'text', text: '请整理这张素材图片。' },
        { type: 'image', image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mimeType: 'image/jpeg' },
      ],
    }] as any)
  } catch (err: any) {
    const msg = String(err?.message || err)
    throw new Error(`当前文本模型识别图片失败（${msg.slice(0, 160)}）。有的文本模型不能看图（如 DeepSeek）：请在改写的模型里换成能看图的模型（如 gpt-6.1-sol、claude 系列）后点「重新识别」，或把图片里的文字直接粘贴到原文里`)
  }
  const out = tidyText(String(result?.text || '').replace(/<think>[\s\S]*?<\/think>/gi, ''))
  if (!out) throw new Error('模型没有返回图片内容：请换一个能看图的文本模型后点「重新识别」')
  return out
}

/** 提取一个附件的文字（图片要用文本模型识别） */
export async function extractAttachmentText(kind: AttachmentKind, buf: Buffer, opts: { model?: string; configId?: number } = {}): Promise<string> {
  switch (kind) {
    case 'text': {
      const out = tidyText(decodeText(buf))
      if (!out) throw new Error('文件是空的')
      return out
    }
    case 'pdf': return extractPdf(buf)
    case 'docx': return extractDocx(buf)
    case 'image': return extractImage(buf, opts.model, opts.configId)
  }
}

export async function listAttachments(episodeId: number) {
  return db.select().from(schema.episodeAttachments)
    .where(eq(schema.episodeAttachments.episodeId, episodeId))
    .orderBy(schema.episodeAttachments.id)
}

async function processAttachment(id: number, kind: AttachmentKind, buf: Buffer, opts: { model?: string; configId?: number }) {
  try {
    const text = await extractAttachmentText(kind, buf, opts)
    await db.update(schema.episodeAttachments).set({ text, status: 'ready', errorMsg: null, updatedAt: now() })
      .where(eq(schema.episodeAttachments.id, id))
  } catch (err: any) {
    logTaskWarn('Attachment', 'extract-failed', { id, kind, error: String(err?.message || err).slice(0, 300) })
    await db.update(schema.episodeAttachments).set({ status: 'error', errorMsg: String(err?.message || err), updatedAt: now() })
      .where(eq(schema.episodeAttachments.id, id))
  }
}

export class AttachmentError extends Error {}

/**
 * 保存上传的文件并在后台提取文字，立即返回新建的记录（status = processing）。
 * 超出数量 / 大小、格式不支持时抛 AttachmentError（错误信息给用户看）。
 */
export async function addAttachments(
  episodeId: number,
  files: Array<{ name: string; type?: string; data: ArrayBuffer }>,
  opts: { model?: string; configId?: number } = {},
  /** 测试用：等提取完再返回 */
  wait = false,
) {
  const existing = await listAttachments(episodeId)
  if (existing.length + files.length > ATTACHMENT_LIMITS.maxFiles) {
    throw new AttachmentError(`每集最多 ${ATTACHMENT_LIMITS.maxFiles} 个附件，已有 ${existing.length} 个，这次最多还能传 ${Math.max(0, ATTACHMENT_LIMITS.maxFiles - existing.length)} 个`)
  }
  for (const f of files) {
    if (!attachmentKind(f.name, f.type)) throw new AttachmentError(`${f.name}：${unsupportedReason(f.name)}`)
    if (f.data.byteLength > ATTACHMENT_LIMITS.maxFileBytes) throw new AttachmentError(`${f.name} 超过 ${ATTACHMENT_LIMITS.maxFileBytes / 1024 / 1024}MB：请拆小或压缩后再传`)
    if (!f.data.byteLength) throw new AttachmentError(`${f.name} 是空文件`)
  }
  const rows: Array<typeof schema.episodeAttachments.$inferSelect> = []
  const jobs: Promise<void>[] = []
  for (const f of files) {
    const kind = attachmentKind(f.name, f.type)!
    const filePath = await saveUploadedFile(f.data, `source/${episodeId}`, f.name)
    const ts = now()
    const [row] = await db.insert(schema.episodeAttachments).values({
      episodeId, name: f.name, kind, mimeType: f.type || null, size: f.data.byteLength, filePath, status: 'processing', createdAt: ts, updatedAt: ts,
    }).returning()
    rows.push(row)
    jobs.push(processAttachment(row.id, kind, Buffer.from(f.data), opts))
  }
  if (wait) await Promise.all(jobs)
  return rows
}

/** 重新提取（如换了能看图的模型后重新识别图片） */
export async function retryAttachment(episodeId: number, id: number, opts: { model?: string; configId?: number } = {}, wait = false) {
  const [row] = await db.select().from(schema.episodeAttachments)
    .where(and(eq(schema.episodeAttachments.id, id), eq(schema.episodeAttachments.episodeId, episodeId)))
  if (!row) return null
  const buf = fs.readFileSync(path.join(DATA_ROOT, row.filePath))
  await db.update(schema.episodeAttachments).set({ status: 'processing', errorMsg: null, updatedAt: now() })
    .where(eq(schema.episodeAttachments.id, id))
  const job = processAttachment(id, row.kind as AttachmentKind, buf, opts)
  if (wait) await job
  return { ...row, status: 'processing' }
}

export async function deleteAttachment(episodeId: number, id: number): Promise<boolean> {
  const [row] = await db.select().from(schema.episodeAttachments)
    .where(and(eq(schema.episodeAttachments.id, id), eq(schema.episodeAttachments.episodeId, episodeId)))
  if (!row) return false
  await db.delete(schema.episodeAttachments).where(eq(schema.episodeAttachments.id, id))
  try { fs.unlinkSync(path.join(DATA_ROOT, row.filePath)) } catch { /* 文件已不在 */ }
  return true
}

/** 交给 AI 的附件文字：按上传顺序，带文件名标题；合计超过上限时截掉后面的部分 */
export async function attachmentsText(episodeId: number): Promise<{ text: string; truncated: boolean; files: number }> {
  const rows = (await listAttachments(episodeId)).filter((r) => r.status === 'ready' && r.text)
  let budget = ATTACHMENT_LIMITS.maxTotalChars
  let truncated = false
  const parts: string[] = []
  for (const [i, r] of rows.entries()) {
    if (budget <= 0) { truncated = true; break }
    let body = String(r.text)
    if (body.length > budget) { body = `${body.slice(0, budget)}\n（……附件文字超过 ${ATTACHMENT_LIMITS.maxTotalChars} 字，后面的内容没有交给 AI）`; truncated = true }
    budget -= body.length
    parts.push(`【附件 ${i + 1}：${r.name}${r.kind === 'image' ? '（图片识别结果）' : ''}】\n${body}`)
  }
  return { text: parts.join('\n\n'), truncated, files: parts.length }
}

/** 改写用的完整原始内容：原文 + 附件文字 */
export async function rewriteSourceText(episodeId: number, content: string | null | undefined): Promise<string> {
  const raw = String(content || '').trim()
  const att = await attachmentsText(episodeId)
  if (!att.text) return raw
  return [raw, `以下是用户上传的附件内容（与原文一起作为改写素材）：\n\n${att.text}`].filter(Boolean).join('\n\n')
}
