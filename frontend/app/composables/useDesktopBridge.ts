/**
 * 桌面版桥（preload 注入的 window.uu889Desktop）类型声明与安全取值。
 * 非桌面环境（浏览器/服务器部署）返回 null，UI 据此隐藏桌面专属功能。
 */

export interface UpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  latestVersion?: string
  notes?: string
  error?: string
  downloadProgress?: number
  downloadedFile?: string
}

export interface Uu889DesktopBridge {
  pickDirectory: () => Promise<{ ok: boolean, path?: string, freeBytes?: number | null, error?: string, canceled?: boolean }>
  startMigration: (opts: { targetDir: string, migrateFiles: boolean }) => Promise<{ ok: boolean }>
  onMigrateProgress: (cb: (progress: { phase: string, message?: string, copiedBytes?: number, totalBytes?: number }) => void) => () => void
  getUpdateState: () => Promise<UpdateState>
  checkUpdate: () => Promise<UpdateState>
  downloadUpdate: () => Promise<UpdateState>
  applyUpdate: () => Promise<void>
  onUpdateProgress: (cb: (percent: number) => void) => () => void
}

export function useDesktopBridge(): Uu889DesktopBridge | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { uu889Desktop?: Uu889DesktopBridge }).uu889Desktop ?? null
}
