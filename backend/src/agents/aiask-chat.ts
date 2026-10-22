/**
 * aiask.me 文本请求体修正（OpenAI Chat Completions 兼容网关）
 *
 * aiask.me 把请求原样转给各家官方上游，不会像 new-api 类中转站那样过滤未知参数，
 * 所以不能套用通用中转站的"关思考"补丁（thinking / enable_thinking / reasoning_effort）：
 * - OpenAI 推理模型（o*、gpt-5*、gpt-6*、codex*）：拒绝未知参数与 temperature，
 *   最大输出必须用 max_completion_tokens（传 max_tokens 会 400）
 * - grok-4 系列：传 reasoning_effort 会报错
 * 这里按模型家族只保留各家官方认可的参数（规则与 aiask.me 自身工作台一致）。
 */

export type AiaskChatFamily =
  | 'openai_reasoning'
  | 'gpt'
  | 'claude'
  | 'gemini'
  | 'grok'
  | 'deepseek'
  | 'qwen'
  | 'thinking_param'
  | 'other'

export function aiaskChatFamily(model: unknown): AiaskChatFamily {
  const m = String(model || '').trim().toLowerCase().replace(/^.*\//, '')
  if (/^(o\d|gpt-5|gpt-6|codex|computer-use)/.test(m)) return 'openai_reasoning'
  if (/^(gpt-|chatgpt)/.test(m)) return 'gpt'
  if (m.includes('claude')) return 'claude'
  if (m.startsWith('gemini') || m.startsWith('gemma')) return 'gemini'
  if (m.startsWith('grok')) return 'grok'
  if (m.startsWith('deepseek')) return 'deepseek'
  if (/^(qwen|qwq)/.test(m)) return 'qwen'
  // 智谱 GLM / Kimi / 豆包 / MiniMax 均使用 thinking: { type } 开关
  if (/^(glm|chatglm|kimi|moonshot|doubao|minimax|abab)/.test(m)) return 'thinking_param'
  return 'other'
}

/** 就地修正 Chat Completions 请求体并返回它 */
export function patchAiaskChatBody(body: Record<string, any>): Record<string, any> {
  const family = aiaskChatFamily(body.model)
  switch (family) {
    case 'openai_reasoning':
      delete body.temperature
      delete body.top_p
      if (body.max_tokens != null) {
        if (body.max_completion_tokens == null) body.max_completion_tokens = body.max_tokens
        delete body.max_tokens
      }
      break
    case 'deepseek':
    case 'thinking_param':
      // 思考模式要求多轮回传 reasoning_content，Agent 工具循环做不到，显式关闭
      if (body.thinking == null) body.thinking = { type: 'disabled' }
      break
    case 'qwen':
      if (body.enable_thinking == null) body.enable_thinking = false
      break
    case 'claude':
      // 经网关转到 Anthropic 时同样受限：新 Claude 模型拒绝采样参数
      patchClaudeBody(body)
      break
    default:
      // gpt / claude / gemini / grok / 其它：只发标准参数
      break
  }
  return body
}

/**
 * Claude 4.7 及以后的模型（Opus 4.7 / 4.8 / 5 / 5.5、Sonnet 5 / 5.5、Haiku 5 / 5.5、Fable、Mythos）不再接受
 * temperature / top_p / top_k（会 400）；更早的 Claude 仍可用采样参数。
 */
export function claudeRejectsSampling(model: unknown): boolean {
  const m = String(model || '').toLowerCase()
  return /claude-(fable|mythos)|claude-opus-(4-[78]|5)|claude-sonnet-5|claude-haiku-5/.test(m)
}

/** Claude（Anthropic Messages API）请求体修正：去掉新模型不接受的采样参数 */
export function patchClaudeBody(body: Record<string, any>): Record<string, any> {
  if (claudeRejectsSampling(body.model)) {
    delete body.temperature
    delete body.top_p
    delete body.top_k
  }
  return body
}

/** Claude 的 fetch：同样放在补丁链最内层（Mastra 默认会带 temperature: 0） */
export function createClaudeFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body)
        if (body && Array.isArray(body.messages)) {
          init = { ...init, body: JSON.stringify(patchClaudeBody(body)) }
        }
      }
    } catch { /* 非 JSON 请求体原样透传 */ }
    return inner(input, init)
  }
}

/** 作为 AI SDK 的 fetch：放在补丁链最内层，最后一步修正请求体 */
export function createAiaskChatFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input: any, init?: any) => {
    try {
      if (init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body)
        if (body && Array.isArray(body.messages)) {
          init = { ...init, body: JSON.stringify(patchAiaskChatBody(body)) }
        }
      }
    } catch { /* 非 JSON 请求体原样透传 */ }
    return inner(input, init)
  }
}
