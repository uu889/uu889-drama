/**
 * 本地生图服务连不上 / 接口 404 时，探测这个地址上实际跑的是什么程序，给出能直接照做的修改建议。
 *
 * 常见情况：
 * - SD WebUI / Forge 没加 --api（网页能打开，/sdapi/v1/* 全是 404 {"detail":"Not Found"}）
 * - 地址其实是 Fooocus-API / Fooocus 网页版 / ComfyUI / InvokeAI（服务商选错）
 * - 反向代理带了路径前缀、端口填成了网页端口 / 外网映射端口不对
 */
export type LocalProvider = 'sdwebui' | 'comfyui' | 'fooocus'

export type DetectedService =
  | 'sdwebui_api'
  | 'sdwebui_no_api'
  | 'fooocus_api'
  | 'fooocus_web'
  | 'comfyui'
  | 'invokeai'
  | 'gradio_other'
  | 'fastapi_other'
  | 'unknown'
  | 'unreachable'

export interface LocalDiagnosis {
  detected: DetectedService
  /** 识别出的程序名 */
  label: string
  /** 一句话结论 + 怎么改（中文） */
  message: string
  /** 应该改用的服务商（服务商选错时） */
  suggest_provider?: LocalProvider
}

const PROVIDER_NAMES: Record<LocalProvider, string> = { sdwebui: 'Stable Diffusion WebUI', comfyui: 'ComfyUI', fooocus: 'Fooocus' }

/** 把 Node fetch 的「fetch failed」展开成具体原因（连接被拒 / 超时 / 找不到主机 / 证书 / 被重置） */
export function describeFetchError(err: any): string {
  const code = String(err?.cause?.code || err?.code || err?.cause?.name || err?.name || '')
  const msg = String(err?.cause?.message || err?.message || err || '')
  if (/ECONNREFUSED/.test(code + msg)) return '连接被拒绝（ECONNREFUSED）：这个 IP 和端口上没有程序在监听'
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return '找不到主机（DNS 解析失败）'
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|TimeoutError|AbortError|timeout/i.test(code + msg)) return '连接超时：请求发出去了但没有回应'
  if (/ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(code + msg)) return '连接被重置：对方或中间的防火墙 / 代理断开了连接'
  if (/EHOSTUNREACH|ENETUNREACH/.test(code + msg)) return '网络不可达：到这个 IP 没有路由'
  if (/CERT|SSL|TLS|self.signed/i.test(code + msg)) return `HTTPS 证书错误（${msg}）：本地服务一般是 http://，不要写成 https://`
  return msg && msg !== 'fetch failed' ? msg : `请求失败（${code || 'fetch failed'}）`
}

async function probe(url: string, headers: Record<string, string>) {
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(6000), redirect: 'follow' })
    const text = await resp.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* 非 JSON */ }
    return { status: resp.status, text: text.slice(0, 200_000), json }
  } catch (err: any) {
    return { status: 0, text: '', json: null, error: `${err?.cause?.code || ''} ${err?.name || ''} ${err?.message || ''}` }
  }
}

const SD_NO_API_FIX = '在启动参数里加 --api 后重启：Windows 编辑 webui-user.bat，把 set COMMANDLINE_ARGS= 改成 set COMMANDLINE_ARGS=--api（已有其他参数就在后面加空格 --api）；Linux / macOS 运行 ./webui.sh --api；秋叶整合包在启动器「高级选项」里打开「启用 API」；Forge 同样加 --api。改完浏览器打开「地址/docs」能看到 /sdapi/v1/txt2img 就对了'

export async function diagnoseLocalService(expected: LocalProvider, baseUrl: string, headers: Record<string, string> = {}): Promise<LocalDiagnosis> {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return { detected: 'unknown', label: '', message: '请先填写 Base URL' }
  const [openapi, stats, config, root] = await Promise.all([
    probe(`${base}/openapi.json`, headers),
    probe(`${base}/system_stats`, headers),
    probe(`${base}/config`, headers),
    probe(`${base}/`, headers),
  ])

  if (!openapi.status && !stats.status && !config.status && !root.status) {
    const code = root.error || openapi.error || ''
    const listen = expected === 'comfyui'
      ? 'ComfyUI 默认只监听本机 127.0.0.1：要让别的机器访问，启动时加 --listen 0.0.0.0 --port 端口（如 python main.py --listen 0.0.0.0 --port 9099）'
      : expected === 'fooocus'
        ? 'Fooocus-API 要用 --host 0.0.0.0 启动（python main.py --host 0.0.0.0 --port 8888）'
        : 'SD WebUI 要加 --listen（以及 --api）启动，才能被别的机器访问'
    const remote = /^https?:\/\/(localhost|127\.|\[::1\])/i.test(base)
      ? ''
      : '；云服务器（阿里云 / 腾讯云等）还要在「安全组」放行这个端口，系统防火墙（ufw / firewalld / Windows 防火墙）也要放行；如果 UU889-Drama 本身部署在服务器上，是服务器去连这个地址，不是你的浏览器'
    const hint = /ECONNREFUSED/.test(code)
      ? `连接被拒绝：这个端口上没有程序在监听。确认 ${PROVIDER_NAMES[expected]} 已启动、端口号写对；${listen}`
      : /ENOTFOUND|EAI_AGAIN/.test(code) ? '找不到这个主机名，请检查地址'
        : /TIMEOUT|ETIMEDOUT|aborted|AbortError/i.test(code) ? `连接超时：请求发出去了但没有回应，多半是端口被防火墙 / 安全组拦住，或服务只监听了 127.0.0.1。${listen}${remote}`
          : /ECONNRESET|UND_ERR_SOCKET/.test(code) ? `连接被重置：防火墙或代理断开了连接。${listen}${remote}`
            : `连接失败（${code.trim() || '未知错误'}）。${listen}${remote}`
    return { detected: 'unreachable', label: '', message: /ECONNREFUSED/.test(code) ? `${hint}${remote}` : hint }
  }

  const paths = openapi.json && typeof openapi.json.paths === 'object' ? Object.keys(openapi.json.paths) : []
  const title = String(config.json?.title || (root.text.match(/<title>([^<]*)<\/title>/i) || [])[1] || '')
  const isGradio = !!(config.json && (config.json.version || config.json.components || config.json.mode))
  const bodyText = `${title} ${root.text.slice(0, 5000)}`

  let d: LocalDiagnosis
  if (paths.some((p) => p.startsWith('/sdapi/v1/'))) {
    d = { detected: 'sdwebui_api', label: 'Stable Diffusion WebUI（API 已开启）', message: '这是 Stable Diffusion WebUI，API 已开启' }
  } else if (paths.some((p) => p.startsWith('/v1/generation/'))) {
    d = { detected: 'fooocus_api', label: 'Fooocus-API', message: '这个地址是 Fooocus-API', suggest_provider: 'fooocus' }
  } else if (stats.json && stats.json.system && (stats.json.devices || stats.json.system.comfyui_version || stats.json.system.python_version)) {
    d = { detected: 'comfyui', label: 'ComfyUI', message: '这个地址是 ComfyUI', suggest_provider: 'comfyui' }
  } else if (paths.some((p) => p.startsWith('/api/v1/queue') || p.startsWith('/api/v2/models')) || /InvokeAI/i.test(bodyText)) {
    d = { detected: 'invokeai', label: 'InvokeAI', message: '这个地址是 InvokeAI，UU889-Drama 暂不支持；请改用 Stable Diffusion WebUI / ComfyUI / Fooocus' }
  } else if (isGradio && /fooocus/i.test(bodyText)) {
    d = { detected: 'fooocus_web', label: 'Fooocus 网页版', message: '这是 Fooocus 网页版（没有接口）。请改用 Fooocus-API（https://github.com/mrhan1993/Fooocus-API，默认端口 8888），服务商选 Fooocus', suggest_provider: 'fooocus' }
  } else if (isGradio && /stable diffusion|sd-webui|forge|txt2img/i.test(`${bodyText} ${JSON.stringify(config.json).slice(0, 20000)}`)) {
    d = { detected: 'sdwebui_no_api', label: 'Stable Diffusion WebUI（未开启 API）', message: `这是 Stable Diffusion WebUI，但没有开启 API（所以 /sdapi/v1/* 都是 404）。${SD_NO_API_FIX}` }
  } else if (isGradio) {
    d = { detected: 'gradio_other', label: title || 'Gradio 网页', message: `这个地址是一个 Gradio 网页${title ? `（${title}）` : ''}，不是支持的接口服务。如果它是 SD WebUI：${SD_NO_API_FIX}` }
  } else if (openapi.json?.openapi || /"detail"\s*:\s*"Not Found"/.test(root.text)) {
    d = { detected: 'fastapi_other', label: '未知的 FastAPI 服务', message: `这个端口上的程序有响应，但没有 ${PROVIDER_NAMES[expected]} 的接口。最常见的是 SD WebUI 没加 --api：${SD_NO_API_FIX}；也可能是端口填错了（SD WebUI 默认 7860、ComfyUI 8188、Fooocus-API 8888），或经过了带路径前缀的反向代理（Base URL 要写到前缀为止，如 http://host/sd）` }
  } else {
    d = { detected: 'unknown', label: '', message: `这个地址有响应（HTTP ${root.status || openapi.status}），但识别不出是什么程序。请确认 Base URL 是 ${PROVIDER_NAMES[expected]} 的接口地址（不是网页反代或面板地址），端口和路径前缀正确` }
  }

  // 服务商选错时给出明确的改法
  if (d.suggest_provider && d.suggest_provider !== expected) {
    d.message = `${d.message}，不是 ${PROVIDER_NAMES[expected]}：请把服务商改成「${PROVIDER_NAMES[d.suggest_provider]}」（或在 ${PROVIDER_NAMES[expected]} 里换成它自己的地址）`
  } else if (d.detected === 'sdwebui_api' && expected === 'sdwebui') {
    d.message = '这是 Stable Diffusion WebUI，API 已开启；如果仍然 401 / 403，请检查 --api-auth 的「用户名:密码」'
  }
  return d
}
