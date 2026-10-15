<template>
  <div class="sm-panel">
    <label class="sm-check">
      <input :checked="enabled" type="checkbox" @change="enabled = $event.target.checked" />
      <span>
        <b>{{ t('settings.cfg.styleModels.enable') }}</b>
        <span class="sm-hint">{{ t('settings.cfg.styleModels.enableHint') }}</span>
      </span>
    </label>

    <div class="sm-actions">
      <button type="button" class="btn btn-sm" @click="toggleOpen">
        <ChevronDown :size="12" :class="{ 'sm-rot': open }" />
        {{ open ? t('settings.cfg.styleModels.hide') : t('settings.cfg.styleModels.show') }}
      </button>
      <button v-if="open && catalog" type="button" class="btn btn-sm" :disabled="checking" @click="checkLocal">
        <Loader2 v-if="checking" :size="12" class="animate-spin" />
        {{ t('settings.cfg.styleModels.check') }}
      </button>
      <span v-if="checkError" class="sm-err">{{ checkError }}</span>
    </div>

    <div v-if="open" class="sm-body">
      <div v-if="loading" class="sm-hint"><Loader2 :size="12" class="animate-spin" /> {{ t('common.loading') }}</div>
      <template v-else-if="catalog">
        <p class="sm-hint">{{ catalog.usage }}</p>
        <div class="sm-lic-box">
          <b>{{ t('settings.cfg.styleModels.licenseTitle') }}</b>
          <span><span class="sm-lic lic-ok">{{ licLabel('ok') }}</span> {{ t('settings.cfg.styleModels.licenseOk') }}</span>
          <span><span class="sm-lic lic-attention">{{ licLabel('attention') }}</span> {{ t('settings.cfg.styleModels.licenseAttention') }}</span>
          <span><span class="sm-lic lic-restricted">{{ licLabel('restricted') }}</span> {{ t('settings.cfg.styleModels.licenseRestricted') }}</span>
          <span v-if="flaggedLabels.length" class="sm-lic-warn">⚠ {{ t('settings.cfg.styleModels.licenseFlagged', { styles: flaggedLabels.join('、') }) }}</span>
          <span v-else class="sm-dim">{{ t('settings.cfg.styleModels.licenseAllOk') }}</span>
          <span class="sm-dim">{{ t('settings.cfg.styleModels.licenseDisclaimer') }}</span>
        </div>
        <p class="sm-hint">
          {{ t('settings.cfg.styleModels.folders') }}
          <code v-for="(f, k) in catalog.folders" :key="k" class="sm-code">{{ k }} → {{ f }}</code>
        </p>

        <div v-for="row in catalog.styles" :key="row.style" class="sm-style">
          <div class="sm-style-head">
            <strong>{{ row.label }}</strong>
            <span class="sm-key mono">{{ row.style }}</span>
            <span v-if="row.template" class="sm-tag">{{ row.template_label || row.template }}</span>
            <span v-if="row.available" :class="['sm-lic', `lic-${row.license_status}`]">{{ licIcon(row.license_status) }} {{ licLabel(row.license_status) }}</span>
            <span v-if="localSet && row.downloads.length" :class="['sm-tag', missingOf(row).length ? 'is-warn' : 'is-ok']">
              {{ missingOf(row).length ? t('settings.cfg.styleModels.missing', { n: missingOf(row).length }) : t('settings.cfg.styleModels.ready') }}
            </span>
          </div>

          <div class="sm-files">
            <template v-for="item in filesOf(row)" :key="item.role">
              <div class="sm-file">
                <span class="sm-role">{{ item.role }}</span>
                <a :href="item.f.page" target="_blank" rel="noopener">{{ item.f.name }}</a>
                <code class="sm-code">{{ item.f.file }}</code>
                <span v-if="item.role === 'LoRA'" class="sm-dim">{{ t('settings.cfg.styleModels.weight') }} {{ item.f.weight ?? 0.8 }}</span>
                <span v-if="item.f.apply_to && item.f.apply_to !== 'all'" class="sm-dim">· {{ item.f.apply_to === 'low' ? t('settings.cfg.styleModels.lowNoise') : t('settings.cfg.styleModels.highNoise') }}</span>
                <span v-if="item.f.size" class="sm-dim">· {{ item.f.size }}</span>
                <span :class="['sm-lic', `lic-${item.f.license_status}`]" :title="item.f.license || ''">{{ licLabel(item.f.license_status) }}</span>
                <span v-if="item.f.license" class="sm-dim">{{ item.f.license }}</span>
              </div>
              <p v-if="item.f.license_status !== 'ok' && item.f.license_note" :class="['sm-lic-note', `lic-${item.f.license_status}`]">{{ licIcon(item.f.license_status) }} {{ item.f.license_note }}</p>
            </template>
            <div v-if="!row.lora && row.available" class="sm-file sm-dim">LoRA：{{ t('settings.cfg.styleModels.noLora') }}</div>
            <div v-if="row.lora?.trigger || row.checkpoint?.trigger" class="sm-file">
              <span class="sm-role">{{ t('settings.cfg.styleModels.trigger') }}</span>
              <code class="sm-code">{{ row.lora?.trigger || row.checkpoint?.trigger }}</code>
            </div>
            <div v-if="paramText(row)" class="sm-file">
              <span class="sm-role">{{ t('settings.cfg.styleModels.params') }}</span>
              <span class="sm-dim">{{ paramText(row) }}</span>
            </div>
            <p v-for="(n, i) in notesOf(row)" :key="i" class="sm-hint">{{ n }}</p>
            <div v-if="row.alternatives?.length" class="sm-alts">
              <span class="sm-role">{{ t('settings.cfg.styleModels.alternatives') }}</span>
              <div v-for="a in row.alternatives" :key="a.file" class="sm-file">
                <a :href="a.page" target="_blank" rel="noopener">{{ a.name }}</a>
                <code class="sm-code">{{ a.file }}</code>
                <span :class="['sm-lic', `lic-${a.license_status}`]">{{ licLabel(a.license_status) }}</span>
                <span v-if="a.license_note" class="sm-dim">{{ a.license_note }}</span>
              </div>
            </div>
          </div>

          <div class="sm-override">
            <span class="sm-role">{{ t('settings.cfg.styleModels.override') }}</span>
            <input v-if="serviceType === 'video'" :value="ov(row.style).template" class="input mono sm-in" :placeholder="row.template" list="sm-video-templates" @input="setOv(row.style, 'template', $event.target.value)" />
            <input v-else :value="ov(row.style).checkpoint" class="input mono sm-in" :placeholder="row.checkpoint?.file || 'Checkpoint'" @input="setOv(row.style, 'checkpoint', $event.target.value)" />
            <input :value="ov(row.style).lora" class="input mono sm-in" :placeholder="row.lora?.file || t('settings.cfg.styleModels.loraPlaceholder')" @input="setOv(row.style, 'lora', $event.target.value)" />
            <input :value="ov(row.style).lora_weight" class="input mono sm-num" type="number" step="0.05" min="-2" max="2" :placeholder="String(row.lora?.weight ?? 0.8)" @input="setOv(row.style, 'lora_weight', $event.target.value)" />
            <input :value="ov(row.style).trigger" class="input sm-in" :placeholder="row.lora?.trigger || row.checkpoint?.trigger || t('settings.cfg.styleModels.trigger')" @input="setOv(row.style, 'trigger', $event.target.value)" />
            <button v-if="hasOv(row.style)" type="button" class="btn btn-ghost btn-sm" @click="clearOv(row.style)">{{ t('settings.cfg.styleModels.reset') }}</button>
          </div>

          <details v-if="row.downloads.length" class="sm-dl">
            <summary>{{ t('settings.cfg.styleModels.download') }}（{{ row.downloads.length }}）</summary>
            <ScriptBox :scripts="row.scripts" />
          </details>
        </div>

        <datalist id="sm-video-templates">
          <option v-for="tpl in videoTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.label }}</option>
        </datalist>

        <details class="sm-dl sm-all">
          <summary><b>{{ t('settings.cfg.styleModels.downloadAll') }}</b></summary>
          <ScriptBox :scripts="catalog.scripts_all" />
        </details>
        <p class="sm-hint">{{ t('settings.cfg.styleModels.downloadHint') }}</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref, watch } from 'vue'
import { ChevronDown, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { aiConfigAPI } from '~/composables/useApi'

const props = defineProps({
  provider: { type: String, required: true },
  serviceType: { type: String, required: true },
  baseUrl: { type: String, default: '' },
  apiKey: { type: String, default: '' },
})
const enabled = defineModel('enabled', { type: Boolean, default: false })
const overrides = defineModel('overrides', { type: Object, default: () => ({}) })
const { t } = useI18n()

const open = ref(false)
const loading = ref(false)
const catalog = ref(null)
const videoTemplates = ref([])
const checking = ref(false)
const checkError = ref('')
const localSet = ref(null)

async function load() {
  loading.value = true
  try {
    catalog.value = await aiConfigAPI.styleModels(props.provider, props.serviceType === 'video' ? 'video' : 'image')
    if (props.serviceType === 'video' && !videoTemplates.value.length) {
      videoTemplates.value = (await aiConfigAPI.comfyTemplates('video').catch(() => [])) || []
    }
  } catch (e) {
    toast.error(e?.message || String(e))
  } finally {
    loading.value = false
  }
}
function toggleOpen() {
  open.value = !open.value
  if (open.value && !catalog.value) load()
}
watch(() => [props.provider, props.serviceType], () => {
  catalog.value = null
  localSet.value = null
  if (open.value) load()
})

// ===== 覆盖值 =====
const ov = style => overrides.value?.[style] || {}
const hasOv = style => Object.values(ov(style)).some(v => v !== '' && v != null)
function setOv(style, key, value) {
  const next = { ...(overrides.value || {}) }
  const row = { ...(next[style] || {}) }
  if (value === '' || value == null) delete row[key]
  else row[key] = value
  if (Object.keys(row).length) next[style] = row
  else delete next[style]
  overrides.value = next
}
function clearOv(style) {
  const next = { ...(overrides.value || {}) }
  delete next[style]
  overrides.value = next
}

function paramText(row) {
  const p = row.params || {}
  const parts = []
  if (p.sampler) parts.push(`${p.sampler}${p.scheduler ? ` ${p.scheduler}` : ''}`)
  if (p.steps) parts.push(`${t('settings.cfg.local.steps')} ${p.steps}`)
  if (p.cfg != null) parts.push(`CFG ${p.cfg}`)
  if (p.clipSkip) parts.push(`Clip skip ${p.clipSkip}`)
  if (p.baseSize) parts.push(`${p.baseSize}px`)
  if (props.provider === 'fooocus' && p.fooocusStyles?.length) parts.push(`Fooocus: ${p.fooocusStyles.join(', ')}`)
  return parts.join(' · ')
}
const filesOf = row => [['Checkpoint', row.checkpoint], ['LoRA', row.lora]].filter(([, f]) => f).map(([role, f]) => ({ role, f }))
const licLabel = st => t(`settings.cfg.styleModels.lic.${st || 'attention'}`)
const licIcon = st => (st === 'ok' ? '✓' : st === 'restricted' ? '⛔' : '⚠')
const flaggedLabels = computed(() => (catalog.value?.styles || []).filter(s => s.available && s.license_status !== 'ok').map(s => s.label))
const notesOf = row => [row.note, row.checkpoint?.note, row.lora?.note].filter(Boolean)

// ===== 检查本机是否已下载 =====
const bare = f => String(f || '').replace(/^.*[\\/]/, '').replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '').toLowerCase()
function missingOf(row) {
  if (!localSet.value) return []
  return row.downloads.filter(d => !localSet.value.has(bare(d.file)))
}
async function checkLocal() {
  checking.value = true
  checkError.value = ''
  try {
    const res = await aiConfigAPI.localModels({ provider: props.provider, service_type: props.serviceType, base_url: props.baseUrl, api_key: props.apiKey })
    if (res?.error && !res?.groups?.length) throw new Error(res.error)
    localSet.value = new Set((res?.groups || []).flatMap(g => g.items || []).map(bare))
  } catch (e) {
    checkError.value = e?.message || String(e)
  } finally {
    checking.value = false
  }
}

// ===== 下载命令框（bash / PowerShell 切换 + 复制）=====
const ScriptBox = defineComponent({
  props: { scripts: { type: Object, required: true } },
  setup(p) {
    const tab = ref('bash')
    const text = computed(() => (tab.value === 'bash' ? p.scripts.bash : p.scripts.powershell))
    const copy = () => {
      navigator.clipboard?.writeText(text.value).then(() => toast.success(t('settings.cfg.styleModels.copied'))).catch(() => {})
    }
    return () => h('div', { class: 'sm-script' }, [
      h('div', { class: 'sm-script-tabs' }, [
        ...['bash', 'powershell'].map(k => h('button', { type: 'button', class: ['sm-script-tab', { 'is-on': tab.value === k }], onClick: () => { tab.value = k } }, k === 'bash' ? 'macOS / Linux' : 'Windows PowerShell')),
        h('button', { type: 'button', class: 'btn btn-sm sm-copy', onClick: copy }, t('settings.cfg.styleModels.copy')),
      ]),
      h('pre', { class: 'sm-pre' }, text.value),
    ])
  },
})
</script>

<style scoped>
.sm-panel { border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-0); }
.sm-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-1); cursor: pointer; }
.sm-check > span { display: flex; flex-direction: column; gap: 2px; }
.sm-hint { font-size: 11px; color: var(--text-3); margin: 0; line-height: 1.5; }
.sm-err { font-size: 11px; color: var(--danger, #e5484d); }
.sm-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sm-rot { transform: rotate(180deg); }
.sm-body { display: flex; flex-direction: column; gap: 10px; }
.sm-style { border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.sm-style-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; }
.sm-key { font-size: 11px; color: var(--text-3); }
.sm-tag { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-2); }
.sm-tag.is-ok { color: var(--success, #30a46c); border-color: currentColor; }
.sm-tag.is-warn { color: var(--warning, #f59e0b); border-color: currentColor; }
.sm-files { display: flex; flex-direction: column; gap: 3px; }
.sm-file { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 11.5px; min-width: 0; }
.sm-file a { color: var(--accent, #6e56cf); text-decoration: none; }
.sm-file a:hover { text-decoration: underline; }
.sm-role { font-size: 10.5px; color: var(--text-3); min-width: 64px; }
.sm-dim { color: var(--text-3); font-size: 11px; }
.sm-code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; background: var(--bg-1); padding: 0 4px; border-radius: 4px; word-break: break-all; margin-right: 4px; }
.sm-lic { font-size: 10.5px; padding: 0 6px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.lic-ok { color: var(--success, #30a46c); }
.lic-attention { color: var(--warning, #d97706); }
.lic-restricted { color: var(--danger, #e5484d); }
.sm-lic-note { margin: 0 0 0 70px; font-size: 11px; line-height: 1.5; }
.sm-lic-box { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-2); border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px; }
.sm-lic-warn { color: var(--warning, #d97706); font-weight: 600; }
.sm-alts { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.sm-override { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sm-in { flex: 1 1 160px; min-width: 0; font-size: 11.5px; padding: 4px 8px; }
.sm-num { width: 72px; font-size: 11.5px; padding: 4px 8px; }
.sm-dl summary { cursor: pointer; font-size: 11.5px; color: var(--text-2); }
.sm-all { border-top: 1px solid var(--border); padding-top: 8px; }
.sm-script { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.sm-script-tabs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.sm-script-tab { font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-2); cursor: pointer; }
.sm-script-tab.is-on { background: var(--bg-1); color: var(--text-1); }
.sm-copy { margin-left: auto; }
.sm-pre { margin: 0; max-height: 260px; overflow: auto; font-size: 11px; line-height: 1.5; background: var(--bg-1); border: 1px solid var(--border); border-radius: 6px; padding: 8px; white-space: pre; }
</style>
