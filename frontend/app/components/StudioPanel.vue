<template>
  <div class="sp">
    <!-- 出片设置：画幅 / 分辨率 / 单镜秒数 / 同期声 / 画风 / 生成画面开关 -->
    <div class="sp-bar">
      <label class="sp-opt" :title="t('studio.toolsHint')">
        <span class="switch" :class="{ on: form.tools }" role="switch" :aria-checked="form.tools" @click="setSetting('tools', !form.tools)"></span>
        <span>{{ t('studio.tools') }}</span>
      </label>
      <template v-if="form.tools">
        <select v-model="form.aspect_ratio" class="input sp-select" :title="t('studio.ratio')" @change="setSetting('aspect_ratio', form.aspect_ratio)">
          <option v-for="r in RATIOS" :key="r" :value="r">{{ r }}</option>
        </select>
        <select v-model="form.resolution" class="input sp-select" :title="t('studio.resolution')" @change="setSetting('resolution', form.resolution)">
          <option v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}</option>
        </select>
        <select v-model.number="form.clip_seconds" class="input sp-select" :title="t('studio.clipSeconds')" @change="setSetting('clip_seconds', form.clip_seconds)">
          <option v-for="n in [4, 5, 6, 8, 10, 12, 15]" :key="n" :value="n">{{ t('studio.seconds', { n }) }}</option>
        </select>
        <label class="sp-opt" :title="t('studio.audioHint')">
          <span class="switch" :class="{ on: form.generate_audio }" role="switch" :aria-checked="form.generate_audio" @click="setSetting('generate_audio', !form.generate_audio)"></span>
          <span>{{ t('studio.audio') }}</span>
        </label>
        <select v-model="form.style_id" class="input sp-select sp-style" :title="t('studio.styleHint')" @change="setStyle(form.style_id)">
          <option value="">{{ bible.style && !bible.style_id ? t('studio.styleCustom') : t('studio.styleAuto') }}</option>
          <option v-for="s in styles" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <button type="button" class="btn btn-sm" :class="{ on: panel === 'bible' }" @click="panel = panel === 'bible' ? '' : 'bible'">
          <Lock :size="12" />{{ t('studio.bible') }}<span v-if="bible.entries.length" class="sp-count">{{ bible.entries.length }}</span>
        </button>
        <button type="button" class="btn btn-sm" :class="{ on: panel === 'assets' }" @click="panel = panel === 'assets' ? '' : 'assets'">
          <Images :size="12" />{{ t('studio.assets') }}<span v-if="assets.length" class="sp-count">{{ assets.length }}</span>
        </button>
      </template>
    </div>

    <!-- 一贯性设定 -->
    <div v-if="panel === 'bible' && form.tools" class="sp-drawer">
      <p class="sp-hint">{{ t('studio.bibleDesc') }}</p>
      <label class="cat-field">
        <span class="cat-field-label">{{ t('studio.look') }}</span>
        <textarea v-model="lookDraft" class="textarea" rows="2" :placeholder="t('studio.lookPlaceholder')" @change="saveLook"></textarea>
      </label>
      <div v-if="bible.entries.length" class="sp-entries">
        <div v-for="e in bible.entries" :key="e.type + e.name" class="sp-entry">
          <img v-if="e.path" :src="thumbOf(mediaSrc(e.path))" :alt="e.name" @error="thumbFallback($event, mediaSrc(e.path))" @click="preview = { type: 'image', src: mediaSrc(e.path), name: e.name }" />
          <div v-else class="sp-entry-empty"><ImageOff :size="16" /></div>
          <div class="sp-entry-copy">
            <span class="sp-entry-name"><span class="tag tag-info">{{ t('studio.type.' + e.type) }}</span>{{ e.name }}</span>
            <span class="sp-entry-desc">{{ [e.description, e.styling].filter(Boolean).join('；') }}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" :title="t('common.delete')" @click="removeEntry(e)"><X :size="12" /></button>
        </div>
      </div>
      <p v-else class="sp-hint">{{ t('studio.bibleEmpty') }}</p>
    </div>

    <!-- 素材 -->
    <div v-if="panel === 'assets' && form.tools" class="sp-drawer">
      <div v-if="assets.length" class="sp-gallery">
        <div v-for="a in assets.slice().reverse()" :key="a.id" class="sp-tile">
          <AssetThumb :asset="a" @open="openPreview" />
          <div class="sp-tile-foot">
            <span class="sp-tile-name" :title="a.name">#{{ a.id }} {{ a.name }}</span>
            <a v-if="a.path" class="btn btn-ghost btn-sm" :href="mediaSrc(a.path)" :download="a.name" :title="t('studio.download')"><Download :size="12" /></a>
            <button type="button" class="btn btn-ghost btn-sm" :title="t('common.delete')" @click="removeAsset(a)"><X :size="12" /></button>
          </div>
        </div>
      </div>
      <p v-else class="sp-hint">{{ t('studio.assetsEmpty') }}</p>
    </div>

    <div ref="scrollEl" class="sp-scroll">
      <div v-if="!timeline.length" class="sp-welcome">
        <Clapperboard :size="26" :stroke-width="1.4" />
        <p>{{ welcome }}</p>
        <div v-if="starters?.length" class="sp-starters">
          <button v-for="s in starters" :key="s" class="sp-starter" @click="send(s)">{{ s }}</button>
        </div>
      </div>
      <template v-for="b in timeline" :key="b.id">
        <div v-if="b.type === 'user'" class="sp-msg user"><div class="sp-bubble">{{ b.text }}</div></div>
        <div v-else-if="b.type === 'assistant'" class="sp-msg assistant">
          <div class="sp-bubble">{{ b.text }}<span v-if="running && b === lastBlock" class="sp-caret"></span></div>
          <div v-if="!(running && b === lastBlock)" class="sp-msg-tools">
            <button class="btn btn-ghost btn-sm" @click="copy(b.text)"><Copy :size="12" />{{ t('catalog.common.copy') }}</button>
            <button v-if="handoff" class="btn btn-ghost btn-sm" @click="emit('handoff', b.text)"><Share2 :size="12" />{{ t('catalog.handoff.button') }}</button>
          </div>
        </div>
        <div v-else-if="b.type === 'plan'" class="sp-plan">
          <div class="sp-plan-title"><ListChecks :size="13" />{{ t('studio.plan') }}</div>
          <div v-for="(s, i) in b.steps" :key="i" class="sp-plan-step" :class="s.status">
            <Check v-if="s.status === 'done'" :size="12" />
            <Loader2 v-else-if="s.status === 'in_progress'" :size="12" class="animate-spin" />
            <Circle v-else :size="12" />
            <span>{{ s.title }}</span>
          </div>
        </div>
        <div v-else-if="b.type === 'tool'" class="sp-tool" :class="b.status">
          <div class="sp-tool-head">
            <Loader2 v-if="b.status === 'running'" :size="13" class="animate-spin" />
            <Check v-else-if="b.status === 'done'" :size="13" />
            <X v-else :size="13" />
            <span class="sp-tool-label">{{ toolLabel(b) }}</span>
            <span class="sp-tool-sub">{{ toolSubtitle(b) }}</span>
          </div>
          <div v-if="toolAssets(b).length" class="sp-tool-assets">
            <AssetThumb v-for="a in toolAssets(b)" :key="a.id" :asset="a" @open="openPreview" />
          </div>
          <div v-else-if="b.status === 'running' && runningAsset(b)" class="sp-tool-assets">
            <AssetThumb :asset="runningAsset(b)" @open="openPreview" />
          </div>
          <p v-if="b.result?.error" class="sp-tool-error">{{ b.result.error }}</p>
          <p v-if="b.result?.note || b.result?.warning" class="sp-tool-note">{{ b.result.note || b.result.warning }}</p>
          <p v-if="b.result?.warnings?.length" class="sp-tool-note">{{ b.result.warnings.join('；') }}</p>
          <details v-if="b.result?.report" class="sp-tool-report"><summary>{{ t('studio.report') }}</summary><p>{{ b.result.report }}</p></details>
        </div>
        <p v-else-if="b.type === 'notice'" class="sp-notice">{{ b.text }}</p>
      </template>
      <div v-if="running && (!lastBlock || lastBlock.type === 'user')" class="sp-thinking"><Loader2 :size="13" class="animate-spin" />{{ t('studio.thinking') }}</div>
    </div>

    <form class="sp-input" @submit.prevent="send(draft)" @dragover.prevent @drop.prevent="onDrop">
      <textarea
        v-model="draft"
        class="textarea"
        rows="3"
        :placeholder="placeholder || t('studio.placeholder')"
        @keydown.enter.exact.prevent="send(draft)"
        @paste="onPaste"
      ></textarea>
      <div class="sp-input-foot">
        <input ref="fileEl" type="file" multiple accept="image/*,video/*,audio/*" hidden @change="onFiles" />
        <button type="button" class="btn btn-sm" :disabled="uploading" :title="t('studio.uploadHint')" @click="fileEl?.click()">
          <Loader2 v-if="uploading" :size="12" class="animate-spin" /><Paperclip v-else :size="12" />{{ t('studio.upload') }}
        </button>
        <span class="cat-field-hint">{{ t('catalog.agents.enterHint') }}</span>
        <button v-if="running" type="button" class="btn" @click="stop"><Square :size="12" />{{ t('catalog.common.stop') }}</button>
        <button v-else type="submit" class="btn btn-primary" :disabled="!draft.trim() || busy"><Send :size="13" />{{ t('catalog.agents.send') }}</button>
      </div>
    </form>

    <Teleport to="body">
      <div v-if="preview" class="overlay sp-preview" @click.self="preview = null">
        <div class="sp-preview-box">
          <video v-if="preview.type === 'video'" :src="preview.src" controls autoplay playsinline></video>
          <audio v-else-if="preview.type === 'audio'" :src="preview.src" controls autoplay></audio>
          <img v-else :src="preview.src" :alt="preview.name" />
          <div class="sp-preview-foot">
            <span>{{ preview.name }}</span>
            <a class="btn btn-sm" :href="preview.src" :download="preview.name"><Download :size="12" />{{ t('studio.download') }}</a>
            <button class="btn btn-sm" @click="preview = null">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
/**
 * 创作会话面板：智能体 / 工作流共用。对话 + 工具卡片（出图 / 出视频进度与结果）+ 出片设置 + 一贯性设定 + 素材库。
 * session 为空时第一次发送调用 createSession(text, settings) 新建会话。
 */
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { h } from 'vue'
import {
  Send, Square, Copy, Share2, Clapperboard, Check, X, Loader2, Circle, ListChecks, Paperclip, Images, Lock, Download, ImageOff, Play, Music,
} from 'lucide-vue-next'
import { toastError } from '~/composables/useToast'
import { studioAPI, mediaSrc, isVideoAsset, isAudioAsset } from '~/composables/useStudio'
import { thumbOf, thumbFallback, posterOf } from '~/composables/useMedia'
import { catalogAPI } from '~/composables/useCatalog'
import TaskProgress from '~/components/TaskProgress.vue'

const props = defineProps({
  session: { type: Object, default: null },
  starters: { type: Array, default: () => [] },
  welcome: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  /** 发消息时附带的 model / config_id / cinematic */
  extraBody: { type: Function, default: () => ({}) },
  /** 还没有会话时新建：(text, settings, styleId) => Promise<session> */
  createSession: { type: Function, default: null },
  /** 智能体回复旁显示「交给一键生成」 */
  handoff: { type: Boolean, default: false },
  /** 新会话的默认设置（工作流的画幅等） */
  defaults: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update', 'handoff'])
const { t } = useI18n()

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']
const RESOLUTIONS = ['480p', '720p', '1080p']
const SETTINGS_KEY = 'uu889:studio-settings'

function loadLocal() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {} } catch { return {} }
}
const form = reactive({ tools: true, aspect_ratio: '9:16', resolution: '720p', clip_seconds: 6, generate_audio: true, style_id: '', ...loadLocal(), ...props.defaults })
const draft = ref('')
const busy = ref(false)
const uploading = ref(false)
const panel = ref('')
const preview = ref(null)
const scrollEl = ref(null)
const fileEl = ref(null)
const styles = ref([])
const lookDraft = ref('')

const timeline = computed(() => props.session?.timeline || [])
const assets = computed(() => props.session?.assets || [])
const bible = computed(() => props.session?.bible || { style: '', style_id: null, entries: [] })
const running = computed(() => !!props.session?.running)
const lastBlock = computed(() => timeline.value[timeline.value.length - 1] || null)
const assetById = computed(() => new Map(assets.value.map(a => [a.id, a])))

watch(() => props.session?.id, () => syncForm(), { immediate: true })
watch(() => props.session?.settings, () => syncForm())
watch(() => bible.value.style, (v) => { lookDraft.value = v || '' }, { immediate: true })
watch(() => timeline.value.length, () => scrollBottom())
watch(() => lastBlock.value?.text, () => scrollBottom(true))

function syncForm() {
  const s = props.session?.settings
  if (!s) return
  Object.assign(form, {
    tools: s.tools, aspect_ratio: s.aspect_ratio, resolution: s.resolution, clip_seconds: s.clip_seconds,
    generate_audio: s.generate_audio, style_id: props.session?.bible?.style_id || '',
  })
}

function scrollBottom(onlyIfNear = false) {
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    if (onlyIfNear && el.scrollHeight - el.scrollTop - el.clientHeight > 160) return
    el.scrollTop = el.scrollHeight
  })
}

function saveLocal() {
  try {
    const { tools, aspect_ratio, resolution, clip_seconds, generate_audio } = form
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ tools, aspect_ratio, resolution, clip_seconds, generate_audio }))
  } catch { /* 忽略 */ }
}

function currentSettings() {
  const { tools, aspect_ratio, resolution, clip_seconds, generate_audio } = form
  return { tools, aspect_ratio, resolution, clip_seconds, generate_audio, ...(props.defaults?.agent_id ? { agent_id: props.defaults.agent_id } : {}) }
}

async function setSetting(key, value) {
  form[key] = value
  saveLocal()
  if (!props.session) return
  try { emit('update', await studioAPI.patch(props.session.id, { settings: { [key]: value } })) } catch (e) { toastError(e) }
}

async function setStyle(id) {
  form.style_id = id
  if (!props.session) return
  try { emit('update', await studioAPI.patch(props.session.id, { style_id: id || null })) } catch (e) { toastError(e) }
}

async function saveLook() {
  if (!props.session || lookDraft.value === (bible.value.style || '')) return
  try { emit('update', await studioAPI.patch(props.session.id, { bible: { style: lookDraft.value, style_id: null } })) } catch (e) { toastError(e) }
}

async function removeEntry(e) {
  if (!props.session) return
  const entries = bible.value.entries.filter(x => !(x.name === e.name && x.type === e.type))
  try { emit('update', await studioAPI.patch(props.session.id, { bible: { entries } })) } catch (err) { toastError(err) }
}

async function removeAsset(a) {
  if (!props.session || !confirm(t('studio.removeAssetConfirm', { name: a.name }))) return
  try {
    await studioAPI.removeAsset(props.session.id, a.id)
    emit('update', await studioAPI.get(props.session.id))
  } catch (e) { toastError(e) }
}

async function ensureSession(text) {
  if (props.session) return props.session
  if (!props.createSession) throw new Error('no session')
  const s = await props.createSession(text, currentSettings(), form.style_id || null)
  return s
}

async function send(text) {
  const content = String(text || '').trim()
  if (!content || running.value || busy.value) return
  busy.value = true
  const saved = draft.value
  draft.value = ''
  try {
    if (!props.session) {
      const s = await ensureSession(content)
      emit('update', s)
    } else {
      emit('update', await studioAPI.send(props.session.id, { text: content, ...props.extraBody() }))
    }
    scrollBottom()
  } catch (e) {
    draft.value = saved
    toastError(e)
  } finally {
    busy.value = false
  }
}

async function stop() {
  if (!props.session) return
  try { emit('update', await studioAPI.stop(props.session.id)) } catch (e) { toastError(e) }
}

async function uploadFiles(files) {
  const list = [...files].filter(Boolean)
  if (!list.length) return
  uploading.value = true
  try {
    let s = props.session
    if (!s) {
      if (!props.createSession) return
      s = await props.createSession('', currentSettings(), form.style_id || null)
      emit('update', s)
    }
    const added = await studioAPI.upload(s.id, list)
    emit('update', await studioAPI.get(s.id))
    const refs = added.map(a => `#${a.id}`).join(' ')
    draft.value = `${draft.value ? `${draft.value.trimEnd()} ` : ''}${t('studio.uploaded', { refs })}`
    toast.success(t('studio.uploadedToast', { n: added.length }))
  } catch (e) { toastError(e) } finally { uploading.value = false }
}
function onFiles(e) { uploadFiles(e.target.files || []); e.target.value = '' }
function onDrop(e) { uploadFiles(e.dataTransfer?.files || []) }
function onPaste(e) {
  const files = [...(e.clipboardData?.files || [])]
  if (files.length) { e.preventDefault(); uploadFiles(files) }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text || ''); toast.success(t('catalog.common.copied')) } catch (e) { toastError(e) }
}

function toolLabel(b) {
  const key = `studio.tool.${b.tool}`
  const v = t(key)
  return v === key ? (b.label || b.tool) : v
}
function toolSubtitle(b) {
  const a = b.args || {}
  return String(a.name || a.title || (a.type && a.name) || a.prompt || a.style || a.url || a.text || a.question || '').replace(/\s+/g, ' ').slice(0, 80)
}
function toolAssets(b) {
  return (b.asset_ids || []).map(id => assetById.value.get(Number(id))).filter(Boolean)
}
/** 运行中的工具卡片：按名字找刚提交的素材（显示进度） */
function runningAsset(b) {
  const name = b.args?.name
  const list = assets.value.filter(a => a.status === 'processing')
  if (!list.length) return null
  if (name) return list.find(a => a.name === name || a.name === `${name}·设定图`) || null
  return null
}
function openPreview(a) {
  if (!a?.path) return
  preview.value = { type: isVideoAsset(a) ? 'video' : isAudioAsset(a) ? 'audio' : 'image', src: mediaSrc(a.path), name: a.name }
}

/** 素材缩略：图片 / 视频海报 / 音频 / 生成中进度 / 失败 */
const AssetThumb = defineComponent({
  props: { asset: { type: Object, required: true } },
  emits: ['open'],
  setup(p, { emit: e }) {
    return () => {
      const a = p.asset
      if (a.status === 'processing') {
        return h('div', { class: 'sp-thumb pending' }, [
          h('span', { class: 'sp-thumb-name' }, a.name),
          a.progress ? h(TaskProgress, { progress: a.progress, compact: true }) : h('span', { class: 'sp-thumb-wait' }, [h(Loader2, { size: 14, class: 'animate-spin' })]),
        ])
      }
      if (a.status === 'failed') {
        return h('div', { class: 'sp-thumb failed', title: a.error_msg || '' }, [h('span', { class: 'sp-thumb-name' }, a.name), h('span', { class: 'sp-thumb-err' }, a.error_msg || t('studio.failed'))])
      }
      const src = mediaSrc(a.path)
      if (isAudioAsset(a)) {
        return h('div', { class: 'sp-thumb audio' }, [h(Music, { size: 16 }), h('span', { class: 'sp-thumb-name' }, a.name), h('audio', { src, controls: true, preload: 'none' })])
      }
      if (isVideoAsset(a)) {
        return h('button', { type: 'button', class: ['sp-thumb', a.kind === 'render' ? 'final' : ''], onClick: () => e('open', a) }, [
          h('img', { src: posterOf(src) || '', alt: a.name, loading: 'lazy' }),
          h('span', { class: 'sp-thumb-play' }, [h(Play, { size: 16 })]),
          a.meta?.duration ? h('span', { class: 'sp-thumb-dur' }, `${a.meta.duration}s`) : null,
          h('span', { class: 'sp-thumb-label' }, a.kind === 'render' ? `${t('studio.final')} · ${a.name}` : a.name),
        ])
      }
      return h('button', { type: 'button', class: 'sp-thumb', onClick: () => e('open', a) }, [
        h('img', { src: thumbOf(src), alt: a.name, loading: 'lazy', onError: (ev) => thumbFallback(ev, src) }),
        h('span', { class: 'sp-thumb-label' }, a.name),
      ])
    }
  },
})

onMounted(async () => {
  try { styles.value = (await catalogAPI.styles()) || [] } catch { /* 没有风格库也能用 */ }
})
</script>

<style scoped>
.sp { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 24px; border-bottom: 1px solid var(--border); }
.sp-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); cursor: pointer; user-select: none; }
.sp-select { height: 30px; padding: 0 8px; font-size: 12px; width: auto; min-width: 0; }
.sp-style { max-width: 180px; }
.sp-bar .btn.on { background: var(--bg-active); }
.sp-count { font-size: 10.5px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--accent-bg); color: var(--accent-text); }
.sp-drawer { border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; flex-direction: column; gap: 10px; max-height: 42vh; overflow-y: auto; background: var(--bg-surface); }
.sp-hint { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.sp-entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.sp-entry { display: flex; gap: 8px; align-items: flex-start; border: 1px solid var(--border); border-radius: var(--radius); padding: 6px; background: var(--surface-raised); }
.sp-entry img, .sp-entry-empty { width: 56px; height: 56px; border-radius: 6px; object-fit: cover; flex-shrink: 0; cursor: zoom-in; background: var(--bg-hover); display: grid; place-items: center; color: var(--text-3); }
.sp-entry-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sp-entry-name { font-size: 12.5px; font-weight: 600; color: var(--text-0); display: flex; gap: 6px; align-items: center; }
.sp-entry-desc { font-size: 11.5px; color: var(--text-2); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.sp-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.sp-tile { display: flex; flex-direction: column; gap: 4px; }
.sp-tile :deep(.sp-thumb) { width: 100%; }
.sp-tile-foot { display: flex; align-items: center; gap: 2px; }
.sp-tile-name { flex: 1; min-width: 0; font-size: 11.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-scroll { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.sp-welcome { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-3); text-align: center; max-width: 600px; }
.sp-welcome p { font-size: 13px; line-height: 1.6; }
.sp-starters { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
.sp-starter { border: 1px solid var(--border); background: var(--surface-raised); color: var(--text-1); border-radius: var(--radius-pill); font-size: 12px; padding: 6px 12px; cursor: pointer; text-align: left; }
.sp-starter:hover { border-color: var(--border-hover); background: var(--bg-hover); }
.sp-msg { display: flex; flex-direction: column; gap: 4px; max-width: 860px; }
.sp-msg.user { align-self: flex-end; align-items: flex-end; }
.sp-msg.assistant { align-self: flex-start; }
.sp-bubble { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.7; padding: 10px 14px; border-radius: var(--radius-lg); background: var(--surface-raised); border: 1px solid var(--border); color: var(--text-0); }
.sp-msg.user .sp-bubble { background: var(--accent-bg); border-color: transparent; }
.sp-msg-tools { display: flex; gap: 4px; }
.sp-caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; background: var(--text-2); vertical-align: -2px; animation: sp-blink 1s steps(1) infinite; }
@keyframes sp-blink { 50% { opacity: 0; } }
.sp-thinking { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); }
.sp-plan { align-self: flex-start; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; background: var(--bg-surface); display: flex; flex-direction: column; gap: 4px; min-width: 260px; max-width: 860px; }
.sp-plan-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-1); }
.sp-plan-step { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); }
.sp-plan-step.done { color: var(--text-3); text-decoration: line-through; }
.sp-plan-step.in_progress { color: var(--text-0); font-weight: 600; }
.sp-tool { align-self: flex-start; max-width: 860px; width: fit-content; min-width: 260px; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 12px; background: var(--surface-raised); display: flex; flex-direction: column; gap: 6px; }
.sp-tool.error { border-color: var(--error); }
.sp-tool-head { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-1); min-width: 0; }
.sp-tool.done .sp-tool-head svg { color: var(--success); }
.sp-tool.error .sp-tool-head svg { color: var(--error); }
.sp-tool-label { font-weight: 600; flex-shrink: 0; }
.sp-tool-sub { color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 520px; }
.sp-tool-assets { display: flex; flex-wrap: wrap; gap: 8px; }
.sp-tool-error { font-size: 12px; color: var(--error); white-space: pre-wrap; }
.sp-tool-note { font-size: 12px; color: var(--text-2); }
.sp-tool-report summary { font-size: 12px; color: var(--text-2); cursor: pointer; }
.sp-tool-report p { font-size: 12px; color: var(--text-1); white-space: pre-wrap; line-height: 1.6; margin-top: 4px; }
.sp-notice { font-size: 12px; color: var(--text-3); align-self: center; }
:deep(.sp-thumb) { position: relative; width: 180px; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); background: var(--bg-hover); padding: 0; cursor: zoom-in; display: flex; flex-direction: column; justify-content: flex-end; }
:deep(.sp-thumb img) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
:deep(.sp-thumb.final) { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-bg); }
:deep(.sp-thumb-label) { position: relative; font-size: 11px; color: #fff; padding: 14px 6px 4px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.65)); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:deep(.sp-thumb-play) { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; display: grid; place-items: center; }
:deep(.sp-thumb-dur) { position: absolute; top: 6px; right: 6px; font-size: 10.5px; color: #fff; background: rgba(0, 0, 0, 0.55); border-radius: 4px; padding: 0 4px; }
:deep(.sp-thumb.pending), :deep(.sp-thumb.failed), :deep(.sp-thumb.audio) { cursor: default; padding: 8px; gap: 6px; justify-content: center; }
:deep(.sp-thumb.audio) { aspect-ratio: auto; width: 240px; color: var(--text-2); }
:deep(.sp-thumb.audio audio) { width: 100%; height: 30px; }
:deep(.sp-thumb-name) { font-size: 11.5px; color: var(--text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:deep(.sp-thumb-wait) { color: var(--text-3); }
:deep(.sp-thumb-err) { font-size: 11px; color: var(--error); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.sp-input { border-top: 1px solid var(--border); padding: 12px 24px 16px; display: flex; flex-direction: column; gap: 8px; }
.sp-input .textarea { resize: vertical; min-height: 64px; font-size: 13px; }
.sp-input-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.sp-input-foot .cat-field-hint { margin-right: auto; }
.sp-preview { display: grid; place-items: center; }
.sp-preview-box { max-width: min(92vw, 1100px); max-height: 92vh; display: flex; flex-direction: column; gap: 8px; background: var(--surface-raised); padding: 10px; border-radius: var(--radius-lg); }
.sp-preview-box img, .sp-preview-box video { max-width: 100%; max-height: calc(92vh - 70px); object-fit: contain; border-radius: 6px; background: #000; }
.sp-preview-foot { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2); }
.sp-preview-foot span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 760px) {
  .sp-bar, .sp-scroll, .sp-input, .sp-drawer { padding-left: 16px; padding-right: 16px; }
  :deep(.sp-thumb) { width: 140px; }
}
</style>
