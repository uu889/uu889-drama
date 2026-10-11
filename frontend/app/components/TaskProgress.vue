<template>
  <div v-if="progress" :class="['task-progress', { compact, 'is-failed': progress.stage === 'failed' }]">
    <div class="tp-head">
      <span class="tp-stage">
        <Loader2 v-if="active" :size="11" class="animate-spin" />
        {{ t('episode.progress.stage.' + progress.stage) }}
      </span>
      <span v-if="percentText" class="tp-pct">{{ percentText }}</span>
    </div>
    <div class="tp-bar" role="progressbar" :aria-valuenow="progress.percent ?? undefined" aria-valuemin="0" aria-valuemax="100">
      <div :class="['tp-fill', { indeterminate: progress.percent == null && active }]" :style="{ width: barWidth }" />
    </div>
    <div v-if="chips.length" class="tp-chips">
      <span v-for="chip in chips" :key="chip" class="tp-chip">{{ chip }}</span>
    </div>
    <div v-if="message && !compact" class="tp-msg">{{ message }}</div>
    <div v-else-if="message && compact" class="tp-msg truncate" :title="message">{{ message }}</div>
    <details v-if="!compact && progress.history?.length > 1" class="tp-log">
      <summary>{{ t('episode.progress.log') }} ({{ progress.history.length }})</summary>
      <ol>
        <li v-for="(h, i) in progress.history" :key="i">
          <span class="tp-log-time">{{ clock(h.at) }}</span>
          <span>{{ showServerText ? h.message : t('episode.progress.stage.' + h.stage) }}</span>
        </li>
      </ol>
    </details>
  </div>
</template>

<script setup>
/**
 * 生成任务的实时进度（后端 sys_task 附带的 progress）：阶段 + 进度条 + 细节标签 + 过程记录。
 * 后端的 message 是中文一句话说明；非中文界面改用 stage / detail 组装的多语言标签。
 */
import { Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  progress: { type: Object, default: null },
  compact: { type: Boolean, default: false },
})

const { t, locale } = useI18n()

const active = computed(() => !['completed', 'failed'].includes(props.progress?.stage))
const showServerText = computed(() => locale.value === 'zh')
const percentText = computed(() => {
  const p = props.progress?.percent
  return p == null ? '' : `${Math.round(p)}%`
})
const barWidth = computed(() => {
  const p = props.progress?.percent
  if (p == null) return active.value ? '35%' : '100%'
  return `${Math.max(2, Math.min(100, p))}%`
})
const message = computed(() => {
  if (!props.progress) return ''
  if (showServerText.value) return props.progress.message || ''
  // 非中文界面：显示上游原始状态 / 节点类型，避免出现中文
  const d = props.progress.detail || {}
  return d.provider_status || (d.node_class ? `${d.node_class}` : '')
})

function fmtBytes(n) {
  const v = Number(n || 0)
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  if (v >= 1024) return `${Math.round(v / 1024)} KB`
  return `${v} B`
}
function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return t('episode.progress.sec', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('episode.progress.min', { m, s: s % 60 })
  return t('episode.progress.hour', { h: Math.floor(m / 60), m: m % 60 })
}
function clock(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

const chips = computed(() => {
  const p = props.progress
  if (!p) return []
  const d = p.detail || {}
  const out = []
  if (p.stage === 'queued' && d.queue_ahead != null) {
    out.push(d.queue_ahead > 0 ? t('episode.progress.queueAhead', { n: d.queue_ahead }) : t('episode.progress.queueNext'))
  }
  if (d.upload_total) out.push(t('episode.progress.upload', { done: d.uploaded || 0, total: d.upload_total }))
  if (d.sampler_total > 1) out.push(t('episode.progress.sampler', { i: d.sampler_index, n: d.sampler_total }))
  if (d.steps) out.push(t('episode.progress.step', { step: d.step || 0, steps: d.steps }))
  if (!props.compact && d.nodes_total) out.push(t('episode.progress.nodes', { done: d.nodes_done || 0, total: d.nodes_total }))
  if (p.stage === 'downloading' && d.downloaded_bytes != null) {
    out.push(d.total_bytes
      ? t('episode.progress.download', { done: fmtBytes(d.downloaded_bytes), total: fmtBytes(d.total_bytes) })
      : t('episode.progress.downloaded', { done: fmtBytes(d.downloaded_bytes) }))
  }
  if (d.eta_seconds != null && active.value) out.push(t('episode.progress.eta', { time: fmtDuration(d.eta_seconds) }))
  if (!props.compact && d.poll_count && !d.steps) out.push(t('episode.progress.polls', { n: d.poll_count }))
  if (p.started_at && p.updated_at && active.value) out.push(t('episode.progress.elapsed', { time: fmtDuration((p.updated_at - p.started_at) / 1000) }))
  return out
})
</script>

<style scoped>
.task-progress { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; min-width: 0; text-align: left; }
.tp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; }
.tp-stage { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: var(--text-1); }
.tp-pct { font-variant-numeric: tabular-nums; color: var(--accent); font-weight: 650; }
.tp-bar { position: relative; height: 5px; border-radius: 999px; background: var(--overlay-track, rgba(127, 127, 127, 0.18)); overflow: hidden; }
.tp-fill { height: 100%; border-radius: 999px; background: var(--accent); transition: width 0.4s ease; }
.tp-fill.indeterminate { animation: tp-slide 1.4s ease-in-out infinite; }
.is-failed .tp-fill { background: var(--error); }
.is-failed .tp-stage, .is-failed .tp-pct { color: var(--error); }
@keyframes tp-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
.tp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tp-chip { font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 999px; background: var(--accent-bg, rgba(91, 91, 214, 0.1)); color: var(--accent-text, var(--accent)); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tp-msg { font-size: 11px; color: var(--text-2); line-height: 1.45; overflow-wrap: anywhere; }
.compact .tp-msg { white-space: nowrap; }
.tp-log { font-size: 11px; color: var(--text-3); }
.tp-log summary { cursor: pointer; user-select: none; }
.tp-log ol { margin: 4px 0 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; max-height: 160px; overflow: auto; }
.tp-log li { display: flex; gap: 6px; }
.tp-log-time { font-variant-numeric: tabular-nums; color: var(--text-3); flex-shrink: 0; }
</style>
