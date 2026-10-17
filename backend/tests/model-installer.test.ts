import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'

// 任务记录写到临时数据目录（必须在导入 jobs 之前设置）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-data-'))
process.env.UU889_DATA_DIR = DATA
// 大部分用例测程序内下载器；后台进程下载在下面的「退出程序」用例里单独测
process.env.MODEL_INSTALLER_DETACHED = '0'

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
        // /slower 约 5 秒下完，用来模拟下载途中退出程序
        const tick = setInterval(() => {
          if (off >= body.length || res.destroyed) { clearInterval(tick); res.end(); return }
          res.write(body.subarray(off, off + 64 * 1024))
          off += 64 * 1024
        }, url.startsWith('/slower') ? 100 : 20)
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

test('generation hook: concurrent tasks with different styles share the base checkpoint download and both wait for it', async () => {
  const { ensureStyleModelsForTask } = await import('../src/services/model-installer/index')
  const { listJobs } = await import('../src/services/model-installer/jobs')
  const { FILE_META } = await import('../src/services/model-installer/sources')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-auto2-'))
  for (const d of ['comfy', 'models/checkpoints', 'models/loras']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'main.py'), '')
  const names = ['sd_xl_base_1.0.safetensors', 'watercolor_v1_sdxl.safetensors', 'comic-ink-halftone.safetensors']
  const saved = names.map((n) => FILE_META[n])
  for (const n of names) FILE_META[n] = { bytes: PAYLOAD.length, sha256: SHA }
  const hits: Record<string, number> = {}
  const realFetch = globalThis.fetch
  globalThis.fetch = ((url: any, init: any) => {
    const u = String(url)
    if (!u.startsWith('https://huggingface.co/')) return realFetch(url, init)
    const name = names.find((n) => u.includes(n)) || 'other'
    hits[name] = (hits[name] || 0) + 1
    // 底模慢、LoRA 快：没修之前，后来的任务只等自己的 LoRA，会在底模下完前就开始生成
    return realFetch(name === names[0] ? `${base}/slow/base` : `${base}/ok/lora`, init)
  }) as any
  try {
    const cfg = { provider: 'comfyui', baseUrl: '', apiKey: '', model: '', settings: { style_models_enabled: true, style_models_auto_download: true, model_install: { mode: 'local', root } } }
    const baseFile = path.join(root, 'models', 'checkpoints', names[0])
    const reports: string[] = []
    const run = (style: string) => ensureStyleModelsForTask(cfg, 'image', style, (p) => reports.push(String(p.message)))
      .then(() => fs.existsSync(baseFile))
    // 同一风格两个任务 + 另一个风格一个任务，同时开始
    const ready = await Promise.all([run('watercolor'), run('watercolor'), run('comic')])
    assert.deepEqual(ready, [true, true, true], '每个任务都要等底模下完才返回')
    assert.equal(hits[names[0]], 1, '底模只下载一次')
    assert.equal(hits[names[1]], 1, '同一风格的 LoRA 只下载一次')
    assert.equal(hits[names[2]], 1)
    const items = listJobs().filter((j) => j.root === root).flatMap((j) => j.items.map((i) => i.file))
    assert.deepEqual(items.sort(), [...names].sort(), '每个文件只在一个下载任务里')
    assert.ok(reports.some((m) => /共用同一份下载/.test(m)), reports.join('\n'))
  } finally {
    globalThis.fetch = realFetch
    names.forEach((n, i) => { FILE_META[n] = saved[i] })
  }
})

// ─── 退出程序 / 电脑重启：下载不中断、下次打开接着下、没下完的模型不会被用到 ──────

const JOBS_MODULE = path.resolve('src/services/model-installer/jobs.ts')

/** 在单独的进程里跑一段代码，模拟一次「打开 UU889-Drama」（kill 它 = 退出程序） */
function appProcess(dataDir: string, code: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-app-')), 'app.mts')
  fs.writeFileSync(file, `const J = await import(${JSON.stringify(JOBS_MODULE)})\n${code}`)
  const child = spawn(process.execPath, ['--import', 'tsx', file], {
    cwd: process.cwd(),
    env: { ...process.env, UU889_DATA_DIR: dataDir, MODEL_INSTALLER_DETACHED: '1', NO_PROXY: '*', no_proxy: '*' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout!.on('data', (c) => { out += c })
  child.stderr!.on('data', (c) => { out += c })
  const waitFor = (re: RegExp, ms = 30_000) => new Promise<string>((resolve, reject) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      const m = re.exec(out)
      if (m) { clearInterval(iv); resolve(m[0]) } else if (Date.now() - t0 > ms || child.exitCode != null) { clearInterval(iv); reject(new Error(`app process: ${re} not seen; output:\n${out}`)) }
    }, 50)
  })
  const exited = new Promise<void>((r) => child.once('exit', () => r()))
  return { child, waitFor, exited, output: () => out }
}

function createSlowJobCode(root: string, name: string) {
  return `
const dest = ${JSON.stringify(path.join(root, 'models', 'checkpoints'))} + '/' + ${JSON.stringify(name)}
J.createJob({ provider: 'comfyui', serviceType: 'image', styles: ['anime'], root: ${JSON.stringify(root)}, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
  files: [{ key: 'checkpoint:${name}', name: '${name}', file: '${name}', role: 'checkpoint', styles: ['anime'], url: '${base}/slower/${name}', bytes: ${PAYLOAD.length}, sha256: '${SHA}',
    sources: [{ label: 'huggingface', url: '${base}/slower/${name}' }], dest, state: 'missing', currentBytes: 0, partBytes: 0 }] })
const iv = setInterval(() => { const j = J.getJob(J.listJobs()[0].id); if (j.remote?.jobDir) { clearInterval(iv); console.log('LAUNCHED'); setInterval(() => {}, 1000) } }, 50)
`
}

const RESUME_CODE = `
J.resumeJobsOnStartup()
const iv = setInterval(() => { const j = J.listJobs()[0]; if (j.status !== 'running' && j.status !== 'queued') { clearInterval(iv); console.log('STATUS=' + j.status + ' MSG=' + (j.message || '') + ' ERR=' + (j.error || '')); process.exit(0) } }, 200)
`

test('quitting UU889-Drama mid-download: local download keeps running in the background and the next start sees it finished', { skip: process.platform === 'win32' }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-quit-data-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-quit-root-'))
  const dest = path.join(root, 'models', 'checkpoints', 'q.safetensors')
  const app1 = appProcess(data, createSlowJobCode(root, 'q.safetensors'))
  await app1.waitFor(/LAUNCHED/)
  await new Promise((r) => setTimeout(r, 800))
  app1.child.kill('SIGKILL') // 退出程序（连收尾都没有）
  await app1.exited
  assert.ok(!fs.existsSync(dest), '刚退出时还没下完，正式文件名下不能有文件')
  // 程序关着，下载照样下完
  const t0 = Date.now()
  while (!fs.existsSync(dest) && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 200))
  assert.ok(fs.existsSync(dest), '程序关闭期间后台进程把文件下完了')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'), SHA)
  // 再次打开：读到「已完成」
  const app2 = appProcess(data, RESUME_CODE)
  const line = await app2.waitFor(/STATUS=\S+/)
  assert.equal(line, 'STATUS=done', app2.output())
})

test('download process killed (e.g. computer restarted): next start resumes automatically from the partial file', { skip: process.platform === 'win32' }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-reboot-data-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-reboot-root-'))
  const dest = path.join(root, 'models', 'checkpoints', 'r.safetensors')
  const app1 = appProcess(data, createSlowJobCode(root, 'r.safetensors'))
  await app1.waitFor(/LAUNCHED/)
  await new Promise((r) => setTimeout(r, 1500))
  app1.child.kill('SIGKILL')
  await app1.exited
  // 「电脑重启」：后台下载进程（和它的 curl）也没了
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'model-downloads', 'jobs.json'), 'utf8'))
  const jobDir = saved[0].remote.jobDir
  const pid = Number(fs.readFileSync(path.join(jobDir, 'pid'), 'utf8').trim())
  process.kill(-pid, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 300))
  const partBytes = fs.statSync(`${dest}.uu889part`).size
  assert.ok(partBytes > 0 && partBytes < PAYLOAD.length, `留下了没下完的 .uu889part（${partBytes}）`)
  assert.ok(!fs.existsSync(dest), '没下完的文件不会出现在正式文件名下')
  // 模拟过了一段时间（跳过启动后 20 秒的宽限）
  saved[0].remote.launchedAt = 0
  fs.writeFileSync(path.join(data, 'model-downloads', 'jobs.json'), JSON.stringify(saved))
  rangeHits = 0
  const app2 = appProcess(data, RESUME_CODE)
  const line = await app2.waitFor(/STATUS=\S+ MSG=[^\n]*/, 60_000)
  assert.match(line, /^STATUS=done/, app2.output())
  assert.ok(rangeHits >= 1, '从 .uu889part 断点续传，而不是从头下')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex'), SHA)
  assert.ok(!fs.existsSync(path.join(jobDir, 'run.sh')), '下完后删掉脚本（里面可能有 Token）')
})

test('generation waits for a model that is still downloading even when auto-download is off', async () => {
  const { ensureStyleModelsForTask } = await import('../src/services/model-installer/index')
  const { FILE_META } = await import('../src/services/model-installer/sources')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-manual-'))
  for (const d of ['comfy', 'models/checkpoints', 'models/loras']) fs.mkdirSync(path.join(root, d), { recursive: true })
  fs.writeFileSync(path.join(root, 'main.py'), '')
  const name = 'watercolor_v1_sdxl.safetensors'
  const savedMeta = FILE_META[name]
  FILE_META[name] = { bytes: PAYLOAD.length, sha256: SHA }
  try {
    const dest = path.join(root, 'models', 'loras', name)
    // 手动在「一键下载」里开始的下载（比如上次没下完、程序重启后接着下的）
    createJob({
      provider: 'comfyui', serviceType: 'image', styles: ['watercolor'], root, target: { mode: 'local' }, fsInfo: { os: 'linux', hostname: 'h' },
      files: [{ ...fakeFile(path.dirname(dest), name, [{ label: 'huggingface', url: `${base}/slower/w` }]), key: `lora:${name}`, role: 'lora' as const }],
    })
    const reports: string[] = []
    const cfg = { provider: 'comfyui', settings: { style_models_enabled: true, style_models_auto_download: false, model_install: { mode: 'local', root } } }
    await ensureStyleModelsForTask(cfg, 'image', 'watercolor', (p) => reports.push(String(p.message)))
    assert.ok(fs.existsSync(dest), '返回时模型已经下完')
    assert.ok(reports.some((m) => /正在下载风格模型/.test(m)), reports.join('\n'))
    // 另一个风格用不到这个文件：不等
    const before = reports.length
    await ensureStyleModelsForTask(cfg, 'image', 'comic', (p) => reports.push(String(p.message)))
    assert.equal(reports.length, before)
  } finally {
    FILE_META[name] = savedMeta
  }
})

test('background script: unknown-size files under 1 MB are not accepted as models', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-mi-small-'))
  const jobDir = path.join(dir, 'job')
  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'tiny.safetensors'), 'oops')
  const items = [{ dest: path.join(dir, 'tiny.safetensors'), sources: [{ label: 'huggingface', url: `${base}/html/x` }] }]
  const sp = path.join(jobDir, 'run.sh')
  fs.writeFileSync(sp, buildPosixScript('t3', jobDir, items).replace(/sleep 5/g, 'sleep 0'))
  await new Promise<void>((resolve, reject) => {
    execFile('sh', [sp], { timeout: 60_000, env: { ...process.env, NO_PROXY: '*', no_proxy: '*' } }, (err) => (err ? reject(err) : resolve()))
  })
  const parsed = parseStatusLog(fs.readFileSync(path.join(jobDir, 'status.log'), 'utf8'), 1)
  assert.equal(parsed.items[0].status, 'failed', '已有的 4 字节文件不算下好了；下到的网页也不算模型')
  assert.equal(fs.readFileSync(items[0].dest, 'utf8'), 'oops')
})

// ─── 证书（私钥）登录：格式转换与错误提示 ─────────────────────────────────
test('private keys: PKCS#8 (RSA / EC / Ed25519, encrypted) and PuTTY ppk v3 convert to keys ssh2 can use', async () => {
  const { checkPrivateKey } = await import('../src/services/model-installer/target')
  const ssh2: any = await import('ssh2')
  const utils = ssh2.utils ?? ssh2.default.utils
  const pubOf = (pem: string, pass?: string) => {
    const k = utils.parseKey(pem, pass)
    return (Array.isArray(k) ? k[0] : k).getPublicSSH().toString('base64')
  }
  for (const [type, opts] of [['rsa', { modulusLength: 2048 }], ['ec', { namedCurve: 'P-256' }], ['ed25519', {}]] as const) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync(type as any, opts as any)
    const expected = (() => {
      const jwk: any = publicKey.export({ format: 'jwk' })
      return jwk
    })()
    const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    const r = await checkPrivateKey(pkcs8)
    assert.equal(r.converted, 'PKCS#8', type)
    assert.ok(pubOf(r.key).length > 20, type)
    const enc = privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }) as string
    await assert.rejects(checkPrivateKey(enc), /私钥密码/)
    await assert.rejects(checkPrivateKey(enc, 'wrong'), /私钥密码不对/)
    const r2 = await checkPrivateKey(enc, 'pw')
    assert.equal(pubOf(r2.key), pubOf(r.key), `${type} encrypted pkcs8 → same key`)
    void expected
  }
})

test('private keys: PuTTY ppk v3 (unencrypted) converts; encrypted v3 explains how to export', async () => {
  const { checkPrivateKey } = await import('../src/services/model-installer/target')
  const str = (b: Buffer | string) => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b); const l = Buffer.alloc(4); l.writeUInt32BE(x.length); return Buffer.concat([l, x]) }
  const mp = (b: Buffer) => str(b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b)
  const ppk = (algo: string, pub: Buffer, priv: Buffer, enc = 'none') => {
    const lines = (b: Buffer) => b.toString('base64').match(/.{1,64}/g)!
    const pl = lines(pub); const vl = lines(priv)
    return [`PuTTY-User-Key-File-3: ${algo}`, `Encryption: ${enc}`, 'Comment: test', `Public-Lines: ${pl.length}`, ...pl, `Private-Lines: ${vl.length}`, ...vl, 'Private-MAC: 00'].join('\n')
  }
  // Ed25519
  const ed = crypto.generateKeyPairSync('ed25519')
  const ej: any = ed.privateKey.export({ format: 'jwk' })
  const edPub = Buffer.from(ej.x, 'base64url')
  const r = await checkPrivateKey(ppk('ssh-ed25519', Buffer.concat([str('ssh-ed25519'), str(edPub)]), str(Buffer.from(ej.d, 'base64url'))))
  assert.equal(r.converted, 'PuTTY ppk v3')
  assert.match(r.key, /BEGIN OPENSSH PRIVATE KEY/)
  // RSA
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const rj: any = rsa.privateKey.export({ format: 'jwk' })
  const B = (s: string) => Buffer.from(s, 'base64url')
  const rr = await checkPrivateKey(ppk('ssh-rsa', Buffer.concat([str('ssh-rsa'), mp(B(rj.e)), mp(B(rj.n))]), Buffer.concat([mp(B(rj.d)), mp(B(rj.p)), mp(B(rj.q)), mp(B(rj.qi))])))
  assert.match(rr.key, /BEGIN RSA PRIVATE KEY/)
  // ECDSA P-256
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const cj: any = ec.privateKey.export({ format: 'jwk' })
  const Q = Buffer.concat([Buffer.from([4]), B(cj.x), B(cj.y)])
  const er = await checkPrivateKey(ppk('ecdsa-sha2-nistp256', Buffer.concat([str('ecdsa-sha2-nistp256'), str('nistp256'), str(Q)]), mp(B(cj.d))))
  assert.match(er.key, /BEGIN EC PRIVATE KEY/)
  await assert.rejects(checkPrivateKey(ppk('ssh-ed25519', Buffer.alloc(8), Buffer.alloc(8), 'aes256-cbc'), 'x'), /PuTTYgen/)
})

test('private keys: friendly errors for public keys, certificates and garbage', async () => {
  const { checkPrivateKey } = await import('../src/services/model-installer/target')
  await assert.rejects(checkPrivateKey(''), /选择私钥文件/)
  await assert.rejects(checkPrivateKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH user@host'), /公钥/)
  await assert.rejects(checkPrivateKey('ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQ= user'), /OpenSSH 证书/)
  await assert.rejects(checkPrivateKey('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'), /SSL 证书/)
  await assert.rejects(checkPrivateKey('not a key'), /私钥格式不支持/)
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
  const ok = await checkPrivateKey(pem.replace(/\n/g, '\r\n'))
  assert.equal(ok.converted, null)
  assert.ok(!ok.key.includes('\r'))
})
