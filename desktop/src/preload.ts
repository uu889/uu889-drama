/**
 * preload — 渲染进程安全桥
 * 暴露 window.uu889Desktop：目录选择、迁移触发、迁移进度订阅。
 * contextIsolation 默认开启，仅经 contextBridge 暴露白名单方法。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('uu889Desktop', {
  /** 弹原生目录选择框；返回 { ok, path?, freeBytes?, error?, canceled? } */
  pickDirectory: () => ipcRenderer.invoke('uu889:pick-directory'),
  /** 触发存储迁移；返回 { ok } 或 reject（错误信息见进度事件/异常） */
  startMigration: (opts: { targetDir: string, migrateFiles: boolean }) =>
    ipcRenderer.invoke('uu889:start-migration', opts),
  /** 订阅迁移进度；返回取消订阅函数 */
  onMigrateProgress: (cb: (progress: { phase: string, copiedBytes?: number, totalBytes?: number, message?: string }) => void) => {
    const listener = (_event: unknown, progress: Parameters<typeof cb>[0]) => cb(progress)
    ipcRenderer.on('uu889:migrate-progress', listener)
    return () => ipcRenderer.removeListener('uu889:migrate-progress', listener)
  },
  // ---- 应用内更新 ----
  getUpdateState: () => ipcRenderer.invoke('uu889:update-state'),
  checkUpdate: () => ipcRenderer.invoke('uu889:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('uu889:update-download'),
  applyUpdate: () => ipcRenderer.invoke('uu889:update-apply'),
  /** 订阅更新下载进度（0-100）；返回取消订阅函数 */
  onUpdateProgress: (cb: (percent: number) => void) => {
    const listener = (_event: unknown, percent: number) => cb(percent)
    ipcRenderer.on('uu889:update-progress', listener)
    return () => ipcRenderer.removeListener('uu889:update-progress', listener)
  },
})
