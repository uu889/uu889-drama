import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { isOfficialProvider, parseConfigSettings, parseConfigTemperature } from '../services/ai.js'
import { comfyAuthHeaders, comfyUrl, parseComfyWorkflow } from '../services/adapters/comfyui-common.js'
import { autoBindComfyWorkflow } from '../services/adapters/comfyui-bind.js'
import { describeComfyTemplates, modelOverrideFiles, resolveComfyTemplate, splitModelFiles, type ComfyTemplateKind } from '../services/adapters/comfyui-templates.js'
import { explicitNumberSetting, localAuthHeaders, localUrl } from '../services/adapters/local-image.js'
import { normalizeStyleOverrides } from '../services/adapters/style-models.js'
import { describeStyleModelCatalog } from '../services/adapters/style-model-guide.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

const app = new Hono()

/** 归一化 temperature 入参：null=未设置；合法值 0~2；非法抛错 */
function normalizeTemperature(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 2) throw new Error('invalid temperature')
  return n
}

/**
 * 厂商专属配置项（存 settings JSON，接口上以顶层字段读写）：键 → 校验规则。
 * 本地生图 / 生视频服务（ComfyUI、Stable Diffusion WebUI、Fooocus）的工作流与出图参数。
 */
type SettingRule =
  | { kind: 'workflow' }
  | { kind: 'text'; max?: number }
  | { kind: 'number'; min: number; max: number; integer?: boolean }
  /** 布尔：等于默认值时从 settings 里删除，只存非默认值；default 为 null 时 true / false 都存，空值删除（按服务类型决定默认） */
  | { kind: 'boolean'; default: boolean | null }
  /** 视觉风格 → 模型覆盖表（JSON 对象），按 normalizeStyleOverrides 校验 */
  | { kind: 'style_models' }

const IMAGE_PARAM_RULES: Record<string, SettingRule> = {
  image_base_size: { kind: 'number', min: 256, max: 2048, integer: true },
  image_steps: { kind: 'number', min: 1, max: 150, integer: true },
  image_cfg_scale: { kind: 'number', min: 0, max: 30 },
}

/** 视觉风格 → 本地模型（三个本地服务都支持，默认关） */
const STYLE_MODEL_RULES: Record<string, SettingRule> = {
  style_models_enabled: { kind: 'boolean', default: false },
  style_models: { kind: 'style_models' },
}

const PROVIDER_SETTING_RULES: Record<string, Record<string, SettingRule>> = {
  comfyui: {
    comfyui_workflow: { kind: 'workflow' },
    comfyui_template: { kind: 'text', max: 64 },
    comfyui_auto_bind: { kind: 'boolean', default: true },
    comfyui_fps: { kind: 'number', min: 1, max: 120, integer: true },
    comfyui_steps: { kind: 'number', min: 1, max: 200, integer: true },
    comfyui_cfg: { kind: 'number', min: 0, max: 30 },
    comfyui_negative_prompt: { kind: 'text', max: 4000 },
    prompt_template: { kind: 'text', max: 4000 },
    prompt_translate: { kind: 'boolean', default: null },
    ...IMAGE_PARAM_RULES,
    ...STYLE_MODEL_RULES,
  },
  sdwebui: {
    image_negative_prompt: { kind: 'text', max: 4000 },
    image_sampler: { kind: 'text', max: 100 },
    prompt_template: { kind: 'text', max: 4000 },
    prompt_translate: { kind: 'boolean', default: null },
    ...IMAGE_PARAM_RULES,
    ...STYLE_MODEL_RULES,
  },
  fooocus: {
    image_negative_prompt: { kind: 'text', max: 4000 },
    prompt_template: { kind: 'text', max: 4000 },
    prompt_translate: { kind: 'boolean', default: null },
    fooocus_performance: { kind: 'text', max: 50 },
    fooocus_styles: { kind: 'text', max: 1000 },
    ...STYLE_MODEL_RULES,
  },
}

const ALL_PROVIDER_SETTING_KEYS = [...new Set(Object.values(PROVIDER_SETTING_RULES).flatMap((rules) => Object.keys(rules)))]

/**
 * 从请求体提取该厂商的专属配置：返回需要写入（值）或删除（null）的键；非法值抛错（错误信息直接给用户看）。
 * 只处理请求体中出现的键，未出现的保持原值。
 */
function pickProviderSettings(provider: string, body: any): Record<string, any> {
  const rules = PROVIDER_SETTING_RULES[provider] || {}
  const out: Record<string, any> = {}
  for (const [key, rule] of Object.entries(rules)) {
    if (!(key in body)) continue
    const raw = body[key]
    if (rule.kind === 'workflow') {
      const workflow = parseComfyWorkflow(typeof raw === 'string' ? raw.trim() : raw)
      out[key] = workflow ? JSON.stringify(workflow) : null
    } else if (rule.kind === 'boolean') {
      const value = raw === true || raw === 'true' || raw === 1 || raw === '1'
        ? true
        : raw === false || raw === 'false' || raw === 0 || raw === '0' ? false : rule.default
      out[key] = value === rule.default || value === null ? null : value
    } else if (rule.kind === 'style_models') {
      out[key] = normalizeStyleOverrides(raw)
    } else if (rule.kind === 'text') {
      const text = String(raw ?? '').trim()
      out[key] = text ? text.slice(0, rule.max ?? 4000) : null
    } else {
      if (raw === '' || raw == null) {
        out[key] = null
        continue
      }
      const n = Number(raw)
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) throw new Error(`${key} 须为 ${rule.min} 到 ${rule.max} 之间的数字`)
      out[key] = rule.integer ? Math.round(n) : n
    }
  }
  return out
}

function mergeSettings(existing: string | null | undefined, patch: Record<string, any>): string | null {
  const settings: Record<string, any> = parseConfigSettings(existing) || {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete settings[key]
    else settings[key] = value
  }
  return Object.keys(settings).length ? JSON.stringify(settings) : null
}

/** 把 settings JSON 中的 temperature / 厂商专属配置透出为顶层字段，便于前端直接读写 */
function withParsedFields(r: any) {
  const settings = parseConfigSettings(r.settings) || {}
  const extra: Record<string, any> = {}
  for (const key of ALL_PROVIDER_SETTING_KEYS) {
    if (settings[key] != null) extra[key] = settings[key]
  }
  return {
    ...toSnakeCase(r),
    model: r.model ? JSON.parse(r.model) : [],
    temperature: parseConfigTemperature(r.settings),
    ...extra,
  }
}

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    // 探针统一走 generateContent:文本运行时(AI SDK)走的就是它,官方与中转站都支持;
    // interactions 端点很多中转站未配置,探它会误报 500。
    // 用最小合法请求体而非空体——空体在部分中转站会触发上游认证失败的误报
    const modelName = m || 'gemini-3.1-pro-preview'
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${modelName}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return {
      method: 'POST',
      url: url.toString(),
      headers: geminiHeaders(apiKey, true),
      body: { contents: [{ parts: [{ text: 'hi' }] }] },
    }
  }

  if (['openai', 'aiask', 'xai', 'deepseek', 'qwen'].includes(p)) {
    // OpenAI 兼容接口（aiask.me / xAI / DeepSeek / 通义千问兼容模式）都提供 /v1/models，用它验证 Key 与地址
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'claude') {
    // Anthropic：/v1/models 需要 x-api-key 与 anthropic-version 头
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl || 'https://api.anthropic.com', '/v1', '/models'),
      headers: { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' },
      body: undefined,
    }
  }

  if (p === 'veo') {
    // Gemini API：列出可用模型（含 veo-*），不会创建计费任务
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl || 'https://generativelanguage.googleapis.com', '/v1beta', '/models'),
      headers: geminiHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'runway') {
    // Runway：/v1/organization 返回额度信息，不会创建计费任务
    return {
      method: 'GET',
      url: `${(baseUrl || 'https://api.dev.runwayml.com').replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/organization`,
      headers: { ...bearerHeaders(apiKey), 'X-Runway-Version': '2024-11-06' },
      body: undefined,
    }
  }

  if (p === 'comfyui') {
    // 本地 ComfyUI：生图时列出可用 checkpoint（模型名即 ckpt 文件名），生视频时看 /system_stats；都不占用队列
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl || 'http://127.0.0.1:8188', '', serviceType === 'image' ? '/object_info/CheckpointLoaderSimple' : '/system_stats'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'sdwebui') {
    // Stable Diffusion WebUI（需 --api）：列出可用 checkpoint，模型名填其 title 或 model_name
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl || 'http://127.0.0.1:7860', '', '/sdapi/v1/sd-models'),
      headers: localAuthHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'fooocus') {
    // Fooocus-API：列出 model_filenames / lora_filenames
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl || 'http://127.0.0.1:8888', '', '/v1/engines/all-models'),
      headers: localAuthHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'volcengine') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : serviceType === 'text'
        ? '/chat/completions'
        : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    // MiniMax 仅提供视频服务，空请求体探测鉴权/端点连通性
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v2', '/video_generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'aliyun') {
    // Wan 3.0 仅支持异步提交；空请求体不会创建计费任务，仅用于验证地域端点与鉴权是否可达。
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', '/services/aigc/video-generation/video-synthesis'),
      headers: {
        ...bearerHeaders(apiKey, true),
        'X-DashScope-Async': 'enable',
      },
      body: {},
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs?service_type=text
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  let rows = await db.select().from(schema.aiServiceConfigs)
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const parsed = rows.map(withParsedFields)
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段
  if (!body.service_type || !body.provider) {
    return badRequest(c, '需要 service_type 与 provider')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  let temperature: number | null = null
  if ('temperature' in body) {
    try {
      temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
  }
  let providerSettings: Record<string, any> = {}
  try {
    providerSettings = pickProviderSettings(body.provider, body)
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  const res = await db.insert(schema.aiServiceConfigs).values({
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    settings: mergeSettings(null, { temperature, ...providerSettings }),
    createdAt: ts,
    updatedAt: ts,
  })

  const [row] = await db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, getInsertId(res)))

  return created(c, withParsedFields(row))
})

// POST /ai-configs/test
app.post('/test', async (c) => {
  const body = await c.req.json()
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, '需要 service_type、provider 与 base_url')
  }
  if (!isOfficialProvider(body.service_type, body.provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    const payload = {
      ok: resp.ok,
      reachable,
      status: resp.status,
      status_text: resp.statusText,
      method: probe.method,
      url: probeUrl,
      message: reachable
        ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
        : '端点未按预期响应，请检查 Base URL 和代理前缀',
      response_preview: text.slice(0, 240),
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// ─── 本地服务辅助接口（设置页「模板 / 检查工作流 / 读取模型列表」）────────────────

// GET /ai-configs/comfyui/templates?kind=video|image — 内置工作流模板（含 API 格式 JSON、所需模型与下载地址）
app.get('/comfyui/templates', (c) => {
  const kind = (c.req.query('kind') === 'image' ? 'image' : 'video') as ComfyTemplateKind
  return success(c, describeComfyTemplates(kind))
})

/**
 * GET /ai-configs/style-models?provider=comfyui|sdwebui|fooocus&service_type=image|video
 * 视觉风格 → 推荐模型清单（Checkpoint / LoRA / 触发词 / 参数 / 下载地址）与模型目录，设置页据此生成下载命令
 */
app.get('/style-models', (c) => {
  const provider = String(c.req.query('provider') || '')
  const serviceType = c.req.query('service_type') === 'video' ? 'video' : 'image'
  const data = describeStyleModelCatalog(provider, serviceType)
  if (!data) return badRequest(c, '该服务商不支持按视觉风格切换模型（仅 ComfyUI / Stable Diffusion WebUI / Fooocus）')
  return success(c, data)
})

/**
 * POST /ai-configs/comfyui/inspect — 检查工作流会被怎样控制
 * body: { service_type, workflow?, comfyui_template?, model?, comfyui_auto_bind?, steps?, cfg?, base_url?, api_key? }
 * 返回绑定表（哪个节点的哪个字段接 UU889-Drama 的哪个参数）、提醒、用到的模型文件；
 * 传了 base_url 时再查 ComfyUI 里这些模型文件是否存在。
 */
app.post('/comfyui/inspect', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = (body.service_type === 'image' ? 'image' : 'video') as ComfyTemplateKind
  const model = String(Array.isArray(body.model) ? body.model[0] || '' : body.model || '').trim()
  let workflow: Record<string, any> | null
  try {
    workflow = parseComfyWorkflow(typeof body.workflow === 'string' ? body.workflow.trim() : body.workflow)
  } catch (err: any) {
    return badRequest(c, err.message)
  }
  const template = workflow ? null : resolveComfyTemplate(kind, body.comfyui_template, model)
  const source = workflow || template!.workflow
  const autoBind = !(body.comfyui_auto_bind === false || body.comfyui_auto_bind === 'false')
  const steps = explicitNumberSetting(kind === 'image' ? body.image_steps : body.comfyui_steps, 1, 200)
  const cfg = explicitNumberSetting(kind === 'image' ? body.image_cfg_scale : body.comfyui_cfg, 0, 30)
  const { report } = autoBindComfyWorkflow(source, kind, { enabled: autoBind, model, modelFiles: modelOverrideFiles(model, template), steps, cfg })

  // 内置模板的 {{model}} 会替换成「模型」里的文件名（或模板默认文件）
  const modelValue = splitModelFiles(model).length ? model : template?.defaultModel || ''
  const files = report.model_files.map((f) => ({ ...f }))
  for (const b of report.bindings) {
    if (b.target === 'model' && b.source === 'placeholder' && modelValue && splitModelFiles(modelValue).length) {
      const loaderField = report.loaders.find((l) => l.node_id === b.node_id)
      if (loaderField) files.push({ node_id: b.node_id, class_type: b.class_type, input: b.input, value: splitModelFiles(modelValue)[0] })
    }
  }

  let missing: Array<{ value: string; class_type: string; input: string; available: number }> | null = null
  let comfyError = ''
  const baseUrl = String(body.base_url || '').trim()
  if (baseUrl && files.length) {
    const cfgLike = { provider: 'comfyui', baseUrl, apiKey: String(body.api_key || ''), model: '' }
    missing = []
    const classes = [...new Set(files.map((f) => f.class_type))]
    const choices: Record<string, Record<string, string[]>> = {}
    await Promise.all(classes.map(async (cls) => {
      try {
        const resp = await fetch(comfyUrl(cfgLike, `/object_info/${encodeURIComponent(cls)}`), { headers: comfyAuthHeaders(cfgLike), signal: AbortSignal.timeout(10_000) })
        if (!resp.ok) return
        const info = await resp.json() as any
        const inputs = { ...(info?.[cls]?.input?.required || {}), ...(info?.[cls]?.input?.optional || {}) }
        choices[cls] = {}
        for (const [name, spec] of Object.entries<any>(inputs)) choices[cls][name] = comboOptions(spec)
      } catch (err: any) {
        comfyError = err?.message || String(err)
      }
    }))
    let checked = 0
    for (const f of files) {
      const list = choices[f.class_type]?.[f.input]
      if (!list || !list.length) continue
      checked++
      if (!list.includes(f.value)) missing.push({ value: f.value, class_type: f.class_type, input: f.input, available: list.length })
    }
    // 一个都没查到（ComfyUI 没启动 / 节点不存在）：不能说「都有」
    if (!checked) {
      missing = null
      comfyError = comfyError || '无法从 ComfyUI 读取模型列表（/object_info），未检查模型文件是否存在；请确认 Base URL 正确且 ComfyUI 已启动'
    }
  }

  return success(c, {
    source: workflow ? 'custom' : 'builtin',
    template: template ? { id: template.id, label: template.label, files: template.files, recommended: template.recommended, needs_image: template.needsImage || 'none' } : null,
    auto_bind: autoBind,
    bindings: report.bindings,
    warnings: report.warnings,
    outputs: report.outputs,
    loaders: report.loaders,
    model_files: files,
    missing_models: missing,
    comfy_error: comfyError || undefined,
  })
})

/** ComfyUI /object_info 里 COMBO 输入的可选值（兼容 [[...], {}] 与 ["COMBO", { options }] 两种格式） */
function comboOptions(spec: any): string[] {
  if (!Array.isArray(spec)) return []
  if (Array.isArray(spec[0])) return spec[0].map(String)
  if (spec[0] === 'COMBO' && Array.isArray(spec[1]?.options)) return spec[1].options.map(String)
  return []
}

/**
 * POST /ai-configs/local/models — 读取本地服务里实际可用的模型 / 采样器 / 风格，设置页点选即可加入「模型」
 * body: { provider, service_type, base_url, api_key }
 */
app.post('/local/models', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const provider = String(body.provider || '')
  const apiKey = String(body.api_key || '')
  const groups: Array<{ key: string; label: string; folder?: string; items: string[] }> = []
  const getJson = async (url: string, headers: Record<string, string>) => {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${url}`)
    return resp.json() as Promise<any>
  }
  try {
    if (provider === 'comfyui') {
      const cfgLike = { provider, baseUrl: String(body.base_url || 'http://127.0.0.1:8188'), apiKey, model: '' }
      const headers = comfyAuthHeaders(cfgLike)
      const want: Array<[string, string, string, string]> = [
        ['checkpoints', 'Checkpoint（CheckpointLoaderSimple）', 'CheckpointLoaderSimple', 'ckpt_name'],
        ['diffusion_models', '扩散模型（UNETLoader）', 'UNETLoader', 'unet_name'],
        ['gguf', 'GGUF 扩散模型（UnetLoaderGGUF）', 'UnetLoaderGGUF', 'unet_name'],
        ['text_encoders', '文本编码器（CLIPLoader）', 'CLIPLoader', 'clip_name'],
        ['vae', 'VAE（VAELoader）', 'VAELoader', 'vae_name'],
        ['loras', 'LoRA（LoraLoader）', 'LoraLoader', 'lora_name'],
      ]
      const folders: Record<string, string> = {
        checkpoints: 'models/checkpoints', diffusion_models: 'models/diffusion_models', gguf: 'models/unet',
        text_encoders: 'models/text_encoders', vae: 'models/vae', loras: 'models/loras',
      }
      await Promise.all(want.map(async ([key, label, cls, input]) => {
        try {
          const info = await getJson(comfyUrl(cfgLike, `/object_info/${cls}`), headers)
          const spec = info?.[cls]?.input?.required?.[input]
          const items = comboOptions(spec)
          if (info?.[cls]) groups.push({ key, label, folder: folders[key], items })
        } catch { /* 节点不存在（如未装 GGUF 插件）时跳过 */ }
      }))
      groups.sort((a, b) => want.findIndex((w) => w[0] === a.key) - want.findIndex((w) => w[0] === b.key))
      if (!groups.length) throw new Error('无法从 ComfyUI 读取节点信息，请确认地址正确且 ComfyUI 已启动')
    } else if (provider === 'sdwebui') {
      const base = String(body.base_url || '')
      const headers = localAuthHeaders(apiKey)
      const models = await getJson(localUrl(base, 'http://127.0.0.1:7860', '/sdapi/v1/sd-models'), headers)
      groups.push({ key: 'checkpoints', label: 'Checkpoint（sd-models）', items: (Array.isArray(models) ? models : []).map((m: any) => String(m.model_name || m.title)).filter(Boolean) })
      try {
        const samplers = await getJson(localUrl(base, 'http://127.0.0.1:7860', '/sdapi/v1/samplers'), headers)
        groups.push({ key: 'samplers', label: '采样器（填到「采样器」）', items: (Array.isArray(samplers) ? samplers : []).map((s: any) => String(s.name)).filter(Boolean) })
      } catch { /* 可选 */ }
      try {
        const loras = await getJson(localUrl(base, 'http://127.0.0.1:7860', '/sdapi/v1/loras'), headers)
        groups.push({ key: 'loras', label: 'LoRA（/sdapi/v1/loras）', items: (Array.isArray(loras) ? loras : []).map((l: any) => String(l.path || l.name || '').replace(/^.*[\\/]/, '') || String(l.name)).filter(Boolean) })
      } catch { /* 可选 */ }
    } else if (provider === 'fooocus') {
      const base = String(body.base_url || '')
      const headers = localAuthHeaders(apiKey)
      const all = await getJson(localUrl(base, 'http://127.0.0.1:8888', '/v1/engines/all-models'), headers)
      groups.push({ key: 'checkpoints', label: 'Checkpoint（model_filenames）', items: (all?.model_filenames || []).map(String) })
      if (Array.isArray(all?.lora_filenames)) groups.push({ key: 'loras', label: 'LoRA（lora_filenames）', items: all.lora_filenames.map(String) })
      try {
        const styles = await getJson(localUrl(base, 'http://127.0.0.1:8888', '/v1/engines/styles'), headers)
        if (Array.isArray(styles)) groups.push({ key: 'styles', label: '风格（填到「风格」，逗号分隔）', items: styles.map(String) })
      } catch { /* 可选 */ }
    } else {
      return badRequest(c, '只支持本地服务（comfyui / sdwebui / fooocus）')
    }
    return success(c, { groups })
  } catch (err: any) {
    return success(c, { groups, error: err?.message || String(err) })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!row) return notFound(c)
  return success(c, withParsedFields(row))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [existing] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  if (!existing) return notFound(c)

  const serviceType = 'service_type' in body ? body.service_type : existing.serviceType
  const provider = 'provider' in body ? body.provider : existing.provider
  if (!isOfficialProvider(serviceType, provider)) {
    return badRequest(c, '不支持的 service_type/provider')
  }

  const updates: Record<string, any> = { updatedAt: now() }

  if ('service_type' in body) updates.serviceType = body.service_type
  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if ('api_key' in body) updates.apiKey = body.api_key
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active
  // 与已有 settings 合并：清空的 temperature / ComfyUI 配置从 JSON 中移除
  const settingsPatch: Record<string, any> = {}
  if ('temperature' in body) {
    try {
      settingsPatch.temperature = normalizeTemperature(body.temperature)
    } catch {
      return badRequest(c, 'temperature 须为 0 到 2 之间的数字')
    }
  }
  try {
    Object.assign(settingsPatch, pickProviderSettings(provider, body))
  } catch (err: any) {
    return badRequest(c, err.message)
  }
  if (Object.keys(settingsPatch).length) updates.settings = mergeSettings(existing.settings, settingsPatch)

  await db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id))
  return success(c)
})

// GET /ai-providers
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = await db.select().from(schema.aiServiceProviders)
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
