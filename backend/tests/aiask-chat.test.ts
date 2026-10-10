import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aiaskChatFamily, createAiaskChatFetch, patchAiaskChatBody } from '../src/agents/aiask-chat'
import { describeModelError } from '../src/utils/model-error'

test('aiask chat family detection follows the gateway workbench rules', () => {
  assert.equal(aiaskChatFamily('gpt-6-astra'), 'openai_reasoning')
  assert.equal(aiaskChatFamily('gpt-5.5'), 'openai_reasoning')
  assert.equal(aiaskChatFamily('o4-mini'), 'openai_reasoning')
  assert.equal(aiaskChatFamily('codex-mini-latest'), 'openai_reasoning')
  assert.equal(aiaskChatFamily('gpt-4.1'), 'gpt')
  assert.equal(aiaskChatFamily('claude-sonnet-4-6'), 'claude')
  assert.equal(aiaskChatFamily('gemini-3.1-pro-preview'), 'gemini')
  assert.equal(aiaskChatFamily('grok-4'), 'grok')
  assert.equal(aiaskChatFamily('deepseek-v4-pro'), 'deepseek')
  assert.equal(aiaskChatFamily('qwen3-max'), 'qwen')
  assert.equal(aiaskChatFamily('glm-5'), 'thinking_param')
  assert.equal(aiaskChatFamily('openai/gpt-6-astra'), 'openai_reasoning')
})

test('OpenAI reasoning models: no temperature, max_completion_tokens, no relay-only fields', () => {
  const body = patchAiaskChatBody({ model: 'gpt-6-astra', messages: [], temperature: 0, top_p: 1, max_tokens: 16384 })
  assert.deepEqual(body, { model: 'gpt-6-astra', messages: [], max_completion_tokens: 16384 })
  // 已有 max_completion_tokens 时保留调用方的值
  assert.deepEqual(
    patchAiaskChatBody({ model: 'gpt-5.5', messages: [], max_tokens: 100, max_completion_tokens: 50 }),
    { model: 'gpt-5.5', messages: [], max_completion_tokens: 50 },
  )
})

test('non-reasoning families only get the parameters their APIs accept', () => {
  assert.deepEqual(patchAiaskChatBody({ model: 'grok-4', messages: [], max_tokens: 10 }), { model: 'grok-4', messages: [], max_tokens: 10 })
  assert.deepEqual(patchAiaskChatBody({ model: 'claude-sonnet-4-6', messages: [] }), { model: 'claude-sonnet-4-6', messages: [] })
  assert.deepEqual(patchAiaskChatBody({ model: 'deepseek-v4-pro', messages: [] }), { model: 'deepseek-v4-pro', messages: [], thinking: { type: 'disabled' } })
  assert.deepEqual(patchAiaskChatBody({ model: 'qwen3-max', messages: [] }), { model: 'qwen3-max', messages: [], enable_thinking: false })
})

test('createAiaskChatFetch rewrites JSON chat bodies and passes everything else through', async () => {
  const seen: any[] = []
  const inner = (async (_input: any, init?: any) => { seen.push(init?.body); return new Response('{}') }) as typeof fetch
  const f = createAiaskChatFetch(inner)
  await f('https://aiask.me/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-6-astra', messages: [], max_tokens: 5, temperature: 0 }) })
  await f('https://aiask.me/v1/models', { method: 'GET' })
  assert.deepEqual(JSON.parse(seen[0]), { model: 'gpt-6-astra', messages: [], max_completion_tokens: 5 })
  assert.equal(seen[1], undefined)
})

test('describeModelError surfaces status and the provider message', () => {
  const apiErr = Object.assign(new Error('Bad Request'), {
    statusCode: 400,
    responseBody: JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model." } }),
  })
  assert.equal(describeModelError(apiErr), "文本模型调用失败（HTTP 400）：Unsupported parameter: 'max_tokens' is not supported with this model.")
  // Mastra 把 SDK 错误包在 cause 里
  const wrapped = Object.assign(new Error('Agent failed'), { cause: apiErr })
  assert.match(describeModelError(wrapped), /^文本模型调用失败（HTTP 400）：Unsupported parameter/)
  // 非 HTTP 错误保持原文
  assert.equal(describeModelError(new Error('剧本内容为空')), '剧本内容为空')
  assert.equal(describeModelError(Object.assign(new Error('x'), { statusCode: 502, responseBody: '<html>bad gateway</html>' })), '文本模型调用失败（HTTP 502）：<html>bad gateway</html>')
})
