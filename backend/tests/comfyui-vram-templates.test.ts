import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMFY_H3_VRAM_TEMPLATES, COMFY_VIDEO_TEMPLATES, COMFY_VRAM_TEMPLATES, describeComfyTemplates, getComfyTemplate, resolveComfyTemplate } from '../src/services/adapters/comfyui-templates'
import { ComfyUIVideoAdapter, comfyDimensions, minimaxH3Dimensions } from '../src/services/adapters/comfyui-video'
import { hasWan14bModel, injectStyleLora } from '../src/services/adapters/comfyui-lora'
import { FILE_META, sourcesFor } from '../src/services/model-installer/sources'
import { buildPlanFiles } from '../src/services/model-installer/plan'

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[1] === 'number'

test('VRAM tiers: 12G → 288G, every one image-to-video 14B with sane sampling', () => {
  assert.deepEqual(COMFY_VRAM_TEMPLATES.map((t) => t.vram), [12, 16, 24, 32, 48, 96, 141, 192, 288])
  for (const t of COMFY_VRAM_TEMPLATES) {
    assert.ok(COMFY_VIDEO_TEMPLATES.includes(t), `${t.id} is listed with the video templates`)
    assert.equal(t.id, `wan2.2-i2v-14b-${t.vram}g`)
    assert.equal(getComfyTemplate('video', t.id), t)
    assert.equal(t.needsImage, 'required')
    assert.ok(t.label.startsWith(`【${t.vram}G 显存】`), t.label)
    const wf = t.workflow
    // 每条连线都指向存在的节点
    for (const [id, node] of Object.entries<any>(wf)) {
      for (const v of Object.values(node.inputs || {})) if (isLink(v)) assert.ok(wf[String(v[0])], `${t.id} node ${id} → ${v[0]}`)
    }
    const [hi, lo] = [wf['57'].inputs, wf['58'].inputs]
    assert.equal(hi.steps, lo.steps)
    assert.equal(hi.end_at_step, lo.start_at_step, '高噪声段结束处接低噪声段')
    assert.equal(hi.steps, t.recommended.steps)
    assert.ok(hasWan14bModel(wf), `${t.id} counts as 14B for style LoRAs`)
    const gguf = t.vram <= 16
    assert.equal(wf['37'].class_type, gguf ? 'UnetLoaderGGUF' : 'UNETLoader')
    const fast = t.vram <= 24
    if (fast) {
      assert.equal(hi.steps, 4)
      assert.equal(hi.cfg, 1)
      assert.equal(wf['54'].inputs.shift, 5)
      assert.match(wf['101'].inputs.lora_name, /lightx2v.*high_noise/)
      assert.match(wf['102'].inputs.lora_name, /lightx2v.*low_noise/)
      assert.deepEqual(wf['54'].inputs.model, ['101', 0])
    } else {
      assert.equal(wf['101'], undefined)
      assert.ok(hi.steps >= 20)
    }
    // fp16 text encoder from 48G up
    assert.equal(wf['38'].inputs.clip_name, t.vram >= 48 ? 'umt5_xxl_fp16.safetensors' : 'umt5_xxl_fp8_e4m3fn_scaled.safetensors')
  }
  // 步数随显存增加，分辨率上限不降
  const steps = COMFY_VRAM_TEMPLATES.map((t) => t.recommended.steps!)
  const caps = COMFY_VRAM_TEMPLATES.map((t) => t.recommended.maxShortEdge!)
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i] >= steps[i - 1])
    assert.ok(caps[i] >= caps[i - 1])
  }
  const api = describeComfyTemplates('video', false)
  assert.equal(api.find((t) => t.id === 'wan2.2-i2v-14b-12g')!.vram, 12)
  assert.equal(api.find((t) => t.id === 'wan2.2-ti2v-5b')!.vram, null)
})

test('VRAM tiers: every file has an exact size + sha256, downloads from Hugging Face (with mirror), lands in the right folder', () => {
  for (const t of COMFY_VRAM_TEMPLATES) {
    for (const f of t.files) {
      const meta = FILE_META[f.file]
      assert.ok(meta?.bytes && /^[0-9a-f]{64}$/.test(meta.sha256 || ''), `${t.id} ${f.file}`)
      assert.match(f.url, /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+/)
      assert.ok(f.url.endsWith(f.file), f.url)
      assert.deepEqual(sourcesFor(f).map((s) => s.label), ['huggingface', 'hf-mirror'])
    }
  }
  const plan = buildPlanFiles({ provider: 'comfyui', serviceType: 'video', styles: ['anime'], settings: { comfyui_template: 'wan2.2-i2v-14b-12g' } })
  const roles = Object.fromEntries(plan.files.map((f) => [f.file, f.role]))
  assert.equal(roles['Wan2.2-I2V-A14B-HighNoise-Q4_K_S.gguf'], 'diffusion_models')
  assert.equal(roles['wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors'], 'lora')
  assert.equal(roles['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], 'text_encoders')
})

test('VRAM tiers: low-VRAM templates cap the resolution, high ones allow 1080p', async () => {
  assert.deepEqual(comfyDimensions('16:9', '1080p', 480), { width: 864, height: 480 })
  assert.deepEqual(comfyDimensions('9:16', '720p', 640), { width: 640, height: 1152 })
  assert.deepEqual(comfyDimensions('16:9', '480p', 720), { width: 864, height: 480 }, 'a cap never raises the resolution')
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  try {
    const build = (model: string) => new ComfyUIVideoAdapter().buildGenerateRequest(
      { provider: 'comfyui', baseUrl: 'http://127.0.0.1:1', apiKey: '', model, settings: null },
      { id: 1, prompt: '清晨阳光下的街道', duration: 5, aspectRatio: '16:9', resolution: '1080p' },
    )
    const low = (await build('wan2.2-i2v-14b-12g')).body.prompt
    assert.equal(low['50'].inputs.height, 480)
    assert.equal(low['50'].inputs.length, 81)
    assert.equal(low['37'].inputs.unet_name, 'Wan2.2-I2V-A14B-HighNoise-Q4_K_S.gguf')
    const high = (await build('wan2.2-i2v-14b-141g')).body.prompt
    assert.equal(high['50'].inputs.height, comfyDimensions('16:9', '1080p').height)
    assert.equal(high['57'].inputs.steps, 40)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('VRAM tiers: a style LoRA goes after the 4-step LoRA on both experts', () => {
  const t = getComfyTemplate('video', 'wan2.2-i2v-14b-16g')!
  const wf = injectStyleLora(t.workflow, { file: 'pixar_10_epochs.safetensors', strength: 0.8 })
  const style = Object.entries<any>(wf).filter(([, n]) => n.inputs?.lora_name === 'pixar_10_epochs.safetensors')
  assert.equal(style.length, 2)
  assert.deepEqual(style.map(([, n]) => n.inputs.model[0]).sort(), ['101', '102'])
  const ids = style.map(([id]) => id)
  assert.ok(ids.includes(wf['54'].inputs.model[0]) && ids.includes(wf['55'].inputs.model[0]), 'sampling uses the style LoRA output')
})

test('missing GGUF custom node: tells the user to install ComfyUI-GGUF', () => {
  const adapter = new ComfyUIVideoAdapter()
  const modern = adapter.describeError(400, JSON.stringify({ error: { type: 'missing_node_type', message: "Node 'UnetLoaderGGUF' not found. The custom node may not be installed.", extra_info: { class_type: 'UnetLoaderGGUF' } }, node_errors: {} }))
  assert.match(String(modern), /^ComfyUI 缺少节点 UnetLoaderGGUF：.*ComfyUI-GGUF/)
  const legacy = adapter.describeError(400, JSON.stringify({ error: { type: 'invalid_prompt', message: 'Cannot execute because node UnetLoaderGGUF does not exist.' }, node_errors: {} }))
  assert.match(String(legacy), /ComfyUI-GGUF/)
  const other = adapter.describeError(400, JSON.stringify({ error: { type: 'missing_node_type', message: "Node 'VHS_VideoCombine' not found." } }))
  assert.match(String(other), /缺少节点 VHS_VideoCombine：请用 ComfyUI-Manager 安装/)
})

// ─── MiniMax H3 显存档位 ───────────────────────────────────────────────────

test('MiniMax H3 tiers: 12G → 288G, GGUF / pruned int8 / full int8 / bf16, steps grow with VRAM', () => {
  assert.deepEqual(COMFY_H3_VRAM_TEMPLATES.map((t) => t.vram), [12, 16, 24, 32, 48, 96, 141, 192, 288])
  const unets: string[] = []
  for (const t of COMFY_H3_VRAM_TEMPLATES) {
    assert.ok(COMFY_VIDEO_TEMPLATES.includes(t))
    assert.equal(t.id, `minimax-h3-${t.vram}g`)
    assert.equal(getComfyTemplate('video', t.id), t)
    assert.equal(t.vramFamily, 'MiniMax H3 音画同出')
    assert.equal(t.needsImage, 'optional')
    assert.equal(t.recommended.fps, 24)
    assert.ok(t.label.startsWith(`【${t.vram}G 显存】MiniMax H3`), t.label)
    const wf = t.workflow
    for (const [id, node] of Object.entries<any>(wf)) {
      for (const v of Object.values(node.inputs || {})) if (isLink(v)) assert.ok(wf[String(v[0])], `${t.id} node ${id} → ${v[0]}`)
    }
    // 每个用到的文件都在 files 里（一键下载能装齐）
    const files = new Set(t.files.map((f) => f.file))
    for (const n of Object.values<any>(wf)) for (const k of ['unet_name', 'clip_name', 'vae_name', 'lora_name']) if (n.inputs?.[k]) assert.ok(files.has(n.inputs[k]), `${t.id} ${n.inputs[k]}`)
    const gguf = t.vram <= 24
    assert.equal(wf['6'].class_type, gguf ? 'UnetLoaderGGUF' : 'UNETLoader')
    assert.equal(wf['13'].inputs.type, 'minimax')
    const turbo = t.vram <= 32
    assert.equal(!!wf['121'], turbo)
    if (turbo) assert.equal(wf['121'].inputs.lora_name, 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors')
    assert.equal(wf['9'].inputs.steps, t.recommended.steps)
    assert.equal(wf['17'].inputs.sampler_name, 'res_multistep')
    unets.push(wf['6'].inputs.unet_name)
  }
  assert.deepEqual(unets, [
    'MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf', 'MiniMax-H3-FL2VA-Pruned-Q4_K_M.gguf', 'MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf',
    'minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'minimax_h3_fl2va_int8_convrot.safetensors', 'minimax_h3_fl2va_int8_convrot.safetensors',
    'minimax_h3_fl2va_bf16.safetensors', 'minimax_h3_fl2va_bf16.safetensors', 'minimax_h3_fl2va_bf16.safetensors',
  ])
  const steps = COMFY_H3_VRAM_TEMPLATES.map((t) => t.recommended.steps!)
  assert.deepEqual(steps, [8, 8, 8, 8, 20, 25, 30, 40, 50])
  // 32G 档和 ComfyUI 官方模板同一套文件
  assert.deepEqual(getComfyTemplate('video', 'minimax-h3-32g')!.files.map((f) => f.file).sort(), [
    'minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    'minimax_h3_video_vae_int8_convrot.safetensors', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  ])
  // 原来的 H3 模板不受影响：按文件名仍然选中原模板
  assert.equal(resolveComfyTemplate('video', null, 'minimax_h3_fl2va_int8_convrot.safetensors').id, 'minimax-h3-fl2v')
  const api = describeComfyTemplates('video', false)
  assert.equal(api.find((t) => t.id === 'minimax-h3-96g')!.vram_family, 'MiniMax H3 音画同出')
  assert.equal(api.find((t) => t.id === 'wan2.2-i2v-14b-96g')!.vram_family, 'Wan 2.2 图生视频 14B')
})

test('MiniMax H3 tiers and the original H3 templates: every file has a direct download URL, exact size and sha256', () => {
  for (const t of COMFY_VIDEO_TEMPLATES.filter((x) => x.id.startsWith('minimax-h3'))) {
    for (const f of t.files) {
      assert.match(f.url, /^https:\/\/huggingface\.co\/.+\/resolve\/main\/.+/, `${t.id} ${f.url}`)
      assert.ok(f.url.endsWith(f.file), f.url)
      const meta = FILE_META[f.file]
      assert.ok(meta?.bytes && /^[0-9a-f]{64}$/.test(meta.sha256 || ''), `${t.id} ${f.file}`)
    }
  }
  const plan = buildPlanFiles({ provider: 'comfyui', serviceType: 'video', styles: ['anime'], settings: { comfyui_template: 'minimax-h3-12g' } })
  const roles = Object.fromEntries(plan.files.map((f) => [f.file, f.role]))
  assert.equal(roles['MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf'], 'diffusion_models')
  assert.equal(roles['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'], 'text_encoders')
  assert.equal(roles['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'], 'lora')
})

test('MiniMax H3 tiers: 12G is capped at 480p, others render the native 768p canvas', async () => {
  assert.deepEqual(minimaxH3Dimensions('16:9', '1080p', 480), { width: 864, height: 480 })
  assert.deepEqual(minimaxH3Dimensions('16:9', '1080p', 768), { width: 1344, height: 768 })
  assert.deepEqual(minimaxH3Dimensions('9:16', '720p'), { width: 768, height: 1344 })
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  try {
    const build = (model: string) => new ComfyUIVideoAdapter().buildGenerateRequest(
      { provider: 'comfyui', baseUrl: 'http://127.0.0.1:1', apiKey: '', model, settings: null },
      { id: 1, prompt: '街边算命摊，老人说：今天宜出行', duration: 5, aspectRatio: '16:9', resolution: '1080p' },
    )
    const low = (await build('minimax-h3-12g')).body.prompt
    assert.equal(low['104'].inputs.height, 480)
    assert.equal(low['104'].inputs.length, 124, '24fps、17k+5 帧')
    assert.equal(low['60'].inputs.fps, 24)
    const high = (await build('minimax-h3-288g')).body.prompt
    assert.equal(high['104'].inputs.height, 768)
    assert.equal(high['9'].inputs.steps, 50)
  } finally {
    globalThis.fetch = realFetch
  }
})
