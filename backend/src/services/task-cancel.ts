/**
 * 手动取消生成任务（生成任务列表里的「取消」按钮）
 *
 * 任务可能停在任何一步：排队等显卡 / 上游名额、正在提交、已提交在轮询、正在下载结果。
 * 取消时先把 sys_task 落成失败（error_msg = TASK_CANCELLED_MESSAGE），再：
 * - 中断正在进行的提交请求（AbortController）
 * - 让排队中的任务离开队列（gpu-queue 的等待以 GpuLaneLeftError 结束，不会再提交）
 * - 已提交的任务调用适配器 cancel 取消上游（ComfyUI 删队列 / 中断等，没有就只停止轮询）
 * 之后各步骤检查 isTaskCancelled，不再提交、不再写回结果、也不会把状态改回别的。
 */
import { releaseGpuLane } from './gpu-queue.js'

/** 取消后写进 error_msg 的文案（前端按它显示「已取消」） */
export const TASK_CANCELLED_MESSAGE = '已手动取消'

export class TaskCancelledError extends Error {
  constructor(id: number) {
    super(`任务 ${id} ${TASK_CANCELLED_MESSAGE}`)
    this.name = 'TaskCancelledError'
  }
}

const cancelled = new Set<number>()
const aborts = new Map<number, AbortController>()
const upstream = new Map<number, () => Promise<unknown> | unknown>()

export function isTaskCancelled(id: number): boolean {
  return cancelled.has(id)
}

export function assertNotCancelled(id: number) {
  if (cancelled.has(id)) throw new TaskCancelledError(id)
}

/** 提交请求用的中断信号（和超时合并）；任务结束时调用 done 清理 */
export function taskAbortSignal(id: number, timeoutMs: number): AbortSignal {
  let ctrl = aborts.get(id)
  if (!ctrl) aborts.set(id, (ctrl = new AbortController()))
  return AbortSignal.any([AbortSignal.timeout(timeoutMs), ctrl.signal])
}

/** 已提交到上游：登记取消上游任务的方法（轮询期间 taskId 可能因重交而变化，所以传函数） */
export function onTaskCancel(id: number, fn: () => Promise<unknown> | unknown) {
  upstream.set(id, fn)
}

/** 任务走完（成功 / 失败）时清理登记 */
export function clearTaskCancel(id: number) {
  aborts.delete(id)
  upstream.delete(id)
}

/**
 * 标记取消并停下手头的步骤。markFailed 负责落库（由调用方传入，避免循环依赖）。
 * 返回 false 表示这个任务已经结束，不能取消。
 */
export async function cancelRunningTask(
  id: number,
  status: string | null | undefined,
  markFailed: () => Promise<void>,
): Promise<boolean> {
  if (status !== 'processing' && status !== 'pending') return false
  cancelled.add(id)
  await markFailed()
  aborts.get(id)?.abort(new TaskCancelledError(id))
  const cancelUpstream = upstream.get(id)
  if (cancelUpstream) {
    try { await cancelUpstream() } catch { /* 上游取消失败不影响本地结束 */ }
  }
  releaseGpuLane(id)
  clearTaskCancel(id)
  return true
}

/** 测试用 */
export function resetTaskCancels() {
  cancelled.clear()
  aborts.clear()
  upstream.clear()
}
