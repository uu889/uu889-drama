import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const useApi = readFileSync(new URL('../app/composables/useApi.ts', import.meta.url), 'utf8')

function providerPresetBlock(serviceType) {
  const presetsStart = settingsPage.indexOf('const providerPresets = {')
  assert.notEqual(presetsStart, -1, 'missing providerPresets')
  const marker = `  ${serviceType}: {`
  const start = settingsPage.indexOf(marker, presetsStart)
  assert.notEqual(start, -1, `missing ${serviceType} provider presets`)
  const end = settingsPage.indexOf('\n  },', start)
  assert.notEqual(end, -1, `unterminated ${serviceType} provider presets`)
  return settingsPage.slice(start, end)
}

test('settings page exposes official provider templates only', () => {
  assert.doesNotMatch(settingsPage, /provider:\s*'chatfire'/i)
  assert.doesNotMatch(settingsPage, /openrouter/i)
  assert.doesNotMatch(settingsPage, /huobaoPreset/i)
  assert.doesNotMatch(settingsPage, /applyHuobaoPreset/i)
  assert.doesNotMatch(settingsPage, /\/huobao-preset/)
  assert.doesNotMatch(useApi, /api\.firemux\.com/i)
  assert.doesNotMatch(useApi, /applyHuobaoPreset/i)
  assert.doesNotMatch(useApi, /openrouter/i)
  assert.doesNotMatch(useApi, /huobaoPreset/i)
  assert.doesNotMatch(useApi, /\/huobao-preset/)

  assert.match(settingsPage, /const providers = \['aiask', 'xai', 'gemini', 'openai', 'volcengine', 'minimax', 'aliyun', 'comfyui'\]/)
  assert.match(settingsPage, /https:\/\/generativelanguage\.googleapis\.com/)
  assert.match(settingsPage, /https:\/\/api\.openai\.com/)
  assert.match(settingsPage, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(settingsPage, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.deepseek\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/dashscope\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
  assert.doesNotMatch(settingsPage, /\['ali'|'ali',|, 'ali'\]/)
  assert.doesNotMatch(settingsPage, /firemux/)
  assert.match(settingsPage, /const AIASK_SITE_URL = 'https:\/\/aiask\.me'/)
  assert.match(settingsPage, /applyAiaskQuickConfig/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.minimax\.io/)
})

test('settings page offers official default model IDs', () => {
  assert.match(settingsPage, /gemini-3\.1-pro-preview/)
  assert.match(settingsPage, /gemini-3\.8-flash/)
  assert.match(settingsPage, /gemini-3-flash-preview/)
  assert.match(settingsPage, /gpt-5\.6-terra/)
  assert.match(settingsPage, /gpt-5\.5/)
  assert.match(settingsPage, /grok-imagine-image/)
  assert.match(settingsPage, /grok-imagine-video-1\.5/)
  assert.match(settingsPage, /wan2\.2-ti2v-5b/)
  assert.match(settingsPage, /gemini-3-pro-image/)
  assert.match(settingsPage, /gemini-3\.1-flash-image/)
  assert.match(settingsPage, /gpt-image-2/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
  assert.match(settingsPage, /wan3\.0-video-prime/)
  assert.match(settingsPage, /wan3\.0-video/)
  assert.match(settingsPage, /deepseek-v4-pro/)
  assert.doesNotMatch(settingsPage, /gpt-5\.4/)
  assert.doesNotMatch(settingsPage, /doubao-seed-1-6/)
  assert.doesNotMatch(settingsPage, /wan2\.6-t2i/)
  assert.doesNotMatch(settingsPage, /wan2\.6-i2v-flash/)
  assert.doesNotMatch(settingsPage, /viduq3-turbo/)
  assert.doesNotMatch(settingsPage, /viduq3-pro/)
  assert.doesNotMatch(settingsPage, /gemini-2\.5-flash/)
  assert.doesNotMatch(settingsPage, /gpt-4\.1-mini/)
  assert.doesNotMatch(settingsPage, /gpt-image-1/)
  assert.doesNotMatch(settingsPage, /gemini-3-pro-image-preview/)
  assert.doesNotMatch(settingsPage, /gemini-3\.1-flash-image-preview/)
  assert.doesNotMatch(settingsPage, /doubao-seedream/)
  assert.doesNotMatch(settingsPage, /speech-2\.8-hd/)
})

test('text configs and aiask / ComfyUI configs expose the connection test button', () => {
  assert.match(settingsPage, /v-if="st\.type === 'text' \|\| \['aiask', 'xai', 'comfyui'\]\.includes\(c\.provider\)" class="btn btn-ghost btn-sm" @click="testExistingCfg\(c\)">\{\{ t\('settings\.ai\.test'\) \}\}/)
})

test('settings page offers the supported official provider presets', () => {
  assert.match(providerPresetBlock('text'), /deepseek-v4-pro/)
  assert.doesNotMatch(providerPresetBlock('text'), /minimax/i)
  assert.doesNotMatch(providerPresetBlock('image'), /'ali'|minimax/i)
  assert.match(providerPresetBlock('video'), /volcengine/)
  assert.match(providerPresetBlock('video'), /minimax/)
  assert.match(providerPresetBlock('video'), /aliyun/)
  assert.match(providerPresetBlock('video'), /aiask: \{ label: 'aiask\.me Grok 视频', baseUrl: AIASK_SITE_URL, models: \['grok-imagine-video-1\.5'\] \}/)
  assert.match(providerPresetBlock('video'), /comfyui: \{ label: '本地 ComfyUI', baseUrl: 'http:\/\/127\.0\.0\.1:8188'/)
  assert.match(providerPresetBlock('video'), /xai: \{ label: 'Grok 视频（xAI 原生）', baseUrl: 'https:\/\/api\.x\.ai'/)
  assert.match(providerPresetBlock('text'), /aiask:/)
  assert.match(providerPresetBlock('image'), /aiask:.*grok-imagine-image/)
  assert.doesNotMatch(providerPresetBlock('video'), /'vidu'/i)
  assert.doesNotMatch(settingsPage, /audio:\s*\{/)
})

test('aiask.me quick config writes text, image and Grok video configs', () => {
  const quickStart = settingsPage.indexOf('const aiaskQuickConfigs = [')
  assert.notEqual(quickStart, -1)
  const quickConfigs = settingsPage.slice(quickStart, settingsPage.indexOf('\n]', quickStart) + 2)
  for (const type of ['text', 'image', 'video']) {
    assert.match(quickConfigs, new RegExp(`service_type: '${type}', provider: 'aiask'.*base_url: AIASK_SITE_URL`))
  }
  assert.match(quickConfigs, /model: \['grok-imagine-video-1\.5'\]/)
})

test('ComfyUI video configs expose workflow / fps / negative prompt fields', () => {
  assert.match(settingsPage, /const isComfyForm = computed\(\(\) => cfgForm\.service_type === 'video' && cfgForm\.provider === 'comfyui'\)/)
  assert.match(settingsPage, /v-model="cfgForm\.comfyui_workflow"/)
  assert.match(settingsPage, /v-model="cfgForm\.comfyui_fps"/)
  assert.match(settingsPage, /v-model="cfgForm\.comfyui_negative_prompt"/)
})
