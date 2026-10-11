/**
 * 本地生图提示词翻译：SD / SDXL / FLUX 的文本编码器只认英文，UU889-Drama 的提示词却常是中文。
 * 开启 settings.prompt_translate 后，含中日韩文字的提示词在提交前用当前启用的文字模型翻成英文。
 * 结果按原文缓存；翻译失败时沿用原文（不中断生成）。
 */
import { Agent } from '@mastra/core/agent'
import { logTaskWarn } from '../utils/task-logger.js'

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/
const cache = new Map<string, string>()
const CACHE_LIMIT = 500

const INSTRUCTIONS = [
  'You translate prompts for Stable Diffusion / SDXL / FLUX image models into English.',
  'Output only the translated prompt — no quotes, no explanations, no prefixes.',
  'Keep it as a comma-separated list of visual descriptions; keep proper names, @references, numbers, weights like (word:1.2) and English words unchanged.',
  'Do not add or remove content.',
].join('\n')

export function needsTranslation(text: string | null | undefined): boolean {
  return CJK_RE.test(String(text || ''))
}

/** 提供商默认是否翻译：本地生图（SD 系 / FLUX 只懂英文）默认开；ComfyUI 视频（Wan 懂中文）默认关 */
export function shouldTranslatePrompt(provider: string, type: 'image' | 'video', settings: Record<string, any> | null | undefined): boolean {
  const explicit = settings?.prompt_translate
  if (explicit === true || explicit === false) return explicit
  return type === 'image' && ['comfyui', 'sdwebui', 'fooocus'].includes(provider)
}

export async function translatePromptToEnglish(text: string): Promise<string> {
  const source = String(text || '').trim()
  if (!needsTranslation(source)) return source
  const cached = cache.get(source)
  if (cached) return cached
  const { getUtilityTextModel } = await import('../agents/index.js')
  const agent = new Agent({
    id: 'prompt_translator',
    name: 'Prompt Translator',
    instructions: INSTRUCTIONS,
    model: () => getUtilityTextModel(),
  })
  const result: any = await agent.generate(source)
  const out = String(result?.text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '')
  if (!out) throw new Error('文字模型返回为空')
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(source, out)
  return out
}

/** 生成流程里用：失败时记录警告并返回原文 */
export async function maybeTranslatePrompt(text: string, onError?: (message: string) => void): Promise<string> {
  try {
    return await translatePromptToEnglish(text)
  } catch (err: any) {
    const message = err?.message || String(err)
    logTaskWarn('PromptTranslate', 'failed', { error: message })
    onError?.(message)
    return text
  }
}
