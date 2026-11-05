<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="emit('close')">
      <form class="dialog handoff-dialog" @submit.prevent="submit">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('catalog.handoff.title') }}</h2>
            <p class="dialog-desc">{{ t('catalog.handoff.desc') }}</p>
          </div>
        </div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">{{ t('index.createDialog.name') }}</span>
            <input v-model="form.title" class="input" :placeholder="t('catalog.handoff.titlePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('index.createDialog.style') }}</span>
            <BaseSelect v-model="form.style" :options="styleOptions" :placeholder="t('index.createDialog.stylePlaceholder')" searchable />
          </label>
          <label class="field">
            <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
            <BaseSelect v-model="form.aspect_ratio" :options="ratioOptions" :searchable="false" />
          </label>
          <label v-if="cinematic" class="field-check">
            <input v-model="withCinematic" type="checkbox" />
            <span>{{ t('catalog.handoff.withCinematic') }}</span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('catalog.handoff.content') }}</span>
            <textarea v-model="form.content" class="textarea handoff-content" rows="8"></textarea>
            <span class="field-hint">{{ t('catalog.handoff.hint') }}</span>
          </label>
        </div>
        <div class="dialog-foot">
            <button type="button" class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="busy || !form.content.trim()">
              <Loader2 v-if="busy" :size="13" class="animate-spin" />
              {{ t('catalog.handoff.submit') }}
            </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup>
import { Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { stylePresetAPI } from '~/composables/useApi'
import { catalogAPI } from '~/composables/useCatalog'
import { toastError } from '~/composables/useToast'
import BaseSelect from '~/components/BaseSelect.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  content: { type: String, default: '' },
  title: { type: String, default: '' },
  styleKey: { type: String, default: '' },
  aspectRatio: { type: String, default: '' },
  workflowId: { type: String, default: '' },
  /** 智能体 / 工作流里开启的影像参数：一起带进新项目 */
  cinematic: { type: Object, default: null },
})
const emit = defineEmits(['close'])
const { t } = useI18n()

const form = ref({ title: '', style: '', aspect_ratio: '9:16', content: '' })
const busy = ref(false)
const withCinematic = ref(true)
const presets = ref([])
const catalogStyles = ref([])

const styleOptions = computed(() => {
  const mine = presets.value.map(p => ({ label: p.name, value: p.value }))
  const have = new Set(mine.map(o => o.value))
  const lib = catalogStyles.value.filter(s => !have.has(s.id)).map(s => ({ label: s.name, value: s.id }))
  return lib.length
    ? [{ label: t('catalog.styles.mine'), options: mine }, { label: t('catalog.styles.library'), options: lib }].filter(g => g.options.length)
    : mine
})
const ratioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))

watch(() => props.open, async (open) => {
  if (!open) return
  form.value = {
    title: props.title,
    style: props.styleKey,
    aspect_ratio: props.aspectRatio || '9:16',
    content: props.content,
  }
  try {
    const [p, s] = await Promise.all([stylePresetAPI.list(), catalogAPI.styles()])
    presets.value = p || []
    catalogStyles.value = s || []
    if (!form.value.style && presets.value.length) form.value.style = presets.value[0].value
  } catch (e) { toastError(e) }
})

async function submit() {
  busy.value = true
  try {
    const res = await catalogAPI.handoff({
      ...form.value,
      workflow_id: props.workflowId || undefined,
      cinematic: props.cinematic && withCinematic.value ? props.cinematic : undefined,
    })
    emit('close')
    navigateTo(`/drama/${res.drama_id}/episode/${res.episode_number}`)
  } catch (e) {
    toastError(e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.handoff-dialog { width: 560px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px); display: flex; flex-direction: column; }
.dialog-head-copy { display: flex; flex-direction: column; gap: 2px; }
.dialog-desc { font-size: 12.5px; color: var(--text-3); }
.dialog-body { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-1); cursor: pointer; }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.handoff-content { min-height: 140px; resize: vertical; font-size: 12.5px; line-height: 1.6; }
</style>
