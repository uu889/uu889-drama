/**
 * 打包资源准备 — 组装 desktop/resources/（electron-builder extraResources 的来源）
 *
 * 1. frontend/           ← nuxt generate 产物（.output/public，含 index.html）
 * 2. workspace-template/ ← backend/workspace（skills + prompts，首启动拷入 userData）
 * 3. bin-<os>/           ← ffmpeg/ffprobe 按平台分目录（electron-builder ${os} 宏各取所需，
 *                          避免 mac 包带 exe、win 包带 mac 二进制白白 +144MB）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(__dirname, '..')
const REPO = path.resolve(DESKTOP, '..')
const RES = path.join(DESKTOP, 'resources')

fs.rmSync(RES, { recursive: true, force: true })
fs.mkdirSync(RES, { recursive: true })

// 1. 前端静态产物
const frontendSrc = path.join(REPO, 'frontend', '.output', 'public')
if (!fs.existsSync(path.join(frontendSrc, 'index.html'))) {
  console.error('缺少前端产物：请先在 frontend/ 执行 npm run generate')
  process.exit(1)
}
fs.cpSync(frontendSrc, path.join(RES, 'frontend'), { recursive: true })
console.log('resources/frontend ✓')

// 2. workspace 模板（skills 技能 + prompts 提示词）
const workspaceSrc = path.join(REPO, 'backend', 'workspace')
fs.cpSync(workspaceSrc, path.join(RES, 'workspace-template'), {
  recursive: true,
  // catalog-user/ 是开发机上用户自建的模板，不打进安装包
  filter: (src) => !src.split(path.sep).includes('catalog-user'),
})
console.log('resources/workspace-template ✓')

// 3. ffmpeg 二进制（macOS/Linux 用 ffmpeg-static 当前平台的产物；
//    Windows 交叉打包：ffmpeg.exe 从 ffmpeg-static GitHub release 获取（本地缓存），
//    ffprobe.exe 直接用 ffprobe-static 自带的 win32/x64 产物）
const req = createRequire(import.meta.url)
const binMac = path.join(RES, 'bin-mac')
const binWin = path.join(RES, 'bin-win')
fs.mkdirSync(binMac, { recursive: true })
fs.mkdirSync(binWin, { recursive: true })
const ffmpegPath = req('ffmpeg-static')
const ffprobePath = req('ffprobe-static')?.path
if (!ffmpegPath || !ffprobePath || !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
  console.error('ffmpeg-static/ffprobe-static 二进制缺失，请重新 npm install（或配置 FFMPEG_BINARIES_URL 镜像）')
  process.exit(1)
}
fs.copyFileSync(ffmpegPath, path.join(binMac, 'ffmpeg'))
fs.copyFileSync(ffprobePath, path.join(binMac, 'ffprobe'))
fs.chmodSync(path.join(binMac, 'ffmpeg'), 0o755)
fs.chmodSync(path.join(binMac, 'ffprobe'), 0o755)
console.log('resources/bin-mac ✓')

// 3b. Windows 二进制（打 win 包用；不打 win 包时缺失不报错，仅提示）
const winBinDir = path.join(DESKTOP, 'build', 'win-bin')
const ffmpegWin = path.join(winBinDir, 'ffmpeg.exe')
const ffprobeWinSrc = path.join(path.dirname(req.resolve('ffprobe-static/package.json')), 'bin', 'win32', 'x64', 'ffprobe.exe')
if (!fs.existsSync(ffmpegWin)) {
  console.warn('提示: 缺少 build/win-bin/ffmpeg.exe，Windows 包将无法内置 ffmpeg。' +
    '获取: https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64')
}
if (fs.existsSync(ffmpegWin) && fs.existsSync(ffprobeWinSrc)) {
  fs.copyFileSync(ffmpegWin, path.join(binWin, 'ffmpeg.exe'))
  fs.copyFileSync(ffprobeWinSrc, path.join(binWin, 'ffprobe.exe'))
  console.log('resources/bin-win ✓')
}
