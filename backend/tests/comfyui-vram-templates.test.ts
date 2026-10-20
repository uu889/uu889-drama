import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMFY_H3_VRAM_TEMPLATES, COMFY_VIDEO_TEMPLATES, COMFY_VRAM_TEMPLATES, describeComfyTemplates, getComfyTemplate, resolveComfyTemplate, toMiniMaxH3PictureTags } from '../src/services/adapters/comfyui-templates'
import { renderComfyWorkflow } from '../src/services/adapters/comfyui-common'
import { ComfyUIVideoAdapter, comfyDimensions, minimaxH3Dimensions } from '../src/services/adapters/comfyui-video'
import { hasWan14bModel, injectStyleLora } from '../src/services/adapters/comfyui-lora'
import { FILE_META, sourcesFor } from '../src/services/model-installer/sources'
import { buildPlanFiles } from '../src/services/model-installer/plan'

const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[1] === 'number'

test('VRAM tiers: 12G → 288G, every one image-to-video 14B with sane sampling', () => {
  // 每个显存档一个主模板；同档的第二个模板（如 12G 的 720p）用后缀区分
  const WAN_TIERS = COMFY_VRAM_TEMPLATES.filter((t) => t.id === `wan2.2-i2v-14b-${t.vram}g`)
  assert.deepEqual(WAN_TIERS.map((t) => t.vram), [12, 16, 24, 32, 48, 96, 141, 192, 288])
  assert.deepEqual(COMFY_VRAM_TEMPLATES.filter((t) => !WAN_TIERS.includes(t)).map((t) => t.id), ['wan2.2-i2v-14b-12g-720p'])
  for (const t of COMFY_VRAM_TEMPLATES) {
    assert.ok(COMFY_VIDEO_TEMPLATES.includes(t), `${t.id} is listed with the video templates`)
    assert.match(t.id, new RegExp(`^wan2\\.2-i2v-14b-${t.vram}g(-\\d+p)?$`))
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
  const steps = WAN_TIERS.map((t) => t.recommended.steps!)
  const caps = WAN_TIERS.map((t) => t.recommended.maxShortEdge!)
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
  const H3_TIERS = COMFY_H3_VRAM_TEMPLATES.filter((t) => t.id === `minimax-h3-${t.vram}g`)
  assert.deepEqual(H3_TIERS.map((t) => t.vram), [12, 16, 24, 32, 48, 96, 141, 192, 288])
  assert.deepEqual(COMFY_H3_VRAM_TEMPLATES.filter((t) => !H3_TIERS.includes(t)).map((t) => t.id), ['minimax-h3-12g-768p'])
  const unets: string[] = []
  for (const t of COMFY_H3_VRAM_TEMPLATES) {
    assert.ok(COMFY_VIDEO_TEMPLATES.includes(t))
    assert.match(t.id, new RegExp(`^minimax-h3-${t.vram}g(-\\d+p)?$`))
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
    if (turbo) assert.equal(wf['121'].inputs.lora_name, 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors')
    assert.equal(wf['104'].class_type, 'MiniMaxH3ReferenceToVideo', '用参考图生视频节点，才能引用角色资产')
    assert.equal(wf['9'].inputs.steps, t.recommended.steps)
    assert.equal(wf['17'].inputs.sampler_name, 'res_multistep')
    if (H3_TIERS.includes(t)) unets.push(wf['6'].inputs.unet_name)
  }
  assert.deepEqual(unets, [
    'MiniMax-H3-Ref2VA-Pruned-Q3_K_M.gguf', 'MiniMax-H3-Ref2VA-Pruned-Q4_K_M.gguf', 'MiniMax-H3-Ref2VA-Pruned-Q5_K_M.gguf',
    'minimax_h3_ref2va_pruned_int8_convrot.safetensors', 'minimax_h3_ref2va_int8_convrot.safetensors', 'minimax_h3_ref2va_int8_convrot.safetensors',
    'minimax_h3_ref2va_bf16.safetensors', 'minimax_h3_ref2va_bf16.safetensors', 'minimax_h3_ref2va_bf16.safetensors',
  ])
  const steps = H3_TIERS.map((t) => t.recommended.steps!)
  assert.deepEqual(steps, [4, 4, 4, 4, 20, 25, 30, 40, 50])
  // 32G 档和 ComfyUI 官方模板同一套文件
  assert.deepEqual(getComfyTemplate('video', 'minimax-h3-32g')!.files.map((f) => f.file).sort(), [
    'minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
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
  assert.equal(roles['MiniMax-H3-Ref2VA-Pruned-Q3_K_M.gguf'], 'diffusion_models')
  assert.equal(roles['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'], 'text_encoders')
  assert.equal(roles['minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'], 'lora')
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

// ─── MiniMax H3 参考图生视频：角色资产真的进了工作流 ─────────────────────────────

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC'
const PNG3 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC'

/** 模拟 ComfyUI：/upload/image 记下上传顺序，其余 404（拿不到 /object_info 时按可选输入处理） */
function fakeComfyUpload() {
  const uploads: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: any) => {
    if (String(url).endsWith('/upload/image')) {
      const name = `up_${uploads.length + 1}.png`
      uploads.push(name)
      return new Response(JSON.stringify({ name, subfolder: '', type: 'input' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { uploads, restore: () => { globalThis.fetch = realFetch } }
}

const cfg = (model: string) => ({ provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model, settings: null })

test('MiniMax H3 reference-to-video: scene + character + prop images all become <Picture N> references, @names become tags', async () => {
  const fake = fakeComfyUpload()
  try {
    // 前端的参考图顺序：场景、角色、道具；@名字 已解析成 @图片N名字
    const req = await new ComfyUIVideoAdapter().buildGenerateRequest(cfg('minimax-h3-32g'), {
      id: 1, duration: 5, aspectRatio: '16:9', resolution: '720p',
      prompt: '@图片2张三坐在@图片1街边算命摊前，对@图片3李四说：今天宜出行。',
      referenceImageUrls: JSON.stringify([PNG, PNG2, PNG3]),
    })
    const wf = req.body.prompt
    const r2v = wf['104']
    assert.equal(r2v.class_type, 'MiniMaxH3ReferenceToVideo')
    // 三张参考图按顺序接到 ref_image_0..2，多余的 LoadImage 已裁掉
    assert.deepEqual([0, 1, 2].map((i) => wf[r2v.inputs[`ref_images.ref_image_${i}`][0]].inputs.image), ['up_1.png', 'up_2.png', 'up_3.png'])
    assert.equal(r2v.inputs['ref_images.ref_image_3'], undefined)
    assert.ok(!wf['73'], '没用到的参考图节点被裁掉')
    assert.match(r2v.inputs.prompt, /^参考图：<Picture 1>、<Picture 2>、<Picture 3>（/)
    assert.match(r2v.inputs.prompt, /<Picture 2>张三坐在<Picture 1>街边算命摊前，对<Picture 3>李四说/)
    assert.doesNotMatch(r2v.inputs.prompt, /@图片/)
    // 没有首帧 / 尾帧：两个引导节点短路，采样直接用参考图条件
    assert.ok(!wf['105'] && !wf['106'] && !wf['52'] && !wf['53'])
    assert.deepEqual(wf['16'].inputs.conditioning, ['104', 0])
    assert.equal(fake.uploads.length, 3)
  } finally {
    fake.restore()
  }
})

test('MiniMax H3 reference-to-video: previous shot end frame is anchored as the first frame while character references stay', async () => {
  const fake = fakeComfyUpload()
  try {
    const req = await new ComfyUIVideoAdapter().buildGenerateRequest(cfg('minimax-h3-r2v'), {
      id: 2, duration: 5, aspectRatio: '9:16', resolution: '720p', prompt: '@图片2张三转身离开',
      firstFrameUrl: PNG, referenceImageUrls: JSON.stringify([PNG2, PNG3]),
    })
    const wf = req.body.prompt
    assert.equal(wf['105'].class_type, 'MiniMaxH3AddGuide')
    assert.equal(wf['105'].inputs.frame_idx, 0)
    assert.deepEqual(wf['105'].inputs.positive, ['104', 0])
    assert.ok(wf['52'], '首帧图片节点保留')
    assert.ok(!wf['106'], '没有尾帧：尾帧引导短路')
    assert.deepEqual(wf['16'].inputs.conditioning, ['105', 0])
    assert.ok(wf['104'].inputs['ref_images.ref_image_1'], '角色参考图仍然在')
    assert.equal(wf['104'].inputs.width, 768)
    assert.equal(wf['104'].inputs.height, 1344)
    assert.match(wf['104'].inputs.prompt, /<Picture 2>张三转身离开/)
    assert.equal(wf['9'].inputs.steps, 20)
  } finally {
    fake.restore()
  }
})

test('MiniMax H3 reference-to-video: no images at all is plain text-to-video; first + last frame both anchored', () => {
  const t = getComfyTemplate('video', 'minimax-h3-96g')!
  const textOnly = renderComfyWorkflow(t.workflow, { prompt: '雨夜街头', seed: 1, width: 1344, height: 768, frames: 124, fps: 24 })
  assert.ok(!Object.values<any>(textOnly).some((n) => n.class_type === 'LoadImage' || n.class_type === 'MiniMaxH3AddGuide'))
  assert.deepEqual(textOnly['16'].inputs.conditioning, ['104', 0])
  assert.equal(Object.keys(textOnly['104'].inputs).filter((k) => k.startsWith('ref_images.')).length, 0)
  const both = renderComfyWorkflow(t.workflow, { prompt: 'x', seed: 1, width: 1344, height: 768, frames: 124, fps: 24, first_frame: 'a.png', last_frame: 'b.png', reference_image_1: 'c.png' })
  assert.equal(both['106'].inputs.frame_idx, -1)
  assert.deepEqual(both['106'].inputs.positive, ['105', 0])
  assert.deepEqual(both['16'].inputs.conditioning, ['106', 0])
  assert.deepEqual(both['104'].inputs['ref_images.ref_image_0'], ['70', 0])
})

test('<Picture N> conversion: only for existing references, header lists them, nothing added without references', () => {
  assert.equal(toMiniMaxH3PictureTags('@图片1张三', 0), '@图片1张三')
  const out = toMiniMaxH3PictureTags('@图片1张三和@图片4王五', 2)
  assert.match(out, /^参考图：<Picture 1>、<Picture 2>（/)
  assert.match(out, /<Picture 1>张三和@图片4王五$/, '超出参考图数量的标记不乱改')
})

test('original MiniMax H3 first/last-frame templates say they ignore character references', () => {
  for (const id of ['minimax-h3-fl2v', 'minimax-h3-fl2v-turbo-8step', 'minimax-h3-fl2v-turbo-4step']) {
    const t = getComfyTemplate('video', id)!
    assert.match(t.description, /不引用角色 \/ 场景参考图/)
    assert.equal(t.workflow['104'].class_type, 'MiniMaxH3ImageToVideo')
  }
  const r2v = getComfyTemplate('video', 'minimax-h3-r2v')!
  assert.deepEqual(r2v.files.map((f) => f.file).sort(), [
    'minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_ref2va_int8_convrot.safetensors', 'minimax_h3_video_vae_fp16.safetensors', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  ])
  for (const f of r2v.files) assert.ok(FILE_META[f.file]?.sha256, f.file)
})

test('old ComfyUI without the H3 guide node: tells the user to update ComfyUI, not to install a plugin', () => {
  const msg = new ComfyUIVideoAdapter().describeError(400, JSON.stringify({ error: { type: 'missing_node_type', message: "Node 'MiniMaxH3AddGuide' not found.", extra_info: { class_type: 'MiniMaxH3AddGuide' } } }))
  assert.match(String(msg), /^ComfyUI 缺少节点 MiniMaxH3AddGuide：.*更新到最新版.*0\.34\.0/)
})

test('12G second templates: H3 768p uses the 16G Q4 GGUF at the native canvas, Wan 720p decodes in tiles', async () => {
  const { minimaxH3Dimensions, comfyDimensions } = await import('../src/services/adapters/comfyui-video')
  const h3 = getComfyTemplate('video', 'minimax-h3-12g-768p')!
  assert.equal(h3.vram, 12)
  assert.equal(h3.vramFamily, 'MiniMax H3 音画同出')
  assert.equal(h3.workflow['6'].inputs.unet_name, 'MiniMax-H3-Ref2VA-Pruned-Q4_K_M.gguf')
  assert.deepEqual(minimaxH3Dimensions('16:9', '720p', h3.recommended.maxShortEdge), { width: 1344, height: 768 })
  // 12G 主模板仍是 480p
  assert.deepEqual(minimaxH3Dimensions('16:9', '720p', getComfyTemplate('video', 'minimax-h3-12g')!.recommended.maxShortEdge).height, 480)
  const wan = getComfyTemplate('video', 'wan2.2-i2v-14b-12g-720p')!
  assert.equal(wan.workflow['8'].class_type, 'VAEDecodeTiled')
  assert.equal(wan.workflow['8'].inputs.temporal_size, 64)
  assert.equal(getComfyTemplate('video', 'wan2.2-i2v-14b-12g')!.workflow['8'].class_type, 'VAEDecode')
  assert.equal(comfyDimensions('16:9', '720p', wan.recommended.maxShortEdge).height, comfyDimensions('16:9', '720p', getComfyTemplate('video', 'wan2.2-i2v-14b-24g')!.recommended.maxShortEdge).height, '和 24G 档同样的 720p 画布')
  // 按模板 ID 当模型名也能选中
  assert.equal(resolveComfyTemplate('video', null, 'minimax-h3-12g-768p').id, 'minimax-h3-12g-768p')
  // 设置页按显存分组：12G 组里两个都有
  const api = describeComfyTemplates('video', false)
  assert.deepEqual(api.filter((t) => t.vram === 12 && t.vram_family === 'MiniMax H3 音画同出').map((t) => t.id), ['minimax-h3-12g', 'minimax-h3-12g-768p'])
})
