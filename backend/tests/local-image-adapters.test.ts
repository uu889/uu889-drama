import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ComfyUIImageAdapter, COMFYUI_DEFAULT_IMAGE_WORKFLOW } from '../src/services/adapters/comfyui-image'
import { SdWebuiImageAdapter } from '../src/services/adapters/sdwebui-image'
import { FooocusImageAdapter, fooocusAspectRatio } from '../src/services/adapters/fooocus-image'
import { localAuthHeaders, localImageDimensions } from '../src/services/adapters/local-image'
import { getImageAdapter } from '../src/services/adapters/registry'
import { isOfficialProvider } from '../src/services/ai'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

test('local image providers are registered', () => {
  for (const p of ['comfyui', 'sdwebui', 'fooocus']) {
    assert.ok(isOfficialProvider('image', p), p)
    assert.equal(getImageAdapter(p).provider, p)
  }
  assert.ok(!isOfficialProvider('video', 'sdwebui'))
})

test('local image sizing keeps aspect ratio near base² aligned to 64', () => {
  assert.deepEqual(localImageDimensions('1920x1080'), { width: 1344, height: 768 })
  assert.deepEqual(localImageDimensions('1080x1920'), { width: 768, height: 1344 })
  assert.deepEqual(localImageDimensions('1024x1024'), { width: 1024, height: 1024 })
  assert.deepEqual(localImageDimensions('1920x1080', 512), { width: 704, height: 384 })
  assert.deepEqual(localImageDimensions(undefined), { width: 1024, height: 1024 })
})

test('local auth: user:pass is HTTP Basic, other keys Bearer + X-API-KEY, empty sends nothing', () => {
  assert.deepEqual(localAuthHeaders(''), {})
  assert.equal(localAuthHeaders('me:secret').Authorization, `Basic ${Buffer.from('me:secret').toString('base64')}`)
  assert.deepEqual(localAuthHeaders('abc'), { Authorization: 'Bearer abc', 'X-API-KEY': 'abc' })
})

test('ComfyUI image: default SDXL workflow with typed placeholders, /view result', async () => {
  const adapter = new ComfyUIImageAdapter()
  const cfg = { provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model: 'juggernautXL.safetensors', settings: { image_steps: 30, image_cfg_scale: 5.5 } }
  const req = await adapter.buildGenerateRequest(cfg, { id: 1, prompt: 'a castle', size: '1920x1080' })
  const wf = req.body.prompt
  assert.equal(req.url, 'http://127.0.0.1:8188/prompt')
  assert.equal(wf['4'].inputs.ckpt_name, 'juggernautXL.safetensors')
  assert.deepEqual([wf['5'].inputs.width, wf['5'].inputs.height], [1344, 768])
  assert.equal(wf['3'].inputs.steps, 30)
  assert.equal(wf['3'].inputs.cfg, 5.5)
  assert.equal(typeof wf['3'].inputs.seed, 'number')
  assert.equal(wf['6'].inputs.text, 'a castle')
  assert.ok(wf['7'].inputs.text.includes('lowres'), 'default negative prompt')
  assert.ok(COMFYUI_DEFAULT_IMAGE_WORKFLOW['9'].class_type === 'SaveImage')

  assert.equal(adapter.parsePollResponse({}).status, 'processing')
  const done = adapter.parsePollResponse({ p: { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'uu889-drama_00001_.png', subfolder: '', type: 'output' }] } } } })
  assert.deepEqual(done, { status: 'completed', imageUrl: '/view?filename=uu889-drama_00001_.png&subfolder=&type=output' })
  assert.equal(adapter.resolveDownload(cfg, done.imageUrl!).url, 'http://127.0.0.1:8188/view?filename=uu889-drama_00001_.png&subfolder=&type=output')
  assert.equal(adapter.parsePollResponse({ p: { status: { status_str: 'success', completed: true }, outputs: {} } }).status, 'failed')
  assert.equal(adapter.parsePollResponse({ __comfyMissing: true }).status, 'failed')
  assert.equal(adapter.pollProfile.maxDurationMs, null, 'local queue: no 10-minute image cap')
})

test('SD WebUI: txt2img payload, model override, base64 result, readable errors', () => {
  const adapter = new SdWebuiImageAdapter()
  const cfg = { provider: 'sdwebui', baseUrl: 'http://127.0.0.1:7860/', apiKey: 'me:pw', model: 'default', settings: { image_base_size: 512, image_sampler: 'DPM++ 2M', image_negative_prompt: 'ugly' } }
  const req = adapter.buildGenerateRequest(cfg, { id: 1, prompt: 'cat', size: '1080x1920' })
  assert.equal(req.url, 'http://127.0.0.1:7860/sdapi/v1/txt2img')
  assert.match(req.headers.Authorization, /^Basic /)
  assert.deepEqual(
    { w: req.body.width, h: req.body.height, steps: req.body.steps, cfg: req.body.cfg_scale, sampler: req.body.sampler_name, neg: req.body.negative_prompt },
    { w: 384, h: 704, steps: 25, cfg: 7, sampler: 'DPM++ 2M', neg: 'ugly' },
  )
  assert.equal(req.body.override_settings, undefined, 'default keeps the loaded checkpoint')
  const withModel = adapter.buildGenerateRequest({ ...cfg, model: 'sd_xl_base_1.0' }, { id: 2, prompt: 'cat' })
  assert.deepEqual(withModel.body.override_settings, { sd_model_checkpoint: 'sd_xl_base_1.0' })

  assert.deepEqual(adapter.parseGenerateResponse({ images: ['QQ=='], info: '{}' }), { isAsync: false, imageUrl: undefined })
  assert.deepEqual(adapter.extractImageBase64({ images: ['QQ=='] }), { data: 'QQ==', mimeType: 'image/png' })
  assert.throws(() => adapter.parseGenerateResponse({ images: [] }))
  assert.match(adapter.describeError(500, JSON.stringify({ error: 'OutOfMemoryError', detail: 'CUDA out of memory' }))!, /CUDA out of memory/)
  assert.match(adapter.describeError(404, 'Not Found')!, /--api/)
})

test('Fooocus: text-to-image vs image prompts, nearest SDXL ratio, async job lifecycle', () => {
  const adapter = new FooocusImageAdapter()
  const cfg = { provider: 'fooocus', baseUrl: 'http://127.0.0.1:8888', apiKey: '', model: 'default', settings: { fooocus_performance: 'Quality', fooocus_styles: 'Fooocus V2, Fooocus Sharp' } }
  const t2i = adapter.buildGenerateRequest(cfg, { id: 1, prompt: 'cat', size: '1920x1080' })
  assert.equal(t2i.url, 'http://127.0.0.1:8888/v1/generation/text-to-image')
  assert.equal(t2i.body.aspect_ratios_selection, '1344*768')
  assert.equal(t2i.body.performance_selection, 'Quality')
  assert.deepEqual(t2i.body.style_selections, ['Fooocus V2', 'Fooocus Sharp'])
  assert.equal(t2i.body.async_process, true)
  assert.equal(t2i.body.require_base64, true)
  assert.equal(t2i.body.base_model_name, undefined)

  const ip = adapter.buildGenerateRequest({ ...cfg, model: 'juggernautXL.safetensors' }, {
    id: 2, prompt: 'hero', size: '1024x1024', referenceImages: JSON.stringify([PNG, 'https://x/a.png', PNG, PNG, PNG]),
  })
  assert.equal(ip.url, 'http://127.0.0.1:8888/v2/generation/text-to-image-with-ip')
  assert.equal(ip.body.image_prompts.length, 4)
  assert.deepEqual(ip.body.image_prompts[0], { cn_img: 'iVBORw0KGgo=', cn_stop: 0.5, cn_weight: 1.0, cn_type: 'ImagePrompt' })
  assert.equal(ip.body.image_prompts[1].cn_img, 'https://x/a.png')
  assert.equal(ip.body.base_model_name, 'juggernautXL.safetensors')

  assert.deepEqual(adapter.parseGenerateResponse({ job_id: 'j1', job_stage: 'WAITING' }), { isAsync: true, taskId: 'j1' })
  assert.match(adapter.buildPollRequest(cfg, 'j1').url, /\/v1\/generation\/query-job\?job_id=j1/)
  assert.equal(adapter.parsePollResponse({ job_stage: 'WAITING' }).status, 'pending')
  assert.equal(adapter.parsePollResponse({ job_stage: 'RUNNING', job_progress: 40 }).status, 'processing')
  const done = { job_stage: 'SUCCESS', job_result: [{ base64: 'QUJD', url: 'http://127.0.0.1:8888/files/a.png', seed: 1, finish_reason: 'SUCCESS' }] }
  assert.deepEqual(adapter.parsePollResponse(done), { status: 'completed', imageUrl: undefined })
  assert.deepEqual(adapter.extractImageBase64(done), { data: 'QUJD', mimeType: 'image/png' })
  assert.match(adapter.parsePollResponse({ job_stage: 'ERROR', job_error: 'CUDA OOM' }).error!, /CUDA OOM/)
  assert.equal(adapter.parsePollResponse({ job_stage: 'SUCCESS', job_result: [{ finish_reason: 'USER_CANCEL' }] }).status, 'failed')
  // 同步返回（未开启 async 的部署）也能处理
  assert.deepEqual(adapter.parseGenerateResponse([{ base64: 'QUJD', finish_reason: 'SUCCESS' }]), { isAsync: false, imageUrl: undefined })

  assert.equal(fooocusAspectRatio('1080x1920'), '768*1344')
  assert.equal(fooocusAspectRatio('2560x1080'), '1536*640')
})
