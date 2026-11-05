<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="close">
      <div class="dialog cine-dialog">
        <div class="dialog-head cine-head">
          <div class="cine-head-copy">
            <h2 class="dialog-title"><Clapperboard :size="16" />{{ t('cinematic.title') }}</h2>
            <p class="cine-desc">{{ mode === 'project' ? t('cinematic.descProject') : t('cinematic.descChat') }}</p>
          </div>
          <label class="cine-switch" :title="t('cinematic.enableTip')">
            <input v-model="spec.enabled" type="checkbox" />
            <span>{{ spec.enabled ? t('cinematic.enabled') : t('cinematic.disabled') }}</span>
          </label>
        </div>

        <div class="cine-toolbar">
          <BaseSelect
            v-model="presetPick"
            class="cine-preset-select"
            :options="presetOptions"
            :placeholder="t('cinematic.loadPreset')"
            searchable
            @update:model-value="applyPreset"
          />
          <button class="btn btn-sm" :disabled="!!aiBusy" @click="generate(null)">
            <Loader2 v-if="aiBusy === 'all'" :size="13" class="animate-spin" /><Sparkles v-else :size="13" />{{ t('cinematic.aiAll') }}
          </button>
          <button class="btn btn-sm" @click="savePresetOpen = true"><Save :size="13" />{{ t('cinematic.saveAsPreset') }}</button>
          <button class="btn btn-sm" @click="copyPrompt"><Copy :size="13" />{{ t('cinematic.copyPrompt') }}</button>
          <button v-if="selectedPresetMine" class="btn btn-sm btn-danger" @click="deletePreset">{{ t('cinematic.deletePreset') }}</button>
        </div>
        <div v-if="mode !== 'project' || showSource" class="cine-source">
          <textarea v-model="source" class="textarea" rows="2" :placeholder="mode === 'project' ? t('cinematic.sourceProject') : t('cinematic.sourceChat')"></textarea>
        </div>
        <button v-else type="button" class="cine-source-toggle" @click="showSource = true">{{ t('cinematic.sourceToggle') }}</button>

        <nav class="cine-tabs">
          <button v-for="tab in TABS" :key="tab" type="button" class="cine-tab" :class="{ on: active === tab }" @click="active = tab">
            {{ t(`cinematic.tabs.${tab}`) }}<span v-if="tabCount(tab)" class="cine-tab-dot">{{ tabCount(tab) }}</span>
          </button>
        </nav>

        <div class="dialog-body cine-body">
          <div v-if="!opts" class="dim">{{ t('common.loading') }}</div>

          <!-- 全局视觉与硬件底座 -->
          <section v-else-if="active === 'visual'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'visual'" :hint="t('cinematic.hint.visual')" @ai="generate('visual')" />
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.styleAnchor') }}</span>
              <CineChips v-model="spec.visual.style_ids" :options="opts.styleAnchors" :max="4" />
              <input v-model="spec.visual.style_anchor" class="input" :placeholder="t('cinematic.ph.styleAnchor')" />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.camera') }}</span>
              <CineChips v-model="spec.visual.camera_ids" :options="opts.cameras" :max="4" show-effects />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.lens') }}</span>
              <CineChips v-model="spec.visual.lens_ids" :options="opts.lenses" :max="4" show-effects />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.focal') }}</span>
              <CineChips v-model="spec.visual.focal_ids" :options="opts.focalLengths" :max="4" show-effects />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.film') }}</span>
              <CineChips v-model="spec.visual.film_ids" :options="opts.filmStocks" :max="4" show-effects />
              <textarea v-model="spec.visual.camera_notes" class="textarea" rows="2" :placeholder="t('cinematic.ph.cameraNotes')"></textarea>
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.aspect') }}</span>
              <CineChips v-model="spec.visual.aspect_id" :options="opts.aspectRatios" :multiple="false" show-effects />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.palette') }}</span>
              <div class="cine-palette-presets">
                <button
                  v-for="p in opts.palettes"
                  :key="p.id"
                  type="button"
                  class="cine-palette-preset"
                  :class="{ on: spec.visual.palette_id === p.id }"
                  :title="p.desc"
                  @click="usePalette(p)"
                >
                  <span class="cine-swatches"><i v-for="c in p.colors" :key="c.hex" :style="{ background: c.hex, flexGrow: c.percent }"></i></span>
                  {{ p.label }}
                </button>
              </div>
              <div class="cine-palette-bar" v-if="spec.visual.palette.length">
                <i v-for="(c, i) in spec.visual.palette" :key="i" :style="{ background: c.hex || '#888', flexGrow: c.percent || 1 }" :title="`${c.percent}% ${c.name}`"></i>
              </div>
              <div v-for="(c, i) in spec.visual.palette" :key="i" class="cine-color-row">
                <input v-model="c.hex" type="color" class="cine-color" @input="spec.visual.palette_id = ''" />
                <input v-model="c.hex" class="input cine-hex" maxlength="7" @input="spec.visual.palette_id = ''" />
                <input v-model="c.name" class="input" :placeholder="t('cinematic.ph.colorName')" @input="spec.visual.palette_id = ''" />
                <input v-model.number="c.percent" type="number" min="0" max="100" class="input cine-pct" @input="spec.visual.palette_id = ''" /><span class="dim">%</span>
                <button type="button" class="btn btn-ghost btn-sm" @click="spec.visual.palette.splice(i, 1)"><X :size="13" /></button>
              </div>
              <div class="cine-row-actions">
                <button v-if="spec.visual.palette.length < 6" type="button" class="btn btn-sm" @click="spec.visual.palette.push({ name: '', hex: '#888888', percent: 10 })"><Plus :size="13" />{{ t('cinematic.addColor') }}</button>
                <span v-if="spec.visual.palette.length" class="cine-hint" :class="{ warn: paletteTotal !== 100 }">{{ t('cinematic.paletteTotal', { n: paletteTotal }) }}</span>
              </div>
              <input v-model="spec.visual.tone_notes" class="input" :placeholder="t('cinematic.ph.toneNotes')" />
            </div>
          </section>

          <!-- 核心人物锚定 -->
          <section v-else-if="active === 'characters'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'characters'" :hint="t('cinematic.hint.characters')" @ai="generate('characters')">
              <button v-if="mode === 'project'" type="button" class="btn btn-sm" @click="importProjectCharacters"><Users :size="13" />{{ t('cinematic.importChars') }}</button>
            </SectionHead>
            <div v-for="(c, i) in spec.characters" :key="c.id" class="cine-card">
              <div class="cine-card-media">
                <MediaSlot :url="c.image_url" :label="t('cinematic.refImage')" @upload="f => uploadImage(f, url => c.image_url = url)" @clear="c.image_url = ''" />
                <div class="cine-voice">
                  <label class="btn btn-sm cine-upload">
                    <Mic :size="13" />{{ c.voice_url ? t('cinematic.voiceReplace') : t('cinematic.voiceUpload') }}
                    <input type="file" accept=".mp3,.wav,.m4a,.aac,audio/*" hidden @change="e => uploadVoice(e, c)" />
                  </label>
                  <audio v-if="c.voice_url" :src="c.voice_url" controls class="cine-audio"></audio>
                  <input v-model="c.voice_ref" class="input input-sm" :placeholder="t('cinematic.ph.voiceRef')" />
                </div>
              </div>
              <div class="cine-card-fields">
                <div class="cine-grid">
                  <label class="cine-mini"><span>{{ t('cinematic.f.name') }}</span><input v-model="c.name" class="input" /></label>
                  <PickInput v-model="c.gender" :label="t('cinematic.f.gender')" :picks="opts.characterPicks.gender" />
                  <PickInput v-model="c.age" :label="t('cinematic.f.age')" :picks="opts.characterPicks.age" />
                  <PickInput v-model="c.style" :label="t('cinematic.f.charStyle')" :picks="opts.characterPicks.style" />
                  <PickInput v-model="c.face" :label="t('cinematic.f.face')" :picks="opts.characterPicks.face" />
                  <PickInput v-model="c.hair" :label="t('cinematic.f.hair')" :picks="opts.characterPicks.hair" />
                </div>
                <PickInput v-model="c.outfit" :label="t('cinematic.f.outfit')" :picks="opts.characterPicks.outfit" append />
                <label class="cine-mini"><span>{{ t('cinematic.f.accessories') }}</span><input v-model="c.accessories" class="input" :placeholder="t('cinematic.ph.accessories')" /></label>
                <label class="cine-mini"><span>{{ t('cinematic.f.details') }}</span><textarea v-model="c.details" class="textarea" rows="2" :placeholder="t('cinematic.ph.details')"></textarea></label>
              </div>
              <button type="button" class="btn btn-ghost btn-sm cine-del" :title="t('common.delete')" @click="spec.characters.splice(i, 1)"><Trash2 :size="14" /></button>
            </div>
            <button type="button" class="btn btn-sm" @click="addCharacter"><Plus :size="13" />{{ t('cinematic.addCharacter') }}</button>
          </section>

          <!-- 三维场景与空间逻辑锚定 -->
          <section v-else-if="active === 'scene'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'scene'" :hint="t('cinematic.hint.scene')" @ai="generate('scene')" />
            <div class="cine-card cine-card-flat">
              <div class="cine-card-media">
                <MediaSlot :url="spec.scene.image_url" :label="t('cinematic.sceneImage')" wide @upload="f => uploadImage(f, url => spec.scene.image_url = url)" @clear="spec.scene.image_url = ''" />
              </div>
              <div class="cine-card-fields">
                <label class="cine-mini"><span>{{ t('cinematic.f.sceneName') }}</span><input v-model="spec.scene.name" class="input" :placeholder="t('cinematic.ph.sceneName')" /></label>
                <label class="cine-mini"><span>{{ t('cinematic.f.environment') }}</span><textarea v-model="spec.scene.environment" class="textarea" rows="3" :placeholder="t('cinematic.ph.environment')"></textarea></label>
              </div>
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.zones') }}</span>
              <div v-for="(z, i) in spec.scene.zones" :key="i" class="cine-zone">
                <input v-model="z.area" class="input cine-zone-area" :placeholder="t('cinematic.ph.zoneArea')" list="cine-zone-areas" />
                <textarea v-model="z.content" class="textarea" rows="2" :placeholder="t('cinematic.ph.zoneContent')"></textarea>
                <button type="button" class="btn btn-ghost btn-sm" @click="spec.scene.zones.splice(i, 1)"><X :size="13" /></button>
              </div>
              <datalist id="cine-zone-areas">
                <option v-for="a in ZONE_AREAS" :key="a" :value="a" />
              </datalist>
              <div class="cine-row-actions">
                <button type="button" class="btn btn-sm" @click="spec.scene.zones.push({ area: '', content: '' })"><Plus :size="13" />{{ t('cinematic.addZone') }}</button>
              </div>
            </div>
            <label class="cine-mini"><span>{{ t('cinematic.f.surroundings') }}</span><input v-model="spec.scene.surroundings" class="input" :placeholder="t('cinematic.ph.surroundings')" /></label>
          </section>

          <!-- 关键道具与资产 -->
          <section v-else-if="active === 'props'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'props'" :hint="t('cinematic.hint.props')" @ai="generate('props')" />
            <div v-for="(p, i) in spec.props" :key="p.id" class="cine-card">
              <div class="cine-card-media">
                <MediaSlot :url="p.image_url" :label="t('cinematic.refImage')" @upload="f => uploadImage(f, url => p.image_url = url)" @clear="p.image_url = ''" />
              </div>
              <div class="cine-card-fields">
                <label class="cine-mini"><span>{{ t('cinematic.f.propName') }}</span><input v-model="p.name" class="input" /></label>
                <label class="cine-mini"><span>{{ t('cinematic.f.propDesc') }}</span><textarea v-model="p.description" class="textarea" rows="2" :placeholder="t('cinematic.ph.propDesc')"></textarea></label>
                <label class="cine-mini"><span>{{ t('cinematic.f.placement') }}</span><input v-model="p.placement" class="input" :placeholder="t('cinematic.ph.placement')" /></label>
              </div>
              <button type="button" class="btn btn-ghost btn-sm cine-del" :title="t('common.delete')" @click="spec.props.splice(i, 1)"><Trash2 :size="14" /></button>
            </div>
            <button type="button" class="btn btn-sm" @click="spec.props.push({ id: newRowId('p'), name: '', description: '', placement: '', image_url: '' })"><Plus :size="13" />{{ t('cinematic.addProp') }}</button>
          </section>

          <!-- 面部明暗与立体塑造 -->
          <section v-else-if="active === 'lighting'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'lighting'" :hint="t('cinematic.hint.lighting')" @ai="generate('lighting')" />
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.keyLight') }}</span>
              <CineChips v-model="spec.lighting.key_light_id" :options="opts.keyLights" :multiple="false" show-effects />
              <input v-model="spec.lighting.key_light" class="input" :placeholder="t('cinematic.ph.keyLight')" />
            </div>
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.ratio') }}</span>
              <CineChips v-model="spec.lighting.ratio_id" :options="opts.lightRatios" :multiple="false" show-effects />
            </div>
            <SnippetField v-model="spec.lighting.terminator" :label="t('cinematic.f.terminator')" :snippets="opts.lightingSnippets.terminator" />
            <SnippetField v-model="spec.lighting.fill" :label="t('cinematic.f.fill')" :snippets="opts.lightingSnippets.fill" />
            <SnippetField v-model="spec.lighting.dynamic" :label="t('cinematic.f.dynamic')" :snippets="opts.lightingSnippets.dynamic" />
            <SnippetField v-model="spec.lighting.materials" :label="t('cinematic.f.materials')" :snippets="opts.lightingSnippets.materials" />
            <div class="cine-field">
              <span class="cine-label">{{ t('cinematic.f.constraints') }}</span>
              <CineChips v-model="spec.lighting.constraint_ids" :options="opts.techConstraints" />
              <input v-model="spec.lighting.constraints" class="input" :placeholder="t('cinematic.ph.constraints')" />
            </div>
          </section>

          <!-- 动态时间戳分镜剧本 -->
          <section v-else-if="active === 'storyboard'" class="cine-sec">
            <SectionHead :busy="aiBusy === 'storyboard'" :hint="t('cinematic.hint.storyboard')" @ai="generate('storyboard')" />
            <label class="cine-switch cine-switch-inline">
              <input v-model="spec.storyboard.enabled" type="checkbox" />
              <span>{{ t('cinematic.sbEnable') }}</span>
            </label>
            <pre class="cine-format">{{ t('cinematic.sbFormat') }}</pre>
            <label class="cine-mini cine-seg">
              <span>{{ t('cinematic.f.segment') }}</span>
              <input v-model.number="spec.storyboard.segment_seconds" type="number" min="0" max="15" step="0.5" class="input" />
              <span class="cine-hint">{{ t('cinematic.segmentHint') }}</span>
            </label>
            <div v-for="row in SB_ROWS" :key="row.key" class="cine-field">
              <span class="cine-label">{{ t(`cinematic.f.${row.label}`) }}</span>
              <CineChips v-model="spec.storyboard[row.key]" :options="opts[row.opts]" />
            </div>
            <label class="cine-mini"><span>{{ t('cinematic.f.sound') }}</span><input v-model="spec.storyboard.sound" class="input" :placeholder="t('cinematic.ph.sound')" list="cine-sound" /></label>
            <datalist id="cine-sound">
              <option v-for="s in SOUND_PICKS" :key="s" :value="s" />
            </datalist>
            <label class="cine-mini"><span>{{ t('cinematic.f.sbNotes') }}</span><textarea v-model="spec.storyboard.notes" class="textarea" rows="2" :placeholder="t('cinematic.ph.sbNotes')"></textarea></label>
          </section>

          <!-- 预览 -->
          <section v-else-if="active === 'preview'" class="cine-sec">
            <p class="cine-hint">{{ mode === 'project' ? t('cinematic.previewProject') : t('cinematic.previewChat') }}</p>
            <pre class="cine-preview">{{ previewText || t('cinematic.previewEmpty') }}</pre>
          </section>
        </div>

        <div class="dialog-foot">
          <button v-if="mode === 'project'" type="button" class="btn cine-apply" :disabled="saving" :title="t('cinematic.applyTip')" @click="save(true)">
            <RefreshCcw :size="13" />{{ t('cinematic.apply') }}
          </button>
          <button type="button" class="btn" @click="close">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn-primary" :disabled="saving" @click="save(false)">
            <Loader2 v-if="saving" :size="13" class="animate-spin" />{{ t('common.save') }}
          </button>
        </div>
      </div>

      <!-- 另存为预设 -->
      <div v-if="savePresetOpen" class="overlay" @click.self="savePresetOpen = false">
        <form class="dialog cine-preset-dialog" @submit.prevent="savePreset">
          <div class="dialog-head"><h2 class="dialog-title">{{ t('cinematic.saveAsPreset') }}</h2></div>
          <div class="dialog-body cine-sec">
            <label class="cine-mini"><span>{{ t('catalog.common.name') }}</span><input v-model="presetForm.name" class="input" required /></label>
            <label class="cine-mini"><span>{{ t('catalog.common.category') }}</span><input v-model="presetForm.category" class="input" /></label>
            <label class="cine-mini"><span>{{ t('catalog.common.description') }}</span><input v-model="presetForm.description" class="input" /></label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="savePresetOpen = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary">{{ t('common.save') }}</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { h } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Clapperboard, Sparkles, Save, Copy, Plus, X, Trash2, Loader2, Users, Mic, RefreshCcw, ImagePlus } from 'lucide-vue-next'
import { dramaAPI, uploadAPI } from '~/composables/useApi'
import { cinematicAPI, emptyCinematicSpec, fillCinematicSpec, cinematicFilledCount, newRowId } from '~/composables/useCinematic'
import { toastError } from '~/composables/useToast'
import BaseSelect from '~/components/BaseSelect.vue'
import CineChips from '~/components/CineChips.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** project：一键生成项目（保存到项目）；chat：智能体 / 工作流（保存在本地） */
  mode: { type: String, default: 'chat' },
  dramaId: { type: Number, default: 0 },
  /** chat 模式的初始参数 */
  value: { type: Object, default: null },
  /** 文字模型（{ model, config_id }） */
  modelBody: { type: Function, default: () => ({}) },
})
const emit = defineEmits(['close', 'saved'])
const { t } = useI18n()

const TABS = ['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard', 'preview']
const SB_ROWS = [
  { key: 'shot_size_ids', opts: 'shotSizes', label: 'shotSizes' },
  { key: 'angle_ids', opts: 'cameraAngles', label: 'angles' },
  { key: 'layer_ids', opts: 'compositionLayers', label: 'layers' },
  { key: 'technique_ids', opts: 'compositionTechniques', label: 'techniques' },
  { key: 'move_ids', opts: 'cameraMoves', label: 'moves' },
  { key: 'performance_ids', opts: 'microPerformances', label: 'performances' },
  { key: 'atmosphere_ids', opts: 'atmosphereDetails', label: 'atmosphere' },
]
const ZONE_AREAS = ['船头侧（靠前）', '船中', '船尾侧', '画面左侧', '画面中央', '画面右侧', '前景', '中景', '背景', '门口', '窗边', '桌前', '主位', '客位', '高处', '低处', '室内', '室外']
const SOUND_PICKS = ['不需要配乐，不需要背景音乐，不要氛围音，仅保留同期声', '保留环境音与同期声，不要配乐', '轻柔弦乐铺底，台词清晰', '紧张的低频鼓点', '只有风声与水声']

const opts = ref(null)
const spec = ref(emptyCinematicSpec())
const active = ref('visual')
const aiBusy = ref('')
const saving = ref(false)
const presets = ref([])
const presetPick = ref('')
const source = ref('')
const showSource = ref(false)
const previewText = ref('')
const savePresetOpen = ref(false)
const presetForm = ref({ name: '', category: '', description: '' })

const SOURCE_KEY = 'uu889:cinematic:source'

const presetOptions = computed(() => {
  const groups = new Map()
  for (const p of presets.value) {
    const k = p.builtin ? (p.category || t('catalog.common.other')) : t('catalog.common.mine')
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push({ label: p.name, value: p.id })
  }
  return [...groups.entries()].map(([label, options]) => ({ label, options }))
})
const selectedPresetMine = computed(() => presets.value.some(p => p.id === presetPick.value && !p.builtin))
const paletteTotal = computed(() => spec.value.visual.palette.reduce((s, c) => s + (Number(c.percent) || 0), 0))

function tabCount(tab) {
  const s = spec.value
  switch (tab) {
    case 'characters': return s.characters.length
    case 'props': return s.props.length
    case 'scene': return s.scene.zones.length || (s.scene.environment ? 1 : 0)
    case 'storyboard': return s.storyboard.enabled ? '✓' : 0
    default: return 0
  }
}

watch(() => props.open, async (open) => {
  if (!open) return
  active.value = 'visual'
  presetPick.value = ''
  showSource.value = false
  try { source.value = localStorage.getItem(SOURCE_KEY) || '' } catch { source.value = '' }
  try {
    const [o, p] = await Promise.all([opts.value ? Promise.resolve(opts.value) : cinematicAPI.options(), cinematicAPI.presets()])
    opts.value = o
    presets.value = p || []
    spec.value = fillCinematicSpec(props.mode === 'project' && props.dramaId
      ? await cinematicAPI.getProject(props.dramaId)
      : JSON.parse(JSON.stringify(props.value || emptyCinematicSpec())))
  } catch (e) { toastError(e) }
})

watch(source, v => { try { localStorage.setItem(SOURCE_KEY, v) } catch { /* 忽略 */ } })

watch(active, async (tab) => {
  if (tab !== 'preview') return
  try {
    previewText.value = (await cinematicAPI.render(spec.value, props.mode === 'project' ? 'name' : 'image'))?.text || ''
  } catch (e) { toastError(e) }
})

function close() { emit('close') }

function applyPreset(id) {
  const p = presets.value.find(x => x.id === id)
  if (!p) return
  const next = fillCinematicSpec(JSON.parse(JSON.stringify(p.spec)))
  next.enabled = true
  spec.value = next
  toast.success(t('cinematic.presetLoaded', { name: p.name }))
}

function usePalette(p) {
  spec.value.visual.palette_id = p.id
  spec.value.visual.palette = p.colors.map(c => ({ ...c }))
}

function addCharacter() {
  spec.value.characters.push({ id: newRowId('c'), name: '', gender: '', age: '', face: '', hair: '', style: '', outfit: '', accessories: '', details: '', image_url: '', voice_url: '', voice_ref: '' })
}

async function importProjectCharacters() {
  try {
    const drama = await dramaAPI.get(props.dramaId)
    const have = new Set(spec.value.characters.map(c => c.name))
    let n = 0
    for (const ch of drama?.characters || []) {
      if (!ch.name || have.has(ch.name)) continue
      spec.value.characters.push({
        id: newRowId('c'), name: ch.name, gender: '', age: '', face: '', hair: '', style: '',
        outfit: ch.styling || '', accessories: '', details: ch.appearance || '',
        image_url: ch.image_url || '', voice_url: '', voice_ref: '',
      })
      n++
    }
    toast.success(t('cinematic.imported', { n }))
  } catch (e) { toastError(e) }
}

async function uploadImage(file, set) {
  try {
    const res = await uploadAPI.image(file)
    set(res.url)
  } catch (e) { toastError(e) }
}

async function uploadVoice(e, c) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    const res = await uploadAPI.audio(file)
    c.voice_url = res.url
    if (!c.voice_ref) c.voice_ref = `@${file.name.replace(/\.[a-z0-9]+$/i, '')}`
  } catch (err) { toastError(err) }
}

async function generate(section) {
  if (aiBusy.value) return
  if (props.mode !== 'project' && !source.value.trim()) {
    toast.error(t('cinematic.needSource'))
    return
  }
  aiBusy.value = section || 'all'
  try {
    const next = await cinematicAPI.generate({
      sections: section ? [section] : [],
      text: source.value.trim() || undefined,
      drama_id: props.mode === 'project' ? props.dramaId : undefined,
      spec: spec.value,
      ...props.modelBody(),
    })
    spec.value = fillCinematicSpec(next)
    toast.success(t('cinematic.generated'))
  } catch (e) { toastError(e) } finally { aiBusy.value = '' }
}

async function copyPrompt() {
  try {
    const text = (await cinematicAPI.render(spec.value, 'image'))?.text || ''
    if (!text) return toast.error(t('cinematic.previewEmpty'))
    await navigator.clipboard.writeText(text)
    toast.success(t('catalog.common.copied'))
  } catch (e) { toastError(e) }
}

async function savePreset() {
  const name = presetForm.value.name.trim()
  if (!name) return
  const id = `my-${Date.now().toString(36)}`
  try {
    await cinematicAPI.savePreset(id, { ...presetForm.value, spec: spec.value })
    presets.value = (await cinematicAPI.presets()) || []
    presetPick.value = id
    savePresetOpen.value = false
    presetForm.value = { name: '', category: '', description: '' }
    toast.success(t('catalog.common.saved'))
  } catch (e) { toastError(e) }
}

async function deletePreset() {
  const p = presets.value.find(x => x.id === presetPick.value)
  if (!p || p.builtin || !confirm(t('catalog.common.deleteConfirm', { name: p.name }))) return
  try {
    await cinematicAPI.delPreset(p.id)
    presets.value = (await cinematicAPI.presets()) || []
    presetPick.value = ''
  } catch (e) { toastError(e) }
}

async function save(apply) {
  // 填了内容却没开：保存时自动打开（用户多半是忘了）
  if (!spec.value.enabled && cinematicFilledCount(spec.value)) spec.value.enabled = true
  const clean = {
    ...spec.value,
    characters: spec.value.characters.filter(c => c.name?.trim()),
    props: spec.value.props.filter(p => p.name?.trim()),
  }
  saving.value = true
  try {
    let saved = clean
    if (props.mode === 'project' && props.dramaId) {
      saved = await cinematicAPI.saveProject(props.dramaId, clean)
      if (apply) {
        const r = await cinematicAPI.applyProject(props.dramaId)
        toast.success(t('cinematic.applied', {
          chars: (r.characters_created || 0) + (r.characters_updated || 0),
          scenes: (r.scenes_created || 0) + (r.scenes_updated || 0),
          props: (r.props_created || 0) + (r.props_updated || 0),
        }))
      } else toast.success(t('catalog.common.saved'))
    }
    emit('saved', fillCinematicSpec(saved))
    emit('close')
  } catch (e) { toastError(e) } finally { saving.value = false }
}

// ── 小组件 ──
const SectionHead = defineComponent({
  props: { busy: Boolean, hint: String },
  emits: ['ai'],
  setup(p, { emit: e, slots }) {
    return () => h('div', { class: 'cine-sec-head' }, [
      h('p', { class: 'cine-hint' }, p.hint),
      h('div', { class: 'cine-sec-actions' }, [
        slots.default?.(),
        h('button', { type: 'button', class: 'btn btn-sm', disabled: p.busy, onClick: () => e('ai') }, [
          h(p.busy ? Loader2 : Sparkles, { size: 13, class: p.busy ? 'animate-spin' : '' }),
          t('cinematic.aiSection'),
        ]),
      ]),
    ])
  },
})

const PickInput = defineComponent({
  props: { modelValue: String, label: String, picks: Array, append: Boolean },
  emits: ['update:modelValue'],
  setup(p, { emit: e }) {
    const pick = (v) => {
      if (p.append && p.modelValue) e('update:modelValue', `${p.modelValue}，${v}`)
      else e('update:modelValue', v)
    }
    return () => h('label', { class: 'cine-mini' }, [
      h('span', p.label),
      h('input', { class: 'input', value: p.modelValue, onInput: (ev) => e('update:modelValue', ev.target.value) }),
      p.picks?.length ? h('div', { class: 'cine-picks' }, p.picks.map(v => h('button', {
        type: 'button', class: ['cine-pick', { on: p.modelValue === v }], onClick: () => pick(v),
      }, v))) : null,
    ])
  },
})

const SnippetField = defineComponent({
  props: { modelValue: String, label: String, snippets: Array },
  emits: ['update:modelValue'],
  setup(p, { emit: e }) {
    const add = (v) => e('update:modelValue', p.modelValue ? `${p.modelValue.replace(/[，。；\s]+$/, '')}，${v}` : v)
    return () => h('div', { class: 'cine-field' }, [
      h('span', { class: 'cine-label' }, p.label),
      h('textarea', { class: 'textarea', rows: 2, value: p.modelValue, onInput: (ev) => e('update:modelValue', ev.target.value) }),
      h('div', { class: 'cine-picks' }, (p.snippets || []).map(v => h('button', { type: 'button', class: 'cine-pick', onClick: () => add(v) }, `+ ${v}`))),
    ])
  },
})

const MediaSlot = defineComponent({
  props: { url: String, label: String, wide: Boolean },
  emits: ['upload', 'clear'],
  setup(p, { emit: e }) {
    const onFile = (ev) => {
      const f = ev.target.files?.[0]
      ev.target.value = ''
      if (f) e('upload', f)
    }
    return () => h('div', { class: ['cine-media', { wide: p.wide }] }, [
      p.url
        ? h('div', { class: 'cine-media-img' }, [
          h('img', { src: p.url, alt: '' }),
          h('button', { type: 'button', class: 'cine-media-clear', title: t('common.delete'), onClick: () => e('clear') }, [h(X, { size: 12 })]),
        ])
        : h('label', { class: 'cine-media-empty' }, [
          h(ImagePlus, { size: 18, 'stroke-width': 1.5 }),
          h('span', p.label),
          h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: onFile }),
        ]),
    ])
  },
})
</script>

<style scoped>
.cine-dialog { width: 980px; max-width: calc(100vw - 32px); max-height: calc(100vh - 40px); }
.cine-head { align-items: flex-start; }
.cine-head-copy { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.cine-head .dialog-title { display: flex; align-items: center; gap: 8px; }
.cine-desc { font-size: 12.5px; color: var(--text-3); line-height: 1.6; }
.cine-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.cine-switch-inline { font-weight: 500; }
.cine-toolbar, .cine-source, .cine-source-toggle, .cine-tabs, .cine-head { flex-shrink: 0; }
.cine-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 24px 0; }
.cine-preset-select { min-width: 240px; }
.cine-source { padding: 8px 24px 0; }
.cine-source .textarea { width: 100%; font-size: 12.5px; }
.cine-source-toggle { margin: 6px 24px 0; align-self: flex-start; background: none; border: 0; padding: 0; font-size: 12px; color: var(--accent-text); cursor: pointer; }
.cine-tabs { display: flex; gap: 2px; padding: 10px 24px 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
.cine-tab { border: 0; background: none; padding: 8px 12px; font-size: 13px; color: var(--text-2); border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.cine-tab.on { color: var(--text-0); font-weight: 600; border-bottom-color: var(--accent); }
.cine-tab-dot { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent-bg); color: var(--accent-text); font-size: 10.5px; line-height: 16px; text-align: center; }
.cine-body { flex: 1; min-height: 320px; }
.cine-sec { display: flex; flex-direction: column; gap: 16px; }
:deep(.cine-sec-head) { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
:deep(.cine-sec-actions) { display: flex; gap: 6px; flex-shrink: 0; }
:deep(.cine-hint), .cine-hint { font-size: 12px; color: var(--text-3); line-height: 1.6; margin: 0; }
.cine-hint.warn { color: var(--warning); }
.cine-field { display: flex; flex-direction: column; gap: 8px; }
:deep(.cine-field) { display: flex; flex-direction: column; gap: 8px; }
.cine-label, :deep(.cine-label) { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
:deep(.cine-mini) { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-2); min-width: 0; }
:deep(.cine-mini) > span:first-child { font-weight: 600; color: var(--text-1); }
:deep(.cine-picks) { display: flex; flex-wrap: wrap; gap: 4px; }
:deep(.cine-pick) { border: 1px dashed var(--border); background: none; color: var(--text-2); border-radius: var(--radius-pill); padding: 2px 8px; font-size: 11.5px; cursor: pointer; }
:deep(.cine-pick:hover), :deep(.cine-pick.on) { border-color: var(--accent); color: var(--accent-text); }
.cine-palette-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.cine-palette-preset { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--surface-input); border-radius: var(--radius-pill); padding: 3px 10px 3px 4px; font-size: 12px; color: var(--text-1); cursor: pointer; }
.cine-palette-preset.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.cine-swatches { display: flex; width: 44px; height: 16px; border-radius: 8px; overflow: hidden; }
.cine-swatches i, .cine-palette-bar i { display: block; height: 100%; }
.cine-palette-bar { display: flex; height: 22px; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border); }
.cine-color-row { display: flex; align-items: center; gap: 6px; }
.cine-color { width: 34px; height: 30px; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: none; flex-shrink: 0; }
.cine-hex { width: 92px; flex-shrink: 0; font-family: var(--font-mono); }
.cine-pct { width: 70px; flex-shrink: 0; }
.cine-row-actions { display: flex; align-items: center; gap: 10px; }
.cine-card { position: relative; display: flex; gap: 14px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-soft); }
.cine-card-flat { background: none; }
.cine-card-media { display: flex; flex-direction: column; gap: 8px; width: 150px; flex-shrink: 0; }
.cine-card-fields { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.cine-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.cine-del { position: absolute; top: 6px; right: 6px; }
.cine-voice { display: flex; flex-direction: column; gap: 6px; }
.cine-upload { cursor: pointer; justify-content: center; }
.cine-audio { width: 100%; height: 28px; }
:deep(.cine-media) { width: 150px; height: 150px; border-radius: var(--radius-sm); overflow: hidden; border: 1px dashed var(--border-strong); background: var(--surface-input); }
:deep(.cine-media.wide) { width: 150px; height: 100px; }
:deep(.cine-media-empty) { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 11.5px; color: var(--text-3); cursor: pointer; text-align: center; padding: 8px; }
:deep(.cine-media-img) { position: relative; width: 100%; height: 100%; }
:deep(.cine-media-img img) { width: 100%; height: 100%; object-fit: cover; display: block; }
:deep(.cine-media-clear) { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 11px; border: 0; background: var(--scrim); color: var(--on-media); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.cine-zone { display: flex; gap: 8px; align-items: flex-start; }
.cine-zone-area { width: 200px; flex-shrink: 0; }
.cine-zone .textarea { flex: 1; }
.cine-seg .input { width: 100px; }
.cine-format, .cine-preview { margin: 0; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-soft); font-family: var(--font-mono); font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--text-1); }
.cine-preview { max-height: 52vh; overflow: auto; }
.cine-apply { margin-right: auto; }
.cine-preset-dialog { width: 420px; max-width: calc(100vw - 32px); }
.dim { color: var(--text-3); font-size: 13px; }
@media (max-width: 720px) {
  .cine-card { flex-direction: column; }
  .cine-card-media { width: 100%; flex-direction: row; }
  .cine-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cine-zone { flex-direction: column; }
  .cine-zone-area { width: 100%; }
}
</style>
