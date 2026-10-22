import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampDuration, fitPromptBytes, truncateBytes, utf8Bytes, videoLimits } from '../src/services/video-limits'
import { fitGrokPrompt } from '../src/services/adapters/video-common'
import { isTransientFailure, isUpstreamBusy } from '../src/services/upstream-busy'
import { restartEveryVideos } from '../src/services/adapters/comfyui-common'

test('limits: unlimited by default (0), configurable per video config', () => {
  assert.deepEqual(videoLimits(null), { maxDuration: 0, maxPromptBytes: 0 })
  assert.deepEqual(videoLimits({ max_duration: '', max_prompt_bytes: '' }), { maxDuration: 0, maxPromptBytes: 0 })
  assert.deepEqual(videoLimits({ max_duration: 10, max_prompt_bytes: 4090 }), { maxDuration: 10, maxPromptBytes: 4090 })
  assert.equal(clampDuration(20, 0), 20, '0 = 不限')
  assert.equal(clampDuration(20, 15), 15)
  assert.equal(clampDuration(8, 15), 8)
  assert.equal(clampDuration(undefined, 15), null)
})

test('truncateBytes never splits a character and prefers sentence ends', () => {
  const s = '一二三四五。六七八九十'
  const out = truncateBytes(s, 20)
  assert.ok(utf8Bytes(out) <= 20)
  assert.equal(out, '一二三四五。')
  assert.ok(!truncateBytes('汉'.repeat(50), 100).includes('�'))
})

const BODY = '小明推门进来，雨水顺着外套往下滴。\n0-3秒：中景，小明站在门口（无人说话）\n3-6秒：近景，小明说：「我回来了。」'
const DIRECTIVES = [
  '【台词控制】本段共 6 秒，只有以下 1 句话：\n1. 小明：「我回来了。」（约 1.2 秒）',
  '【人物外观锁定】以下人物必须与参考图一致：\n小明：短发，黑色外套',
  '【场景一致】场景布局以 客厅 为准。',
  '【画风一致】' + '画面清晰锐利、细节丰富。'.repeat(40),
  '【人物站位】小明在画面左侧。',
].join('\n')

test('fitPromptBytes drops optional add-on blocks first and keeps dialogue control and body', () => {
  const prompt = `${BODY}\n\n${DIRECTIVES}`
  const full = utf8Bytes(prompt)
  const fit = fitPromptBytes(prompt, full - 50)
  assert.ok(fit.toBytes <= full - 50)
  assert.deepEqual(fit.removed, ['画风一致'])
  assert.ok(fit.prompt.startsWith(BODY))
  assert.match(fit.prompt, /【台词控制】[\s\S]*【人物外观锁定】[\s\S]*【场景一致】[\s\S]*【人物站位】/)
  assert.equal(fit.bodyCut, false)
  // 更紧：去掉更多块
  const tight = fitPromptBytes(prompt, utf8Bytes(BODY) + 160)
  assert.ok(tight.toBytes <= utf8Bytes(BODY) + 160)
  assert.ok(tight.prompt.startsWith(BODY))
  assert.match(tight.prompt, /【台词控制】/)
  // 不超就原样
  assert.equal(fitPromptBytes(prompt, 0).prompt, prompt)
  assert.equal(fitPromptBytes(prompt, full).trimmed, false)
})

test('a long Chinese prompt ends up under Grok 4096 bytes after <IMAGE_n> conversion', () => {
  const long = '@图片1小明走进客厅，' + '镜头缓缓推进，'.repeat(400)
  const out = fitGrokPrompt({ provider: 'aiask', baseUrl: '', apiKey: '', model: '', settings: { max_prompt_bytes: 0 } }, long)
  assert.ok(utf8Bytes(out) <= 4096)
  // 不设上限时仍按 Grok 接口自身的 4096 字节；设得更小按设置
  assert.ok(utf8Bytes(fitGrokPrompt({ provider: 'aiask', baseUrl: '', apiKey: '', model: '', settings: null }, long)) <= 4096)
  assert.ok(utf8Bytes(fitGrokPrompt({ provider: 'aiask', baseUrl: '', apiKey: '', model: '', settings: { max_prompt_bytes: 3000 } }, long)) <= 3000)
})

test('upstream image download interruption is retried', () => {
  const msg = '[failed] Failed to downloade the provided image (image_downloade_error=image_download_interrupted): the connection drpped while downloading the image. Please retry or host the image on a more reliabe nedpoint.'
  assert.ok(isTransientFailure(msg))
  assert.ok(isUpstreamBusy(400, msg))
  assert.ok(!isTransientFailure('提示词过长。Grok视频最多支持4096字节的UTF-8文本，请缩短后重试。'))
  assert.ok(!isUpstreamBusy(400, '提示词过长。Grok视频最多支持4096字节的UTF-8文本，请缩短后重试。'))
})

test('ComfyUI periodic restart: auto every 3 videos on 12G, 5 on 16G, off for big cards, configurable', () => {
  assert.equal(restartEveryVideos(null, 12), 3)
  assert.equal(restartEveryVideos(null, 16), 5)
  assert.equal(restartEveryVideos(null, 24), 0)
  assert.equal(restartEveryVideos(null, undefined), 0)
  assert.equal(restartEveryVideos({ restart_every: 0 }, 12), 0)
  assert.equal(restartEveryVideos({ restart_every: 4 }, 48), 4)
})

test('large reference images are shrunk to a ≤2048px JPEG before upload; small ones are left alone', async () => {
  const sharp = (await import('sharp')).default
  const { shrinkReferenceFile } = await import('../src/services/adapters/media')
  const raw = Buffer.alloc(3000 * 2000 * 4)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) & 255
  const big = await sharp(raw, { raw: { width: 3000, height: 2000, channels: 4 } }).png().toBuffer()
  const out = await shrinkReferenceFile({ blob: new Blob([new Uint8Array(big)], { type: 'image/png' }), mimeType: 'image/png', filename: 'image[]-1.png' })
  assert.equal(out.mimeType, 'image/jpeg')
  assert.equal(out.filename, 'image[]-1.jpg')
  const meta = await sharp(Buffer.from(await out.blob.arrayBuffer())).metadata()
  assert.equal(Math.max(meta.width!, meta.height!), 2048)
  const small = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).png().toBuffer()
  const file = { blob: new Blob([new Uint8Array(small)], { type: 'image/png' }), mimeType: 'image/png', filename: 'a.png' }
  assert.equal(await shrinkReferenceFile(file), file)
})
