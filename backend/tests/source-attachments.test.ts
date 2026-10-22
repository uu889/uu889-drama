import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// 临时数据库（必须在导入 db 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-attach-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')

const { db, initDb, schema } = await import('../src/db/index')
const att = await import('../src/services/source-attachments')
const JSZip = (await import('jszip')).default
const sharp = (await import('sharp')).default

let episodeId = 0
let server: http.Server
let lastChat: any = null
let visionWorks = true

/** 最小的带文字层 PDF（Helvetica，一行英文） */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

before(async () => {
  initDb()
  // 模拟 OpenAI 兼容的文本接口：能看图时返回识别结果
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      lastChat = JSON.parse(raw || '{}')
      res.writeHead(visionWorks ? 200 : 400, { 'Content-Type': 'application/json' })
      if (!visionWorks) return res.end(JSON.stringify({ error: { message: 'image input is not supported by this model' } }))
      res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '林夏：「你终于来了。」\n【画面】咖啡馆，林夏抬头。' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  const ts = new Date().toISOString()
  await db.insert(schema.aiServiceConfigs).values({ serviceType: 'text', provider: 'aiask', name: 'text', baseUrl: base, apiKey: 'k', model: '["gpt-6.1-sol"]', isActive: true, priority: 100, createdAt: ts, updatedAt: ts })
  await db.insert(schema.dramas).values({ title: '剧', createdAt: ts, updatedAt: ts })
  await db.insert(schema.episodes).values({ dramaId: 1, episodeNumber: 1, title: '第一集', content: '原文第一段。', createdAt: ts, updatedAt: ts })
  episodeId = (await db.select().from(schema.episodes))[0].id
})

after(() => server?.close())

test('file types: supported kinds, helpful messages for .doc / unknown', () => {
  assert.equal(att.attachmentKind('a.txt'), 'text')
  assert.equal(att.attachmentKind('a.PDF'), 'pdf')
  assert.equal(att.attachmentKind('a.docx'), 'docx')
  assert.equal(att.attachmentKind('a.jpeg'), 'image')
  assert.equal(att.attachmentKind('a.doc'), null)
  assert.equal(att.attachmentKind('a.doc', 'text/plain'), null, '扩展名优先于 MIME')
  assert.equal(att.attachmentKind('noext', 'application/pdf'), 'pdf')
  assert.match(att.unsupportedReason('a.doc'), /另存为」.docx/)
  assert.match(att.unsupportedReason('a.exe'), /支持 txt/)
})

test('txt saved by Notepad in GBK is read correctly', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7]) // 你好，世界
  assert.equal(att.decodeText(gbk), '你好，世界')
  assert.equal(att.decodeText(Buffer.from('﻿第一章', 'utf8')), '第一章')
})

test('txt, PDF, Word and an image are extracted and handed to the rewrite together with the original text', async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const rows = await att.addAttachments(episodeId, [
    { name: '第二章.txt', type: 'text/plain', data: ab(Buffer.from('第二章\r\n\r\n\r\n\r\n他推门进来。  \r\n')) },
    { name: 'outline.pdf', type: 'application/pdf', data: ab(makePdf('Chapter three outline')) },
    { name: '人物.docx', type: '', data: ab(await makeDocx(['林夏，二十五岁，咖啡师。', '陈默，林夏的前男友。'])) },
    { name: '截图.png', type: 'image/png', data: ab(png) },
  ], {}, true)
  assert.equal(rows.length, 4)
  const list = await att.listAttachments(episodeId)
  for (const r of list) assert.equal(r.status, 'ready', `${r.name}: ${r.errorMsg}`)
  assert.equal(list[0].text, '第二章\n\n他推门进来。')
  assert.match(String(list[1].text), /Chapter three outline/)
  assert.match(String(list[2].text), /林夏，二十五岁/)
  assert.match(String(list[3].text), /你终于来了/)
  assert.match(JSON.stringify(lastChat.messages), /image_url|data:image\/jpeg;base64/, '图片作为图片发给模型')

  const source = await att.rewriteSourceText(episodeId, '原文第一段。')
  assert.match(source, /^原文第一段。/)
  assert.match(source, /【附件 1：第二章.txt】\n第二章/)
  assert.match(source, /【附件 4：截图.png（图片识别结果）】/)
})

test('limits: 10 files per episode, 20MB each, unsupported formats rejected before saving', async () => {
  await assert.rejects(att.addAttachments(episodeId, Array.from({ length: 7 }, (_, i) => ({ name: `${i}.txt`, data: ab(Buffer.from('x')) }))), /最多 10 个附件，已有 4 个/)
  await assert.rejects(att.addAttachments(episodeId, [{ name: 'old.doc', data: ab(Buffer.from('x')) }]), /另存为」.docx/)
  await assert.rejects(att.addAttachments(episodeId, [{ name: 'big.pdf', data: new ArrayBuffer(21 * 1024 * 1024) }]), /超过 20MB/)
  assert.equal((await att.listAttachments(episodeId)).length, 4)
})

test('scanned PDF and a text model that cannot see images give clear errors; retry works after switching', async () => {
  const blank = makePdf('')
  visionWorks = false
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } }).png().toBuffer()
  const [pdfRow, imgRow] = await att.addAttachments(episodeId, [
    { name: 'scan.pdf', data: ab(blank) },
    { name: 'page.jpg', data: ab(png) },
  ], {}, true)
  const rows = await att.listAttachments(episodeId)
  const pdf = rows.find((r) => r.id === pdfRow.id)!
  const img = rows.find((r) => r.id === imgRow.id)!
  assert.equal(pdf.status, 'error')
  const [broken] = await att.addAttachments(episodeId, [{ name: 'broken.pdf', data: ab(Buffer.from('%PDF-1.4')) }], {}, true)
  assert.match(String((await att.listAttachments(episodeId)).find((r) => r.id === broken.id)!.errorMsg), /PDF 读不了/)
  await att.deleteAttachment(episodeId, broken.id)
  assert.match(String(pdf.errorMsg), /没有文字层/)
  assert.equal(img.status, 'error')
  assert.match(String(img.errorMsg), /不能看图/)
  // 失败的附件不交给 AI
  assert.doesNotMatch(await att.rewriteSourceText(episodeId, ''), /page.jpg/)
  visionWorks = true
  await att.retryAttachment(episodeId, img.id, {}, true)
  const [again] = (await att.listAttachments(episodeId)).filter((r) => r.id === img.id)
  assert.equal(again.status, 'ready')
  assert.ok(await att.deleteAttachment(episodeId, pdf.id))
  assert.equal((await att.listAttachments(episodeId)).length, 5)
})

test('attachment text handed to AI is capped at 100k characters', async () => {
  const ts = new Date().toISOString()
  await db.insert(schema.episodes).values({ dramaId: 1, episodeNumber: 2, title: '第二集', createdAt: ts, updatedAt: ts })
  const ep2 = (await db.select().from(schema.episodes)).at(-1)!.id
  await att.addAttachments(ep2, [
    { name: 'a.txt', data: ab(Buffer.from('甲'.repeat(80_000))) },
    { name: 'b.txt', data: ab(Buffer.from('乙'.repeat(80_000))) },
  ], {}, true)
  const out = await att.attachmentsText(ep2)
  assert.ok(out.truncated)
  assert.equal((out.text.match(/甲/g) || []).length, 80_000)
  assert.equal((out.text.match(/乙/g) || []).length, 20_000)
  assert.match(out.text, /后面的内容没有交给 AI/)
})
