/**
 * 存储迁移引擎（主进程）
 *
 * 序列：validate → stop backend → move → write config → restart backend → done
 * 铁律：copy 校验通过前绝不删旧目录；配置搬完才写；任何失败回滚并以旧目录拉起后端。
 * 文件操作（目标目录解析、同盘判断、重试、回滚）在 migrate-core.ts。
 *
 * 进度经 IPC 'uu889:migrate-progress' 推送（80ms 节流，done/error 必发）。
 */
import { app, dialog, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { moveData, resolveMigrationTarget, validateTarget } from './migrate-core'

export interface MigrationDeps {
  getWindow(): BrowserWindow | null
  getDataDir(): string
  setDataDir(dir: string): void
  getPort(): number
  isBackendAlive(): boolean
  /** 停后端并等待退出（内部置 backendRestarting 抑制致命弹窗） */
  stopBackend(): Promise<void>
  startBackend(): void
  waitHealthy(port: number, timeoutMs: number): Promise<void>
  /** 后端生命周期告一段落（已 healthy 或已恢复）时复位标志 */
  markRestartingFalse(): void
  writeConfig(dataDir: string): void
  configPath(): string
  normCase(p: string): string
}

export interface MigrateProgress {
  phase: 'validating' | 'stopping' | 'moving' | 'config' | 'restarting' | 'done' | 'error'
  message?: string
  copiedBytes?: number
  totalBytes?: number
}

export interface MigrateOptions {
  targetDir: string
  migrateFiles: boolean
}

export function registerMigrationIpc(deps: MigrationDeps): void {
  ipcMain.handle('uu889:start-migration', async (_event, opts: MigrateOptions) => {
    await runMigration(deps, opts)
    return { ok: true }
  })
}

// ---- 进度推送（80ms 节流，done/error 必发） ----

function makeReporter(getWindow: () => BrowserWindow | null) {
  let lastSent = 0
  return (progress: MigrateProgress, force = false) => {
    const now = Date.now()
    if (!force && progress.phase !== 'done' && progress.phase !== 'error' && now - lastSent < 80) return
    lastSent = now
    getWindow()?.webContents.send('uu889:migrate-progress', progress)
  }
}

// ---- 主流程 ----

export async function runMigration(deps: MigrationDeps, opts: MigrateOptions): Promise<void> {
  const report = makeReporter(deps.getWindow)
  const oldDir = path.resolve(deps.getDataDir())
  const backendWasAlive = deps.isBackendAlive()
  let leftover: string | undefined

  try {
    report({ phase: 'validating' }, true)
    // 选了已有内容的文件夹时自动用其中的 UU889Drama-Data 子目录
    const target = await resolveMigrationTarget(opts.targetDir, oldDir)
    // 应用数据目录（存储配置所在位置）本身不能作为数据目录
    if (deps.normCase(target) === deps.normCase(path.dirname(deps.configPath()))) throw new Error('不能选择应用数据目录本身，请选其他文件夹')
    const totalBytes = await validateTarget(target, oldDir)

    if (backendWasAlive) {
      report({ phase: 'stopping' }, true)
      await deps.stopBackend()
    }

    if (opts.migrateFiles) {
      report({ phase: 'moving', copiedBytes: 0, totalBytes }, true)
      const res = await moveData(oldDir, target, (p) => report({ phase: 'moving', ...p }))
      leftover = res.leftover
    } else {
      await fsp.mkdir(target, { recursive: true })
    }

    // 配置在文件搬完后才写；写失败回滚为旧值（或删除 = 回默认目录）
    report({ phase: 'config' }, true)
    const configExisted = fs.existsSync(deps.configPath())
    const oldConfigRaw = configExisted ? fs.readFileSync(deps.configPath(), 'utf8') : null
    try {
      deps.writeConfig(target)
    } catch (err) {
      if (oldConfigRaw !== null) fs.writeFileSync(deps.configPath(), oldConfigRaw)
      else fs.rmSync(deps.configPath(), { force: true })
      throw err
    }

    report({ phase: 'restarting' }, true)
    deps.setDataDir(target)
    deps.startBackend()
    await deps.waitHealthy(deps.getPort(), 60_000)
    deps.markRestartingFalse()
    report({ phase: 'done', message: leftover ? `数据已搬到新位置；旧文件夹 ${leftover} 被其他程序占用没能删除，可以稍后手动删除` : undefined }, true)
  } catch (err) {
    const message = (err as Error)?.message || String(err)
    report({ phase: 'error', message }, true)

    // 恢复：后端应处于运行态；恢复失败则明确退出应用，不留僵尸窗口
    if (backendWasAlive && !deps.isBackendAlive()) {
      deps.setDataDir(oldDir)
      try {
        deps.startBackend()
        await deps.waitHealthy(deps.getPort(), 60_000)
        deps.markRestartingFalse()
      } catch (recoverErr) {
        console.error('[migrate] 恢复后端失败:', recoverErr)
        dialog.showErrorBox('UU889-Drama', `存储迁移失败且恢复后台服务失败，应用即将关闭。\n原始错误：${message}`)
        app.quit()
        return
      }
    } else {
      deps.markRestartingFalse()
    }
    throw err
  }
}
