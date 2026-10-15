<template>
  <div class="mi-panel">
    <div class="mi-head">
      <Download :size="14" />
      <strong>{{ t('settings.cfg.installer.title') }}</strong>
    </div>
    <p class="mi-hint">{{ t('settings.cfg.installer.intro') }}</p>

    <!-- 工作方式 -->
    <div class="mi-row">
      <span class="mi-label">{{ t('settings.cfg.installer.mode') }}</span>
      <label class="mi-radio"><input v-model="mode" type="radio" value="local" :disabled="env && !env.local_allowed" /> {{ t('settings.cfg.installer.local') }}<span v-if="env" class="mi-dim">（{{ osLabel(env.os) }} · {{ env.hostname }}）</span></label>
      <label class="mi-radio"><input v-model="mode" type="radio" value="remote" /> {{ t('settings.cfg.installer.remote') }}</label>
    </div>
    <p v-if="env && !env.local_allowed && mode === 'local'" class="mi-warn">{{ t('settings.cfg.installer.localDisabled') }}</p>

    <!-- 远程登录 -->
    <div v-if="mode === 'remote'" class="mi-remote">
      <div class="mi-grid">
        <input v-model="remote.host" class="input" :placeholder="t('settings.cfg.installer.host')" />
        <input v-model.number="remote.port" class="input mi-port" type="number" min="1" max="65535" placeholder="22" />
        <input v-model="remote.username" class="input" :placeholder="t('settings.cfg.installer.username')" autocomplete="off" />
      </div>
      <div class="mi-row">
        <label class="mi-radio"><input v-model="remote.auth" type="radio" value="password" /> {{ t('settings.cfg.installer.authPassword') }}</label>
        <label class="mi-radio"><input v-model="remote.auth" type="radio" value="key" /> {{ t('settings.cfg.installer.authKey') }}</label>
      </div>
      <input v-if="remote.auth !== 'key'" v-model="remote.password" class="input" type="password" :placeholder="t('settings.cfg.installer.password')" autocomplete="new-password" />
      <template v-else>
        <textarea v-model="remote.privateKey" class="input mono mi-key" rows="4" :placeholder="t('settings.cfg.installer.privateKey')" />
        <input v-model="remote.passphrase" class="input" type="password" :placeholder="t('settings.cfg.installer.passphrase')" autocomplete="new-password" />
      </template>
      <div class="mi-row">
        <button type="button" class="btn btn-sm" :disabled="testing" @click="testRemote">
          <Loader2 v-if="testing" :size="12" class="animate-spin" />{{ t('settings.cfg.installer.test') }}
        </button>
        <span v-if="remoteInfo?.ok" class="mi-ok">✓ {{ t('settings.cfg.installer.connected', { os: osLabel(remoteInfo.os), host: remoteInfo.hostname, home: remoteInfo.home }) }}</span>
        <span v-else-if="remoteInfo?.error" class="mi-err">{{ remoteInfo.error }}</span>
      </div>
      <p class="mi-hint">{{ t('settings.cfg.installer.remoteHint') }}</p>
    </div>

    <!-- 安装根目录 -->
    <div class="mi-field">
      <span class="mi-label">{{ t('settings.cfg.installer.root', { app: appLabel }) }}</span>
      <div class="mi-row mi-nowrap">
        <input v-model="root" class="input mono" :placeholder="rootPlaceholder" />
        <button type="button" class="btn btn-sm" :disabled="detecting" @click="detect">
          <Loader2 v-if="detecting" :size="12" class="animate-spin" />{{ t('settings.cfg.installer.detect') }}
        </button>
        <button type="button" class="btn btn-sm" @click="browse">{{ t('settings.cfg.installer.browse') }}</button>
      </div>
      <div v-if="candidates" class="mi-cands">
        <span v-if="!candidates.length" class="mi-dim">{{ t('settings.cfg.installer.notFound', { app: appLabel }) }}</span>
        <button v-for="c in candidates" :key="c.path" type="button" :class="['mi-cand', { 'is-on': c.path === root }]" @click="root = c.path">
          <span class="mono">{{ c.path }}</span>
          <span class="mi-dim">{{ c.flavor }} · {{ c.source === 'api' ? t('settings.cfg.installer.fromApi') : t('settings.cfg.installer.fromScan') }}</span>
        </button>
      </div>
    </div>

    <!-- 风格 -->
    <div class="mi-field">
      <span class="mi-label">{{ t('settings.cfg.installer.styles') }}</span>
      <div class="mi-chips">
        <button v-for="s in STYLE_LIST" :key="s.key" type="button" :class="['mi-chip', { 'is-on': styles.includes(s.key) }]" @click="toggleStyle(s.key)">
          {{ s.label }}<span v-if="inUse.includes(s.key)" class="mi-dot" :title="t('settings.cfg.installer.inUse')">●</span>
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="styles = inUse.length ? [...inUse] : ['3d']">{{ t('settings.cfg.installer.pickInUse') }}</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="styles = STYLE_LIST.map(s => s.key)">{{ t('settings.cfg.installer.pickAll') }}</button>
      </div>
    </div>

    <!-- 选项 -->
    <div class="mi-opts">
      <label class="mi-check"><input v-model="autoDownload" type="checkbox" /> <span><b>{{ t('settings.cfg.installer.auto') }}</b><span class="mi-hint">{{ t('settings.cfg.installer.autoHint') }}</span></span></label>
      <label class="mi-check"><input v-model="preferMirror" type="checkbox" /> <span><b>{{ t('settings.cfg.installer.preferMirror') }}</b><span class="mi-hint">{{ t('settings.cfg.installer.preferMirrorHint') }}</span></span></label>
      <div class="mi-grid2">
        <label class="mi-field"><span class="mi-label">Civitai API Key</span><input v-model="civitaiToken" class="input mono" type="password" :placeholder="t('settings.cfg.installer.civitaiPlaceholder')" autocomplete="off" /></label>
        <label class="mi-field"><span class="mi-label">Hugging Face Token</span><input v-model="hfToken" class="input mono" type="password" :placeholder="t('settings.cfg.installer.hfPlaceholder')" autocomplete="off" /></label>
      </div>
      <p class="mi-hint">{{ t('settings.cfg.installer.sourcesHint') }}</p>
    </div>

    <div class="mi-row">
      <button type="button" class="btn btn-sm" :disabled="planning || !root || !styles.length" @click="checkPlan">
        <Loader2 v-if="planning" :size="12" class="animate-spin" />{{ t('settings.cfg.installer.check') }}
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="starting || !plan || !missing.length" @click="startDownload">
        <Loader2 v-if="starting" :size="12" class="animate-spin" />{{ t('settings.cfg.installer.download', { n: missing.length, size: fmtBytes(plan?.missing_bytes) }) }}
      </button>
    </div>
    <p class="mi-hint">{{ t('settings.cfg.installer.saveHint') }}</p>

    <!-- 检查结果 -->
    <div v-if="plan" class="mi-plan">
      <div class="mi-summary">
        <span>{{ t('settings.cfg.installer.summary', { total: plan.files.length, missing: missing.length, size: fmtBytes(plan.missing_bytes) }) }}</span>
        <span v-if="plan.free_bytes != null" class="mi-dim">{{ t('settings.cfg.installer.free', { size: fmtBytes(plan.free_bytes) }) }}</span>
        <span v-if="plan.layout.flavor" class="mi-dim">· {{ plan.layout.flavor }}</span>
      </div>
      <p v-for="(w, i) in plan.warnings" :key="`w${i}`" class="mi-warn">⚠ {{ w }}</p>
      <p v-for="(n, i) in plan.notes" :key="`n${i}`" class="mi-hint">{{ n }}</p>
      <p v-for="(s, i) in plan.skipped" :key="`s${i}`" class="mi-hint">· {{ styleLabel(s.style) }}：<code>{{ s.file }}</code> {{ s.reason }}</p>
      <table class="mi-table">
        <thead><tr><th>{{ t('settings.cfg.installer.colFile') }}</th><th>{{ t('settings.cfg.installer.colStyles') }}</th><th>{{ t('settings.cfg.installer.colSize') }}</th><th>{{ t('settings.cfg.installer.colState') }}</th></tr></thead>
        <tbody>
          <tr v-for="f in plan.files" :key="f.key">
            <td>
              <div class="mono mi-file">{{ f.file }}</div>
              <div class="mi-dim mi-dest" :title="f.dest">{{ f.dest }}</div>
              <div class="mi-dim">{{ f.sources.map(s => s.label).join(' → ') }}</div>
            </td>
            <td class="mi-dim">{{ f.styles.length >= STYLE_LIST.length ? t('settings.cfg.installer.pickAll') : f.styles.map(styleLabel).join('、') }}</td>
            <td class="mi-dim">{{ f.bytes ? fmtBytes(f.bytes) : (f.size || '—') }}</td>
            <td><span :class="['mi-state', `st-${f.state}`]">{{ stateLabel(f) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 下载任务 -->
    <div v-if="myJobs.length" class="mi-jobs">
      <div class="mi-head"><strong>{{ t('settings.cfg.installer.jobs') }}</strong></div>
      <div v-for="j in myJobs" :key="j.id" class="mi-job">
        <div class="mi-job-head">
          <span :class="['mi-state', `job-${j.status}`]">{{ t(`settings.cfg.installer.status.${j.status}`) }}</span>
          <span class="mi-dim">{{ j.target.mode === 'remote' ? `${j.target.username}@${j.target.host}` : t('settings.cfg.installer.local') }} · {{ osLabel(j.os) }} · <span class="mono">{{ j.root }}</span></span>
          <span v-if="j.origin === 'auto'" class="mi-tag">{{ t('settings.cfg.installer.autoTag') }}</span>
          <span class="mi-spacer" />
          <button v-if="j.status === 'running' || j.status === 'queued'" type="button" class="btn btn-ghost btn-sm" @click="act('pause', j)">{{ t('settings.cfg.installer.pause') }}</button>
          <button v-if="['paused', 'failed', 'canceled'].includes(j.status)" type="button" class="btn btn-ghost btn-sm" @click="act('resume', j)">{{ t('settings.cfg.installer.resume') }}</button>
          <button v-if="j.status === 'running' || j.status === 'paused'" type="button" class="btn btn-ghost btn-sm" @click="act('cancel', j)">{{ t('settings.cfg.installer.cancel') }}</button>
          <button v-if="!['running', 'queued'].includes(j.status)" type="button" class="btn btn-ghost btn-icon btn-sm" :title="t('settings.cfg.installer.remove')" @click="act('remove', j)"><X :size="12" /></button>
        </div>
        <div class="mi-bar"><div class="mi-bar-fill" :style="{ width: `${j.percent ?? 0}%` }" /></div>
        <div class="mi-dim mi-job-line">
          {{ j.files_done }}/{{ j.files_total }} · {{ j.percent ?? 0 }}% · {{ fmtBytes(j.received_bytes) }} / {{ fmtBytes(j.total_bytes) }}
          <template v-if="j.speed">· {{ fmtBytes(j.speed) }}/s · {{ t('settings.cfg.installer.eta') }} {{ fmtEta(j.eta) }}</template>
        </div>
        <p v-if="j.message" class="mi-hint">{{ j.message }}</p>
        <p v-if="j.error" class="mi-err">{{ j.error }}</p>
        <p v-if="j.remote_poll_error" class="mi-warn">{{ j.remote_poll_error }}</p>
        <details class="mi-items" :open="j.status === 'running'">
          <summary>{{ t('settings.cfg.installer.files') }}</summary>
          <div v-for="it in j.items" :key="it.key" class="mi-item">
            <div class="mi-item-head">
              <span :class="['mi-state', `item-${it.status}`]">{{ t(`settings.cfg.installer.item.${it.status}`) }}</span>
              <span class="mono mi-file">{{ it.file }}</span>
              <span class="mi-dim">{{ fmtBytes(it.received) }}{{ it.total ? ` / ${fmtBytes(it.total)}` : '' }}</span>
              <span v-if="it.status === 'downloading' && it.speed" class="mi-dim">· {{ fmtBytes(it.speed) }}/s · {{ fmtEta(it.eta) }}</span>
              <span v-if="it.source" class="mi-dim">· {{ it.source }}</span>
            </div>
            <div class="mi-bar mi-bar-sm"><div class="mi-bar-fill" :style="{ width: `${itemPercent(it)}%` }" /></div>
            <p v-if="it.error" class="mi-err">{{ it.error }}</p>
            <details v-if="it.log?.length" class="mi-log"><summary>{{ t('settings.cfg.installer.log') }}</summary><pre>{{ it.log.join('\n') }}</pre></details>
          </div>
        </details>
      </div>
    </div>

    <!-- 目录浏览 -->
    <div v-if="browser.open" class="mi-modal" @click.self="browser.open = false">
      <div class="mi-modal-box">
        <div class="mi-head">
          <strong>{{ t('settings.cfg.installer.browseTitle') }}</strong>
          <span class="mi-spacer" />
          <button type="button" class="btn btn-ghost btn-icon btn-sm" @click="browser.open = false"><X :size="12" /></button>
        </div>
        <div class="mi-row mi-nowrap">
          <input v-model="browser.path" class="input mono" @keyup.enter="listDir(browser.path)" />
          <button type="button" class="btn btn-sm" @click="listDir(browser.path)">{{ t('settings.cfg.installer.go') }}</button>
        </div>
        <p v-if="browser.marker" class="mi-ok">✓ {{ t('settings.cfg.installer.isRoot', { app: browser.marker.flavor }) }}</p>
        <p v-if="browser.error" class="mi-err">{{ browser.error }}</p>
        <div class="mi-dirs">
          <button v-if="browser.parent !== null" type="button" class="mi-dir" @click="listDir(browser.parent)">⬆ ..</button>
          <button v-for="e in browser.entries" :key="e.path" type="button" class="mi-dir" @click="listDir(e.path)">📁 {{ e.name }}</button>
          <span v-if="browser.loading" class="mi-dim"><Loader2 :size="12" class="animate-spin" /></span>
        </div>
        <div class="mi-row">
          <span class="mi-spacer" />
          <button type="button" class="btn btn-primary btn-sm" :disabled="!browser.path" @click="root = browser.path; browser.open = false">{{ t('settings.cfg.installer.useThis') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Download, Loader2, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { modelInstallerAPI } from '~/composables/useApi'
import { useDesktopBridge } from '~/composables/useDesktopBridge'

const props = defineProps({
  provider: { type: String, required: true },
  serviceType: { type: String, required: true },
  baseUrl: { type: String, default: '' },
  apiKey: { type: String, default: '' },
  model: { type: String, default: '' },
  /** 生成计划用的配置（风格覆盖、模板选择等，取表单里的草稿值） */
  planSettings: { type: Object, default: () => ({}) },
  configId: { type: [Number, String], default: null },
})
/** { mode, root, remote: { host, port, username, auth, password, privateKey, passphrase } } */
const install = defineModel('install', { type: Object, default: () => ({}) })
const autoDownload = defineModel('autoDownload', { type: Boolean, default: false })
const preferMirror = defineModel('preferMirror', { type: Boolean, default: false })
const civitaiToken = defineModel('civitaiToken', { type: String, default: '' })
const hfToken = defineModel('hfToken', { type: String, default: '' })
const { t } = useI18n()
const desktop = useDesktopBridge()

const STYLE_LIST = [
  { key: '3d', label: '3D 漫剧' }, { key: 'anime', label: '日漫赛璐璐' }, { key: 'ghibli', label: '吉卜力手绘' }, { key: 'watercolor', label: '水彩绘本' },
  { key: 'comic', label: '美式漫画' }, { key: 'guofeng', label: '国风 2.5D' }, { key: 'webtoon', label: '韩系网漫' }, { key: 'noir', label: '黑白漫画' },
]
const styleLabel = k => STYLE_LIST.find(s => s.key === k)?.label || k
const APP_LABELS = { sdwebui: 'Stable Diffusion WebUI', comfyui: 'ComfyUI', fooocus: 'Fooocus' }
const appLabel = computed(() => APP_LABELS[props.provider] || props.provider)
const osLabel = os => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' }[os] || os || '')

// ===== 安装位置（双向绑定到配置的 model_install）=====
function ensureInstall() {
  const cur = install.value && typeof install.value === 'object' ? install.value : {}
  return { mode: cur.mode === 'remote' ? 'remote' : 'local', root: cur.root || '', remote: { host: '', port: 22, username: '', auth: 'password', password: '', privateKey: '', passphrase: '', ...(cur.remote || {}) } }
}
const state = reactive(ensureInstall())
watch(install, (v) => {
  const next = ensureInstall()
  if (JSON.stringify(next) !== JSON.stringify({ mode: state.mode, root: state.root, remote: state.remote })) Object.assign(state, next)
})
watch(state, () => { install.value = { mode: state.mode, root: state.root, remote: state.mode === 'remote' ? { ...state.remote } : undefined } }, { deep: true })
const mode = computed({ get: () => state.mode, set: (v) => { state.mode = v; candidates.value = null; plan.value = null } })
const root = computed({ get: () => state.root, set: (v) => { state.root = v; plan.value = null } })
const remote = computed(() => state.remote)

function installPayload() {
  return { mode: state.mode, root: state.root, remote: state.mode === 'remote' ? { ...state.remote } : undefined }
}

const env = ref(null)
const inUse = ref([])
const styles = ref([])
onMounted(async () => {
  try { env.value = await modelInstallerAPI.env() } catch { /* ignore */ }
  try { inUse.value = await modelInstallerAPI.stylesInUse() || [] } catch { /* ignore */ }
  styles.value = inUse.value.length ? [...inUse.value] : ['3d']
  if (env.value && !env.value.local_allowed && state.mode === 'local') state.mode = 'remote'
  loadJobs()
})
const toggleStyle = (k) => { styles.value = styles.value.includes(k) ? styles.value.filter(s => s !== k) : [...styles.value, k]; plan.value = null }
const rootPlaceholder = computed(() => {
  const os = mode.value === 'remote' ? remoteInfo.value?.os : env.value?.os
  const dir = props.provider === 'sdwebui' ? 'stable-diffusion-webui' : props.provider === 'fooocus' ? 'Fooocus-API' : 'ComfyUI'
  return os === 'windows' ? `D:\\${dir}` : `~/${dir}`
})

// ===== 远程测试 =====
const testing = ref(false)
const remoteInfo = ref(null)
async function testRemote() {
  testing.value = true
  try { remoteInfo.value = await modelInstallerAPI.test({ install: installPayload() }) } catch (e) { remoteInfo.value = { ok: false, error: e?.message || String(e) } } finally { testing.value = false }
}

// ===== 识别 / 浏览 =====
const detecting = ref(false)
const candidates = ref(null)
async function detect() {
  detecting.value = true
  try {
    const r = await modelInstallerAPI.detect({ install: installPayload(), provider: props.provider, base_url: props.baseUrl, api_key: props.apiKey })
    candidates.value = r.candidates || []
    if (mode.value === 'remote') remoteInfo.value = { ok: true, os: r.os, home: r.home, hostname: r.hostname }
    if (!root.value && candidates.value.length) root.value = candidates.value[0].path
  } catch (e) {
    toast.error(e?.message || String(e))
  } finally {
    detecting.value = false
  }
}
const browser = reactive({ open: false, path: '', parent: null, entries: [], marker: null, error: '', loading: false })
async function listDir(p) {
  browser.loading = true
  browser.error = ''
  try {
    const r = await modelInstallerAPI.listDir({ install: installPayload(), path: p })
    Object.assign(browser, { path: r.path, parent: r.parent, entries: r.entries, marker: r.marker })
  } catch (e) {
    browser.error = e?.message || String(e)
  } finally {
    browser.loading = false
  }
}
async function browse() {
  // 桌面版本机：用系统的选择文件夹对话框
  if (mode.value === 'local' && desktop?.pickDirectory) {
    const r = await desktop.pickDirectory().catch(() => null)
    if (r?.ok && r.path) root.value = r.path
    return
  }
  browser.open = true
  await listDir(root.value || '')
}

// ===== 检查 / 下载 =====
const planning = ref(false)
const plan = ref(null)
const missing = computed(() => (plan.value?.files || []).filter(f => f.state !== 'present'))
function baseBody() {
  return {
    install: installPayload(),
    provider: props.provider,
    service_type: props.serviceType === 'video' ? 'video' : 'image',
    styles: styles.value,
    settings: props.planSettings,
    model: props.model,
    prefer_mirror: preferMirror.value,
    civitai_token: civitaiToken.value,
    hf_token: hfToken.value,
    base_url: props.baseUrl,
    api_key: props.apiKey,
    config_id: props.configId || undefined,
  }
}
async function checkPlan() {
  planning.value = true
  try { plan.value = await modelInstallerAPI.plan(baseBody()) } catch (e) { toast.error(e?.message || String(e)) } finally { planning.value = false }
}
const starting = ref(false)
async function startDownload() {
  starting.value = true
  try {
    await modelInstallerAPI.createJob(baseBody())
    toast.success(t('settings.cfg.installer.started'))
    await loadJobs()
  } catch (e) {
    toast.error(e?.message || String(e))
  } finally {
    starting.value = false
  }
}
function stateLabel(f) {
  if (f.state === 'partial') return t('settings.cfg.installer.state.partial', { pct: f.bytes ? Math.floor((f.part_bytes / f.bytes) * 100) : '?' })
  return t(`settings.cfg.installer.state.${f.state}`)
}

// ===== 任务进度（轮询）=====
const jobs = ref([])
const myJobs = computed(() => jobs.value.filter(j => j.provider === props.provider).slice(0, 6))
let timer = null
async function loadJobs() {
  try { jobs.value = await modelInstallerAPI.jobs() || [] } catch { /* ignore */ }
  clearTimeout(timer)
  const active = jobs.value.some(j => j.status === 'running' || j.status === 'queued')
  timer = setTimeout(loadJobs, active ? 1500 : 10000)
}
onBeforeUnmount(() => clearTimeout(timer))
async function act(kind, j) {
  try {
    if (kind === 'remove') await modelInstallerAPI.remove(j.id)
    else await modelInstallerAPI[kind](j.id)
    if (kind === 'resume' || kind === 'remove') plan.value = null
    await loadJobs()
  } catch (e) {
    toast.error(e?.message || String(e))
  }
}
const itemPercent = it => (it.status === 'done' || it.status === 'skipped') ? 100 : it.total ? Math.min(100, (it.received / it.total) * 100) : 0

function fmtBytes(n) {
  const v = Number(n || 0)
  if (v >= 1073741824) return `${(v / 1073741824).toFixed(2)} GB`
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`
  return `${v} B`
}
function fmtEta(s) {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s >= 3600) return `${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m`
  if (s >= 60) return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
  return `${Math.round(s)}s`
}
</script>

<style scoped>
.mi-panel { border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-0); }
.mi-head { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.mi-hint { font-size: 11px; color: var(--text-3); margin: 0; line-height: 1.5; }
.mi-dim { font-size: 11px; color: var(--text-3); }
.mi-warn { font-size: 11px; color: var(--warning, #d97706); margin: 0; }
.mi-err { font-size: 11px; color: var(--danger, #e5484d); margin: 0; }
.mi-ok { font-size: 11px; color: var(--success, #30a46c); }
.mi-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mi-nowrap { flex-wrap: nowrap; }
.mi-nowrap .input { flex: 1; min-width: 0; }
.mi-label { font-size: 11.5px; color: var(--text-2); font-weight: 600; }
.mi-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mi-radio { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.mi-remote { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px dashed var(--border); border-radius: 8px; }
.mi-grid { display: grid; grid-template-columns: 1fr 80px 1fr; gap: 6px; }
.mi-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 640px) { .mi-grid, .mi-grid2 { grid-template-columns: 1fr; } }
.mi-key { font-size: 11px; }
.mi-cands { display: flex; flex-direction: column; gap: 4px; }
.mi-cand { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; cursor: pointer; font-size: 11.5px; color: var(--text-1); }
.mi-cand.is-on { border-color: var(--accent, #6e56cf); background: var(--bg-1); }
.mi-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.mi-chip { font-size: 11.5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text-2); cursor: pointer; }
.mi-chip.is-on { background: var(--accent, #6e56cf); border-color: var(--accent, #6e56cf); color: #fff; }
.mi-dot { margin-left: 4px; font-size: 8px; vertical-align: middle; }
.mi-opts { display: flex; flex-direction: column; gap: 6px; }
.mi-check { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; cursor: pointer; }
.mi-check > span { display: flex; flex-direction: column; gap: 1px; }
.mi-plan { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid var(--border); padding-top: 8px; }
.mi-summary { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; }
.mi-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
.mi-table th, .mi-table td { text-align: left; padding: 5px 6px; border-top: 1px solid var(--border); vertical-align: top; overflow: hidden; }
.mi-table th { color: var(--text-2); border-top: none; font-weight: 600; }
.mi-table th:first-child { width: 52%; }
.mi-file { word-break: break-all; font-size: 11px; }
.mi-dest { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mi-state { font-size: 10.5px; padding: 0 6px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; color: var(--text-2); }
.st-present, .job-done, .item-done, .item-skipped { color: var(--success, #30a46c); }
.st-missing, .st-size_mismatch, .job-failed, .item-failed { color: var(--danger, #e5484d); }
.st-partial, .job-paused, .job-canceled { color: var(--warning, #d97706); }
.job-running, .job-queued, .item-downloading, .item-verifying { color: var(--accent, #6e56cf); }
.mi-jobs { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 8px; }
.mi-job { display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; }
.mi-job-head, .mi-item-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; min-width: 0; }
.mi-spacer { flex: 1; }
.mi-tag { font-size: 10.5px; padding: 0 6px; border-radius: 4px; background: var(--bg-1); color: var(--text-2); }
.mi-bar { height: 8px; border-radius: 999px; background: var(--bg-1); overflow: hidden; border: 1px solid var(--border); }
.mi-bar-sm { height: 5px; }
.mi-bar-fill { height: 100%; background: var(--accent, #6e56cf); transition: width .4s ease; }
.mi-job-line { font-variant-numeric: tabular-nums; }
.mi-items summary, .mi-log summary { cursor: pointer; font-size: 11px; color: var(--text-2); }
.mi-item { display: flex; flex-direction: column; gap: 3px; padding: 4px 0; }
.mi-log pre { margin: 2px 0 0; font-size: 10.5px; background: var(--bg-1); padding: 6px; border-radius: 6px; white-space: pre-wrap; }
.mi-modal { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
.mi-modal-box { width: min(560px, 100%); max-height: 80vh; display: flex; flex-direction: column; gap: 8px; background: var(--bg-0, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
.mi-dirs { flex: 1; min-height: 160px; overflow: auto; display: flex; flex-direction: column; gap: 2px; border: 1px solid var(--border); border-radius: 8px; padding: 4px; }
.mi-dir { text-align: left; font-size: 12px; padding: 4px 8px; border: none; background: transparent; color: var(--text-1); border-radius: 4px; cursor: pointer; }
.mi-dir:hover { background: var(--bg-1); }
</style>
