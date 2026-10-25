<template>
  <div class="app-error">
    <div class="app-error-box">
      <div class="app-error-title">{{ t('errors.pageCrashed') }}</div>
      <div class="app-error-msg mono">{{ detail }}</div>
      <div class="app-error-actions">
        <button class="btn btn-primary" @click="reload">{{ t('errors.reloadPage') }}</button>
        <button class="btn btn-ghost" @click="goHome">{{ t('errors.backHome') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 页面级错误兜底：出错时显示原因和「重新加载」，而不是一片空白
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ error: { statusCode?: number; message?: string; statusMessage?: string } }>()
const { t } = useI18n()
const detail = computed(() => [props.error?.statusCode, props.error?.message || props.error?.statusMessage].filter(Boolean).join(' · '))
function reload() { location.reload() }
function goHome() { clearError({ redirect: '/' }) }
</script>

<style>
@import url('./assets/studio.css');
.app-error { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg, #f6f7f9); padding: 24px; }
.app-error-box { max-width: 560px; width: 100%; padding: 28px 32px; border-radius: 14px; background: var(--surface-raised, #fff); border: 1px solid var(--border, #e5e7eb); box-shadow: var(--shadow-elevated, 0 8px 30px rgba(0,0,0,0.08)); }
.app-error-title { font-size: 17px; font-weight: 700; color: var(--text-0, #111); }
.app-error-msg { margin-top: 10px; font-size: 12px; color: var(--text-2, #555); word-break: break-all; white-space: pre-wrap; }
.app-error-actions { margin-top: 18px; display: flex; gap: 8px; }
</style>
