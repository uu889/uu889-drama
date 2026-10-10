import assert from 'node:assert/strict'
import { test } from 'node:test'
import { XaiVideoAdapter, normalizeXaiRatio } from '../src/services/adapters/xai-video'
import { AiaskVideoAdapter } from '../src/services/adapters/aiask-video'
import { toGrokImageRefs } from '../src/services/adapters/video-common'
import { getVideoAdapter } from '../src/services/adapters/registry'
import { isOfficialProvider } from '../src/services/ai'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const xai = { provider: 'xai', baseUrl: 'https://api.x.ai', apiKey: 'xai-test', model: 'grok-imagine-video-1.5' }

test('xai is a registered video provider', () => {
  assert.ok(isOfficialProvider('video', 'xai'))
  assert.equal(getVideoAdapter('xai').provider, 'xai')
})

test('xai text-to-video follows the native contract', () => {
  const req = new XaiVideoAdapter().buildGenerateRequest(xai, { id: 1, prompt: 'rocket on mars', duration: 30, aspectRatio: '21:9', resolution: '1080p' })
  assert.equal(req.url, 'https://api.x.ai/v1/videos/generations')
  assert.equal(req.headers.Authorization, 'Bearer xai-test')
  assert.deepEqual(req.body, { model: 'grok-imagine-video-1.5', prompt: 'rocket on mars', duration: 15, aspect_ratio: '21:9', resolution: '1080p' })
})

test('xai image-to-video sends image.url; last frame alone is used as the image', () => {
  const adapter = new XaiVideoAdapter()
  const i2v = adapter.buildGenerateRequest(xai, { id: 2, prompt: 'p', firstFrameUrl: PNG, referenceImageUrls: JSON.stringify([PNG]) })
  assert.deepEqual(i2v.body.image, { url: PNG })
  assert.equal(i2v.body.reference_images, undefined, 'image-to-video does not mix in references')
  assert.deepEqual(adapter.buildGenerateRequest(xai, { id: 3, prompt: 'p', lastFrameUrl: PNG }).body.image, { url: PNG })
})

test('xai reference-to-video: reference_images, <IMAGE_n> prompt refs, 720p cap, per-model limits', () => {
  const adapter = new XaiVideoAdapter()
  const refs = Array.from({ length: 20 }, (_, i) => `https://cdn.example.com/${i}.png`)
  const req = adapter.buildGenerateRequest(xai, {
    id: 4, prompt: '@图片1林夏走进@图片2酒馆，@图片30不存在', duration: 12, resolution: '1080p', aspectRatio: '9:16',
    referenceImageUrls: JSON.stringify(refs),
  })
  assert.equal(req.body.reference_images.length, 14)
  assert.deepEqual(req.body.reference_images[0], { url: refs[0] })
  assert.equal(req.body.prompt, '<IMAGE_0>林夏走进<IMAGE_1>酒馆，@图片30不存在')
  assert.equal(req.body.resolution, '720p')
  assert.equal(req.body.duration, 12)

  const base = adapter.buildGenerateRequest({ ...xai, model: 'grok-imagine-video' }, {
    id: 5, prompt: 'p', model: 'grok-imagine-video', duration: 15, referenceImageUrls: JSON.stringify(refs),
  })
  assert.equal(base.body.reference_images.length, 7)
  assert.equal(base.body.duration, 10)
})

test('xai create / poll / download lifecycle', () => {
  const adapter = new XaiVideoAdapter()
  assert.deepEqual(adapter.parseGenerateResponse({ request_id: 'd974' }), { isAsync: true, taskId: 'd974' })
  assert.throws(() => adapter.parseGenerateResponse({}))
  assert.equal(adapter.buildPollRequest({ ...xai, baseUrl: 'https://aiask.me/v1' }, 'd974').url, 'https://aiask.me/v1/videos/d974')
  assert.equal(adapter.parsePollResponse({ status: 'pending' }).status, 'pending')
  assert.deepEqual(
    adapter.parsePollResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/a/video.mp4', duration: 8 }, model: 'grok-imagine-video-1.5' }),
    { status: 'completed', videoUrl: 'https://vidgen.x.ai/a/video.mp4', duration: 8 },
  )
  assert.equal(adapter.parsePollResponse({ status: 'done' }).status, 'failed', 'done without a url must not poll forever')
  assert.match(adapter.parsePollResponse({ status: 'expired' }).error!, /expired/)
  assert.match(adapter.parsePollResponse({ status: 'failed', error: { message: 'moderation' } }).error!, /moderation/)

  // xAI 临时直链不带 Key；aiask Grok 分组改写成的相对 content 地址带 Key
  assert.equal(adapter.resolveDownload!(xai, 'https://vidgen.x.ai/a/video.mp4').headers, undefined)
  const viaGateway = adapter.resolveDownload!({ ...xai, baseUrl: 'https://aiask.me' }, '/v1/videos/d974/content')
  assert.equal(viaGateway.url, 'https://aiask.me/v1/videos/d974/content')
  assert.equal(viaGateway.headers?.Authorization, 'Bearer xai-test')
})

test('normalizeXaiRatio keeps native ratios and snaps others', () => {
  assert.equal(normalizeXaiRatio('5:2'), '5:2')
  assert.equal(normalizeXaiRatio('21:9'), '21:9')
  assert.equal(normalizeXaiRatio('adaptive'), '16:9')
  assert.equal(normalizeXaiRatio('2:1'), '16:9')
  assert.equal(normalizeXaiRatio('12:5'), '21:9')
})

test('aiask grok multimodal_reference also rewrites @图片N to <IMAGE_n>', async () => {
  const req = await new AiaskVideoAdapter().buildGenerateRequest(
    { provider: 'aiask', baseUrl: 'https://aiask.me', apiKey: 'k', model: 'grok-imagine-video-1.5' },
    { id: 6, prompt: '@图片1少年推门', referenceImageUrls: JSON.stringify([PNG]) },
  )
  assert.equal((req.body as FormData).get('prompt'), '<IMAGE_0>少年推门')
  assert.equal(toGrokImageRefs('@图片2', 1), '@图片2')
})
