/**
 * 创作会话（智能体 / 工作流里直接生图、生视频、剪成片）的接口与轮询
 */
import { api } from './useApi'

export const studioAPI = {
  list: (kind: 'agent' | 'workflow', refId?: string) => api.get<any[]>(`/studio/sessions?kind=${kind}${refId ? `&ref_id=${encodeURIComponent(refId)}` : ''}`),
  create: (data: any) => api.post<any>('/studio/sessions', data),
  get: (id: number) => api.get<any>(`/studio/sessions/${id}`),
  patch: (id: number, data: any) => req('PATCH', `/studio/sessions/${id}`, data),
  send: (id: number, data: any) => api.post<any>(`/studio/sessions/${id}/messages`, data),
  stop: (id: number) => api.post<any>(`/studio/sessions/${id}/stop`),
  remove: (id: number) => api.del(`/studio/sessions/${id}`),
  removeAsset: (id: number, assetId: number) => api.del(`/studio/sessions/${id}/assets/${assetId}`),
  upload: async (id: number, files: File[]) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    const resp = await fetch(`/api/v1/studio/sessions/${id}/uploads`, { method: 'POST', body: fd })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok || (json.code && json.code >= 400)) throw new Error(json.message || `${resp.status}`)
    return (json.data ?? json) as any[]
  },
}

async function req(method: string, path: string, body?: any) {
  const resp = await fetch(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || (json.code && json.code >= 400)) throw new Error(json.message || `${resp.status}`)
  return json.data ?? json
}

/** static/x.png → /static/x.png */
export function mediaSrc(path: string | null | undefined): string {
  if (!path) return ''
  return /^(https?:|data:|\/)/.test(path) ? path : `/${path}`
}

export function isVideoAsset(a: any): boolean {
  return a?.kind === 'video' || a?.kind === 'render' || (a?.kind === 'upload' && /\.(mp4|mov|webm|m4v|mkv)$/i.test(a?.path || ''))
}

export function isAudioAsset(a: any): boolean {
  return a?.kind === 'voice' || (a?.kind === 'upload' && /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a?.path || ''))
}

/** 渲染工作流模板（与后端 renderTemplate 同规则） */
export function renderWorkflowTemplate(template: string, ctx: { inputs: Record<string, string>; steps: Record<string, string>; previous?: string }) {
  const first = Object.values(ctx.inputs)[0] ?? ''
  return String(template || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => {
    if (key === 'input') return first
    if (key === 'previous') return ctx.previous ?? ''
    const [scope, name] = key.split('.', 2)
    if (scope === 'inputs' && name in ctx.inputs) return ctx.inputs[name]
    if (scope === 'steps' && name in ctx.steps) return ctx.steps[name]
    return whole
  })
}

/** 会话状态 + 运行中自动轮询 */
export function useStudioSession() {
  const session = ref<any>(null)
  const loading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function clear() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule() {
    clear()
    if (disposed || !session.value) return
    const busy = session.value.running || (session.value.assets || []).some((a: any) => a.status === 'processing')
    if (busy) timer = setTimeout(refresh, 1500)
  }

  async function refresh() {
    const id = session.value?.id
    if (!id) return
    try {
      const s = await studioAPI.get(id)
      if (session.value?.id === id) session.value = s
    } catch { /* 下次再试 */ }
    schedule()
  }

  async function open(id: number | null) {
    clear()
    if (!id) { session.value = null; return }
    loading.value = true
    try {
      session.value = await studioAPI.get(id)
    } finally {
      loading.value = false
    }
    schedule()
  }

  function set(s: any) {
    session.value = s
    schedule()
  }

  onBeforeUnmount(() => { disposed = true; clear() })
  return { session, loading, open, refresh, set }
}
