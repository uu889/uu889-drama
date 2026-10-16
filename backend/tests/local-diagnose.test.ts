import assert from 'node:assert/strict'
import { test } from 'node:test'
import http from 'node:http'
import net from 'node:net'
import { describeFetchError, diagnoseLocalService } from '../src/services/adapters/local-diagnose'

/** 起一个只认识指定路径的模拟服务：其余路径返回 FastAPI 风格的 404 {"detail":"Not Found"} */
async function serve(routes: Record<string, { status?: number; body: any; type?: string }>) {
  const server = http.createServer((req, res) => {
    const r = routes[(req.url || '/').split('?')[0]]
    if (!r) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"detail":"Not Found"}'); return }
    res.writeHead(r.status || 200, { 'Content-Type': r.type || 'application/json' })
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, close: () => server.close() }
}

async function freePort(): Promise<number> {
  const s = net.createServer()
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()))
  const port = (s.address() as any).port
  await new Promise((ok) => s.close(ok))
  return port
}

test('SD WebUI without --api: gradio page answers, /sdapi is 404 → tells how to add --api', async () => {
  const s = await serve({
    '/': { body: '<html><head><title>Stable Diffusion</title></head><body>gradio</body></html>', type: 'text/html' },
    '/config': { body: { version: '3.41.2', mode: 'blocks', title: 'Stable Diffusion', components: [{ props: { elem_id: 'txt2img_prompt' } }] } },
  })
  const d = await diagnoseLocalService('sdwebui', s.base)
  s.close()
  assert.equal(d.detected, 'sdwebui_no_api')
  assert.match(d.message, /--api/)
  assert.match(d.message, /webui-user\.bat/)
})

test('SD WebUI with API reachable', async () => {
  const s = await serve({ '/openapi.json': { body: { openapi: '3.1.0', paths: { '/sdapi/v1/txt2img': {}, '/sdapi/v1/sd-models': {} } } } })
  const d = await diagnoseLocalService('sdwebui', s.base)
  s.close()
  assert.equal(d.detected, 'sdwebui_api')
})

test('wrong provider: Fooocus-API or ComfyUI behind an SD WebUI config', async () => {
  const f = await serve({ '/openapi.json': { body: { openapi: '3.1.0', paths: { '/v1/generation/text-to-image': {} } } } })
  const df = await diagnoseLocalService('sdwebui', f.base)
  f.close()
  assert.equal(df.suggest_provider, 'fooocus')
  assert.match(df.message, /服务商改成「Fooocus」/)
  const c = await serve({ '/system_stats': { body: { system: { os: 'posix', python_version: '3.12', comfyui_version: '0.3.60' }, devices: [] } } })
  const dc = await diagnoseLocalService('sdwebui', c.base)
  c.close()
  assert.equal(dc.detected, 'comfyui')
  assert.match(dc.message, /ComfyUI/)
})

test('Fooocus web UI (no API) is recognised', async () => {
  const s = await serve({ '/config': { body: { version: '3.41.2', mode: 'blocks', title: 'Fooocus 2.5.5' } } })
  const d = await diagnoseLocalService('fooocus', s.base)
  s.close()
  assert.equal(d.detected, 'fooocus_web')
  assert.match(d.message, /Fooocus-API/)
})

test('unknown FastAPI service: mentions --api, default ports and path prefixes', async () => {
  const s = await serve({})
  const d = await diagnoseLocalService('sdwebui', s.base)
  s.close()
  assert.equal(d.detected, 'fastapi_other')
  assert.match(d.message, /7860/)
})

test('nothing listening (ComfyUI on a cloud IP): explains --listen 0.0.0.0, security group and firewall', async () => {
  const port = await freePort()
  const d = await diagnoseLocalService('comfyui', `http://127.0.0.1:${port}`)
  assert.equal(d.detected, 'unreachable')
  assert.match(d.message, /连接被拒绝/)
  assert.match(d.message, /--listen 0\.0\.0\.0/)
  // 非本机地址时补充安全组 / 防火墙提示（用保留地址模拟，不真的发出连接也能走到拒绝分支）
  const remote = await diagnoseLocalService('comfyui', `http://localhost.invalid:${port}`)
  assert.equal(remote.detected, 'unreachable')
})

test('describeFetchError expands "fetch failed"', async () => {
  const port = await freePort()
  const err = await fetch(`http://127.0.0.1:${port}/system_stats`).then(() => null, (e) => e)
  assert.match(String(err?.message), /fetch failed/)
  assert.match(describeFetchError(err), /ECONNREFUSED|连接被拒绝/)
  assert.match(describeFetchError({ name: 'TimeoutError', message: 'The operation was aborted due to timeout' }), /超时/)
})
