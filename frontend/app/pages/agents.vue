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
            <button class="btn btn-sm" :disabled="!messages.length || running" @click="clearChat">{{ t('catalog.agents.clear') }}</button>
            <button class="btn btn-sm" @click="openEditor(current)">{{ current.builtin ? t('catalog.common.customize') : t('catalog.common.edit') }}</button>
            <button v-if="!current.builtin" class="btn btn-sm btn-danger" @click="removeCurrent">{{ t('common.delete') }}</button>
          </div>
        </div>

        <div ref="scrollEl" class="chat-scroll">
          <div v-if="!messages.length" class="chat-welcome">
            <MessagesSquare :size="26" :stroke-width="1.4" />
            <p>{{ t('catalog.agents.welcome', { name: current.name }) }}</p>
            <div v-if="current.starters?.length" class="starter-row">
              <button v-for="s in current.starters" :key="s" class="starter" @click="send(s)">{{ s }}</button>
            </div>
          </div>
          <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
            <div class="msg-bubble">{{ m.content }}<span v-if="running && i === messages.length - 1 && m.role === 'assistant'" class="caret"></span></div>
            <div v-if="m.role === 'assistant' && m.content && !(running && i === messages.length - 1)" class="msg-tools">
              <button class="btn btn-ghost btn-sm" @click="copy(m.content)"><Copy :size="12" />{{ t('catalog.common.copy') }}</button>
              <button class="btn btn-ghost btn-sm" @click="handoffText = m.content; handoffOpen = true"><Clapperboard :size="12" />{{ t('catalog.handoff.button') }}</button>
            </div>
          </div>
        </div>

        <form class="chat-input" @submit.prevent="send(draft)">
          <textarea
            v-model="draft"
            class="textarea"
            rows="3"
            :placeholder="t('catalog.agents.placeholder')"
            @keydown.enter.exact.prevent="send(draft)"
          ></textarea>
          <div class="chat-input-foot">
            <span class="cat-field-hint">{{ t('catalog.agents.enterHint') }}</span>
            <button v-if="running" type="button" class="btn" @click="stop"><Square :size="12" />{{ t('catalog.common.stop') }}</button>
            <button v-else type="submit" class="btn btn-primary" :disabled="!draft.trim()"><Send :size="13" />{{ t('catalog.agents.send') }}</button>
          </div>
        </form>
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
import { Plus, Send, Square, Copy, Clapperboard, Bot, MessagesSquare } from 'lucide-vue-next'
import { toastError } from '~/composables/useToast'
import { catalogAPI, postSse, useTextModelPick, groupByCategory } from '~/composables/useCatalog'
import ModelSelect from '~/components/ModelSelect.vue'
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
const messages = ref([])
const draft = ref('')
const running = ref(false)
const scrollEl = ref(null)
const handoffOpen = ref(false)
const handoffText = ref('')
let abort = null
const models = useTextModelPick()

// ── 影像参数（智能体 / 工作流共用一份，存在浏览器本地） ──
const cine = ref(loadChatCinematic())
const cineOpen = ref(false)
const cineOn = computed(() => !!cine.value?.enabled && cinematicFilledCount(cine.value) > 0)
function onCineSaved(spec) { cine.value = spec; saveChatCinematic(spec) }

const CHAT_KEY = id => `uu889:agent-chat:${id}`
function loadChat(id) {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY(id)) || '[]') } catch { return [] }
}
function saveChat() {
  if (!current.value) return
  try { localStorage.setItem(CHAT_KEY(current.value.id), JSON.stringify(messages.value.slice(-40))) } catch { /* 忽略 */ }
}

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

async function select(id) {
  if (running.value) stop()
  try {
    current.value = await catalogAPI.agent(id)
    messages.value = loadChat(id)
    draft.value = ''
    if (route.query.agent !== id) navigateTo({ query: { agent: id } }, { replace: true })
    scrollBottom()
  } catch (e) { toastError(e) }
}

function scrollBottom() {
  nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight })
}

async function send(text) {
  const content = String(text || '').trim()
  if (!content || running.value || !current.value) return
  draft.value = ''
  messages.value.push({ role: 'user', content })
  const reply = reactive({ role: 'assistant', content: '' })
  messages.value.push(reply)
  scrollBottom()
  running.value = true
  const controller = new AbortController()
  abort = controller
  try {
    await postSse(`/catalog/agents/${current.value.id}/chat`, {
      messages: messages.value.slice(0, -1),
      ...models.modelBody(),
      ...cinematicBody(cine.value),
    }, (event, data) => {
      if (event === 'delta' && data?.text) { reply.content += data.text; scrollBottom() }
      else if (event === 'done') reply.content = data?.text || reply.content
      else if (event === 'error') throw new Error(data?.message || 'error')
    }, controller.signal)
    if (!reply.content.trim()) throw new Error(t('catalog.common.emptyOutput'))
  } catch (e) {
    if (e?.name !== 'AbortError') {
      toastError(e)
      if (!reply.content.trim()) messages.value.splice(messages.value.indexOf(reply), 1)
    }
  } finally {
    running.value = false
    abort = null
    saveChat()
  }
}

function stop() { abort?.abort() }
function clearChat() { messages.value = []; saveChat() }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast.success(t('catalog.common.copied')) } catch (e) { toastError(e) }
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
onBeforeUnmount(stop)
</script>

<style scoped>
.chat-scroll { flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.chat-welcome { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-3); text-align: center; max-width: 560px; }
.chat-welcome p { font-size: 13px; }
.starter-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
.starter {
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-1);
  border-radius: var(--radius-pill);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  text-align: left;
}
.starter:hover { border-color: var(--border-hover); background: var(--bg-hover); }
.msg { display: flex; flex-direction: column; gap: 4px; max-width: 860px; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.assistant { align-self: flex-start; }
.msg-bubble {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.7;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-0);
}
.msg.user .msg-bubble { background: var(--accent-bg); border-color: transparent; }
.msg-tools { display: flex; gap: 4px; }
.caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; background: var(--text-2); vertical-align: -2px; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.chat-input { border-top: 1px solid var(--border); padding: 12px 24px 16px; display: flex; flex-direction: column; gap: 8px; }
.chat-input .textarea { resize: vertical; min-height: 64px; font-size: 13px; }
.chat-input-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.chat-input-foot .cat-field-hint { margin-right: auto; }
@media (max-width: 760px) {
  .chat-scroll, .chat-input { padding-left: 16px; padding-right: 16px; }
}
</style>
