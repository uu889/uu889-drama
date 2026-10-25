/**
 * 界面出错兜底：组件渲染 / 事件处理里没接住的异常不再让页面静默变白，
 * 而是弹出带原文的提示（同一条 10 秒内只提示一次），控制台留完整堆栈，方便用户截图反馈。
 */
import { toast } from 'vue-sonner'
import { i18n } from '~/composables/i18n'
import { errorDetail } from '~/composables/useToast'

export default defineNuxtPlugin((nuxtApp) => {
  const recent = new Map<string, number>()
  const report = (err: unknown, where: string) => {
    console.error(`[ui-error] ${where}`, err)
    const detail = errorDetail(err, 200)
    if (!detail) return
    const now = Date.now()
    if ((recent.get(detail) || 0) > now - 10_000) return
    recent.set(detail, now)
    toast.error(i18n.global.t('errors.uiError', { detail }), { duration: 10000 })
  }
  // Nuxt 挂载完成后会去掉 Vue 的 errorHandler，这里重新接上（渲染出错时只提示，不清空页面）
  nuxtApp.hook('app:suspense:resolve', () => {
    nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => report(err, String(info || 'vue'))
  })
  window.addEventListener('unhandledrejection', (e) => report(e.reason, 'unhandledrejection'))
})
