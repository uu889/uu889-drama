/**
 * 视觉风格 → 本地模型：项目选了「日漫赛璐璐」「吉卜力手绘」等视觉风格后，本地生图 / 生视频自动换成对应的
 * Checkpoint + 风格 LoRA + 触发词 + 推荐参数。
 *
 * - 推荐清单见 style-model-catalog.ts（SD WebUI 用 Civitai，ComfyUI / Fooocus 用 Hugging Face）
 * - 配置里 settings.style_models_enabled 打开后生效（默认关：没下载对应模型时不要自动切换）
 * - settings.style_models[风格] 可以逐项覆盖推荐值（checkpoint / lora / lora_weight / trigger / template）
 */
import { STYLE_MODEL_CATALOG, type CatalogKind, type StyleImagePreset, type StyleVideoPreset } from './style-model-catalog'

export const STYLE_KEYS = ['3d', 'anime', 'ghibli', 'watercolor', 'comic', 'guofeng', 'webtoon', 'noir'] as const
export type StyleKey = typeof STYLE_KEYS[number]

export interface StyleModelOverride {
  checkpoint?: string
  lora?: string
  lora_weight?: number | string
  trigger?: string
  template?: string
}

/** 生成时实际使用的风格模型（文件名都是放进本地服务模型目录后的文件名） */
export interface ResolvedStyleModels {
  style: StyleKey
  checkpoint?: string
  lora?: string
  loraWeight: number
  loraApplyTo?: 'all' | 'high' | 'low'
  trigger?: string
  sampler?: string
  scheduler?: string
  steps?: number
  cfg?: number
  clipSkip?: number
  baseSize?: number
  template?: string
  /** template 来自用户的风格覆盖（优先于配置里选的模板 / 模型） */
  templateOverride?: boolean
  negative?: string
  fooocusStyles?: string[]
}

export function catalogKindFor(provider: string, serviceType: 'image' | 'video'): CatalogKind | null {
  if (serviceType === 'video') return provider === 'comfyui' ? 'comfyui_video' : null
  if (provider === 'sdwebui') return 'sdwebui'
  if (provider === 'comfyui' || provider === 'fooocus') return 'hf_image'
  return null
}

export function isStyleKey(value: unknown): value is StyleKey {
  return typeof value === 'string' && (STYLE_KEYS as readonly string[]).includes(value)
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 把用户填写的覆盖值规范化（用于保存前校验） */
export function normalizeStyleOverrides(raw: unknown): Record<StyleKey, StyleModelOverride> | null {
  let obj: any = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try { obj = JSON.parse(raw) } catch { throw new Error('style_models 不是合法 JSON') }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const out: Partial<Record<StyleKey, StyleModelOverride>> = {}
  for (const key of STYLE_KEYS) {
    const row = obj[key]
    if (!row || typeof row !== 'object') continue
    const clean: StyleModelOverride = {}
    for (const f of ['checkpoint', 'lora', 'trigger', 'template'] as const) {
      const v = text(row[f])
      if (v) clean[f] = v.slice(0, 300)
    }
    const w = Number(row.lora_weight)
    if (row.lora_weight !== '' && row.lora_weight != null && Number.isFinite(w) && w >= -2 && w <= 2) clean.lora_weight = w
    if (Object.keys(clean).length) out[key] = clean
  }
  return Object.keys(out).length ? (out as Record<StyleKey, StyleModelOverride>) : null
}

/** 解析某个风格在该服务商下实际使用的模型；未开启 / 无风格 / 不支持的服务商返回 null */
export function resolveStyleModels(
  provider: string,
  serviceType: 'image' | 'video',
  settings: Record<string, any> | null | undefined,
  style: string | null | undefined,
): ResolvedStyleModels | null {
  if (!settings?.style_models_enabled || !isStyleKey(style)) return null
  const kind = catalogKindFor(provider, serviceType)
  if (!kind) return null
  const preset = STYLE_MODEL_CATALOG[kind][style] as StyleImagePreset | StyleVideoPreset | undefined
  let overrides: StyleModelOverride = {}
  try {
    overrides = normalizeStyleOverrides(settings.style_models)?.[style] || {}
  } catch {
    overrides = {}
  }
  const lora = 'lora' in (preset || {}) ? (preset as any).lora : null
  const resolved: ResolvedStyleModels = {
    style,
    checkpoint: overrides.checkpoint || (preset && 'checkpoint' in preset ? preset.checkpoint?.file : undefined),
    lora: overrides.lora || lora?.file || undefined,
    loraWeight: Number(overrides.lora_weight ?? lora?.weight ?? 0.8),
    loraApplyTo: lora?.applyTo,
    trigger: overrides.trigger ?? lora?.trigger ?? (preset as any)?.trigger ?? (preset as any)?.checkpoint?.trigger,
    template: overrides.template || (preset as StyleVideoPreset | undefined)?.template,
    templateOverride: !!overrides.template,
  }
  if (preset && 'params' in preset && preset.params) {
    const p = preset.params
    Object.assign(resolved, {
      sampler: p.sampler, scheduler: p.scheduler, steps: p.steps, cfg: p.cfg,
      clipSkip: p.clipSkip, baseSize: p.baseSize, negative: p.negative, fooocusStyles: p.fooocusStyles,
    })
  }
  // 用户把 LoRA 清空（填 none / 无）表示不用 LoRA
  if (resolved.lora && /^(none|无|-)$/i.test(resolved.lora)) resolved.lora = undefined
  return resolved
}

/** 触发词放在提示词最前面（已包含就不重复） */
export function withTrigger(prompt: string, trigger?: string): string {
  const t = (trigger || '').trim()
  if (!t) return prompt
  return prompt.toLowerCase().includes(t.toLowerCase()) ? prompt : `${t}, ${prompt}`
}

/** 文件名去掉扩展名与目录（SD WebUI 的 <lora:名字:权重> 用不带扩展名的名字） */
export function bareModelName(file: string): string {
  return file.replace(/^.*[\\/]/, '').replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '')
}
