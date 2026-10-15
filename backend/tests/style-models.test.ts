import assert from 'node:assert/strict'
import { test } from 'node:test'
import { injectStyleLora } from '../src/services/adapters/comfyui-lora'
import { getComfyTemplate } from '../src/services/adapters/comfyui-templates'
import { ComfyUIImageAdapter } from '../src/services/adapters/comfyui-image'
import { ComfyUIVideoAdapter } from '../src/services/adapters/comfyui-video'
import { SdWebuiImageAdapter } from '../src/services/adapters/sdwebui-image'
import { FooocusImageAdapter } from '../src/services/adapters/fooocus-image'
import { STYLE_MODEL_CATALOG } from '../src/services/adapters/style-model-catalog'
import { STYLE_KEYS, normalizeStyleOverrides, resolveStyleModels, withTrigger, bareModelName } from '../src/services/adapters/style-models'
import { buildDownloadScripts, describeStyleModelCatalog } from '../src/services/adapters/style-model-guide'

const ON = { style_models_enabled: true }

test('style catalog covers every visual style for every backend', () => {
  for (const kind of ['sdwebui', 'hf_image', 'comfyui_video'] as const) {
    for (const style of STYLE_KEYS) assert.ok((STYLE_MODEL_CATALOG[kind] as any)[style], `${kind}.${style}`)
  }
  for (const style of STYLE_KEYS) {
    const sd = STYLE_MODEL_CATALOG.sdwebui[style]
    assert.match(sd.checkpoint.url, /^https:\/\/civitai\.com\/api\/download\/models\/\d+$/)
    if (sd.lora) assert.match(sd.lora.url, /^https:\/\/civitai\.com\/api\/download\/models\/\d+$/)
    const hf = STYLE_MODEL_CATALOG.hf_image[style]
    assert.match(hf.checkpoint.url, /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\//)
    if (hf.lora) assert.match(hf.lora.url, /^https:\/\/huggingface\.co\//)
    const v = STYLE_MODEL_CATALOG.comfyui_video[style]
    assert.ok(getComfyTemplate('video', v.template), `video template ${v.template}`)
    if (v.lora) assert.match(v.lora.url, /^https:\/\/huggingface\.co\//)
  }
})

test('resolveStyleModels: off by default, user overrides win, none disables LoRA', () => {
  assert.equal(resolveStyleModels('sdwebui', 'image', {}, 'ghibli'), null)
  assert.equal(resolveStyleModels('sdwebui', 'image', ON, 'unknown'), null)
  assert.equal(resolveStyleModels('openai', 'image', ON, 'ghibli'), null)
  const r = resolveStyleModels('sdwebui', 'image', ON, 'ghibli')!
  assert.equal(r.checkpoint, STYLE_MODEL_CATALOG.sdwebui.ghibli.checkpoint.file)
  assert.equal(r.lora, STYLE_MODEL_CATALOG.sdwebui.ghibli.lora!.file)
  const o = resolveStyleModels('sdwebui', 'image', { ...ON, style_models: JSON.stringify({ ghibli: { checkpoint: 'mine.safetensors', lora: 'none', trigger: '' } }) }, 'ghibli')!
  assert.equal(o.checkpoint, 'mine.safetensors')
  assert.equal(o.lora, undefined)
  // ComfyUI 与 Fooocus 生图共用 Hugging Face 清单
  assert.equal(resolveStyleModels('fooocus', 'image', ON, 'anime')!.checkpoint, STYLE_MODEL_CATALOG.hf_image.anime.checkpoint.file)
})

test('normalizeStyleOverrides validates JSON and drops junk', () => {
  assert.equal(normalizeStyleOverrides(''), null)
  assert.throws(() => normalizeStyleOverrides('{bad'))
  assert.deepEqual(normalizeStyleOverrides({ anime: { lora: ' a.safetensors ', lora_weight: '0.5', x: 1 }, nope: { lora: 'b' }, noir: { lora_weight: 9 } }), { anime: { lora: 'a.safetensors', lora_weight: 0.5 } })
})

test('withTrigger / bareModelName', () => {
  assert.equal(withTrigger('a girl', 'Studio Ghibli'), 'Studio Ghibli, a girl')
  assert.equal(withTrigger('studio ghibli, a girl', 'Studio Ghibli'), 'studio ghibli, a girl')
  assert.equal(bareModelName('sub/dir/my lora.safetensors'), 'my lora')
})

test('injectStyleLora: checkpoint workflow gets LoraLoader on MODEL and CLIP', () => {
  const sdxl = getComfyTemplate('image', 'sdxl')!.workflow
  const ck = Object.keys(sdxl).find((id) => sdxl[id].class_type === 'CheckpointLoaderSimple')!
  const wf = injectStyleLora(sdxl, { file: 'style.safetensors', strength: 0.7 })
  const loraId = Object.keys(wf).find((id) => wf[id].class_type === 'LoraLoader')!
  assert.deepEqual(wf[loraId].inputs.model, [ck, 0])
  assert.deepEqual(wf[loraId].inputs.clip, [ck, 1])
  for (const [id, node] of Object.entries<any>(wf)) {
    if (id === loraId) continue
    for (const v of Object.values<any>(node.inputs || {})) {
      if (Array.isArray(v) && v[0] === ck) assert.ok(v[1] === 2, `${id} still wired to checkpoint slot ${v[1]}`)
    }
  }
  assert.equal(sdxl[loraId], undefined, 'template not mutated')
  // 再插一次同名 LoRA 不重复
  const twice = injectStyleLora(wf, { file: 'style.safetensors', strength: 0.7 })
  assert.equal(Object.values<any>(twice).filter((n) => n.class_type === 'LoraLoader').length, 1)
})

test('injectStyleLora: Wan 2.2 14B applyTo low only touches the low-noise model, chained after an existing LoRA', () => {
  const base = getComfyTemplate('video', 'wan2.2-t2v-14b')!.workflow
  const unets = Object.keys(base).filter((id) => base[id].class_type === 'UNETLoader')
  const low = unets.find((id) => /low/.test(base[id].inputs.unet_name))!
  const high = unets.find((id) => /high/.test(base[id].inputs.unet_name))!
  // 先在低噪声上挂一个已有 LoRA（类似加速 LoRA）
  const pre = JSON.parse(JSON.stringify(base))
  for (const node of Object.values<any>(pre)) {
    for (const [k, v] of Object.entries<any>(node.inputs || {})) if (Array.isArray(v) && v[0] === low && v[1] === 0) node.inputs[k] = ['900', 0]
  }
  pre['900'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'speed.safetensors', strength_model: 1, model: [low, 0] } }
  const wf = injectStyleLora(pre, { file: 'style.safetensors', strength: 0.8, applyTo: 'low' })
  const styled = Object.keys(wf).filter((id) => wf[id].inputs?.lora_name === 'style.safetensors')
  assert.equal(styled.length, 1)
  assert.deepEqual(wf[styled[0]].inputs.model, ['900', 0])
  const usersOfHigh = Object.values<any>(wf).filter((n) => Object.values<any>(n.inputs || {}).some((v) => Array.isArray(v) && v[0] === high))
  assert.ok(usersOfHigh.every((n) => n.class_type !== 'LoraLoaderModelOnly'), 'high-noise model untouched')
  const all = injectStyleLora(base, { file: 'style.safetensors', strength: 0.8 })
  assert.equal(Object.values<any>(all).filter((n) => n.inputs?.lora_name === 'style.safetensors').length, 2)
})

test('SD WebUI: style switches checkpoint, appends <lora>, adds trigger and recommended params', async () => {
  const adapter = new SdWebuiImageAdapter()
  const preset = STYLE_MODEL_CATALOG.sdwebui.webtoon
  const req = await adapter.buildGenerateRequest(
    { provider: 'sdwebui', baseUrl: 'http://127.0.0.1:7860', apiKey: '', model: 'default', settings: ON },
    { id: 1, prompt: 'a boy in the rain', size: '1024x1024', style: 'webtoon' },
  )
  const b = req.body
  assert.equal(b.override_settings.sd_model_checkpoint, preset.checkpoint.file)
  assert.ok(b.prompt.startsWith(preset.lora!.trigger!), b.prompt)
  assert.ok(b.prompt.endsWith(`<lora:${bareModelName(preset.lora!.file)}:${preset.lora!.weight}>`), b.prompt)
  assert.equal(b.cfg_scale, preset.params!.cfg)
  // 用户自己填了步数就用用户的
  const req2 = await adapter.buildGenerateRequest(
    { provider: 'sdwebui', baseUrl: 'http://127.0.0.1:7860', apiKey: '', model: 'default', settings: { ...ON, image_steps: 12 } },
    { id: 1, prompt: 'x', size: '1024x1024', style: 'watercolor' },
  )
  assert.equal(req2.body.steps, 12)
  assert.equal(req2.body.override_settings.CLIP_stopAtLastLayers, 2)
  // 未开启：不动
  const off = await adapter.buildGenerateRequest(
    { provider: 'sdwebui', baseUrl: 'http://127.0.0.1:7860', apiKey: '', model: 'default', settings: {} },
    { id: 1, prompt: 'x', size: '1024x1024', style: 'webtoon' },
  )
  assert.equal(off.body.prompt, 'x')
  assert.equal(off.body.override_settings, undefined)
})

test('Fooocus: style sets base_model_name, replaces loras, picks Fooocus styles', async () => {
  const adapter = new FooocusImageAdapter()
  const preset = STYLE_MODEL_CATALOG.hf_image.noir
  const req = await adapter.buildGenerateRequest(
    { provider: 'fooocus', baseUrl: 'http://127.0.0.1:8888', apiKey: '', model: 'default', settings: ON },
    { id: 1, prompt: 'detective in alley', size: '1024x1024', style: 'noir' },
  )
  assert.equal(req.body.base_model_name, preset.checkpoint.file)
  assert.deepEqual(req.body.loras, [{ enabled: true, model_name: preset.lora!.file, weight: preset.lora!.weight }])
  assert.deepEqual(req.body.style_selections, preset.params!.fooocusStyles)
  assert.ok(req.body.prompt.startsWith('m4ng41nk'))
  const anime = await adapter.buildGenerateRequest(
    { provider: 'fooocus', baseUrl: 'http://127.0.0.1:8888', apiKey: '', model: 'default', settings: { ...ON, fooocus_styles: 'Fooocus Sharp' } },
    { id: 1, prompt: 'x', size: '1024x1024', style: 'anime' },
  )
  assert.deepEqual(anime.body.loras, [])
  assert.deepEqual(anime.body.style_selections, ['Fooocus Sharp'])
})

test('ComfyUI image: style checkpoint + LoRA injected into SDXL template', async () => {
  const adapter = new ComfyUIImageAdapter()
  const preset = STYLE_MODEL_CATALOG.hf_image.ghibli
  const req = await adapter.buildGenerateRequest(
    { provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model: 'flux1-dev-fp8.safetensors', settings: { ...ON, comfyui_template: 'flux1-dev' } },
    { id: 1, prompt: 'a forest spirit', size: '1024x1024', style: 'ghibli' },
  )
  const wf = req.body.prompt
  const nodes = Object.values<any>(wf)
  assert.equal(nodes.find((n) => n.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name, preset.checkpoint.file)
  const lora = nodes.find((n) => n.class_type === 'LoraLoader')
  assert.equal(lora.inputs.lora_name, preset.lora!.file)
  const pos = nodes.find((n) => n.class_type === 'CLIPTextEncode' && String(n.inputs.text).includes('forest spirit'))
  assert.ok(String(pos.inputs.text).startsWith(preset.lora!.trigger!))
})

test('ComfyUI video: style LoRA on the Wan 14B low-noise model, skipped on 5B, style template only when user picked none', async () => {
  const adapter = new ComfyUIVideoAdapter()
  const preset = STYLE_MODEL_CATALOG.comfyui_video.ghibli
  const cfg = (settings: Record<string, any>, model = '') => ({ provider: 'comfyui', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model, settings: { ...ON, ...settings } })
  const rec = { id: 1, prompt: 'a cat walks', duration: 5, aspectRatio: '16:9', style: 'ghibli' }
  const t2v = await adapter.buildGenerateRequest(cfg({ comfyui_template: 'wan2.2-t2v-14b' }), rec)
  const nodes = Object.values<any>(t2v.body.prompt)
  const lora = nodes.find((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === preset.lora!.file)
  assert.ok(lora)
  const src = t2v.body.prompt[lora.inputs.model[0]]
  assert.match(src.inputs.unet_name, /low_noise/)
  const pos = nodes.find((n) => n.class_type === 'CLIPTextEncode' && String(n.inputs.text).includes('a cat walks'))
  assert.ok(String(pos.inputs.text).startsWith(preset.lora!.trigger!))
  // TI2V 5B：不挂 14B LoRA
  const five = await adapter.buildGenerateRequest(cfg({}, 'wan2.2-ti2v-5b'), rec)
  assert.ok(!Object.values<any>(five.body.prompt).some((n) => n.class_type === 'LoraLoaderModelOnly'))
})

test('style video template applies only when nothing else is chosen', async () => {
  const { resolveComfyTemplate } = await import('../src/services/adapters/comfyui-templates')
  const sm = resolveStyleModels('comfyui', 'video', ON, 'anime')!
  assert.equal(sm.template, STYLE_MODEL_CATALOG.comfyui_video.anime.template)
  assert.equal(sm.templateOverride, false)
  const o = resolveStyleModels('comfyui', 'video', { ...ON, style_models: { anime: { template: 'wan2.2-t2v-14b' } } }, 'anime')!
  assert.equal(o.templateOverride, true)
  assert.ok(resolveComfyTemplate('video', o.template, ''))
})

test('download scripts: Civitai token, HF mirror, folders per provider', () => {
  const sd = describeStyleModelCatalog('sdwebui', 'image')!
  assert.ok(sd.scripts_all.bash.includes('${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}'))
  assert.ok(sd.scripts_all.bash.includes('"$SD_DIR/models/Stable-diffusion/'))
  assert.ok(sd.scripts_all.powershell.includes('$tk'))
  const fo = describeStyleModelCatalog('fooocus', 'image')!
  assert.ok(fo.scripts_all.bash.includes('repositories/Fooocus/models/loras/'))
  assert.ok(fo.scripts_all.bash.includes('${HF_ENDPOINT:-https://huggingface.co}/'))
  const vid = describeStyleModelCatalog('comfyui', 'video')!
  assert.ok(vid.scripts_all.bash.includes('models/diffusion_models/'))
  assert.equal(describeStyleModelCatalog('sdwebui', 'video'), null)
  const dedup = buildDownloadScripts('comfyui', [
    { file: 'a.safetensors', folder: 'models/loras', url: 'https://huggingface.co/x/y/resolve/main/a.safetensors', source: 'huggingface' },
    { file: 'a.safetensors', folder: 'models/loras', url: 'https://huggingface.co/x/y/resolve/main/a.safetensors', source: 'huggingface' },
  ])
  assert.equal(dedup.bash.split('\n').filter((l) => l.startsWith('curl')).length, 1)
})

test('license: every recommended file is classified, defaults are never restricted, non-ok files explain why', { todo: '许可数据核对中，填好后去掉 todo' }, () => {
  for (const kind of ['sdwebui', 'hf_image', 'comfyui_video'] as const) {
    for (const style of STYLE_KEYS) {
      const p: any = (STYLE_MODEL_CATALOG[kind] as any)[style]
      for (const f of [p.checkpoint, p.lora].filter(Boolean)) {
        assert.ok(f.licenseStatus, `${kind}.${style} ${f.file} has no licenseStatus`)
        assert.notEqual(f.licenseStatus, 'restricted', `${kind}.${style} default ${f.file} is restricted`)
        if (f.licenseStatus !== 'ok') assert.ok(f.licenseNote, `${kind}.${style} ${f.file} needs licenseNote`)
      }
      for (const a of p.alternatives || []) {
        assert.ok(a.licenseStatus, `${kind}.${style} alternative ${a.file}`)
        if (a.licenseStatus !== 'ok') assert.ok(a.licenseNote, `${kind}.${style} alternative ${a.file} needs licenseNote`)
      }
    }
  }
  const d = describeStyleModelCatalog('fooocus', 'image')!
  for (const s of d.styles as any[]) assert.ok(['ok', 'attention', 'restricted'].includes(s.license_status))
})
