/**
 * 模板库：一键生成风格库 / 智能体 / 工作流 的接口与工具
 */
import { api, aiConfigAPI } from './useApi'

export const catalogAPI = {
  summary: () => api.get('/catalog'),
  styles: () => api.get<any[]>('/catalog/styles'),
  importStyle: (id: string) => api.post(`/catalog/styles/${id}/import`),
  skills: () => api.get<any[]>('/catalog/skills'),
  agents: () => api.get<any[]>('/catalog/agents'),
  agent: (id: string) => api.get(`/catalog/agents/${id}`),
  saveAgent: (id: string, data: any) => api.put(`/catalog/agents/${id}`, data),
  delAgent: (id: string) => api.del(`/catalog/agents/${id}`),
  workflows: () => api.get<any[]>('/catalog/workflows'),
  workflow: (id: string) => api.get(`/catalog/workflows/${id}`),
  saveWorkflow: (id: string, data: any) => api.put(`/catalog/workflows/${id}`, data),
  delWorkflow: (id: string) => api.del(`/catalog/workflows/${id}`),
  handoff: (data: any) => api.post<{ drama_id: number; episode_number: number }>('/catalog/handoff', data),
}

function parseSseBlock(block: string) {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  try { return { event, data: JSON.parse(data.join('\n') || 'null') } } catch { return { event, data: null } }
}

/** POST 一个 SSE 接口，逐个事件回调；signal 中断时抛 AbortError */
export async function postSse(path: string, body: any, onEvent: (event: string, data: any) => void, signal?: AbortSignal) {
  const resp = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok || !resp.body) {
    const json = await resp.json().catch(() => null)
    throw new Error(json?.message || `${resp.status}`)
  }
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value.replace(/\r\n/g, '\n')
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const { event, data } = parseSseBlock(buf.slice(0, idx))
      buf = buf.slice(idx + 2)
      onEvent(event, data)
    }
  }
}

function configModels(cfg: any): string[] {
  const raw = cfg?.model
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try { const m = JSON.parse(raw); return Array.isArray(m) ? m.filter(Boolean) : [m].filter(Boolean) } catch { return [raw].filter(Boolean) }
}

/** 文字模型选择（与工作台同一套：'provider/model' 复合键 + 所属配置） */
export function useTextModelPick() {
  const options = ref<any[]>([])
  const picked = ref('')
  async function loadModels() {
    try {
      const cfgs = (await aiConfigAPI.list('text')) || []
      const seen = new Set<string>()
      const out: any[] = []
      for (const c of [...cfgs].filter((c: any) => c.is_active).sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0))) {
        for (const m of configModels(c)) {
          const key = `${c.provider}/${m}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ key, model: m, provider: c.provider, configId: c.id, configName: c.name || c.provider })
        }
      }
      options.value = out
    } catch { /* 没配置时用后端默认 */ }
  }
  /** 请求体里的 model / config_id */
  function modelBody() {
    const key = picked.value
    if (!key) return {}
    const i = key.indexOf('/')
    return { model: i >= 0 ? key.slice(i + 1) : key, config_id: options.value.find(o => o.key === key)?.configId }
  }
  const multiConfig = computed(() => new Set(options.value.map(o => o.configId)).size > 1)
  return { options, picked, loadModels, modelBody, multiConfig }
}

/** 按分类分组（保持出现顺序，「我的」放最前） */
export function groupByCategory<T extends { category?: string }>(items: T[], otherLabel: string) {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = it.category || otherLabel
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(it)
  }
  return [...map.entries()].map(([category, list]) => ({ category, items: list }))
}
