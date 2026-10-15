import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'

// 任务记录写到临时数据目录（必须在导入 jobs 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-data-'))
process.env.UU889_DATA_DIR = DATA

const { createJob, getJob, publicJob, pauseJob, resumeJob } = await import('../src/services/model-installer/jobs')
const { buildPosixScript, buildPowerShellScript, parseStatusLog } = await import('../src/services/model-installer/remote-script')
const { identifyRoot, resolveLayout, scanForRoots } = await import('../src/services/model-installer/detect')
const { openLocalTarget, normalizeTargetPath, toSftpPath } = await import('../src/services/model-installer/target')
const { buildPlanFiles, checkPlanFiles } = await import('../src/services/model-installer/plan')
const { sourcesFor } = await import('../src/services/model-installer/sources')
const { normalizeModelInstall } = await import('../src/services/model-installer/index')

// ─── 模拟下载服务器：/ok 支持 Range、/slow 慢速、/broken 500、/missing 404、/html 网页 ───
const PAYLOAD = crypto.randomBytes(3 * 1024 * 1024 + 123)
const SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex')
let server: http.Server
let base = ''
let rangeHits = 0
let cutNext = 0 // >0：下一次 /ok 请求只发这么多字节就断开

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url || ''
    if (url.startsWith('/broken')) { res.writeHead(500); res.end('boom'); return }
    if (url.startsWith('/missing')) { res.writeHead(404); res.end('nope'); return }
    if (url.startsWith('/html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); return }
    if (url.startsWith('/ok') || url.startsWith('/slow')) {
      let start = 0
      const range = req.headers.range
      if (range) {
        rangeHits++
        start = Number(/bytes=(\d+)-/.exec(range)![1])
        if (start >= PAYLOAD.length) { res.writeHead(416); res.end(); return }
        res.writeHead(206, { 'Content-Length': PAYLOAD.length - start, 'Content-Range': `bytes ${start}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'Content-Type': 'application/octet-stream' })
      } else {
        res.writeHead(200, { 'Content-Length': PAYLOAD.length, 'Content-Type': 'application/octet-stream' })
      }
      const body = PAYLOAD.subarray(start)
      if (cutNext > 0) {
        const n = cutNext
        cutNext = 0
        res.write(body.subarray(0, n), () => res.destroy())
        return
      }
      if (url.startsWith('/slow')) {
        let off = 0
        const tick = setInterval(() => {
          if (off >= body.length || res.destroyed) { clearInterval(tick); res.end(); return }
          res.write(body.subarray(off, off + 64 * 1024))
          off += 64 * 1024
        }, 20)
        res.on('close', () => clearInterval(tick))
        return
      }
      res.end(body)
      return
    }
    res.writeHead(404); res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as any).port}`
})

after(() => {
  server.close()
})

async function waitFor(id: string, statuses: string[], ms = 20_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const j = getJob(id)!
    if (statuses.includes(j.status)) return j
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timeout waiting for ${statuses}; now ${getJob(id)?.status}`)
}

function fakeFile(dir: string, name: string, sources: Array<{ label: any; url: string }>, extra: Record<string, any> = {}) {
  return {
    key: `lora:${name}`, name, file: name, role: 'lora' as const, styles: ['anime' as const], url: sources[0].url,
    bytes: PAYLOAD.length, sha256: SHA, sources, dest: path.join(dir, name), state: 'missing' as const, currentBytes: 0, partBytes: 0, ...extra,
  }
}

test('local download falls back through broken / 404 / html sources, verifies size + sha256, renames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-'))
  const job = createJob({
    provider: 'comfyui', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'a.safetensors', [
      { label: 'huggingface', url: `${base}/missing/a` },
      { label: 'hf-mirror', url: `${base}/html/a` },
      { label: 'civitai', url: `${base}/ok/a` },
    ])],
  })
  const done = await waitFor(job.id, ['done', 'failed'])
  assert.equal(done.status, 'done', JSON.stringify(publicJob(done).items[0].log))
  const out = fs.readFileSync(path.join(dir, 'a.safetensors'))
  assert.equal(crypto.createHash('sha256').update(out).digest('hex'), SHA)
  assert.ok(!fs.existsSync(path.join(dir, 'a.safetensors.uu889part')))
  assert.equal(done.items[0].sourceLabel, 'civitai')
})

test('local download resumes with Range after the connection drops', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-'))
  rangeHits = 0
  cutNext = 1024 * 1024
  const job = createJob({
    provider: 'sdwebui', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'b.safetensors', [{ label: 'huggingface', url: `${base}/ok/b` }])],
  })
  const done = await waitFor(job.id, ['done', 'failed'], 30_000)
  assert.equal(done.status, 'done', JSON.stringify(publicJob(done).items[0].log))
  assert.ok(rangeHits >= 1, 'resumed with Range')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'b.safetensors'))).digest('hex'), SHA)
})

test('wrong sha256 is rejected and the file is not installed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-'))
  const job = createJob({
    provider: 'fooocus', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'c.safetensors', [{ label: 'huggingface', url: `${base}/ok/c` }], { sha256: 'f'.repeat(64) })],
  })
  const done = await waitFor(job.id, ['done', 'failed'], 30_000)
  assert.equal(done.status, 'failed')
  assert.ok(!fs.existsSync(path.join(dir, 'c.safetensors')))
  assert.match(done.items[0].error || '', /SHA256|来源/)
})

test('pause keeps the partial file and resume continues from it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-'))
  rangeHits = 0
  const job = createJob({
    provider: 'comfyui', serviceType: 'video', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'd.safetensors', [{ label: 'huggingface', url: `${base}/slow/d` }])],
  })
  const part = path.join(dir, 'd.safetensors.uu889part')
  const t0 = Date.now()
  while ((!fs.existsSync(part) || fs.statSync(part).size < 256 * 1024) && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 20))
  await pauseJob(job.id)
  assert.equal(getJob(job.id)!.status, 'paused')
  await new Promise((r) => setTimeout(r, 200))
  const kept = fs.statSync(part).size
  assert.ok(kept > 0 && kept < PAYLOAD.length)
  resumeJob(job.id)
  const done = await waitFor(job.id, ['done', 'failed'], 30_000)
  assert.equal(done.status, 'done', JSON.stringify(publicJob(done).items[0].log))
  assert.ok(rangeHits >= 1)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'd.safetensors'))).digest('hex'), SHA)
  // 任务记录已持久化
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'model-downloads', 'jobs.json'), 'utf8'))
  assert.ok(saved.some((j: any) => j.id === job.id && j.status === 'done'))
})

test('existing complete file is skipped; duplicate jobs for the same file are refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-'))
  fs.writeFileSync(path.join(dir, 'e.safetensors'), PAYLOAD)
  const job = createJob({
    provider: 'comfyui', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'e.safetensors', [{ label: 'huggingface', url: `${base}/broken/e` }], { state: 'size_mismatch' })],
  })
  const done = await waitFor(job.id, ['done', 'failed'])
  assert.equal(done.items[0].status, 'skipped')
  const slow = createJob({
    provider: 'comfyui', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'f.safetensors', [{ label: 'huggingface', url: `${base}/slow/f` }])],
  })
  assert.throws(() => createJob({
    provider: 'comfyui', serviceType: 'image', styles: ['anime'], root: dir, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
    files: [fakeFile(dir, 'f.safetensors', [{ label: 'huggingface', url: `${base}/slow/f` }])],
  }), /没有需要下载/)
  await pauseJob(slow.id)
})

test('remote POSIX script: fallback, resume, size + sha checks, status log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-sh-'))
  const jobDir = path.join(dir, '.uu889-downloads', 'uu889dl-t1')
  fs.mkdirSync(jobDir, { recursive: true })
  // 预先放一段已下载的部分，验证续传
  fs.mkdirSync(path.join(dir, 'models', 'loras'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'models', 'loras', 'x.safetensors.uu889part'), PAYLOAD.subarray(0, 500_000))
  fs.writeFileSync(path.join(dir, 'models', 'loras', 'skip.safetensors'), PAYLOAD)
  const items = [
    { dest: path.join(dir, 'models', 'loras', 'x.safetensors'), bytes: PAYLOAD.length, sha256: SHA, sources: [{ label: 'huggingface', url: `${base}/broken/x` }, { label: 'hf-mirror', url: `${base}/ok/x` }] },
    { dest: path.join(dir, 'models', 'checkpoints', 'y y.safetensors'), bytes: PAYLOAD.length, sha256: 'a'.repeat(64), sources: [{ label: 'huggingface', url: `${base}/ok/y` }] },
    { dest: path.join(dir, 'models', 'loras', 'skip.safetensors'), bytes: PAYLOAD.length, sha256: SHA, sources: [{ label: 'huggingface', url: `${base}/broken/z` }] },
  ]
  const script = buildPosixScript('t1', jobDir, items)
  const sp = path.join(jobDir, 'run.sh')
  fs.writeFileSync(sp, script)
  rangeHits = 0
  // 加快重试：sleep 改成 0
  fs.writeFileSync(sp, script.replace(/sleep 5/g, 'sleep 0'))
  await new Promise<void>((resolve, reject) => {
    execFile('sh', [sp], { timeout: 60_000, env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } }, (err) => (err ? reject(err) : resolve()))
  })
  const log = fs.readFileSync(path.join(jobDir, 'status.log'), 'utf8')
  const parsed = parseStatusLog(log, items.length)
  assert.equal(parsed.finished, true)
  assert.equal(parsed.items[0].status, 'done', log)
  assert.equal(parsed.items[0].sourceLabel, 'hf-mirror')
  assert.equal(parsed.items[1].status, 'failed', log)
  assert.match(log, /BADHASH 1/)
  assert.equal(parsed.items[2].status, 'skipped')
  assert.ok(rangeHits >= 1, 'curl resumed the partial file')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(items[0].dest)).digest('hex'), SHA)
  assert.ok(!fs.existsSync(items[1].dest))
  assert.ok(!fs.existsSync(path.join(jobDir, 'pid')))
})

test('PowerShell script: BOM, quoting, flat source arrays', () => {
  const ps = buildPowerShellScript('t2', "C:\\Users\\张三\\ComfyUI\\.uu889-downloads\\uu889dl-t2", [
    { dest: "C:\\Users\\张三\\ComfyUI\\models\\loras\\it's.safetensors", bytes: 10, sha256: 'ab', sources: [{ label: 'huggingface', url: 'https://huggingface.co/a/b/resolve/main/c?x=1' }, { label: 'civitai', url: 'https://civitai.com/api/download/models/1?token=t' }] },
  ])
  assert.ok(ps.startsWith('\ufeff'))
  assert.match(ps, /Dl 0 'C:\\Users\\张三\\ComfyUI\\models\\loras\\it''s\.safetensors' 10 'ab' @\('huggingface', 'https:\/\/huggingface\.co\/a\/b\/resolve\/main\/c\?x=1', '', 'civitai', 'https:\/\/civitai\.com\/api\/download\/models\/1\?token=t', ''\)/)
  assert.match(ps, /uu889dl-t2/)
})

test('status log parser handles BOM, retries and unknown lines', () => {
  const p = parseStatusLog('\ufeffBEGIN 0\r\nSOURCE 0 huggingface\r\nRETRY 0 1\r\nSOURCE 0 hf-mirror\r\nVERIFY 0\r\nDONE 0\r\nBEGIN 1\r\nSOURCE 1 civitai\r\ngarbage\r\n', 2)
  assert.equal(p.items[0].status, 'done')
  assert.equal(p.items[0].retries, 1)
  assert.equal(p.items[1].status, 'downloading')
  assert.equal(p.current, 1)
  assert.equal(p.finished, false)
})

test('root detection: markers, layout per program, scan finds nested installs', async () => {
  assert.equal(identifyRoot(new Set(['main.py', 'comfy', 'models']))?.provider, 'comfyui')
  assert.equal(identifyRoot(new Set(['models', 'custom_nodes', 'user']))?.flavor, 'ComfyUI Desktop')
  assert.equal(identifyRoot(new Set(['webui.py', 'modules', 'modules_forge']))?.flavor, 'SD WebUI Forge')
  assert.equal(identifyRoot(new Set(['fooocusapi', 'main.py']))?.flavor, 'Fooocus-API')
  assert.equal(identifyRoot(new Set(['entry_with_update.py', 'modules']))?.flavor, 'Fooocus')
  assert.equal(identifyRoot(new Set(['README.md'])), null)

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-home-'))
  const comfy = path.join(home, 'AI', 'ComfyUI')
  for (const d of ['comfy', 'models']) fs.mkdirSync(path.join(comfy, d), { recursive: true })
  fs.writeFileSync(path.join(comfy, 'main.py'), '')
  const fapi = path.join(home, 'Fooocus-API')
  fs.mkdirSync(path.join(fapi, 'fooocusapi'), { recursive: true })
  fs.mkdirSync(path.join(fapi, 'repositories', 'Fooocus', 'models'), { recursive: true })
  fs.writeFileSync(path.join(fapi, 'main.py'), '')
  const t = { ...openLocalTarget(), home }
  const found = await scanForRoots(t)
  assert.ok(found.some((f) => f.provider === 'comfyui' && f.path === comfy))
  assert.ok(found.some((f) => f.provider === 'fooocus' && f.path === fapi))
  const layout = await resolveLayout(t, 'fooocus', fapi)
  assert.equal(layout.folders.lora, path.join(fapi, 'repositories', 'Fooocus', 'models', 'loras'))
  assert.equal(layout.flavor, 'Fooocus-API')
  const wrong = await resolveLayout(t, 'sdwebui', comfy)
  assert.ok(wrong.warnings.some((w) => /ComfyUI/.test(w)))
})

test('plan: files per style, dedupe, template base files + 14B LoRA only, states on disk', async () => {
  const img = buildPlanFiles({ provider: 'comfyui', serviceType: 'image', styles: ['anime', 'noir', 'webtoon'] })
  // anime / noir / webtoon 共用 Animagine，只下一次
  assert.equal(img.files.filter((f) => f.role === 'checkpoint').length, 1)
  assert.deepEqual(img.files.find((f) => f.role === 'checkpoint')!.styles.sort(), ['anime', 'noir', 'webtoon'])
  const vid = buildPlanFiles({ provider: 'comfyui', serviceType: 'video', styles: ['3d'] })
  assert.ok(vid.files.some((f) => f.role === 'diffusion_models' && /low_noise/.test(f.file)))
  assert.ok(vid.files.some((f) => f.role === 'lora'))
  const five = buildPlanFiles({ provider: 'comfyui', serviceType: 'video', styles: ['3d'], model: 'wan2.2-ti2v-5b' })
  assert.ok(!five.files.some((f) => f.role === 'lora'))
  assert.ok(five.skipped.some((s) => /14B/.test(s.reason)))
  const custom = buildPlanFiles({ provider: 'sdwebui', serviceType: 'image', styles: ['anime'], settings: { style_models: { anime: { checkpoint: 'mine.safetensors' } } } })
  assert.ok(custom.skipped.some((s) => s.file === 'mine.safetensors'))
  // 可选替代里的文件也能下载
  const alt = buildPlanFiles({ provider: 'sdwebui', serviceType: 'image', styles: ['guofeng'], settings: { style_models: { guofeng: { checkpoint: 'starlightXLAnimated_v3.safetensors' } } } })
  assert.ok(alt.files.some((f) => f.file === 'starlightXLAnimated_v3.safetensors'))

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-comfy-'))
  for (const d of ['comfy', 'models/checkpoints']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'main.py'), '')
  fs.writeFileSync(path.join(root, 'models', 'checkpoints', 'animagine-xl-4.0-opt.safetensors'), Buffer.alloc(2 * 1024 * 1024))
  const t = openLocalTarget()
  const layout = await resolveLayout(t, 'comfyui', root)
  const states = await checkPlanFiles(t, layout, img.files)
  const ck = states.find((s) => s.role === 'checkpoint')!
  assert.ok(['present', 'size_mismatch'].includes(ck.state))
  assert.ok(states.filter((s) => s.role === 'lora').every((s) => s.state === 'missing'))
})

test('sources: HF first then hf-mirror; prefer-mirror flips; Civitai keeps HF copy first', () => {
  const s = sourcesFor({ file: 'x', url: 'https://huggingface.co/a/b/resolve/main/x' })
  assert.deepEqual(s.map((x) => x.label), ['huggingface', 'hf-mirror'])
  assert.equal(s[1].url, 'https://hf-mirror.com/a/b/resolve/main/x')
  assert.deepEqual(sourcesFor({ file: 'x', url: 'https://huggingface.co/a/b/resolve/main/x' }, { preferMirror: true }).map((x) => x.label), ['hf-mirror', 'huggingface'])
  const c = sourcesFor({ file: 'nope.safetensors', url: 'https://civitai.com/api/download/models/1' })
  assert.equal(c[0].label, 'civitai')
})

test('paths and install settings normalisation', () => {
  assert.equal(normalizeTargetPath('windows', 'C:\\Users\\a', 'D:/AI/ComfyUI/'), 'D:\\AI\\ComfyUI')
  assert.equal(normalizeTargetPath('windows', 'C:\\Users\\a', '/D:/AI'), 'D:\\AI')
  assert.equal(normalizeTargetPath('linux', '/home/a', '~/ComfyUI/'), '/home/a/ComfyUI')
  assert.equal(toSftpPath('windows', 'C:\\a\\b'), '/C:/a/b')
  assert.equal(toSftpPath('linux', '/a/b'), '/a/b')
  assert.deepEqual(normalizeModelInstall({ mode: 'remote', root: '/x', remote: { host: ' h ', username: 'u', auth: 'key', privateKey: 'K', password: 'ignored' } }),
    { mode: 'remote', root: '/x', remote: { host: 'h', port: 22, username: 'u', auth: 'key', password: undefined, privateKey: 'K', passphrase: undefined } })
  assert.throws(() => normalizeModelInstall({ mode: 'remote', root: '/x', remote: { host: 'h', port: 70000 } }))
})

test('every default catalog file has verified sha256; HF files have exact sizes', async () => {
  const { STYLE_MODEL_CATALOG } = await import('../src/services/adapters/style-model-catalog')
  const { FILE_META } = await import('../src/services/model-installer/sources')
  const { getComfyTemplate } = await import('../src/services/adapters/comfyui-templates')
  for (const kind of ['sdwebui', 'hf_image', 'comfyui_video'] as const) {
    for (const p of Object.values<any>(STYLE_MODEL_CATALOG[kind])) {
      for (const f of [p.checkpoint, p.lora].filter(Boolean)) {
        const m = FILE_META[f.file]
        assert.ok(m?.sha256 && /^[0-9a-f]{64}$/.test(m.sha256), `${kind} ${f.file} sha256`)
        if (f.source === 'huggingface') assert.ok(m.bytes, `${f.file} bytes`)
      }
      if (p.template) for (const tf of getComfyTemplate('video', p.template)!.files) assert.ok(FILE_META[tf.file]?.bytes, tf.file)
    }
  }
  // Civitai 文件有 HF 副本时 HF 排第一
  const s = sourcesFor({ file: 'animagine-xl-4.0-opt.safetensors', url: 'https://civitai.com/api/download/models/1408658' })
  assert.deepEqual(s.map((x) => x.label), ['huggingface', 'hf-mirror', 'civitai', 'civitai-mirror'])
  assert.equal(s[3].url, 'https://civarchive.com/api/download/models/1408658')
  assert.equal(s[3].auth, undefined, 'never send the Civitai key to a mirror')
  const only = sourcesFor({ file: 'Comic_realism.safetensors', url: 'https://civitai.com/api/download/models/247021' })
  assert.deepEqual(only.map((x) => x.label), ['civitai', 'civitai-mirror'])
})

test('generation hook: missing style models are downloaded first (progress reported), then generation continues', async () => {
  const { ensureStyleModelsForTask } = await import('../src/services/model-installer/index')
  const { FILE_META } = await import('../src/services/model-installer/sources')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-auto-'))
  for (const d of ['comfy', 'models/checkpoints', 'models/loras']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'main.py'), '')
  // 推荐清单里的文件指向模拟服务器（大小 / 哈希按模拟数据）
  const saved = { a: FILE_META['sd_xl_base_1.0.safetensors'], b: FILE_META['watercolor_v1_sdxl.safetensors'] }
  FILE_META['sd_xl_base_1.0.safetensors'] = { bytes: PAYLOAD.length, sha256: SHA }
  FILE_META['watercolor_v1_sdxl.safetensors'] = { bytes: PAYLOAD.length, sha256: SHA }
  const realFetch = globalThis.fetch
  globalThis.fetch = ((url: any, init: any) => realFetch(String(url).startsWith('https://huggingface.co/') ? `${base}/ok/x` : url, init)) as any
  const reports: string[] = []
  try {
    const cfg = { provider: 'comfyui', baseUrl: '', apiKey: '', model: '', settings: { style_models_enabled: true, style_models_auto_download: true, model_install: { mode: 'local', root } } }
    // 没开自动下载：什么都不做
    await ensureStyleModelsForTask({ ...cfg, settings: { ...cfg.settings, style_models_auto_download: false } }, 'image', 'watercolor', (p) => reports.push(String(p.message)))
    assert.equal(reports.length, 0)
    await ensureStyleModelsForTask(cfg, 'image', 'watercolor', (p) => reports.push(String(p.message)))
    assert.ok(fs.existsSync(path.join(root, 'models', 'checkpoints', 'sd_xl_base_1.0.safetensors')))
    assert.ok(fs.existsSync(path.join(root, 'models', 'loras', 'watercolor_v1_sdxl.safetensors')))
    assert.ok(reports.some((m) => /下载风格模型/.test(m)), reports.join('\n'))
    assert.ok(reports.some((m) => /下载完成/.test(m)))
    // 再次调用：都齐了，直接返回
    const before = reports.length
    await ensureStyleModelsForTask(cfg, 'image', 'watercolor', (p) => reports.push(String(p.message)))
    assert.equal(reports.length, before + 1) // 只有一条「检查风格模型」
  } finally {
    globalThis.fetch = realFetch
    FILE_META['sd_xl_base_1.0.safetensors'] = saved.a
    FILE_META['watercolor_v1_sdxl.safetensors'] = saved.b
  }
})
