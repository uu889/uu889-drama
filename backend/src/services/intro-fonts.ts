/**
 * 片头文字可选字体：本机常见中文字体（只列出确实存在的）+ 用户上传的字体（static/fonts）
 *
 * id：系统字体为 `sys:<key>`，上传的为 `static/fonts/<文件名>`；渲染时只认这两类，前端不能传任意路径。
 * family：前端预览用的 CSS 字体名（桌面版和后端同一台机器，系统字体按名字就能显示）；上传的字体用 url 加载。
 */
import fs from 'fs'
import path from 'path'
import { STORAGE_ROOT } from '../utils/paths.js'
import { getAbsolutePath } from '../utils/storage.js'
import { findSubtitleFont } from './subtitles.js'

export const FONT_DIR = 'fonts'
export const FONT_EXT = new Set(['.ttf', '.otf', '.ttc'])
export const FONT_MAX_BYTES = 40 * 1024 * 1024

export interface IntroFont {
  id: string
  name: string
  /** 预览用的 CSS font-family */
  family?: string
  /** 上传的字体：预览用 @font-face 加载 */
  url?: string
  weight?: number
  uploaded?: boolean
}

interface SysFont { key: string; name: string; family: string; weight?: number; files: Partial<Record<'win32' | 'darwin' | 'linux', string[]>> }

const WIN = (f: string) => path.join(process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows', 'Fonts', f)

const SYSTEM_FONTS: SysFont[] = [
  { key: 'yahei-bold', name: '微软雅黑 粗体', family: 'Microsoft YaHei', weight: 700, files: { win32: [WIN('msyhbd.ttc'), WIN('msyhbd.ttf')] } },
  { key: 'yahei', name: '微软雅黑', family: 'Microsoft YaHei', files: { win32: [WIN('msyh.ttc'), WIN('msyh.ttf')] } },
  { key: 'simhei', name: '黑体', family: 'SimHei', files: { win32: [WIN('simhei.ttf')] } },
  { key: 'dengxian', name: '等线', family: 'DengXian', files: { win32: [WIN('Deng.ttf')] } },
  { key: 'simsun', name: '宋体', family: 'SimSun', files: { win32: [WIN('simsun.ttc')] } },
  { key: 'kaiti', name: '楷体', family: 'KaiTi', files: { win32: [WIN('simkai.ttf')], darwin: ['/System/Library/Fonts/Supplemental/Kaiti.ttc', '/Library/Fonts/Kaiti.ttc'] } },
  { key: 'fangsong', name: '仿宋', family: 'FangSong', files: { win32: [WIN('simfang.ttf')] } },
  { key: 'lishu', name: '隶书', family: 'LiSu', files: { win32: [WIN('SIMLI.TTF'), WIN('simli.ttf')] } },
  { key: 'youyuan', name: '幼圆', family: 'YouYuan', files: { win32: [WIN('SIMYOU.TTF'), WIN('simyou.ttf')] } },
  { key: 'stxingkai', name: '华文行楷', family: 'STXingkai', files: { win32: [WIN('STXINGKA.TTF')] } },
  { key: 'stliti', name: '华文隶书', family: 'STLiti', files: { win32: [WIN('STLITI.TTF')] } },
  { key: 'fzshuti', name: '方正舒体', family: 'FZShuTi', files: { win32: [WIN('FZSTK.TTF')] } },
  { key: 'fzyaoti', name: '方正姚体', family: 'FZYaoti', files: { win32: [WIN('FZYTK.TTF')] } },
  { key: 'pingfang', name: '苹方', family: 'PingFang SC', files: { darwin: ['/System/Library/Fonts/PingFang.ttc'] } },
  { key: 'heiti', name: '黑体-简', family: 'Heiti SC', files: { darwin: ['/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/STHeiti Light.ttc'] } },
  { key: 'songti', name: '宋体-简', family: 'Songti SC', files: { darwin: ['/System/Library/Fonts/Supplemental/Songti.ttc'] } },
  { key: 'hiragino', name: '冬青黑体', family: 'Hiragino Sans GB', files: { darwin: ['/System/Library/Fonts/Hiragino Sans GB.ttc'] } },
  { key: 'noto-sans-bold', name: '思源黑体 粗体', family: 'Noto Sans CJK SC', weight: 700, files: { linux: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'] } },
  { key: 'noto-sans', name: '思源黑体', family: 'Noto Sans CJK SC', files: { linux: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'] } },
  { key: 'noto-serif', name: '思源宋体', family: 'Noto Serif CJK SC', files: { linux: ['/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSerifCJK-Regular.ttc'] } },
  { key: 'wqy-zenhei', name: '文泉驿正黑', family: 'WenQuanYi Zen Hei', files: { linux: ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'] } },
  { key: 'wqy-microhei', name: '文泉驿微米黑', family: 'WenQuanYi Micro Hei', files: { linux: ['/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'] } },
]

function platformKey(): 'win32' | 'darwin' | 'linux' {
  return process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux'
}

function existing(files: string[] | undefined): string | null {
  for (const f of files || []) {
    try { if (fs.statSync(f).size > 0) return f } catch { /* 不存在 */ }
  }
  return null
}

function fontAbsDir() {
  return path.join(STORAGE_ROOT, FONT_DIR)
}

/** 上传的字体只认 static/fonts/ 下、扩展名对的文件 */
export function isUploadedFontPath(p: string): boolean {
  return p.startsWith(`static/${FONT_DIR}/`) && !p.includes('..') && !p.slice(`static/${FONT_DIR}/`.length).includes('/') && FONT_EXT.has(path.extname(p).toLowerCase())
}

export function listIntroFonts(): IntroFont[] {
  const plat = platformKey()
  const list: IntroFont[] = []
  for (const f of SYSTEM_FONTS) {
    if (existing(f.files[plat])) list.push({ id: `sys:${f.key}`, name: f.name, family: f.family, ...(f.weight ? { weight: f.weight } : {}) })
  }
  try {
    for (const name of fs.readdirSync(fontAbsDir()).sort()) {
      const rel = `static/${FONT_DIR}/${name}`
      if (isUploadedFontPath(rel)) list.push({ id: rel, name: name.replace(/^[0-9a-z]{6,}-/, '').replace(/\.[^.]+$/, ''), url: `/${rel}`, uploaded: true })
    }
  } catch { /* 还没有上传过 */ }
  return list
}

/** 字体 id → 字体文件绝对路径；不认识 / 不存在时用默认中文字体 */
export function resolveIntroFont(id: string | null | undefined): string | null {
  if (id?.startsWith('sys:')) {
    const f = SYSTEM_FONTS.find((x) => x.key === id.slice(4))
    const hit = f && existing(f.files[platformKey()])
    if (hit) return hit
  } else if (id && isUploadedFontPath(id)) {
    const abs = getAbsolutePath(id)
    if (fs.existsSync(abs)) return abs
  }
  return findSubtitleFont()
}

/** 字体 id 是否有效（系统里有这款，或上传过） */
export function isKnownIntroFont(id: string): boolean {
  if (id.startsWith('sys:')) return SYSTEM_FONTS.some((f) => f.key === id.slice(4))
  return isUploadedFontPath(id)
}

export async function saveIntroFont(data: ArrayBuffer, originalName: string): Promise<IntroFont> {
  const ext = path.extname(originalName).toLowerCase()
  if (!FONT_EXT.has(ext)) throw new Error('只支持 .ttf / .otf / .ttc 字体文件')
  if (data.byteLength > FONT_MAX_BYTES) throw new Error(`字体文件不能超过 ${FONT_MAX_BYTES / 1024 / 1024}MB`)
  if (data.byteLength < 1024) throw new Error('字体文件太小，可能已损坏')
  const base = path.basename(originalName, path.extname(originalName)).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'font'
  const name = `${Date.now().toString(36)}-${base}${ext}`
  fs.mkdirSync(fontAbsDir(), { recursive: true })
  fs.writeFileSync(path.join(fontAbsDir(), name), Buffer.from(data))
  const rel = `static/${FONT_DIR}/${name}`
  return { id: rel, name: base, url: `/${rel}`, uploaded: true }
}

export function deleteIntroFont(id: string): boolean {
  if (!isUploadedFontPath(id)) return false
  fs.rmSync(getAbsolutePath(id), { force: true })
  return true
}
