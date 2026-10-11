import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoBindComfyWorkflow, collectComfyPlaceholders } from '../src/services/adapters/comfyui-bind'
import { COMFY_IMAGE_TEMPLATES, COMFY_VIDEO_TEMPLATES, resolveComfyTemplate, splitModelFiles } from '../src/services/adapters/comfyui-templates'
import { ComfyMonitor, comfyQueuePosition, describeComfyPromptMeta } from '../src/services/adapters/comfyui-progress'
import { ComfyUIVideoAdapter, renderComfyWorkflow } from '../src/services/adapters/comfyui-video'
import { ComfyUIImageAdapter } from '../src/services/adapters/comfyui-image'
import { FooocusImageAdapter } from '../src/services/adapters/fooocus-image'
import { applyPromptTemplate } from '../src/services/adapters/local-image'
import { getTaskProgress, setTaskProgress } from '../src/services/task-progress'

/** 典型的「直接从 ComfyUI 导出」的 Wan 2.2 14B 图生视频工作流：没有任何占位符 */
const RAW_WAN_I2V: Record<string, any> = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat walking', clip: ['38', 0] }, _meta: { title: 'CLIP Text Encode (Positive Prompt)' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['38', 0] }, _meta: { title: 'CLIP Text Encode (Negative Prompt)' } },
  '37': { class_type: 'UNETLoader', inputs: { unet_name: 'high.safetensors', weight_dtype: 'default' } },
  '56': { class_type: 'UNETLoader', inputs: { unet_name: 'low.safetensors', weight_dtype: 'default' } },
  '38': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5.safetensors', type: 'wan', device: 'default' } },
  '39': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
  '52': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
  '50': { class_type: 'WanImageToVideo', inputs: { width: 640, height: 640, length: 81, batch_size: 1, positive: ['6', 0], negative: ['7', 0], vae: ['39', 0], start_image: ['52', 0] } },
  '57': { class_type: 'KSamplerAdvanced', inputs: { add_noise: 'enable', noise_seed: 123, steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', start_at_step: 0, end_at_step: 10, return_with_leftover_noise: 'enable', model: ['37', 0], positive: ['50', 0], negative: ['50', 1], latent_image: ['50', 2] } },
  '58': { class_type: 'KSamplerAdvanced', inputs: { add_noise: 'disable', noise_seed: 0, steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', start_at_step: 10, end_at_step: 10000, return_with_leftover_noise: 'disable', model: ['56', 0], positive: ['50', 0], negative: ['50', 1], latent_image: ['57', 0] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['58', 0], vae: ['39', 0] } },
  '60': { class_type: 'CreateVideo', inputs: { fps: 16, images: ['8', 0] } },
  '61': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/x', format: 'auto', codec: 'auto', video: ['60', 0] } },
}

test('auto-bind: exported video workflow without placeholders gets prompt / image / seed / size / frames / fps / model', () => {
  const { workflow, report } = autoBindComfyWorkflow(RAW_WAN_I2V, 'video', { model: 'my-high.safetensors|my-low.safetensors', steps: 30 })
  assert.equal(workflow['6'].inputs.text, '{{prompt}}')
  assert.equal(workflow['7'].inputs.text, '{{negative_prompt}}')
  assert.equal(workflow['52'].inputs.image, '{{image}}')
  assert.equal(workflow['57'].inputs.noise_seed, '{{seed}}')
  assert.equal(workflow['58'].inputs.noise_seed, 0, 'second stage seed (add_noise disable) is left alone')
  assert.equal(workflow['50'].inputs.width, '{{width}}')
  assert.equal(workflow['50'].inputs.height, '{{height}}')
  assert.equal(workflow['50'].inputs.length, '{{frames}}')
  assert.equal(workflow['60'].inputs.fps, '{{fps}}')
  assert.equal(workflow['37'].inputs.unet_name, 'my-high.safetensors')
  assert.equal(workflow['56'].inputs.unet_name, 'my-low.safetensors')
  // 两段采样的步数与分段点按比例换算
  assert.equal(workflow['57'].inputs.steps, 30)
  assert.equal(workflow['57'].inputs.end_at_step, 15)
  assert.equal(workflow['58'].inputs.start_at_step, 15)
  assert.equal(workflow['58'].inputs.end_at_step, 10000)
  assert.ok(report.bindings.some((b) => b.target === 'prompt' && b.source === 'auto'))
  assert.deepEqual(report.outputs.map((o) => o.class_type), ['SaveVideo'])

  // 替换后：无图时 LoadImage 被裁剪，WanImageToVideo 保留（start_image 是可选输入）
  const rendered = renderComfyWorkflow(workflow, { prompt: '女孩回头', negative_prompt: 'low', seed: 7, width: 832, height: 480, frames: 81, fps: 16 })
  assert.equal(rendered['6'].inputs.text, '女孩回头')
  assert.equal(rendered['57'].inputs.noise_seed, 7)
  assert.equal(rendered['50'].inputs.width, 832)
  assert.ok(!rendered['52'])
  assert.ok(!('start_image' in rendered['50'].inputs))
})

test('auto-bind: respects hand-written placeholders and can be disabled', () => {
  const template = COMFY_VIDEO_TEMPLATES[0].workflow
  const { workflow } = autoBindComfyWorkflow(template, 'video', {})
  assert.deepEqual(workflow, template)
  const off = autoBindComfyWorkflow(RAW_WAN_I2V, 'video', { enabled: false })
  assert.equal(off.workflow['6'].inputs.text, 'a cat walking')
})

test('auto-bind: first / last frame by title and downstream input, single model warns for dual loaders', () => {
  const flf = JSON.parse(JSON.stringify(RAW_WAN_I2V))
  flf['53'] = { class_type: 'LoadImage', inputs: { image: 'end.png' } }
  flf['50'] = { class_type: 'WanFirstLastFrameToVideo', inputs: { ...flf['50'].inputs, end_image: ['53', 0] } }
  const { workflow, report } = autoBindComfyWorkflow(flf, 'video', { model: 'only.safetensors' })
  assert.equal(workflow['52'].inputs.image, '{{image}}')
  assert.equal(workflow['53'].inputs.image, '{{last_frame}}')
  assert.equal(workflow['37'].inputs.unet_name, 'only.safetensors')
  assert.equal(workflow['56'].inputs.unet_name, 'low.safetensors')
  assert.ok(report.warnings.some((w) => /高噪声文件\|低噪声文件/.test(w)))
})

test('auto-bind: image workflow through FluxGuidance, empty negative kept empty, explicit steps only', () => {
  const raw = JSON.parse(JSON.stringify(COMFY_IMAGE_TEMPLATES.find((t) => t.id === 'flux1-dev')!.workflow))
  raw['6'].inputs.text = 'old prompt'
  raw['3'].inputs.seed = 1
  raw['27'].inputs.width = 1024
  raw['27'].inputs.height = 1024
  raw['4'].inputs.ckpt_name = 'flux1-dev-fp8.safetensors'
  const { workflow } = autoBindComfyWorkflow(raw, 'image', { model: 'other.safetensors' })
  assert.equal(workflow['6'].inputs.text, '{{prompt}}')
  assert.equal(workflow['33'].inputs.text, '')
  assert.equal(workflow['27'].inputs.width, '{{width}}')
  assert.equal(workflow['3'].inputs.steps, 20, 'steps untouched without explicit setting')
  assert.equal(workflow['4'].inputs.ckpt_name, 'other.safetensors')
  assert.equal(collectComfyPlaceholders(workflow).has('seed'), true)
})

test('templates: every template is valid API format and resolvable by id / model file', () => {
  for (const t of [...COMFY_VIDEO_TEMPLATES, ...COMFY_IMAGE_TEMPLATES]) {
    for (const node of Object.values(t.workflow)) assert.equal(typeof (node as any).class_type, 'string', t.id)
    const placeholders = collectComfyPlaceholders(t.workflow)
    assert.ok(placeholders.has('prompt'), `${t.id} binds prompt`)
    assert.ok(placeholders.has('seed'), `${t.id} binds seed`)
  }
  assert.equal(resolveComfyTemplate('video', null, 'wan2.2-i2v-14b').id, 'wan2.2-i2v-14b')
  assert.equal(resolveComfyTemplate('video', 'wan2.2-t2v-14b', 'wan2.2-ti2v-5b').id, 'wan2.2-t2v-14b')
  assert.equal(resolveComfyTemplate('video', null, 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors').id, 'wan2.2-i2v-14b')
  assert.equal(resolveComfyTemplate('image', null, 'flux1-schnell-fp8.safetensors').id, 'flux1-schnell')
  assert.equal(resolveComfyTemplate('image', null, 'juggernautXL.safetensors').id, 'sdxl')
  assert.deepEqual(splitModelFiles('a.safetensors | b.gguf'), ['a.safetensors', 'b.gguf'])
})

test('video adapter: model id picks the template, prompt template wraps the prompt, frame/fps follow template', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  try {
    const req = await new ComfyUIVideoAdapter().buildGenerateRequest(
      { provider: 'comfyui', baseUrl: 'http://127.0.0.1:1', apiKey: '', model: 'wan2.2-t2v-14b', settings: { prompt_template: '电影感，{{prompt}}，4K' } },
      { id: 9, prompt: '雨夜街头', duration: 5, aspectRatio: '16:9', resolution: '480p' },
    )
    const wf = req.body.prompt
    assert.equal(wf['6'].inputs.text, '电影感，雨夜街头，4K')
    assert.equal(wf['60'].inputs.fps, 16)
    assert.equal(wf['40'].inputs.length, 81)
    assert.equal(wf['37'].inputs.unet_name, 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('image adapter: custom exported workflow is auto-bound to prompt / size / model', async () => {
  const exported = {
    '3': { class_type: 'KSampler', inputs: { seed: 5, steps: 8, cfg: 2, sampler_name: 'euler', scheduler: 'sgm_uniform', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'dreamshaperXL_lightning.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'beautiful scenery', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI', images: ['8', 0] } },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  try {
    const req = await new ComfyUIImageAdapter().buildGenerateRequest(
      { provider: 'comfyui', baseUrl: 'http://127.0.0.1:1', apiKey: '', model: 'default', settings: { comfyui_workflow: JSON.stringify(exported), prompt_template: 'masterpiece, {{prompt}}' } },
      { id: 3, prompt: 'a knight', size: '1920x1080' },
    )
    const wf = req.body.prompt
    assert.equal(wf['6'].inputs.text, 'masterpiece, a knight')
    assert.notEqual(wf['7'].inputs.text, 'text, watermark')
    assert.equal(wf['5'].inputs.width, 1344)
    assert.equal(wf['5'].inputs.height, 768)
    assert.equal(wf['3'].inputs.steps, 8, 'lightning steps kept without explicit setting')
    assert.equal(wf['4'].inputs.ckpt_name, 'dreamshaperXL_lightning.safetensors', '"default" model keeps the workflow checkpoint')
    assert.equal(typeof wf['3'].inputs.seed, 'number')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('progress: ComfyUI websocket events become stage / step / eta', () => {
  const monitor = new ComfyMonitor('http://127.0.0.1:1', { provider: 'comfyui', baseUrl: '', apiKey: '', model: '' })
  ;(monitor as any).disabled = true
  monitor.track('p1', describeComfyPromptMeta(RAW_WAN_I2V, 'video'))
  monitor.setQueue('p1', { ahead: 2, total: 3, running: false })
  assert.equal(monitor.describe('p1')?.stage, 'queued')
  assert.match(monitor.describe('p1')!.message!, /前面还有 2 个/)
  monitor.handle({ type: 'execution_start', data: { prompt_id: 'p1' } })
  monitor.handle({ type: 'execution_cached', data: { prompt_id: 'p1', nodes: ['38', '39'] } })
  monitor.handle({ type: 'executing', data: { prompt_id: 'p1', node: '57' } })
  monitor.handle({ type: 'progress', data: { prompt_id: 'p1', node: '57', value: 5, max: 20 } })
  const p = monitor.describe('p1')!
  assert.equal(p.stage, 'running')
  assert.equal(p.detail?.step, 5)
  assert.equal(p.detail?.sampler_index, 1)
  assert.equal(p.detail?.sampler_total, 2)
  assert.match(p.message!, /第 1\/2 段.*第 5\/20 步/)
  assert.ok(p.percent! > 10 && p.percent! < 50)
  monitor.handle({ type: 'executing', data: { prompt_id: 'p1', node: '8' } })
  assert.match(monitor.describe('p1')!.message!, /VAE 解码/)
  assert.deepEqual(comfyQueuePosition({ queue_running: [[1, 'p1']], queue_pending: [] }, 'p1'), { ahead: 0, total: 1, running: true })
  assert.equal(comfyQueuePosition({ queue_running: [], queue_pending: [] }, 'zz'), null)
})

test('progress: Fooocus query-job and task store', () => {
  const fooocus = new FooocusImageAdapter()
  const cfg = { provider: 'fooocus', baseUrl: '', apiKey: '', model: '' }
  assert.equal(fooocus.describeProgress(cfg, 'j', { job_stage: 'WAITING' })?.stage, 'queued')
  const running = fooocus.describeProgress(cfg, 'j', { job_stage: 'RUNNING', job_progress: 50, job_status: 'Sampling step 15/30' })!
  assert.equal(running.detail?.step, 15)
  assert.equal(running.percent, 50)

  setTaskProgress(99901, { stage: 'running', percent: 40, message: 'a' })
  setTaskProgress(99901, { stage: 'running', percent: 30, message: 'b' })
  assert.equal(getTaskProgress(99901)?.percent, 40, 'progress never goes backwards')
  setTaskProgress(99901, { stage: 'failed', message: 'boom' })
  assert.equal(getTaskProgress(99901)?.percent, 40)
  assert.equal(getTaskProgress(99901)?.history.at(-1)?.message, 'boom')
})

test('prompt template', () => {
  assert.equal(applyPromptTemplate('', 'x'), 'x')
  assert.equal(applyPromptTemplate('best quality, {{prompt}}', 'x'), 'best quality, x')
  assert.equal(applyPromptTemplate('best quality', 'x'), 'x, best quality')
})
