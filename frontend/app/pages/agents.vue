<template>
  <div class="cat-page">
    <aside class="cat-side">
      <div class="cat-side-head">
        <div class="cat-side-title">
          <h1>{{ t('catalog.agents.title') }}</h1>
          <button class="btn btn-sm" @click="openEditor(null)">
            <Plus :size="13" :stroke-width="2" />{{ t('catalog.common.new') }}
          </button>
        </div>
        <p class="cat-side-sub">{{ t('catalog.agents.sub') }}</p>
        <input v-model.trim="keyword" class="input cat-search" :placeholder="t('catalog.common.search')" />
      </div>
      <div class="cat-list">
        <template v-for="g in groups" :key="g.category">
          <div class="cat-group-label">{{ g.category }}</div>
          <button
            v-for="a in g.items"
            :key="a.id"
            type="button"
            class="cat-item"
            :class="{ on: current?.id === a.id }"
            @click="select(a.id)"
          >
            <span class="cat-item-name">{{ a.name }}<span v-if="!a.builtin" class="cat-badge">{{ t('catalog.common.mine') }}</span></span>
            <span v-if="a.description" class="cat-item-desc">{{ a.description }}</span>
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
              <span v-for="s in current.skill_details || []" :key="s.id" class="tag" :class="s.missing ? 'tag-warning' : 'tag-info'" :title="s.description">
                {{ t('catalog.agents.skill') }} · {{ s.name }}
              </span>
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
            <button class="btn btn-sm cine-btn" :class="{ on: cineOn }" :title="t('cinematic.descChat')" @click="cineOpen = true">
              <Clapperboard :size="13" />{{ cineOn ? t('cinematic.on') : t('cinematic.off') }}
            </button>
            <select v-if="sessions.length" class="input sp-session-select" :value="studio.session.value?.id || ''" :title="t('studio.history')" @change="openSession(Number($event.target.value) || null)">
              <option value="">{{ t('studio.newSession') }}</option>
              <option v-for="s in sessions" :key="s.id" :value="s.id">{{ s.title }}{{ s.running ? ' ⏳' : '' }}</option>
            </select>
            <button class="btn btn-sm" :disabled="!studio.session.value" @click="openSession(null)"><Plus :size="12" />{{ t('studio.newSession') }}</button>
            <button v-if="studio.session.value" class="btn btn-sm" :title="t('studio.deleteSession')" @click="removeSession"><Trash2 :size="12" /></button>
            <button class="btn btn-sm" @click="openEditor(current)">{{ current.builtin ? t('catalog.common.customize') : t('catalog.common.edit') }}</button>
            <button v-if="!current.builtin" class="btn btn-sm btn-danger" @click="removeCurrent">{{ t('common.delete') }}</button>
          </div>
        </div>

        <StudioPanel
          :session="studio.session.value"
          :starters="current.starters"
          :welcome="t('studio.agentWelcome', { name: current.name })"
          :placeholder="t('catalog.agents.placeholder')"
          :extra-body="runBody"
          :create-session="createSession"
          handoff
          @update="onSessionUpdate"
          @handoff="text => { handoffText = text; handoffOpen = true }"
        />
      </template>
      <div v-else class="cat-empty">
        <Bot :size="28" :stroke-width="1.4" />
        <p>{{ loading ? t('common.loading') : t('catalog.agents.pick') }}</p>
      </div>
    </section>

    <!-- 编辑 / 新建智能体 -->
    <Teleport to="body">
      <div v-if="editor.open" class="overlay" @click.self="editor.open = false">
        <form class="dialog cat-editor" @submit.prevent="saveEditor">
          <div class="dialog-head">
            <h2 class="dialog-title">{{ editor.isNew ? t('catalog.agents.newTitle') : t('catalog.agents.editTitle') }}</h2>
          </div>
          <div class="dialog-body">
            <p v-if="editor.fromBuiltin" class="cat-field-hint">{{ t('catalog.common.overrideHint') }}</p>
            <div class="cat-editor-grid">
              <label class="cat-field">
                <span class="cat-field-label">{{ t('catalog.common.name') }}</span>
                <input v-model="editor.form.name" class="input" required />
              </label>
              <label class="cat-field">
                <span class="cat-field-label">ID</span>
                <input v-model.trim="editor.form.id" class="input cat-mono" :disabled="!editor.isNew" pattern="[a-z0-9][a-z0-9\-]*" required />
              </label>
              <label class="cat-field">
                <span class="cat-field-label">{{ t('catalog.common.category') }}</span>
                <input v-model="editor.form.category" class="input" />
              </label>
              <label class="cat-field">
                <span class="cat-field-label">{{ t('catalog.common.description') }}</span>
                <input v-model="editor.form.description" class="input" />
              </label>
            </div>
            <div v-if="skills.length" class="cat-field">
              <span class="cat-field-label">Skill</span>
              <div class="cat-check-row">
                <label v-for="s in skills" :key="s.id" class="cat-check" :title="s.description">
                  <input v-model="editor.form.skills" type="checkbox" :value="s.id" />{{ s.name }}
                </label>
              </div>
            </div>
            <label class="cat-field">
              <span class="cat-field-label">{{ t('catalog.agents.instructions') }}</span>
              <textarea v-model="editor.form.instructions" class="textarea cat-mono" rows="12" required></textarea>
            </label>
            <label class="cat-field">
              <span class="cat-field-label">{{ t('catalog.agents.starters') }}</span>
              <textarea v-model="editor.form.startersText" class="textarea" rows="3"></textarea>
              <span class="cat-field-hint">{{ t('catalog.agents.startersHint') }}</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="editor.open = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="editor.saving">{{ t('common.save') }}</button>
          </div>
        </form>
      </div>
    </Teleport>

    <HandoffDialog :open="handoffOpen" :content="handoffText" :cinematic="cineOn ? cine : null" @close="handoffOpen = false" />
    <CinematicDialog :open="cineOpen" mode="chat" :value="cine" :model-body="models.modelBody" @close="cineOpen = false" @saved="onCineSaved" />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Plus, Clapperboard, Bot, Trash2 } from 'lucide-vue-next'
import { toastError } from '~/composables/useToast'
import { catalogAPI, useTextModelPick, groupByCategory } from '~/composables/useCatalog'
import ModelSelect from '~/components/ModelSelect.vue'
import StudioPanel from '~/components/StudioPanel.vue'
import { studioAPI, useStudioSession } from '~/composables/useStudio'
import HandoffDialog from '~/components/HandoffDialog.vue'
import CinematicDialog from '~/components/CinematicDialog.vue'
import { loadChatCinematic, saveChatCinematic, cinematicFilledCount, cinematicBody } from '~/composables/useCinematic'
import '~/assets/catalog.css'

const { t } = useI18n()
const route = useRoute()

const agents = ref([])
const skills = ref([])
const loading = ref(true)
const keyword = ref('')
const current = ref(null)
const handoffOpen = ref(false)
const handoffText = ref('')
const models = useTextModelPick()
const studio = useStudioSession()
const sessions = ref([])

// ── 影像参数（智能体 / 工作流共用一份，存在浏览器本地） ──
const cine = ref(loadChatCinematic())
const cineOpen = ref(false)
const cineOn = computed(() => !!cine.value?.enabled && cinematicFilledCount(cine.value) > 0)
function onCineSaved(spec) { cine.value = spec; saveChatCinematic(spec) }

const SESSION_KEY = id => `uu889:agent-session:${id}`

const groups = computed(() => {
  const k = keyword.value.toLowerCase()
  const list = agents.value.filter(a => !k || [a.name, a.description, a.category].join(' ').toLowerCase().includes(k))
  return groupByCategory(list, t('catalog.common.other'))
})

async function load() {
  loading.value = true
  try {
    const [a, s] = await Promise.all([catalogAPI.agents(), catalogAPI.skills()])
    agents.value = a || []
    skills.value = s || []
  } catch (e) { toastError(e) } finally { loading.value = false }
}

async function loadSessions() {
  if (!current.value) return
  try { sessions.value = (await studioAPI.list('agent', current.value.id)) || [] } catch { sessions.value = [] }
}

async function select(id) {
  try {
    current.value = await catalogAPI.agent(id)
    if (route.query.agent !== id) navigateTo({ query: { agent: id } }, { replace: true })
    await loadSessions()
    let last = null
    try { last = Number(localStorage.getItem(SESSION_KEY(id))) || null } catch { /* 忽略 */ }
    await openSession(last && sessions.value.some(s => s.id === last) ? last : null)
  } catch (e) { toastError(e) }
}

async function openSession(id) {
  try {
    await studio.open(id)
    if (current.value) {
      try { id ? localStorage.setItem(SESSION_KEY(current.value.id), String(id)) : localStorage.removeItem(SESSION_KEY(current.value.id)) } catch { /* 忽略 */ }
    }
  } catch (e) { toastError(e) }
}

function runBody() {
  return { ...models.modelBody(), ...cinematicBody(cine.value) }
}

async function createSession(text, settings, styleId) {
  const s = await studioAPI.create({
    kind: 'agent',
    ref_id: current.value.id,
    title: text ? text.split('\n')[0].slice(0, 30) : current.value.name,
    settings,
    style_id: styleId || undefined,
    message: text || undefined,
    ...runBody(),
  })
  try { localStorage.setItem(SESSION_KEY(current.value.id), String(s.id)) } catch { /* 忽略 */ }
  loadSessions()
  return s
}

function onSessionUpdate(s) {
  studio.set(s)
  const row = sessions.value.find(x => x.id === s.id)
  if (row) { row.title = s.title; row.running = s.running } else loadSessions()
}

async function removeSession() {
  const s = studio.session.value
  if (!s || !confirm(t('studio.deleteSessionConfirm', { name: s.title }))) return
  try {
    await studioAPI.remove(s.id)
    await loadSessions()
    await openSession(null)
  } catch (e) { toastError(e) }
}

// ── 编辑器 ──
const editor = reactive({ open: false, isNew: false, fromBuiltin: false, saving: false, form: {} })
function openEditor(a) {
  editor.isNew = !a
  editor.fromBuiltin = !!a?.builtin
  editor.form = a
    ? { id: a.id, name: a.name, description: a.description, category: a.category, skills: [...(a.skills || [])], instructions: a.instructions, startersText: (a.starters || []).join('\n') }
    : { id: '', name: '', description: '', category: t('catalog.common.mine'), skills: [], instructions: '', startersText: '' }
  editor.open = true
}
async function saveEditor() {
  editor.saving = true
  try {
    const f = editor.form
    const saved = await catalogAPI.saveAgent(f.id, {
      name: f.name, description: f.description, category: f.category, skills: f.skills, instructions: f.instructions,
      starters: String(f.startersText || '').split('\n').map(s => s.trim()).filter(Boolean),
    })
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
    await catalogAPI.delAgent(id)
    await load()
    current.value = null
    if (agents.value.some(a => a.id === id)) await select(id)
  } catch (e) { toastError(e) }
}

onMounted(async () => {
  models.loadModels()
  await load()
  const want = String(route.query.agent || '')
  const first = agents.value.find(a => a.id === want) || agents.value[0]
  if (first) select(first.id)
})
</script>

<style scoped>
.cat-main { overflow: hidden; }
.sp-session-select { height: var(--button-height-sm, 30px); padding: 0 8px; font-size: 12px; width: auto; max-width: 200px; }
</style>
