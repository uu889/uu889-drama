<template>
  <div class="vcp">
    <!-- ===== 默认音色 / 语速 / 服务商专属 ===== -->
    <div class="vcp-grid">
      <label v-if="presetVoices.length || !cloneOnly" class="vcp-field">
        <span class="vcp-label">{{ t('voice.defaultVoice') }}</span>
        <input v-model="form.default_voice" class="input" list="vcp-voice-list" :placeholder="defaultVoicePlaceholder" />
        <datalist id="vcp-voice-list">
          <option v-for="v in presetVoices" :key="v.id" :value="v.id">{{ v.label }}</option>
        </datalist>
        <span class="vcp-hint">{{ t('voice.defaultVoiceHint') }}</span>
      </label>
      <label class="vcp-field">
        <span class="vcp-label">{{ t('voice.defaultSpeed') }}</span>
        <input v-model="form.default_speed" class="input" type="number" min="0.5" max="2" step="0.05" placeholder="1.0" />
        <span class="vcp-hint">{{ t('voice.defaultSpeedHint') }}</span>
      </label>
      <label v-if="form.provider === 'volcengine'" class="vcp-field">
        <span class="vcp-label">App ID <span class="vcp-dim">({{ t('voice.optional') }})</span></span>
        <input v-model="form.volc_app_id" class="input" placeholder="1234567890" />
        <span class="vcp-hint">{{ t('voice.volcAppIdHint') }}</span>
      </label>
      <label v-if="form.provider === 'edgetts' && !String(form.base_url || '').trim()" class="vcp-field">
        <span class="vcp-label">{{ t('voice.edgeCommand') }}</span>
        <input v-model="form.edge_tts_command" class="input" placeholder="edge-tts" />
        <span class="vcp-hint">{{ t('voice.edgeCommandHint') }}</span>
      </label>
    </div>

    <!-- ===== 试听 ===== -->
    <div class="vcp-box">
      <div class="vcp-box-head">
        <span class="vcp-label">{{ t('voice.preview') }}</span>
        <span class="vcp-hint">{{ cloneOnly ? t('voice.previewCloneHint') : t('voice.previewHint') }}</span>
      </div>
      <textarea v-model="previewText" class="input vcp-textarea" rows="2" :maxlength="textMax" />
      <div class="vcp-row">
        <select v-model="previewVoice" class="input vcp-select">
          <option v-if="!cloneOnly" value="">{{ t('voice.useDefaultVoice') }}</option>
          <optgroup v-if="!cloneOnly && presetVoices.length" :label="t('voice.presetVoices')">
            <option v-for="v in presetVoices" :key="v.id" :value="`preset:${v.id}`">{{ v.label }} · {{ v.id }}</option>
          </optgroup>
          <optgroup v-if="family && readyClones.length" :label="t('voice.clonedVoices')">
            <option v-for="c in readyClones" :key="c.id" :value="`clone:${c.id}`">{{ c.name }}</option>
          </optgroup>
          <option v-if="cloneOnly && !readyClones.length" value="" disabled>{{ t('voice.noClones') }}</option>
        </select>
        <button type="button" class="btn btn-sm" :disabled="previewing" @click="runPreview">
          <Loader2 v-if="previewing" :size="13" class="animate-spin" />
          <Play v-else :size="13" />
          {{ t('voice.previewBtn') }}
        </button>
      </div>
      <p v-if="previewError" class="vcp-error">{{ previewError }}</p>
      <audio v-if="previewUrl" :src="previewUrl" class="vcp-audio" controls autoplay />
    </div>

    <!-- ===== 克隆音色 ===== -->
    <div v-if="family" class="vcp-box">
      <div class="vcp-box-head">
        <span class="vcp-label">{{ t('voice.cloneTitle') }}</span>
        <span class="vcp-hint">{{ family === 'volcengine' ? t('voice.cloneVolcDesc') : t('voice.cloneSovitsDesc') }}</span>
      </div>
      <ul class="vcp-tips">
        <li v-for="(tip, i) in tips" :key="i">{{ tip }}</li>
      </ul>

      <div v-if="clones.length" class="vcp-clones">
        <div v-for="c in clones" :key="c.id" class="vcp-clone">
          <div class="vcp-clone-main">
            <span class="vcp-clone-name">{{ c.name }}</span>
            <span :class="['tag', c.status === 'ready' ? 'tag-success' : c.status === 'failed' ? 'tag-error' : '']">{{ t(`voice.status.${c.status}`) }}</span>
            <span v-if="c.speaker_id" class="vcp-dim mono">{{ c.speaker_id }}</span>
            <span v-if="c.duration" class="vcp-dim">{{ Math.round(c.duration * 10) / 10 }}s</span>
          </div>
          <div v-if="c.ref_text" class="vcp-clone-text">「{{ c.ref_text }}」</div>
          <div v-if="c.error_msg" class="vcp-error">{{ c.error_msg }}</div>
          <div class="vcp-clone-actions">
            <audio v-if="c.ref_audio_url" :src="`/${c.ref_audio_url}`" controls preload="none" class="vcp-audio-sm" />
            <button v-if="c.family === 'volcengine' && c.status !== 'ready'" type="button" class="btn btn-ghost btn-sm" :disabled="busyId === c.id" @click="refreshClone(c)">
              <RefreshCw :size="12" /> {{ t('voice.refresh') }}
            </button>
            <button type="button" class="btn btn-danger btn-sm" :disabled="busyId === c.id" @click="removeClone(c)"><Trash2 :size="12" /></button>
          </div>
        </div>
      </div>

      <div class="vcp-new">
        <div class="vcp-grid">
          <label class="vcp-field">
            <span class="vcp-label">{{ t('voice.cloneName') }}</span>
            <input v-model="draft.name" class="input" maxlength="40" :placeholder="t('voice.cloneNamePlaceholder')" />
          </label>
          <label v-if="family === 'volcengine'" class="vcp-field">
            <span class="vcp-label">{{ t('voice.speakerId') }}</span>
            <input v-model="draft.speaker_id" class="input mono" placeholder="S_xxxxxxxx" />
          </label>
          <label v-if="family === 'volcengine'" class="vcp-field">
            <span class="vcp-label">{{ t('voice.cloneResource') }}</span>
            <select v-model="draft.resource_id" class="input">
              <option v-for="r in ['seed-icl-1.0', 'seed-icl-2.0']" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="vcp-field">
            <span class="vcp-label">{{ family === 'volcengine' ? t('voice.recording') : t('voice.refAudio') }}</span>
            <input ref="fileInput" class="input" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aac,.pcm" @change="onFile" />
            <span v-if="draft.duration != null" :class="['vcp-hint', { 'vcp-error': durationProblem }]">
              {{ t('voice.duration', { s: Math.round(draft.duration * 10) / 10 }) }}{{ durationProblem ? ` · ${durationProblem}` : '' }}
            </span>
          </label>
          <label class="vcp-field">
            <span class="vcp-label">{{ t('voice.refLang') }}</span>
            <select v-model="draft.ref_lang" class="input">
              <option v-for="l in langs" :key="l" :value="l">{{ t(`voice.lang.${l}`) }}</option>
            </select>
          </label>
        </div>
        <label v-if="family === 'sovits'" class="vcp-field">
          <span class="vcp-label">{{ t('voice.refText') }}</span>
          <textarea v-model="draft.ref_text" class="input vcp-textarea" rows="2" maxlength="200" :placeholder="t('voice.refTextPlaceholder')" />
          <span class="vcp-hint">{{ t('voice.refTextHint') }}</span>
        </label>
        <label class="vcp-consent">
          <input v-model="draft.consent" type="checkbox" />
          <span>{{ t('voice.consent') }}</span>
        </label>
        <ul v-if="draftErrors.length || draftWarnings.length" class="vcp-checks">
          <li v-for="(e, i) in draftErrors" :key="`e${i}`" class="vcp-error">{{ e }}</li>
          <li v-for="(w, i) in draftWarnings" :key="`w${i}`" class="vcp-warn">{{ w }}</li>
        </ul>
        <p v-if="family === 'volcengine' && !configId" class="vcp-warn">{{ t('voice.saveFirst') }}</p>
        <div class="vcp-row">
          <button type="button" class="btn btn-primary btn-sm" :disabled="creating || (family === 'volcengine' && !configId)" @click="createClone">
            <Loader2 v-if="creating" :size="13" class="animate-spin" />
            <Plus v-else :size="13" />
            {{ family === 'volcengine' ? t('voice.uploadTrain') : t('voice.addClone') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Loader2, Play, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { speechAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/**
 * 语音模型配置面板（设置页 → 添加 / 编辑语音配置）：默认音色、语速、火山 App ID、edge-tts 命令；
 * 试听（用还没保存的表单）；克隆音色库（GPT-SoVITS 参考音频 + 参考文本 / 火山声音复刻）。
 * 校验规则与后端 services/voice/validate.ts 一致：前端先拦一遍，提交后以后端为准。
 */
const props = defineProps({
  form: { type: Object, required: true },
  configId: { type: Number, default: null },
})
const { t } = useI18n()
const form = props.form

const SOVITS_MIN = 3
const SOVITS_MAX = 10
const VOLC_MIN = 3
const MAX_BYTES = 10 * 1024 * 1024

const meta = ref(null)
const clones = ref([])
const model = computed(() => String(form.models?.[0] || ''))
const isCloneModel = computed(() => {
  const m = model.value.toLowerCase()
  if (form.provider === 'gptsovits') return true
  if (form.provider === 'aiask') return /sovits/.test(m)
  if (form.provider === 'volcengine') return /icl/.test(m)
  return false
})
/** 只能用克隆音色（gpt-sovits）：火山复刻资源也能用预置音色以外的复刻音色，但预置音色仍可选（后端自动切资源） */
const cloneOnly = computed(() => isCloneModel.value && form.provider !== 'volcengine')
const family = computed(() => (form.provider === 'aiask' || form.provider === 'gptsovits') ? 'sovits' : form.provider === 'volcengine' ? 'volcengine' : null)
const presetVoices = computed(() => {
  if (!meta.value) return []
  if (form.provider === 'volcengine') return meta.value.volc_voices
  if (form.provider === 'edgetts' || (form.provider === 'aiask' && !isCloneModel.value)) return meta.value.edge_voices
  return []
})
const defaultVoicePlaceholder = computed(() => presetVoices.value[0]?.id || '')
const readyClones = computed(() => clones.value.filter(c => c.status === 'ready'))
const tips = computed(() => meta.value?.tips?.[family.value === 'volcengine' ? 'volcengine' : 'sovits'] || [])
const langs = computed(() => family.value === 'volcengine' ? ['zh', 'en', 'ja', 'ko'] : (meta.value?.sovits_langs || ['zh', 'en', 'ja', 'ko', 'yue', 'auto']))
const textMax = computed(() => cloneOnly.value ? 1000 : 5000)

const previewText = ref('你好，欢迎来到 UU889 短剧。今天的故事，从一场意外开始。')
const previewVoice = ref('')
const previewing = ref(false)
const previewUrl = ref('')
const previewError = ref('')

async function loadClones() {
  if (!family.value) { clones.value = []; return }
  try { clones.value = await speechAPI.clones(family.value) } catch (e) { toastError(e) }
}
onMounted(async () => {
  try { meta.value = await speechAPI.meta() } catch { /* 没有 meta 也能用 */ }
  loadClones()
})
watch(family, () => { loadClones(); previewVoice.value = '' })
watch([cloneOnly, readyClones], () => {
  if (cloneOnly.value && !previewVoice.value && readyClones.value.length) previewVoice.value = `clone:${readyClones.value[0].id}`
}, { immediate: true })

function inlineConfig() {
  return {
    provider: form.provider,
    base_url: form.base_url,
    api_key: form.api_key,
    model: [...(form.models || [])],
    default_voice: form.default_voice,
    default_speed: form.default_speed,
    volc_app_id: form.volc_app_id,
    edge_tts_command: form.edge_tts_command,
  }
}

async function runPreview() {
  previewError.value = ''
  const text = previewText.value.trim()
  if (!text) { previewError.value = t('voice.textRequired'); return }
  if (cloneOnly.value && !previewVoice.value.startsWith('clone:')) { previewError.value = t('voice.needClone'); return }
  previewing.value = true
  try {
    const sel = previewVoice.value
    const out = await speechAPI.tts({
      config: inlineConfig(),
      text,
      voice: sel.startsWith('preset:') ? sel.slice(7) : undefined,
      clone_id: sel.startsWith('clone:') ? Number(sel.slice(6)) : undefined,
      speed: form.default_speed === '' || form.default_speed == null ? undefined : Number(form.default_speed),
    })
    previewUrl.value = `/${out.url}`
  } catch (e) {
    previewError.value = e?.message || String(e)
  } finally {
    previewing.value = false
  }
}

// ===== 新建克隆音色 =====
const fileInput = ref(null)
const draft = reactive({ name: '', file: null, duration: null, ref_text: '', ref_lang: 'zh', speaker_id: '', resource_id: 'seed-icl-1.0', consent: false })
const draftErrors = ref([])
const draftWarnings = ref([])
const creating = ref(false)
const busyId = ref(null)

const durationProblem = computed(() => {
  const d = draft.duration
  if (d == null) return ''
  if (family.value === 'sovits') {
    if (d < SOVITS_MIN) return t('voice.tooShort', { min: SOVITS_MIN, max: SOVITS_MAX })
    if (d > SOVITS_MAX) return t('voice.tooLong', { min: SOVITS_MIN, max: SOVITS_MAX })
  } else if (d < VOLC_MIN) return t('voice.tooShortVolc')
  return ''
})

function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (v) => { URL.revokeObjectURL(url); resolve(v) }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
    audio.onerror = () => done(null)
    setTimeout(() => done(null), 8000)
    audio.src = url
  })
}

async function onFile(e) {
  const file = e.target.files?.[0] || null
  draft.file = file
  draft.duration = file ? await readDuration(file) : null
  draftErrors.value = []
  draftWarnings.value = []
}

function localCheck() {
  const errors = []
  if (!draft.name.trim()) errors.push(t('voice.err.name'))
  if (!draft.file) errors.push(t('voice.err.audio'))
  else if (draft.file.size > MAX_BYTES) errors.push(t('voice.err.size'))
  if (durationProblem.value) errors.push(durationProblem.value)
  if (family.value === 'sovits' && !draft.ref_text.trim()) errors.push(t('voice.err.refText'))
  if (family.value === 'volcengine' && !draft.speaker_id.trim()) errors.push(t('voice.err.speaker'))
  if (!draft.consent) errors.push(t('voice.err.consent'))
  return errors
}

async function createClone() {
  draftErrors.value = localCheck()
  draftWarnings.value = []
  if (draftErrors.value.length) return
  creating.value = true
  try {
    const row = await speechAPI.createClone({
      config_id: props.configId || undefined,
      provider: form.provider,
      name: draft.name.trim(),
      ref_text: family.value === 'sovits' ? draft.ref_text.trim() : undefined,
      ref_lang: draft.ref_lang,
      speaker_id: family.value === 'volcengine' ? draft.speaker_id.trim() : undefined,
      resource_id: family.value === 'volcengine' ? draft.resource_id : undefined,
    }, draft.file)
    draftWarnings.value = row.warnings || []
    toast.success(family.value === 'volcengine' ? t('voice.uploaded') : t('voice.cloneAdded', { name: row.name }))
    Object.assign(draft, { name: '', file: null, duration: null, ref_text: '', speaker_id: '', consent: false })
    if (fileInput.value) fileInput.value.value = ''
    await loadClones()
    if (row.status === 'ready') previewVoice.value = `clone:${row.id}`
  } catch (e) {
    draftErrors.value = e.errors?.length ? e.errors : [e.message]
    draftWarnings.value = e.warnings || []
  } finally {
    creating.value = false
  }
}

async function refreshClone(c) {
  busyId.value = c.id
  try {
    const row = await speechAPI.refreshClone(c.id)
    toast(t(`voice.status.${row.status}`))
    await loadClones()
  } catch (e) { toastError(e) } finally { busyId.value = null }
}

async function removeClone(c) {
  if (!window.confirm(t('voice.deleteConfirm', { name: c.name }))) return
  busyId.value = c.id
  try {
    await speechAPI.deleteClone(c.id)
    if (previewVoice.value === `clone:${c.id}`) previewVoice.value = ''
    await loadClones()
  } catch (e) { toastError(e) } finally { busyId.value = null }
}
</script>

<style scoped>
.vcp { display: flex; flex-direction: column; gap: 14px; }
.vcp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.vcp-field { display: flex; flex-direction: column; gap: 5px; }
.vcp-label { font-size: 12px; font-weight: 550; color: var(--text-1); }
.vcp-hint { font-size: 11px; color: var(--text-3); }
.vcp-dim { font-size: 11px; color: var(--text-3); font-weight: 400; }
.vcp-box { border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.vcp-box-head { display: flex; flex-direction: column; gap: 2px; }
.vcp-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.vcp-select { flex: 1; min-width: 180px; }
.vcp-textarea { resize: vertical; min-height: 52px; font-family: inherit; }
.vcp-audio { width: 100%; height: 36px; }
.vcp-audio-sm { height: 30px; max-width: 220px; }
.vcp-tips { margin: 0; padding-left: 18px; font-size: 11px; color: var(--text-2); display: flex; flex-direction: column; gap: 2px; }
.vcp-clones { display: flex; flex-direction: column; gap: 8px; }
.vcp-clone { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.vcp-clone-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.vcp-clone-name { font-size: 13px; font-weight: 600; color: var(--text-1); }
.vcp-clone-text { font-size: 12px; color: var(--text-2); }
.vcp-clone-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vcp-new { display: flex; flex-direction: column; gap: 10px; border-top: 1px dashed var(--border); padding-top: 10px; }
.vcp-consent { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--text-1); cursor: pointer; }
.vcp-consent input { margin-top: 2px; accent-color: var(--accent); }
.vcp-checks { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.vcp-error { color: var(--danger, #e5484d); font-size: 12px; margin: 0; }
.vcp-warn { color: var(--warning, #d97706); font-size: 12px; margin: 0; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
