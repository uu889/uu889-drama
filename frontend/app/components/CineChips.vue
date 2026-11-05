<template>
  <div class="cine-chips">
    <template v-for="g in groups" :key="g.name">
      <div v-if="g.name && groups.length > 1" class="cine-chips-group">{{ g.name }}</div>
      <div class="cine-chips-row">
        <button
          v-for="o in g.items"
          :key="o.id"
          type="button"
          class="cine-chip"
          :class="{ on: isOn(o.id) }"
          :title="o.en ? `${o.en}\n${o.desc}` : o.desc"
          @click="toggle(o.id)"
        >{{ o.label }}</button>
      </div>
    </template>
    <ul v-if="showEffects && selected.length" class="cine-effects">
      <li v-for="o in selected" :key="o.id"><b>{{ o.label }}</b><span v-if="o.en && o.en !== o.label" class="cine-en">{{ o.en }}</span>：{{ o.desc }}</li>
    </ul>
  </div>
</template>

<script setup>
/** 选项胶囊：单选（modelValue 为字符串）/ 多选（数组）；可显示已选项的作用说明 */
const props = defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { type: [Array, String], default: () => [] },
  multiple: { type: Boolean, default: true },
  max: { type: Number, default: 0 },
  showEffects: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const groups = computed(() => {
  const map = new Map()
  for (const o of props.options) {
    const k = o.group || ''
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(o)
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})
const ids = computed(() => (props.multiple ? (Array.isArray(props.modelValue) ? props.modelValue : []) : (props.modelValue ? [props.modelValue] : [])))
const selected = computed(() => ids.value.map(id => props.options.find(o => o.id === id)).filter(Boolean))
const isOn = id => ids.value.includes(id)

function toggle(id) {
  if (!props.multiple) {
    emit('update:modelValue', props.modelValue === id ? '' : id)
    return
  }
  const cur = [...ids.value]
  const i = cur.indexOf(id)
  if (i >= 0) cur.splice(i, 1)
  else {
    if (props.max && cur.length >= props.max) cur.shift()
    cur.push(id)
  }
  emit('update:modelValue', cur)
}
</script>

<style scoped>
.cine-chips { display: flex; flex-direction: column; gap: 6px; }
.cine-chips-group { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.cine-chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
.cine-chip {
  border: 1px solid var(--border);
  background: var(--surface-input);
  color: var(--text-1);
  border-radius: var(--radius-pill);
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.cine-chip:hover { border-color: var(--border-hover); }
.cine-chip.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-text); font-weight: 600; }
.cine-effects { margin: 4px 0 0; padding: 8px 10px 8px 22px; background: var(--surface-soft); border-radius: var(--radius-sm); font-size: 12px; line-height: 1.7; color: var(--text-2); }
.cine-effects b { color: var(--text-1); font-weight: 600; }
.cine-en { margin-left: 4px; color: var(--text-3); font-size: 11px; }
</style>
