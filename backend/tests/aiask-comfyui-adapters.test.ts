import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AiaskVideoAdapter, normalizeAiaskRatio, normalizeAiaskResolution } from '../src/services/adapters/aiask-video'
import { AiaskImageAdapter, sizeToGrokAspectRatio } from '../src/services/adapters/aiask-image'
import {
  ComfyUIVideoAdapter,
  COMFYUI_DEFAULT_WORKFLOW,
  comfyDimensions,
  comfyFrameCount,
  parseComfyWorkflow,
  renderComfyWorkflow,
  classesWithDroppedLinks,
} from '../src/services/adapters/comfyui-video'
import { getImageAdapter, getVideoAdapter } from '../src/services/adapters/registry'
import { isOfficialProvider } from '../src/services/ai'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const aiask = {
  provider: 'aiask',
  baseUrl: 'https://aiask.me',
  apiKey: 'sk-test',
  model: 'grok-imagine-video-1.5',
}

test('aiask and comfyui are registered providers', () => {
  assert.ok(isOfficialProvider('text', 'aiask'))
  assert.ok(isOfficialProvider('image', 'aiask'))
  assert.ok(isOfficialProvider('video', 'aiask'))
  assert.ok(isOfficialProvider('video', 'comfyui'))
  assert.ok(!isOfficialProvider('text', 'comfyui'))
  assert.equal(getVideoAdapter('aiask').provider, 'aiask')
  assert.equal(getVideoAdapter('comfyui').provider, 'comfyui')
  assert.equal(getImageAdapter('aiask').provider, 'aiask')
})

test('aiask grok video: text-to-video is JSON on POST /v1/videos with required params', async () => {
  const req = await new AiaskVideoAdapter().buildGenerateRequest(aiask, {
    id: 1, prompt: 'a paper boat', duration: 30, aspectRatio: '21:9', resolution: '1080p',
  })
  assert.equal(req.url, 'https://aiask.me/v1/videos')
  assert.equal(req.method, 'POST')
  assert.equal(req.headers.Authorization, 'Bearer sk-test')
  assert.deepEqual(req.body, {
    model: 'grok-imagine-video-1.5',
    prompt: 'a paper boat',
    mode: 'text_to_video',
    duration_seconds: 15,
    ratio: '16:9',
    video_resolution: '1080p',
  })
})

test('aiask grok video: base URL with /v1 is not doubled', async () => {
  const req = await new AiaskVideoAdapter().buildGenerateRequest({ ...aiask, baseUrl: 'https://aiask.me/v1/' }, { id: 1, prompt: 'p' })
  assert.equal(req.url, 'https://aiask.me/v1/videos')
})

test('aiask grok video: reference images go multipart as multimodal_reference (720p cap)', async () => {
  const req = await new AiaskVideoAdapter().buildGenerateRequest(aiask, {
    id: 2, prompt: 'hero walks in', duration: 6, aspectRatio: '9:16', resolution: '1080p',
    referenceImageUrls: JSON.stringify([PNG, PNG]),
  })
  assert.ok(req.body instanceof FormData)
  const form = req.body as FormData
  assert.equal(form.get('mode'), 'multimodal_reference')
  assert.equal(form.get('video_resolution'), '720p')
  assert.equal(form.get('ratio'), '9:16')
  assert.equal(form.get('duration_seconds'), '6')
  assert.equal(form.getAll('reference_images').length, 2)
  assert.equal(req.headers['Content-Type'], undefined, 'multipart boundary is set by fetch')
})

test('aiask grok video: first/last frames and lite models', async () => {
  const adapter = new AiaskVideoAdapter()
  const flf = await adapter.buildGenerateRequest(aiask, { id: 3, prompt: 'p', firstFrameUrl: PNG, lastFrameUrl: PNG })
  assert.equal((flf.body as FormData).get('mode'), 'first_last_frames')
  assert.ok((flf.body as FormData).get('first_frame') instanceof Blob)
  assert.ok((flf.body as FormData).get('last_frame') instanceof Blob)

  const lite = await adapter.buildGenerateRequest({ ...aiask, model: 'grok-imagine-video-1.5-lite' }, {
    id: 4, prompt: 'p', model: 'grok-imagine-video-1.5-lite', referenceImageUrls: JSON.stringify([PNG, PNG]),
  })
  assert.equal((lite.body as FormData).get('mode'), 'image_to_video')
  assert.equal((lite.body as FormData).getAll('image').length, 1)
})

test('aiask grok video: create / poll / download lifecycle', () => {
  const adapter = new AiaskVideoAdapter()
  assert.deepEqual(adapter.parseGenerateResponse({ id: 'vid_1', object: 'video', status: 'in_progress' }), { isAsync: true, taskId: 'vid_1' })
  assert.deepEqual(adapter.parseGenerateResponse({ video: { id: 'vid_2', status: 'in_progress' } }), { isAsync: true, taskId: 'vid_2' })
  assert.throws(() => adapter.parseGenerateResponse({ status: 'in_progress' }))

  assert.equal(adapter.buildPollRequest(aiask, 'vid_1').url, 'https://aiask.me/v1/videos/vid_1')
  assert.equal(adapter.parsePollResponse({ id: 'vid_1', status: 'in_progress', queue: { position: 3 } }).status, 'processing')
  assert.equal(adapter.parsePollResponse({ id: 'vid_1', status: 'queued' }).status, 'pending')

  const done = adapter.parsePollResponse({ id: 'vid_1', status: 'completed', duration_seconds: 6, content_url: '/v1/videos/vid_1/content' })
  assert.deepEqual(done, { status: 'completed', videoUrl: '/v1/videos/vid_1/content', duration: 6 })
  // 缺 content_url 时按任务 ID 推出取回地址
  assert.equal(adapter.parsePollResponse({ id: 'vid_9', status: 'completed' }).videoUrl, '/v1/videos/vid_9/content')

  const failed = adapter.parsePollResponse({ id: 'vid_1', status: 'failed', error: { code: 'moderation', message: 'blocked' } })
  assert.equal(failed.status, 'failed')
  assert.match(failed.error!, /blocked/)

  const dl = adapter.resolveDownload(aiask, '/v1/videos/vid_1/content')
  assert.equal(dl.url, 'https://aiask.me/v1/videos/vid_1/content')
  assert.equal(dl.headers?.Authorization, 'Bearer sk-test')
  assert.equal(dl.fallbackExt, '.mp4')
  assert.equal(adapter.resolveDownload({ ...aiask, baseUrl: 'https://aiask.me/v1' }, '/v1/videos/vid_1/content').url, 'https://aiask.me/v1/videos/vid_1/content')
  // 第三方直链不泄露 Key
  assert.equal(adapter.resolveDownload(aiask, 'https://cdn.example.com/a.mp4').headers, undefined)
})

test('aiask ratio / resolution normalization', () => {
  assert.equal(normalizeAiaskRatio('16:9'), '16:9')
  assert.equal(normalizeAiaskRatio('21:9'), '16:9')
  assert.equal(normalizeAiaskRatio('adaptive'), '16:9')
  assert.equal(normalizeAiaskRatio('9:21'), '9:16')
  assert.equal(normalizeAiaskResolution('2K', 'image_to_video'), '1080p')
  assert.equal(normalizeAiaskResolution('1080p', 'first_last_frames'), '720p')
  assert.equal(normalizeAiaskResolution(undefined, 'text_to_video'), '720p')
})

test('aiask image: gpt-image follows OpenAI, grok uses aspect_ratio + JSON edits', () => {
  const adapter = new AiaskImageAdapter()
  const cfg = { provider: 'aiask', baseUrl: 'https://aiask.me', apiKey: 'sk-test', model: 'gpt-image-2' }

  const gpt = adapter.buildGenerateRequest(cfg, { id: 1, prompt: 'cat', size: '1920x1080' })
  assert.equal(gpt.url, 'https://aiask.me/v1/images/generations')
  assert.equal(gpt.body.model, 'gpt-image-2')
  assert.equal(gpt.body.response_format, undefined)

  const grok = adapter.buildGenerateRequest(cfg, { id: 2, model: 'grok-imagine-image', prompt: 'cat', size: '1080x1920' })
  assert.equal(grok.url, 'https://aiask.me/v1/images/generations')
  assert.equal(grok.body.aspect_ratio, '9:16')
  assert.equal(grok.body.response_format, 'b64_json')

  const grokEdit = adapter.buildGenerateRequest(cfg, { id: 3, model: 'grok-imagine-image', prompt: 'cat', referenceImages: JSON.stringify([PNG]) })
  assert.equal(grokEdit.url, 'https://aiask.me/v1/images/edits')
  assert.deepEqual(grokEdit.body.image, { type: 'image_url', url: PNG })

  const gemini = adapter.buildGenerateRequest(cfg, { id: 4, model: 'gemini-3-pro-image', prompt: 'cat', referenceImages: JSON.stringify([PNG]) })
  assert.equal(gemini.url, 'https://aiask.me/v1/images/edits')
  assert.ok(gemini.body instanceof FormData)

  assert.deepEqual(adapter.parseGenerateResponse({ id: 'img_1', data: [{ b64_json: 'QQ==' }] }), { isAsync: false, imageUrl: undefined })
  assert.deepEqual(adapter.extractImageBase64({ data: [{ b64_json: 'QQ==' }], output_format: 'jpg' }), { data: 'QQ==', mimeType: 'image/jpeg' })
  assert.equal(sizeToGrokAspectRatio('1024x1024'), '1:1')
})

test('comfyui: workflow parsing rejects UI-format exports and accepts /prompt bodies', () => {
  assert.equal(parseComfyWorkflow(''), null)
  assert.throws(() => parseComfyWorkflow('{bad'), /合法 JSON/)
  assert.throws(() => parseComfyWorkflow({ nodes: [], links: [] }), /导出 \(API\)/)
  const wrapped = parseComfyWorkflow(JSON.stringify({ prompt: { '1': { class_type: 'LoadImage', inputs: {} } } }))
  assert.deepEqual(Object.keys(wrapped!), ['1'])
})

test('comfyui: dimensions and frame counts follow Wan constraints', () => {
  assert.deepEqual(comfyDimensions('16:9', '720p'), { width: 1248, height: 704 })
  assert.deepEqual(comfyDimensions('9:16', '480p'), { width: 480, height: 864 })
  assert.deepEqual(comfyDimensions('1:1', '1080p'), { width: 1056, height: 1056 })
  assert.equal(comfyFrameCount(5, 24), 121)
  assert.equal(comfyFrameCount(5, 16), 81)
})

test('comfyui: placeholders are typed, missing images prune LoadImage and its links', () => {
  const text2video = renderComfyWorkflow(COMFYUI_DEFAULT_WORKFLOW, {
    prompt: 'rain', negative_prompt: 'blur', seed: 7, width: 1248, height: 704, frames: 121, fps: 24,
  })
  assert.equal(text2video['3'].inputs.seed, 7)
  assert.equal(text2video['6'].inputs.text, 'rain')
  assert.equal(text2video['55'].inputs.length, 121)
  assert.equal(text2video['56'], undefined, 'LoadImage removed without an image')
  assert.equal(text2video['55'].inputs.start_image, undefined, 'dangling link removed')
  assert.deepEqual(text2video['55'].inputs.vae, ['39', 0])

  const withImage = renderComfyWorkflow(COMFYUI_DEFAULT_WORKFLOW, {
    prompt: 'rain', negative_prompt: 'blur', seed: 7, width: 1248, height: 704, frames: 121, fps: 24, image: 'uu889-1-image.png',
  })
  assert.equal(withImage['56'].inputs.image, 'uu889-1-image.png')
  assert.deepEqual(withImage['55'].inputs.start_image, ['56', 0])

  // 级联：LoadImage → ImageScale 一并移除，消费方只丢掉那条连线
  const cascade = renderComfyWorkflow({
    '1': { class_type: 'LoadImage', inputs: { image: '{{first_frame}}' } },
    '2': { class_type: 'ImageScale', inputs: { image: ['1', 0], width: '{{width}}' } },
    '3': { class_type: 'Sampler', inputs: { model: ['4', 0], start: ['2', 0], text: 'shot: {{prompt}}' } },
    '4': { class_type: 'UNETLoader', inputs: { unet_name: 'x.safetensors' } },
  }, { width: 512, prompt: 'x' })
  assert.deepEqual(Object.keys(cascade).sort(), ['3', '4'])
  assert.deepEqual(cascade['3'].inputs, { model: ['4', 0], text: 'shot: x' })
  // 整条链都依赖缺失的图片时报错，而不是提交空工作流
  assert.throws(() => renderComfyWorkflow({
    '1': { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
  }, {}), /裁剪后为空/)

  assert.throws(() => renderComfyWorkflow({ '1': { class_type: 'X', inputs: { v: '{{nope}}' } } }, {}), /不支持的占位符/)
})

test('comfyui: submit / history / view lifecycle', async () => {
  const adapter = new ComfyUIVideoAdapter()
  const cfg = { provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188/', apiKey: '', model: 'wan2.2-ti2v-5b', settings: { comfyui_fps: 16 } }
  const req = await adapter.buildGenerateRequest(cfg, { id: 9, prompt: 'rain', duration: 5, aspectRatio: '16:9', resolution: '480p', seed: 3 })
  assert.equal(req.url, 'http://127.0.0.1:8188/prompt')
  assert.equal(req.headers.Authorization, undefined)
  assert.equal(req.body.client_id, 'uu889-drama')
  assert.equal(req.body.prompt['55'].inputs.length, 81)
  assert.equal(req.body.prompt['55'].inputs.width, 864)
  assert.equal(req.body.prompt['57'].inputs.fps, 16)
  assert.equal(req.body.prompt['3'].inputs.seed, 3)

  assert.deepEqual(adapter.parseGenerateResponse({ prompt_id: 'abc', number: 1, node_errors: {} }), { isAsync: true, taskId: 'abc' })
  // 有 prompt_id 即已入队：部分输出节点校验失败时 ComfyUI 仍会执行其余输出
  assert.deepEqual(adapter.parseGenerateResponse({ prompt_id: 'abc', node_errors: { '9': { class_type: 'PreviewImage', errors: [{ message: 'x' }] } } }), { isAsync: true, taskId: 'abc' })
  assert.throws(() => adapter.parseGenerateResponse({ node_errors: { '3': { class_type: 'KSampler', errors: [{ message: 'Value out of range', details: 'bad seed' }] } } }), /bad seed/)
  // /prompt 400：node_errors 整理成可读文案
  const described = adapter.describeError(400, JSON.stringify({
    error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
    node_errors: { '58': { class_type: 'SaveVideo', errors: [{ message: 'Required input is missing', details: 'video' }] } },
  }))
  assert.match(described!, /^ComfyUI 工作流校验失败（HTTP 400）：Prompt outputs failed validation — #58 SaveVideo — Required input is missing: video/)
  assert.equal(adapter.describeError(500, 'oops'), null)

  assert.equal(adapter.buildPollRequest(cfg, 'abc').url, 'http://127.0.0.1:8188/history/abc')
  assert.equal(adapter.parsePollResponse({}).status, 'processing')

  const done = adapter.parsePollResponse({
    abc: {
      status: { status_str: 'success', completed: true, messages: [] },
      outputs: {
        '9': { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
        '58': { images: [{ filename: 'uu889-drama_00001_.mp4', subfolder: 'video', type: 'output' }], animated: [true] },
      },
    },
  })
  assert.equal(done.status, 'completed')
  assert.equal(done.videoUrl, '/view?filename=uu889-drama_00001_.mp4&subfolder=video&type=output')
  assert.equal(adapter.resolveDownload(cfg, done.videoUrl!).url, 'http://127.0.0.1:8188/view?filename=uu889-drama_00001_.mp4&subfolder=video&type=output')

  const failed = adapter.parsePollResponse({
    abc: { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'UNETLoader', exception_message: 'model not found' }]] }, outputs: {} },
  })
  assert.equal(failed.status, 'failed')
  assert.match(failed.error!, /UNETLoader model not found/)

  const noVideo = adapter.parsePollResponse({ abc: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'a.png', type: 'output' }] } } } })
  assert.equal(noVideo.status, 'failed')
})

test('comfyui: empty prompt is substituted, not reported as an unknown placeholder', () => {
  const w = renderComfyWorkflow({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }, { prompt: '' })
  assert.equal(w['1'].inputs.text, '')
  assert.throws(() => renderComfyWorkflow({ '1': { class_type: 'X', inputs: { v: '{{nope}}' } } }, { nope: '' }), /不支持的占位符/)
})

test('comfyui: pruning removes nodes that lose a required link (Wan 2.1 I2V CLIPVisionEncode)', () => {
  const template = {
    '49': { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'clip_vision_h.safetensors' } },
    '52': { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
    '51': { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['49', 0], image: ['52', 0], crop: 'none' } },
    '50': { class_type: 'WanImageToVideo', inputs: { clip_vision_output: ['51', 0], start_image: ['52', 0], vae: ['39', 0], width: 832 } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: 'wan.safetensors' } },
  }
  // 没有必填信息时：CLIPVisionEncode 还有 clip_vision 连线，只丢掉 image（旧行为）
  const loose = renderComfyWorkflow(template, {})
  assert.ok(loose['51'])
  assert.deepEqual(classesWithDroppedLinks(template, loose).sort(), ['CLIPVisionEncode', 'WanImageToVideo'])
  // 有 /object_info 必填信息：image 是 CLIPVisionEncode 的必填输入 → 整个节点移除，WanImageToVideo 的可选输入一并断开
  const strict = renderComfyWorkflow(template, {}, { CLIPVisionEncode: ['clip_vision', 'image', 'crop'], WanImageToVideo: ['vae', 'width'] })
  assert.equal(strict['51'], undefined)
  assert.deepEqual(Object.keys(strict['50'].inputs).sort(), ['vae', 'width'])
})

test('comfyui: lost tasks fail fast; animated-only output gets a clear error', async () => {
  const adapter = new ComfyUIVideoAdapter()
  assert.match(adapter.parsePollResponse({ __comfyMissing: true }).error!, /找不到该任务/)
  const gifOnly = adapter.parsePollResponse({ p: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'a.webp', type: 'output' }], animated: [true] } } } })
  assert.equal(gifOnly.status, 'failed')
  assert.match(gifOnly.error!, /GIF \/ WebP/)

  // fetchPollResult：history 为空时查 queue，在队列里 → 继续等；都不在 → 丢失
  const cfg = { provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model: 'm' }
  const realFetch = globalThis.fetch
  const respond = (routes: Record<string, unknown>) => {
    globalThis.fetch = (async (url: string) => {
      const path = new URL(url).pathname
      return new Response(JSON.stringify(routes[path] ?? {}), { status: 200 })
    }) as typeof fetch
  }
  try {
    respond({ '/history/p1': {}, '/queue': { queue_running: [], queue_pending: [[3, 'p1', {}, {}, []]] } })
    assert.deepEqual(await adapter.fetchPollResult(cfg, 'p1'), {})
    respond({ '/history/p1': {}, '/queue': { queue_running: [], queue_pending: [] } })
    assert.deepEqual(await adapter.fetchPollResult(cfg, 'p1'), { __comfyMissing: true })
    respond({ '/history/p1': { p1: { status: { status_str: 'success' } } } })
    assert.ok((await adapter.fetchPollResult(cfg, 'p1')).p1)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(adapter.pollProfile.attempts * adapter.pollProfile.intervalMs, 6 * 3600 * 1000)
})
