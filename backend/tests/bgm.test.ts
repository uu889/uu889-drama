/**
 * 拼接导出的背景音乐：曲库路径校验、混音滤镜、真实 FFmpeg 混音（有原声 / 无原声 / 循环 / 截断）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-bgm-'))
process.env.UU889_DATA_DIR = DATA
process.env.SQLITE_PATH = path.join(DATA, 'test.sqlite3')
const SYS_FFMPEG = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'].find((p) => fs.existsSync(p))
if (SYS_FFMPEG && !process.env.FFMPEG_BIN) {
  process.env.FFMPEG_BIN = SYS_FFMPEG
  process.env.FFPROBE_BIN = SYS_FFMPEG.replace(/ffmpeg$/, 'ffprobe')
}
const FFMPEG = process.env.FFMPEG_BIN || ''
const bgm = await import('../src/services/bgm')

test('options: only files inside the music library, volume as 0~1 or percent', () => {
  assert.equal(bgm.normalizeBgmOptions(null), null)
  assert.equal(bgm.normalizeBgmOptions({ path: 'static/uploads/a.mp3' }), null)
  assert.equal(bgm.normalizeBgmOptions({ path: 'static/bgm/../uu889.sqlite3' }), null)
  assert.equal(bgm.normalizeBgmOptions({ path: 'static/bgm/a.exe' }), null)
  assert.deepEqual(bgm.normalizeBgmOptions({ path: '/static/bgm/a.mp3' }), { path: 'static/bgm/a.mp3', volume: 0.3, duck: true, fade: true })
  assert.equal(bgm.normalizeBgmOptions({ path: 'static/bgm/a.mp3', volume: 45 })!.volume, 0.45)
  assert.equal(bgm.normalizeBgmOptions({ path: 'static/bgm/a.mp3', volume: 0.6, duck: false, fade: false })!.duck, false)
})

test('filter: ducking uses the original audio as the trigger, silent videos just get the music', () => {
  const duck = bgm.buildBgmFilter({ volume: 0.3, duck: true, fade: true }, 20, true)
  assert.match(duck, /sidechaincompress/)
  assert.match(duck, /apad=whole_dur=20\.000/)
  assert.match(duck, /afade=t=out:st=17\.50:d=2\.50/)
  assert.match(duck, /amix=inputs=2:duration=first/)
  const plain = bgm.buildBgmFilter({ volume: 0.5, duck: false, fade: false }, 10, true)
  assert.doesNotMatch(plain, /sidechaincompress|afade/)
  const silent = bgm.buildBgmFilter({ volume: 0.3, duck: true, fade: true }, 10, false)
  assert.doesNotMatch(silent, /\[0:a\]/)
  assert.match(silent, /\[aout\]$/)
})

function makeVideo(file: string, seconds: number, withAudio: boolean) {
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=24:duration=${seconds}`]
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(withAudio ? ['-c:a', 'aac', '-shortest'] : []), file)
  execFileSync(FFMPEG, args, { stdio: 'ignore' })
}

test('library + real mix: short music loops to the full length, video untouched, upload validated', { skip: !FFMPEG }, async () => {
  // 曲库：上传 3 秒的音乐
  const music = path.join(DATA, 'song.wav')
  execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', music], { stdio: 'ignore' })
  const item = await bgm.saveBgm(fs.readFileSync(music).buffer as ArrayBuffer, '我的 BGM.wav')
  assert.match(item.path, /^static\/bgm\/[0-9a-z]+-我的 BGM\.wav$/)
  assert.equal(item.name, '我的 BGM.wav')
  assert.ok(item.duration >= 2.9 && item.duration <= 3.1)
  assert.equal((await bgm.listBgm()).length, 1)
  await assert.rejects(bgm.saveBgm(new TextEncoder().encode('not audio').buffer as ArrayBuffer, 'x.mp3'), /读不出/)
  await assert.rejects(bgm.saveBgm(new ArrayBuffer(4), 'x.exe'), /仅支持/)
  assert.equal((await bgm.listBgm()).length, 1, '无效文件没有留在曲库')

  const opts = bgm.normalizeBgmOptions({ path: item.path, volume: 30 })!
  for (const withAudio of [true, false]) {
    const input = path.join(DATA, `in-${withAudio}.mp4`)
    const output = path.join(DATA, `out-${withAudio}.mp4`)
    makeVideo(input, 8, withAudio)
    await bgm.mixBackgroundMusic(input, output, opts)
    const info = await bgm.probeMedia(output)
    assert.ok(info.hasVideo && info.hasAudio, `有画面有声音（原视频${withAudio ? '有' : '没有'}声音）`)
    assert.ok(Math.abs(info.duration - 8) < 0.3, `时长跟视频一致：${info.duration}`)
    // 3 秒的音乐循环到后面：第 4.5~5.5 秒（原视频没声音时）仍有音乐
    if (!withAudio) {
      const r = spawnSync(FFMPEG, ['-ss', '4.5', '-t', '1', '-i', output, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
      const mean = Number((r.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1])
      assert.ok(mean > -40, `循环后的音乐音量 ${mean} dB`)
    }
  }
  // 删除
  assert.equal(bgm.deleteBgm(item.path), true)
  assert.equal(bgm.deleteBgm('static/bgm/../test.sqlite3'), false)
  assert.equal((await bgm.listBgm()).length, 0)
})
