import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VeoVideoAdapter, veoDuration, veoAspectRatio } from '../src/services/adapters/veo-video'
import { RunwayVideoAdapter, nearestRunwayRatio, fitPromptImage } from '../src/services/adapters/runway-video'
import { XaiImageAdapter } from '../src/services/adapters/aiask-image'
import { describeComfyExecutionError, summarizeComfyNodeErrors } from '../src/services/adapters/comfyui-common'
import { getImageAdapter, getVideoAdapter } from '../src/services/adapters/registry'
import { getTextProviderBaseUrl, isOfficialProvider } from '../src/services/ai'
import { claudeRejectsSampling, patchAiaskChatBody, patchClaudeBody } from '../src/agents/aiask-chat'
import { buildLanguageDirective, promptFallbackLanguages } from '../src/agents/language'
import { CONTENT_LANGUAGES } from '../src/services/app-settings'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('new providers are registered for the right service types', () => {
  for (const p of ['deepseek', 'qwen', 'claude', 'xai']) assert.ok(isOfficialProvider('text', p), p)
  assert.ok(isOfficialProvider('image', 'xai'))
  for (const p of ['veo', 'runway']) assert.ok(isOfficialProvider('video', p), p)
  assert.ok(!isOfficialProvider('image', 'claude'))
  assert.equal(getImageAdapter('xai').provider, 'xai')
  assert.equal(getVideoAdapter('veo').provider, 'veo')
  assert.equal(getVideoAdapter('runway').provider, 'runway')
})

test('text base URLs get the /v1 prefix exactly once', () => {
  const base = (provider: string, baseUrl: string) => getTextProviderBaseUrl({ provider, baseUrl, apiKey: '', model: '' })
  assert.equal(base('deepseek', 'https://api.deepseek.com'), 'https://api.deepseek.com/v1')
  assert.equal(base('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  assert.equal(base('xai', 'https://api.x.ai'), 'https://api.x.ai/v1')
  assert.equal(base('claude', 'https://api.anthropic.com'), 'https://api.anthropic.com/v1')
})

test('Claude: newest models drop sampling params, older ones keep them (direct and via aiask)', () => {
  assert.ok(claudeRejectsSampling('claude-opus-5-5'))
  assert.ok(claudeRejectsSampling('claude-sonnet-5-5'))
  assert.ok(claudeRejectsSampling('claude-fable-5-1'))
  assert.ok(claudeRejectsSampling('claude-opus-4-7'))
  assert.ok(!claudeRejectsSampling('claude-haiku-4-5'))
  assert.ok(!claudeRejectsSampling('claude-sonnet-4-6'))
  assert.deepEqual(patchClaudeBody({ model: 'claude-opus-5-5', messages: [], temperature: 0, top_p: 1, max_tokens: 16384 }), { model: 'claude-opus-5-5', messages: [], max_tokens: 16384 })
  assert.deepEqual(patchClaudeBody({ model: 'claude-haiku-4-5', messages: [], temperature: 0 }), { model: 'claude-haiku-4-5', messages: [], temperature: 0 })
  assert.deepEqual(patchAiaskChatBody({ model: 'claude-sonnet-5-5', messages: [], temperature: 0 }), { model: 'claude-sonnet-5-5', messages: [] })
})

test('DeepSeek turns thinking off for tool loops; Qwen sets enable_thinking false', () => {
  assert.deepEqual(patchAiaskChatBody({ model: 'deepseek-v4-pro', messages: [] }).thinking, { type: 'disabled' })
  assert.equal(patchAiaskChatBody({ model: 'qwen3-max', messages: [] }).enable_thinking, false)
  assert.equal(patchAiaskChatBody({ model: 'grok-4', messages: [], max_tokens: 10 }).max_tokens, 10)
})

test('Grok image (xAI): grok-imagine-image-2.0 default, aspect_ratio, single image edit', () => {
  const a = new XaiImageAdapter()
  const cfg = { provider: 'xai', baseUrl: 'https://api.x.ai', apiKey: 'k', model: '' }
  const gen = a.buildGenerateRequest(cfg, { id: 1, prompt: 'cat', size: '1920x1080' })
  assert.equal(gen.url, 'https://api.x.ai/v1/images/generations')
  assert.deepEqual(gen.body, { model: 'grok-imagine-image-2.0', prompt: 'cat', n: 1, aspect_ratio: '16:9', response_format: 'b64_json' })
  const edit = a.buildGenerateRequest(cfg, { id: 2, prompt: 'cat', referenceImages: JSON.stringify([PNG, PNG]) })
  assert.equal(edit.url, 'https://api.x.ai/v1/images/edits')
  assert.deepEqual(edit.body.image, { type: 'image_url', url: PNG })
  assert.equal(edit.body.images, undefined)
  assert.deepEqual(a.extractImageBase64({ data: [{ b64_json: 'QQ==', mime_type: 'image/jpeg' }] }), { data: 'QQ==', mimeType: 'image/jpeg' })
})

test('Veo: predictLongRunning body, references force 8s, lite falls back to first frame, lifecycle', async () => {
  const a = new VeoVideoAdapter()
  const cfg = { provider: 'veo', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'g-key', model: 'veo-3.1-generate-preview' }
  const t2v = await a.buildGenerateRequest(cfg, { id: 1, prompt: 'rain', duration: 5, aspectRatio: '9:16', resolution: '720p' })
  assert.equal(t2v.url, 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning')
  assert.equal(t2v.headers['x-goog-api-key'], 'g-key')
  assert.deepEqual(t2v.body, { instances: [{ prompt: 'rain' }], parameters: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 6 } })

  const refs = await a.buildGenerateRequest(cfg, { id: 2, prompt: 'hero', duration: 4, referenceImageUrls: JSON.stringify([PNG, PNG, PNG, PNG]) })
  assert.equal(refs.body.instances[0].referenceImages.length, 3)
  assert.deepEqual(refs.body.instances[0].referenceImages[0], { image: { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }, referenceType: 'asset' })
  assert.equal(refs.body.parameters.durationSeconds, 8)

  const flf = await a.buildGenerateRequest(cfg, { id: 3, prompt: 'p', firstFrameUrl: PNG, lastFrameUrl: PNG, resolution: '1080p', duration: 4 })
  assert.ok(flf.body.instances[0].image && flf.body.instances[0].lastFrame)
  assert.deepEqual([flf.body.parameters.resolution, flf.body.parameters.durationSeconds], ['1080p', 8])

  const lite = await a.buildGenerateRequest({ ...cfg, model: 'veo-3.1-lite-generate-preview' }, { id: 4, prompt: 'p', model: 'veo-3.1-lite-generate-preview', referenceImageUrls: JSON.stringify([PNG]) })
  assert.ok(lite.body.instances[0].image)
  assert.equal(lite.body.instances[0].referenceImages, undefined)

  assert.deepEqual(a.parseGenerateResponse({ name: 'models/veo-3.1-generate-preview/operations/abc' }), { isAsync: true, taskId: 'models/veo-3.1-generate-preview/operations/abc' })
  assert.equal(a.buildPollRequest(cfg, 'models/veo-3.1-generate-preview/operations/abc').url, 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview/operations/abc')
  assert.equal(a.parsePollResponse({ name: 'x', done: false }).status, 'processing')
  const uri = 'https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media'
  assert.deepEqual(a.parsePollResponse({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } }), { status: 'completed', videoUrl: uri })
  assert.match(a.parsePollResponse({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ['celebrity'] } } }).error!, /审核/)
  assert.match(a.parsePollResponse({ done: true, error: { code: 3, message: 'bad prompt' } }).error!, /bad prompt/)
  assert.equal(a.resolveDownload(cfg, uri).headers?.['x-goog-api-key'], 'g-key')
  assert.equal(a.resolveDownload(cfg, 'https://storage.googleapis.com/x.mp4').headers, undefined)
  assert.deepEqual([veoDuration(5, false), veoDuration(10, false), veoAspectRatio('1:1')], [6, 8, '16:9'])
})

test('Runway: model-specific ratios / durations, image vs text endpoints, task lifecycle', async () => {
  const a = new RunwayVideoAdapter()
  const cfg = { provider: 'runway', baseUrl: 'https://api.dev.runwayml.com', apiKey: 'rw', model: 'gen4.5' }
  const t2v = await a.buildGenerateRequest(cfg, { id: 1, prompt: 'rain', duration: 12, aspectRatio: '9:16' })
  assert.equal(t2v.url, 'https://api.dev.runwayml.com/v1/text_to_video')
  assert.equal(t2v.headers['X-Runway-Version'], '2024-11-06')
  assert.deepEqual(t2v.body, { model: 'gen4.5', promptText: 'rain', ratio: '720:1280', duration: 10 })

  const i2v = await a.buildGenerateRequest(cfg, { id: 2, prompt: 'p', aspectRatio: '1:1', referenceImageUrls: JSON.stringify([PNG]) })
  assert.equal(i2v.url, 'https://api.dev.runwayml.com/v1/image_to_video')
  assert.deepEqual([i2v.body.promptImage, i2v.body.ratio], [PNG, '960:960'])

  const veo = await a.buildGenerateRequest({ ...cfg, model: 'veo3.1' }, { id: 3, prompt: 'p', model: 'veo3.1', firstFrameUrl: PNG, lastFrameUrl: PNG, resolution: '1080p', duration: 5 })
  assert.deepEqual(veo.body.promptImage, [{ uri: PNG, position: 'first' }, { uri: PNG, position: 'last' }])
  assert.deepEqual([veo.body.ratio, veo.body.duration], ['1920:1080', 4])

  await assert.rejects(a.buildGenerateRequest({ ...cfg, model: 'gen4_turbo' }, { id: 4, prompt: 'p', model: 'gen4_turbo' }), /只支持图生视频/)
  const turbo = await a.buildGenerateRequest({ ...cfg, model: 'gen4_turbo' }, { id: 5, prompt: 'p', model: 'gen4_turbo', imageUrl: PNG, duration: 8 })
  assert.equal(turbo.body.duration, 10)

  assert.deepEqual(a.parseGenerateResponse({ id: 't1' }), { isAsync: true, taskId: 't1' })
  assert.equal(a.buildPollRequest(cfg, 't1').url, 'https://api.dev.runwayml.com/v1/tasks/t1')
  assert.equal(a.parsePollResponse({ status: 'THROTTLED' }).status, 'pending')
  assert.equal(a.parsePollResponse({ status: 'RUNNING' }).status, 'processing')
  assert.deepEqual(a.parsePollResponse({ status: 'SUCCEEDED', output: ['https://cdn/x.mp4'] }), { status: 'completed', videoUrl: 'https://cdn/x.mp4' })
  assert.match(a.parsePollResponse({ status: 'FAILED', failure: 'safety', failureCode: 'SAFETY.INPUT' }).error!, /SAFETY\.INPUT/)
  assert.equal(nearestRunwayRatio('21:9', ['1280:720', '1584:672']), '1584:672')

  // 超过 5 MB 的 data URI 压缩为 JPEG
  const sharp = (await import('sharp')).default
  const big = await sharp({ create: { width: 2600, height: 2600, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer()
  const fitted = await fitPromptImage(`data:image/png;base64,${big.toString('base64')}`)
  assert.ok(big.length > 5 * 1024 * 1024 ? fitted.startsWith('data:image/jpeg') : true)
})

test('ComfyUI errors explain truncated model files, OOM and missing models', () => {
  const corrupt = describeComfyExecutionError({
    node_type: 'CLIPLoader',
    exception_message: 'Error while deserializing header: incomplete metadata, file not fully covered',
    current_inputs: { clip_name: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], type: ['wan'] },
  })
  assert.match(corrupt, /不完整或已损坏/)
  assert.match(corrupt, /ComfyUI\/models\/text_encoders\/umt5_xxl_fp8_e4m3fn_scaled\.safetensors/)
  assert.match(describeComfyExecutionError({ node_type: 'KSampler', exception_message: 'CUDA out of memory. Tried to allocate 2 GiB' }), /显存不足/)
  assert.match(summarizeComfyNodeErrors({ '37': { class_type: 'UNETLoader', errors: [{ type: 'value_not_in_list', message: 'Value not in list', details: "unet_name: 'x.safetensors' not in []" }] } }), /ComfyUI\/models\/diffusion_models\//)
})

test('content languages: nine languages, English prompt fallback for the new ones', () => {
  assert.deepEqual([...CONTENT_LANGUAGES], ['zh', 'en', 'ja', 'ko', 'vi', 'de', 'fr', 'es', 'pt'])
  assert.deepEqual(promptFallbackLanguages('zh'), [])
  assert.deepEqual(promptFallbackLanguages('en'), ['en'])
  assert.deepEqual(promptFallbackLanguages('ja'), ['ja', 'en'])
  assert.deepEqual(promptFallbackLanguages('vi'), ['vi', 'en'])
  for (const [lang, name] of [['vi', 'Tiếng Việt'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português']]) {
    assert.ok(buildLanguageDirective(lang).includes(name), lang)
  }
})
