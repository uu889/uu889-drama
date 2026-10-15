/**
 * 视觉风格 → 模型：设置页 / 文档用的说明数据与下载命令（bash + PowerShell）
 *
 * 下载命令统一用 curl（Windows 10+ 自带 curl.exe），-o 指定文件名，保证与推荐清单里的文件名一致
 * （SD WebUI 的 <lora:名字:权重>、ComfyUI 的 lora_name、Fooocus 的 model_name 都按文件名引用）。
 * - Civitai：环境变量 CIVITAI_TOKEN 有值时自动带 ?token=（需要登录的模型必须带）
 * - Hugging Face：环境变量 HF_ENDPOINT 可切到镜像（如 https://hf-mirror.com），HF_TOKEN 用于需要同意协议的仓库
 */
import { getComfyTemplate } from './comfyui-templates'
import { MODEL_FOLDERS, STYLE_MODEL_CATALOG, type CatalogFile, type CatalogKind, type StyleImagePreset, type StyleVideoPreset } from './style-model-catalog'
import { STYLE_KEYS, catalogKindFor, type StyleKey } from './style-models'

export const STYLE_LABELS: Record<StyleKey, string> = {
  '3d': '3D 漫剧',
  anime: '日漫赛璐璐',
  ghibli: '吉卜力手绘',
  watercolor: '水彩绘本',
  comic: '美式漫画',
  guofeng: '国风 2.5D',
  webtoon: '韩系网漫',
  noir: '黑白漫画',
}

type ProviderKey = 'sdwebui' | 'comfyui' | 'fooocus'

/** 安装目录环境变量名 */
const DIR_VAR: Record<ProviderKey, string> = { sdwebui: 'SD_DIR', comfyui: 'COMFY_DIR', fooocus: 'FOOOCUS_DIR' }

export interface DownloadItem {
  file: string
  folder: string
  url: string
  source: 'civitai' | 'huggingface'
  page?: string
  size?: string
  login_required?: boolean
}

const HF_PREFIX = 'https://huggingface.co/'

function bashLine(provider: ProviderKey, item: DownloadItem): string {
  const target = `"$${DIR_VAR[provider]}/${item.folder}/${item.file}"`
  if (item.source === 'civitai') {
    return `curl -L -C - -o ${target} "${item.url}\${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"`
  }
  const url = item.url.startsWith(HF_PREFIX) ? `\${HF_ENDPOINT:-https://huggingface.co}/${item.url.slice(HF_PREFIX.length)}` : item.url
  const auth = item.login_required ? ' -H "Authorization: Bearer $HF_TOKEN"' : ''
  return `curl -L -C -${auth} -o ${target} "${url}"`
}

function psLine(provider: ProviderKey, item: DownloadItem): string {
  const target = `"$env:${DIR_VAR[provider]}\\${item.folder.replace(/\//g, '\\')}\\${item.file}"`
  if (item.source === 'civitai') return `curl.exe -L -C - -o ${target} "${item.url}$tk"`
  const url = item.url.startsWith(HF_PREFIX) ? `$hf/${item.url.slice(HF_PREFIX.length)}` : item.url
  const auth = item.login_required ? ' -H "Authorization: Bearer $env:HF_TOKEN"' : ''
  return `curl.exe -L -C -${auth} -o ${target} "${url}"`
}

/** 生成一组文件的下载脚本（去重；先建目录） */
export function buildDownloadScripts(provider: ProviderKey, items: DownloadItem[]): { bash: string; powershell: string } {
  const seen = new Set<string>()
  const list = items.filter((i) => {
    const key = `${i.folder}/${i.file}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const dir = DIR_VAR[provider]
  const folders = [...new Set(list.map((i) => i.folder))]
  const hasCivitai = list.some((i) => i.source === 'civitai')
  const hasHf = list.some((i) => i.source === 'huggingface')
  const example = provider === 'sdwebui' ? '~/stable-diffusion-webui' : provider === 'comfyui' ? '~/ComfyUI' : '~/Fooocus-API'
  const exampleWin = provider === 'sdwebui' ? 'D:\\stable-diffusion-webui' : provider === 'comfyui' ? 'D:\\ComfyUI' : 'D:\\Fooocus-API'

  const bash = [
    `# 安装目录（按实际路径修改）`,
    `export ${dir}=${example}`,
    ...(hasCivitai ? ['# Civitai API Key（civitai.com → 头像 → Account settings → API Keys）；需要登录的模型必须填', 'export CIVITAI_TOKEN='] : []),
    ...(hasHf ? ['# 国内网络可改用镜像：export HF_ENDPOINT=https://hf-mirror.com', 'export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}'] : []),
    `mkdir -p ${folders.map((f) => `"$${dir}/${f}"`).join(' ')}`,
    ...list.map((i) => bashLine(provider, i)),
  ].join('\n')

  const powershell = [
    `# 安装目录（按实际路径修改）`,
    `$env:${dir} = "${exampleWin}"`,
    ...(hasCivitai ? ['# Civitai API Key；需要登录的模型必须填', '$env:CIVITAI_TOKEN = ""', '$tk = if ($env:CIVITAI_TOKEN) { "?token=$env:CIVITAI_TOKEN" } else { "" }'] : []),
    ...(hasHf ? ['# 国内网络可改用镜像："https://hf-mirror.com"', '$hf = if ($env:HF_ENDPOINT) { $env:HF_ENDPOINT } else { "https://huggingface.co" }'] : []),
    ...folders.map((f) => `New-Item -ItemType Directory -Force -Path "$env:${dir}\\${f.replace(/\//g, '\\')}" | Out-Null`),
    ...list.map((i) => psLine(provider, i)),
  ].join('\n')
  return { bash, powershell }
}

function toItem(f: CatalogFile, folder: string): DownloadItem {
  return { file: f.file, folder, url: f.url, source: f.source, page: f.page, size: f.size, login_required: f.loginRequired || undefined }
}

function fileView(f: CatalogFile | null | undefined) {
  if (!f) return null
  return {
    name: f.name, file: f.file, source: f.source, page: f.page, url: f.url, size: f.size, base_model: f.baseModel,
    license: f.license, trigger: f.trigger, weight: f.weight, apply_to: f.applyTo, login_required: !!f.loginRequired, note: f.note,
  }
}

/** 某个服务商 + 服务类型的完整说明：每个风格用哪些模型、放哪个目录、下载命令、接口里怎么传 */
export function describeStyleModelCatalog(provider: string, serviceType: 'image' | 'video') {
  const kind = catalogKindFor(provider, serviceType)
  if (!kind) return null
  const p = provider as ProviderKey
  const folders = MODEL_FOLDERS[p]
  const loraFolder = folders.lora
  const ckptFolder = folders.checkpoint

  const styles = STYLE_KEYS.map((style) => {
    const preset = (STYLE_MODEL_CATALOG[kind] as Record<StyleKey, StyleImagePreset | StyleVideoPreset>)[style]
    const items: DownloadItem[] = []
    if (!preset) return { style, label: STYLE_LABELS[style], available: false, downloads: [], scripts: buildDownloadScripts(p, []) }
    if (kind === 'comfyui_video') {
      const v = preset as StyleVideoPreset
      const tpl = getComfyTemplate('video', v.template)
      for (const f of tpl?.files || []) items.push({ file: f.file, folder: f.folder, url: f.url, source: 'huggingface' })
      if (v.lora) items.push(toItem(v.lora, loraFolder))
      return {
        style,
        label: STYLE_LABELS[style],
        available: true,
        template: v.template,
        template_label: tpl?.label,
        lora: fileView(v.lora),
        note: v.note,
        downloads: items,
        scripts: buildDownloadScripts(p, items),
      }
    }
    const img = preset as StyleImagePreset
    items.push(toItem(img.checkpoint, ckptFolder))
    if (img.lora) items.push(toItem(img.lora, loraFolder))
    return {
      style,
      label: STYLE_LABELS[style],
      available: true,
      checkpoint: fileView(img.checkpoint),
      lora: fileView(img.lora),
      params: img.params || {},
      note: img.note,
      downloads: items,
      scripts: buildDownloadScripts(p, items),
    }
  })
  const all = styles.flatMap((s) => s.downloads)
  return {
    provider,
    service_type: serviceType,
    catalog: kind as CatalogKind,
    folders,
    dir_var: DIR_VAR[p],
    styles,
    /** 全部风格一次下载 */
    scripts_all: buildDownloadScripts(p, all),
    usage: usageNote(p, serviceType),
  }
}

/** 接口里风格模型是怎么传过去的（设置页 / 文档展示） */
function usageNote(provider: ProviderKey, serviceType: 'image' | 'video'): string {
  if (provider === 'sdwebui') {
    return 'POST /sdapi/v1/txt2img：override_settings.sd_model_checkpoint = Checkpoint（不带扩展名也可），提示词末尾追加 <lora:LoRA文件名(不含扩展名):权重>，触发词放在提示词最前；Clip skip 写入 override_settings.CLIP_stopAtLastLayers；采样器 / 步数 / CFG / 尺寸在你没填时用推荐值'
  }
  if (provider === 'fooocus') {
    return 'POST /v1/generation/text-to-image（有参考图时 /v2/generation/text-to-image-with-ip）：base_model_name = Checkpoint 文件名，loras = [{ enabled: true, model_name: LoRA 文件名, weight }]（替换 Fooocus 默认 LoRA），触发词放在提示词最前，guidance_scale 用推荐 CFG'
  }
  if (serviceType === 'video') {
    return 'POST /prompt：没选模板、「模型」也没指向模板时用风格推荐模板（风格覆盖里填了模板则优先），在 Wan 14B 的低噪声 UNETLoader 后插入 LoraLoaderModelOnly 挂风格 LoRA（Wan 2.1 14B LoRA 可直接用于 2.2 14B；TI2V 5B / MiniMax H3 自动跳过 LoRA），触发词放在提示词最前。画风主要靠首帧：先用风格生图模型出分镜图再图生视频'
  }
  return 'POST /prompt：风格 Checkpoint 写入 CheckpointLoaderSimple.ckpt_name（内置模板固定用 SDXL），在 Checkpoint 后插入 LoraLoader（MODEL + CLIP）挂风格 LoRA，触发词放在提示词最前，步数 / CFG / 尺寸在你没填时用推荐值'
}
