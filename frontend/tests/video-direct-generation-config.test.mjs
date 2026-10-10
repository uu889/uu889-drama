import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../../backend/src/services/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  const combined = `${settingsPage}\n${aiConfigRoute}\n${volcengineAdapter}`
  assert.doesNotMatch(combined, /doubao-seedance-1-5-pro-251215/)
  assert.match(settingsPage, /Seedance 2\.0/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
})

test('video presets use official provider endpoints', () => {
  const presetsStart = settingsPage.indexOf('const providerPresets = {')
  const quickStart = settingsPage.indexOf('const aiaskQuickConfigs = [')
  assert.ok(quickStart > presetsStart)
  const providerPresets = settingsPage.slice(presetsStart, quickStart)
  assert.doesNotMatch(providerPresets, /api\.firemux\.com/)
  assert.match(settingsPage, /https:\/\/ark\.cn-beijing\.volces\.com/)
  assert.match(providerPresets, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/dashscope\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
})

test('aiask quick preset uses Grok video through the /v1/videos task API', () => {
  const quickStart = settingsPage.indexOf('const aiaskQuickConfigs = [')
  const quickConfigs = settingsPage.slice(quickStart, settingsPage.indexOf('\n]', quickStart))
  assert.match(quickConfigs, /service_type: 'video', provider: 'aiask'.*grok-imagine-video-1\.5/)
  const adapter = readFileSync(new URL('../../backend/src/services/adapters/aiask-video.ts', import.meta.url), 'utf8')
  assert.match(adapter, /joinProviderUrl\(config\.baseUrl, '\/v1', '\/videos'\)/)
  assert.match(adapter, /`\/videos\/\$\{encodeURIComponent\(taskId\)\}`/)
  assert.match(adapter, /\/content/)
})
