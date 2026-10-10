/**
 * 由 docs/images/logo.svg 生成全部品牌图标（改 logo 后执行一次即可）：
 *   node desktop/scripts/make-brand-icons.mjs
 * 依赖 backend/node_modules 里的 sharp（先在 backend/ 执行 npm install）。
 *
 * 产物：
 *   frontend/app/assets/brand-logo.png   顶栏品牌图（256）
 *   frontend/app/public/favicon.png      浏览器图标（64）
 *   docs/images/logo.png                 README 用（512）
 *   desktop/assets/icon.ico              Windows 安装器 / 窗口图标（16~256，PNG 压缩条目）
 *   desktop/assets/icon.icns             macOS 应用图标（16~1024，PNG 条目）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(path.join(root, 'backend', 'package.json'))
const sharp = require('sharp')

const svg = fs.readFileSync(path.join(root, 'docs', 'images', 'logo.svg'))
const png = (size) => sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 1024) * 2) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

async function writePng(rel, size) {
  const out = path.join(root, rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, await png(size))
  console.log(`${rel} (${size}x${size})`)
}

async function writeIco(rel, sizes) {
  const images = await Promise.all(sizes.map(png))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = header.length + dir.length
  images.forEach((img, i) => {
    const size = sizes[i]
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(img.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += img.length
  })
  fs.writeFileSync(path.join(root, rel), Buffer.concat([header, dir, ...images]))
  console.log(`${rel} (${sizes.join(', ')})`)
}

async function writeIcns(rel, entries) {
  const chunks = []
  for (const [type, size] of entries) {
    const data = await png(size)
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    chunks.push(head, data)
  }
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  fs.writeFileSync(path.join(root, rel), Buffer.concat([head, body]))
  console.log(`${rel} (${entries.map(([t, s]) => `${t}:${s}`).join(', ')})`)
}

await writePng('frontend/app/assets/brand-logo.png', 256)
await writePng('frontend/app/public/favicon.png', 64)
await writePng('docs/images/logo.png', 512)
await writeIco('desktop/assets/icon.ico', [16, 24, 32, 48, 64, 128, 256])
await writeIcns('desktop/assets/icon.icns', [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
])
