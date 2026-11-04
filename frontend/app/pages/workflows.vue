<template>
  <div class="cat-page">
    <aside class="cat-side">
      <div class="cat-side-head">
        <div class="cat-side-title">
          <h1>{{ t('catalog.workflows.title') }}</h1>
          <button class="btn btn-sm" @click="openEditor(null)">
            <Plus :size="13" :stroke-width="2" />{{ t('catalog.common.new') }}
          </button>
        </div>
        <p class="cat-side-sub">{{ t('catalog.workflows.sub') }}</p>
        <input v-model.trim="keyword" class="input cat-search" :placeholder="t('catalog.common.search')" />
      </div>
      <div class="cat-list">
        <template v-for="g in groups" :key="g.category">
          <div class="cat-group-label">{{ g.category }}</div>
          <button
            v-for="w in g.items"
            :key="w.id"
            type="button"
            class="cat-item"
            :class="{ on: current?.id === w.id }"
            @click="select(w.id)"
          >
            <span class="cat-item-name">{{ w.name }}<span v-if="!w.builtin" class="cat-badge">{{ t('catalog.common.mine') }}</span></span>
            <span v-if="w.description" class="cat-item-desc">{{ w.description }}</span>
          </button>
        </template>
        <p v-if="!loading && !groups.length" class="cat-side-sub" style="padding: 12px 8px">{{ t('catalog.common.none') }}</p>
      </div>
    </aside>

    <section class="cat-main">
      <template v-if="current">
        <div class="cat-main-head">
          <div class="cat-main-copy">
            <h2>{{ current.name }}</h2>
            <p v-if="current.description">{{ current.description }}</p>
            <div class="cat-meta">
              <span v-for="tag in current.tags" :key="tag" class="tag">{{ tag }}</span>
              <span class="tag tag-info">{{ t('catalog.workflows.stepCount', { n: current.steps.length }) }}</span>
              <span v-if="current.handoff" class="tag tag-success">{{ t('catalog.workflows.hasHandoff') }}</span>
              <template v-if="current.source?.name || current.source?.url">
                <span>{{ t('catalog.common.source') }}：</span>
                <a v-if="current.source.url" :href="current.source.url" target="_blank" rel="noopener">{{ current.source.name || current.source.url }}</a>
                <span v-else>{{ current.source.name }}</span>
              </template>
            </div>
          </div>
          <div class="cat-actions">
            <ModelSelect
              v-if="models.options.value.length"
              v-model="models.picked.value"
              :label="t('common.serviceType.text')"
              :options="models.options.value"
              :show-config="models.multiConfig.value"
            />
            <button class="btn btn-sm" @click="openEditor(current)">{{ current.builtin ? t('catalog.common.customize') : t('catalog.common.edit') }}</button>
            <button v-if="!current.builtin" class="btn btn-sm btn-danger" @click="removeCurrent">{{ t('common.delete') }}</button>
          </div>
        </div>

        <div class="wf-body">
          <div v-if="current.inputs.length" class="wf-inputs">
            <label v-for="inp in current.inputs" :key="inp.key" class="cat-field">
              <span class="cat-field-label">{{ inp.label }}<span v-if="inp.required !== false" class="req">*</span></span>
              <textarea v-if="inp.multiline" v-model="inputs[inp.key]" class="textarea" rows="4" :placeholder="inp.placeholder"></textarea>
              <input v-else v-model="inputs[inp.key]" class="input" :placeholder="inp.placeholder" />
            </label>
          </div>
          <div class="wf-run-row">
            <button v-if="running" class="btn" @click="stop"><Square :size="12" />{{ t('catalog.common.stop') }}</button>
            <button v-else class="btn btn-primary" @click="run(0)"><Play :size="13" />{{ t('catalog.workflows.run') }}</button>
            <button
              v-if="current.handoff && finalOutput && !running"
              class="btn"
              @click="openHandoff(finalOutput)"
            ><Clapperboard :size="13" />{{ t('catalog.handoff.button') }}</button>
          </div>

          <ol class="wf-steps">
            <li v-for="(s, i) in current.steps" :key="s.id" class="wf-step" :class="stepState[s.id]">
              <div class="wf-step-head">
                <span class="wf-step-no">
                  <Loader2 v-if="stepState[s.id] === 'running'" :size="13" class="animate-spin" />
                  <Check v-else-if="stepState[s.id] === 'done'" :size="13" />
                  <X v-else-if="stepState[s.id] === 'error'" :size="13" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="wf-step-name">{{ s.name }}</span>
                <span class="wf-step-agent">{{ s.agent_name || s.agent || '' }}</span>
                <span class="wf-step-tools">
                  <button
                    v-if="i > 0 && !running && allDoneBefore(i)"
                    class="btn btn-ghost btn-sm"
                    :title="t('catalog.workflows.rerunFromTitle')"
                    @click="run(i)"
                  ><RotateCcw :size="12" />{{ t('catalog.workflows.rerunFrom') }}</button>
                  <button v-if="outputs[s.id]" class="btn btn-ghost btn-sm" @click="copy(outputs[s.id])"><Copy :size="12" /></button>
                  <button v-if="outputs[s.id] && !running" class="btn btn-ghost btn-sm" :title="t('catalog.handoff.button')" @click="openHandoff(outputs[s.id])"><Clapperboard :size="12" /></button>
                </span>
              </div>
              <textarea
                v-if="outputs[s.id] !== undefined"
                v-model="outputs[s.id]"
                class="textarea wf-output"
                :readonly="running"
                rows="6"
              ></textarea>
              <p v-if="stepErrors[s.id]" class="wf-error">{{ stepErrors[s.id] }}</p>
            </li>
          </ol>
        </div>
      </template>
      <div v-else class="cat-empty">
        <Workflow :size="28" :stroke-width="1.4" />
        <p>{{ loading ? t('common.loading') : t('catalog.workflows.pick') }}</p>
      </div>
    </section>

    <!-- 编辑 / 新建工作流（JSON） -->
    <Teleport to="body">
      <div v-if="editor.open" class="overlay" @click.self="editor.open = false">
        <form class="dialog cat-editor" @submit.prevent="saveEditor">
          <div class="dialog-head">
            <h2 class="dialog-title">{{ editor.isNew ? t('catalog.workflows.newTitle') : t('catalog.workflows.editTitle') }}</h2>
          </div>
          <div class="dialog-body">
            <p v-if="editor.fromBuiltin" class="cat-field-hint">{{ t('catalog.common.overrideHint') }}</p>
            <label class="cat-field">
              <span class="cat-field-label">ID</span>
              <input v-model.trim="editor.id" class="input cat-mono" :disabled="!editor.isNew" pattern="[a-z0-9][a-z0-9\-]*" required />
            </label>
            <label class="cat-field">
              <span class="cat-field-label">JSON</span>
              <textarea v-model="editor.json" class="textarea cat-mono" rows="20" spellcheck="false"></textarea>
              <span class="cat-field-hint">{{ t('catalog.workflows.jsonHint') }}</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="editor.open = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="editor.saving">{{ t('common.save') }}</button>
          </div>
        </form>
      </div>
    </Teleport>

    <HandoffDialog
      :open="handoff.open"
      :content="handoff.content"
      :title="handoff.title"
      :style-key="current?.handoff?.style || ''"
      :aspect-ratio="current?.handoff?.aspect_ratio || ''"
      :workflow-id="current?.id || ''"
      @close="handoff.open = false"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Plus, Play, Square, Copy, Clapperboard, Check, X, Loader2, RotateCcw, Workflow } from 'lucide-vue-next'
import { toastError } from '~/composables/useToast'
import { catalogAPI, postSse, useTextModelPick, groupByCategory } from '~/composables/useCatalog'
import ModelSelect from '~/components/ModelSelect.vue'
import HandoffDialog from '~/components/HandoffDialog.vue'
import '~/assets/catalog.css'

const { t } = useI18n()
const route = useRoute()

const workflows = ref([])
const loading = ref(true)
const keyword = ref('')
const current = ref(null)
const inputs = reactive({})
const outputs = reactive({})
const stepState = reactive({})
const stepErrors = reactive({})
const running = ref(false)
const handoff = reactive({ open: false, content: '', title: '' })
let abort = null
const models = useTextModelPick()

const groups = computed(() => {
  const k = keyword.value.toLowerCase()
  const list = workflows.value.filter(w => !k || [w.name, w.description, w.category, ...(w.tags || [])].join(' ').toLowerCase().includes(k))
  return groupByCategory(list, t('catalog.common.other'))
})

const finalOutput = computed(() => {
  const wf = current.value
  if (!wf) return ''
  const stepId = wf.handoff?.content_step || wf.steps[wf.steps.length - 1]?.id
  return outputs[stepId] || ''
})

function reset(obj) { for (const k of Object.keys(obj)) delete obj[k] }

async function load() {
  loading.value = true
  try { workflows.value = (await catalogAPI.workflows()) || [] } catch (e) { toastError(e) } finally { loading.value = false }
}

async function select(id) {
  if (running.value) stop()
  try {
    const wf = await catalogAPI.workflow(id)
    current.value = wf
    reset(inputs); reset(outputs); reset(stepState); reset(stepErrors)
    for (const inp of wf.inputs) inputs[inp.key] = inp.default || ''
    if (route.query.workflow !== id) navigateTo({ query: { workflow: id } }, { replace: true })
  } catch (e) { toastError(e) }
}

function allDoneBefore(i) {
  return current.value.steps.slice(0, i).every(s => outputs[s.id] !== undefined && String(outputs[s.id]).trim())
}

async function run(startIndex) {
  const wf = current.value
  if (!wf || running.value) return
  for (const inp of wf.inputs) {
    if (inp.required !== false && !String(inputs[inp.key] || '').trim()) {
      toast.warning(t('catalog.workflows.fillInput', { label: inp.label }))
      return
    }
  }
  for (const s of wf.steps.slice(startIndex)) {
    delete outputs[s.id]; delete stepErrors[s.id]; stepState[s.id] = 'pending'
  }
  running.value = true
  const controller = new AbortController()
  abort = controller
  let finished = false
  try {
    await postSse(`/catalog/workflows/${wf.id}/run`, {
      inputs: { ...inputs },
      start_step: wf.steps[startIndex]?.id,
      outputs: { ...outputs },
      ...models.modelBody(),
    }, (event, data) => {
      if (event === 'step') { stepState[data.id] = 'running'; outputs[data.id] = '' }
      else if (event === 'delta') outputs[data.step] = (outputs[data.step] || '') + data.text
      else if (event === 'step-done') { stepState[data.id] = 'done'; outputs[data.id] = data.output }
      else if (event === 'error') {
        if (data?.step) { stepState[data.step] = 'error'; stepErrors[data.step] = data.message }
        throw new Error(data?.message || 'error')
      } else if (event === 'done') finished = true
    }, controller.signal)
    if (finished) toast.success(t('catalog.workflows.finished'))
  } catch (e) {
    if (e?.name === 'AbortError') toast.info(t('catalog.workflows.stopped'))
    else toastError(e)
    for (const s of wf.steps) if (stepState[s.id] === 'running') stepState[s.id] = 'error'
  } finally {
    running.value = false
    abort = null
  }
}

function stop() { abort?.abort() }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast.success(t('catalog.common.copied')) } catch (e) { toastError(e) }
}
function openHandoff(content) {
  const firstInput = current.value?.inputs[0]?.key
  handoff.content = content
  handoff.title = String((firstInput && inputs[firstInput]) || '').split('\n')[0].slice(0, 30)
  handoff.open = true
}

// ── 编辑器（JSON） ──
const SAMPLE = {
  name: '',
  description: '',
  category: '',
  inputs: [{ key: 'topic', label: '主题', multiline: true }],
  steps: [
    { id: 'outline', name: '大纲', prompt: '根据主题写大纲：{{inputs.topic}}' },
    { id: 'script', name: '剧本', prompt: '按大纲写剧本：\n{{steps.outline}}' },
  ],
  handoff: { type: 'one-click', content_step: 'script', aspect_ratio: '9:16' },
}
const editor = reactive({ open: false, isNew: false, fromBuiltin: false, saving: false, id: '', json: '' })
function openEditor(wf) {
  editor.isNew = !wf
  editor.fromBuiltin = !!wf?.builtin
  editor.id = wf?.id || ''
  if (wf) {
    const { id, builtin, ...rest } = wf
    rest.steps = rest.steps.map(({ agent_name, ...s }) => s)
    editor.json = JSON.stringify(rest, null, 2)
  } else {
    editor.json = JSON.stringify(SAMPLE, null, 2)
  }
  editor.open = true
}
async function saveEditor() {
  let data
  try { data = JSON.parse(editor.json) } catch (e) { toast.error(t('catalog.workflows.badJson', { msg: e.message })); return }
  editor.saving = true
  try {
    const saved = await catalogAPI.saveWorkflow(editor.id, data)
    editor.open = false
    toast.success(t('catalog.common.saved'))
    await load()
    await select(saved.id)
  } catch (e) { toastError(e) } finally { editor.saving = false }
}
async function removeCurrent() {
  if (!current.value || !confirm(t('catalog.common.deleteConfirm', { name: current.value.name }))) return
  try {
    const id = current.value.id
    await catalogAPI.delWorkflow(id)
    await load()
    current.value = null
    if (workflows.value.some(w => w.id === id)) await select(id)
  } catch (e) { toastError(e) }
}

onMounted(async () => {
  models.loadModels()
  await load()
  const want = String(route.query.workflow || '')
  const first = workflows.value.find(w => w.id === want) || workflows.value[0]
  if (first) select(first.id)
})
onBeforeUnmount(stop)
</script>

<style scoped>
.wf-body { flex: 1; overflow-y: auto; padding: 18px 24px 32px; display: flex; flex-direction: column; gap: 16px; }
.wf-inputs { display: flex; flex-direction: column; gap: 12px; max-width: 860px; }
.wf-inputs .textarea { resize: vertical; font-size: 13px; }
.req { color: var(--error); margin-left: 2px; }
.wf-run-row { display: flex; gap: 8px; }
.wf-steps { list-style: none; display: flex; flex-direction: column; gap: 10px; max-width: 860px; padding: 0; margin: 0; }
.wf-step {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wf-step.running { border-color: var(--accent); }
.wf-step.error { border-color: var(--error); }
.wf-step-head { display: flex; align-items: center; gap: 10px; }
.wf-step-no {
  width: 22px; height: 22px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11.5px; font-weight: 600;
  background: var(--bg-2); color: var(--text-2); flex-shrink: 0;
}
.wf-step.done .wf-step-no { background: var(--success-bg); color: var(--success); }
.wf-step.error .wf-step-no { background: var(--error-bg); color: var(--error); }
.wf-step.running .wf-step-no { background: var(--accent-bg); color: var(--accent-text); }
.wf-step-name { font-size: 13px; font-weight: 600; color: var(--text-0); }
.wf-step-agent { font-size: 11.5px; color: var(--text-3); }
.wf-step-tools { margin-left: auto; display: flex; gap: 2px; }
.wf-output { resize: vertical; font-size: 12.5px; line-height: 1.65; min-height: 96px; }
.wf-error { font-size: 12px; color: var(--error); white-space: pre-wrap; }
@media (max-width: 760px) {
  .wf-body { padding: 14px 16px 24px; }
}
</style>
