/**
 * 影像参数（Cinematic Spec）：接口、空白模板、智能体 / 工作流共用的本地参数
 * 字段与后端 services/cinematic/spec.ts 一致
 */
import { api } from './useApi'

export const cinematicAPI = {
  options: () => api.get<any>('/cinematic/options'),
  presets: () => api.get<any[]>('/cinematic/presets'),
  savePreset: (id: string, data: any) => api.put(`/cinematic/presets/${id}`, data),
  delPreset: (id: string) => api.del(`/cinematic/presets/${id}`),
  generate: (data: any) => api.post<any>('/cinematic/generate', data),
  render: (spec: any, refs: 'image' | 'name' = 'image') => api.post<{ text: string }>('/cinematic/render', { spec, refs }),
  getProject: (dramaId: number) => api.get<any>(`/dramas/${dramaId}/cinematic`),
  saveProject: (dramaId: number, spec: any) => api.put<any>(`/dramas/${dramaId}/cinematic`, spec),
  applyProject: (dramaId: number, spec?: any) => api.post<any>(`/dramas/${dramaId}/cinematic/apply`, spec || {}),
}

export function emptyCinematicSpec() {
  return {
    enabled: false,
    visual: { style_ids: [], style_anchor: '', camera_ids: [], lens_ids: [], focal_ids: [], film_ids: [], camera_notes: '', aspect_id: '', palette_id: '', palette: [], tone_notes: '' },
    characters: [],
    scene: { name: '', image_url: '', environment: '', zones: [], surroundings: '' },
    props: [],
    lighting: { key_light_id: '', key_light: '', ratio_id: '', terminator: '', fill: '', dynamic: '', materials: '', constraint_ids: [], constraints: '' },
    storyboard: { enabled: false, segment_seconds: 0, shot_size_ids: [], angle_ids: [], layer_ids: [], technique_ids: [], move_ids: [], performance_ids: [], atmosphere_ids: [], sound: '', notes: '' },
  } as any
}

/** 缺字段补齐（旧数据 / 预设里没写的块） */
export function fillCinematicSpec(raw: any) {
  const base = emptyCinematicSpec()
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    ...base,
    ...r,
    visual: { ...base.visual, ...(r.visual || {}) },
    scene: { ...base.scene, ...(r.scene || {}) },
    lighting: { ...base.lighting, ...(r.lighting || {}) },
    storyboard: { ...base.storyboard, ...(r.storyboard || {}) },
    characters: Array.isArray(r.characters) ? r.characters : [],
    props: Array.isArray(r.props) ? r.props : [],
  }
}

/** 填了多少块（按钮上的提示） */
export function cinematicFilledCount(s: any): number {
  if (!s) return 0
  const v = s.visual || {}
  const l = s.lighting || {}
  const sc = s.scene || {}
  return [
    v.style_ids?.length || v.style_anchor || v.camera_ids?.length || v.lens_ids?.length || v.film_ids?.length || v.aspect_id || v.palette?.length,
    s.characters?.length,
    sc.environment || sc.zones?.length || sc.image_url,
    s.props?.length,
    l.key_light_id || l.key_light || l.terminator || l.fill || l.constraint_ids?.length,
    s.storyboard?.enabled,
  ].filter(Boolean).length
}

const CHAT_KEY = 'uu889:cinematic:chat'

/** 智能体 / 工作流共用的一份参数（浏览器本地） */
export function loadChatCinematic() {
  try { return fillCinematicSpec(JSON.parse(localStorage.getItem(CHAT_KEY) || 'null')) } catch { return emptyCinematicSpec() }
}
export function saveChatCinematic(spec: any) {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(spec)) } catch { /* 忽略 */ }
}

/** 请求体里带的参数：没开就不带 */
export function cinematicBody(spec: any) {
  return spec?.enabled && cinematicFilledCount(spec) ? { cinematic: spec } : {}
}

export function newRowId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
