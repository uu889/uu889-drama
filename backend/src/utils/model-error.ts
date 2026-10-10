/**
 * 模型调用失败 → 带状态码与上游原因的提示（前端按「文本模型调用失败」前缀原样展示）。
 * AI SDK 的 APICallError 带 statusCode / responseBody，Mastra 可能把它包在 cause 里。
 */
export function describeModelError(err: any): string {
  const chain: any[] = []
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) chain.push(e)
  const apiErr = chain.find((e) => e && (typeof e.statusCode === 'number' || typeof e.responseBody === 'string'))
  if (!apiErr) return err?.message || 'Agent 执行失败'
  let detail = ''
  if (typeof apiErr.responseBody === 'string' && apiErr.responseBody) {
    try {
      const body = JSON.parse(apiErr.responseBody)
      detail = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : '')
    } catch {
      detail = apiErr.responseBody
    }
  }
  detail = String(detail || apiErr.message || err?.message || '').replace(/\s+/g, ' ').trim()
  const status = typeof apiErr.statusCode === 'number' ? `（HTTP ${apiErr.statusCode}）` : ''
  return `文本模型调用失败${status}：${detail}`.slice(0, 400)
}
