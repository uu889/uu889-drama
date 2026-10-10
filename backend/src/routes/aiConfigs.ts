import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { isOfficialProvider, parseConfigSettings, parseConfigTemperature } from '../services/ai.js'
import { parseComfyWorkflow } from '../services/adapters/comfyui-common.js'
import { localAuthHeaders } from '../services/adapters/local-image.js'
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

const IMAGE_PARAM_RULES: Record<string, SettingRule> = {
  image_base_size: { kind: 'number', min: 256, max: 2048, integer: true },
  image_steps: { kind: 'number', min: 1, max: 150, integer: true },
  image_cfg_scale: { kind: 'number', min: 0, max: 30 },
}

const PROVIDER_SETTING_RULES: Record<string, Record<string, SettingRule>> = {
  comfyui: {
    comfyui_workflow: { kind: 'workflow' },
    comfyui_fps: { kind: 'number', min: 1, max: 120, integer: true },
    comfyui_negative_prompt: { kind: 'text', max: 4000 },
    ...IMAGE_PARAM_RULES,
  },
  sdwebui: {
    image_negative_prompt: { kind: 'text', max: 4000 },
    image_sampler: { kind: 'text', max: 100 },
    ...IMAGE_PARAM_RULES,
  },
  fooocus: {
    image_negative_prompt: { kind: 'text', max: 4000 },
    fooocus_performance: { kind: 'text', max: 50 },
    fooocus_styles: { kind: 'text', max: 1000 },
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

  if (p === 'openai' || p === 'aiask' || p === 'xai') {
    // aiask.me 为 OpenAI 兼容网关、xAI 原生接口同样提供 /v1/models，用它验证 Key 与地址
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
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
