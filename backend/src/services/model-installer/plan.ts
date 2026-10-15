/**
 * 按视觉风格算出「需要哪些模型文件、放到哪里、本机 / 远程上还缺哪些」。
 *
 * - 生图：每个风格的 Checkpoint + 风格 LoRA（尊重设置页里的风格覆盖；覆盖成清单里没有的文件时无法自动下载）
 * - 生视频（ComfyUI）：实际会用到的内置模板的基础模型（扩散模型 / 文本编码器 / VAE）+ 风格 LoRA（只在 14B 模板上）
 */
import { STYLE_MODEL_CATALOG, type CatalogFile, type StyleImagePreset, type StyleVideoPreset } from '../adapters/style-model-catalog'
import { STYLE_KEYS, catalogKindFor, isStyleKey, resolveStyleModels, type StyleKey } from '../adapters/style-models'
import { DEFAULT_VIDEO_TEMPLATE_ID, getComfyTemplate, resolveComfyTemplate } from '../adapters/comfyui-templates'
import { hasWan14bModel } from '../adapters/comfyui-lora'
import { parseComfyWorkflow } from '../adapters/comfyui-common'
import { FILE_META, sourcesFor, type DownloadSource } from './sources'
import type { FolderRole, InstallLayout, InstallProvider } from './detect'
import type { TargetFs } from './target'

export interface PlanFile {
  key: string
  name: string
  file: string
  role: FolderRole
  styles: StyleKey[]
  page?: string
  url: string
  size?: string
  bytes?: number
  sha256?: string
  licenseStatus?: string
  licenseNote?: string
  sources: DownloadSource[]
}

export interface PlanSkip {
  style: StyleKey
  file: string
  reason: string
}

export interface PlanFileState extends PlanFile {
  dest: string
  state: 'present' | 'partial' | 'missing' | 'size_mismatch'
  currentBytes: number
  partBytes: number
}

const FOLDER_ROLE: Record<string, FolderRole> = {
  diffusion_models: 'diffusion_models',
  unet: 'diffusion_models',
  text_encoders: 'text_encoders',
  clip: 'text_encoders',
  vae: 'vae',
  loras: 'lora',
  checkpoints: 'checkpoint',
}

/** 在整个清单（默认 + 可选替代）里按文件名找下载信息 */
function findCatalogFile(file: string): CatalogFile | null {
  for (const kind of Object.keys(STYLE_MODEL_CATALOG) as Array<keyof typeof STYLE_MODEL_CATALOG>) {
    for (const preset of Object.values(STYLE_MODEL_CATALOG[kind]) as Array<StyleImagePreset | StyleVideoPreset>) {
      const list = [(preset as StyleImagePreset).checkpoint, preset.lora, ...(preset.alternatives || [])]
      for (const f of list) if (f && f.file === file) return f
    }
  }
  return null
}

function fromCatalog(f: CatalogFile, role: FolderRole, style: StyleKey, preferMirror: boolean): PlanFile {
  const meta = FILE_META[f.file] || {}
  return {
    key: `${role}:${f.file}`,
    name: f.name,
    file: f.file,
    role,
    styles: [style],
    page: f.page,
    url: f.url,
    size: f.size,
    bytes: meta.bytes,
    sha256: meta.sha256,
    licenseStatus: f.licenseStatus,
    licenseNote: f.licenseNote,
    sources: sourcesFor(f, { preferMirror }),
  }
}

export interface BuildPlanInput {
  provider: InstallProvider
  serviceType: 'image' | 'video'
  styles: string[]
  /** 服务配置的 settings（风格覆盖、模板选择等） */
  settings?: Record<string, any> | null
  /** 服务配置里的「模型」 */
  model?: string
  preferMirror?: boolean
}

export function buildPlanFiles(input: BuildPlanInput): { files: PlanFile[]; skipped: PlanSkip[]; notes: string[] } {
  const kind = catalogKindFor(input.provider, input.serviceType)
  if (!kind) throw new Error('只有 Stable Diffusion WebUI / ComfyUI / Fooocus（生图）和 ComfyUI（生视频）支持按风格下载模型')
  const settings: Record<string, any> = { ...(input.settings || {}), style_models_enabled: true }
  const preferMirror = !!input.preferMirror
  const files = new Map<string, PlanFile>()
  const skipped: PlanSkip[] = []
  const notes: string[] = []
  const add = (pf: PlanFile) => {
    const prev = files.get(pf.key)
    if (prev) {
      for (const s of pf.styles) if (!prev.styles.includes(s)) prev.styles.push(s)
    } else {
      files.set(pf.key, pf)
    }
  }
  const styles = [...new Set(input.styles.filter(isStyleKey))] as StyleKey[]
  if (!styles.length) throw new Error('请选择至少一个视觉风格')

  for (const style of styles) {
    const sm = resolveStyleModels(input.provider, input.serviceType, settings, style)
    if (!sm) continue
    if (input.serviceType === 'image') {
      if (sm.checkpoint) {
        const f = findCatalogFile(sm.checkpoint)
        if (f) add(fromCatalog(f, 'checkpoint', style, preferMirror))
        else skipped.push({ style, file: sm.checkpoint, reason: '风格覆盖里填的 Checkpoint 不在推荐清单里，无法自动下载，请自行放进模型目录' })
      }
      if (sm.lora) {
        const f = findCatalogFile(sm.lora)
        if (f) add(fromCatalog(f, 'lora', style, preferMirror))
        else skipped.push({ style, file: sm.lora, reason: '风格覆盖里填的 LoRA 不在推荐清单里，无法自动下载，请自行放进 LoRA 目录' })
      }
      continue
    }

    // 视频：先确定实际会用的模板（与 comfyui-video.ts 的优先级一致）
    if (parseComfyWorkflow(settings.comfyui_workflow)) {
      if (!notes.length) notes.push('这个配置用的是自定义工作流：只下载风格 LoRA，工作流里的基础模型请按「检查工作流」的清单自行下载')
    }
    const model = String(input.model || '').trim()
    const userPicked = !!settings.comfyui_template || (!!model && resolveComfyTemplate('video', null, model).id !== DEFAULT_VIDEO_TEMPLATE_ID) || model === DEFAULT_VIDEO_TEMPLATE_ID
    const templateId = sm.templateOverride ? sm.template : settings.comfyui_template || (userPicked ? null : sm.template)
    const template = resolveComfyTemplate('video', templateId, model)
    const custom = parseComfyWorkflow(settings.comfyui_workflow)
    if (!custom) {
      for (const tf of template.files) {
        const folderName = tf.folder.split('/').pop() || ''
        const role = FOLDER_ROLE[folderName]
        if (!role) continue
        const meta = FILE_META[tf.file] || {}
        add({
          key: `${role}:${tf.file}`,
          name: tf.file,
          file: tf.file,
          role,
          styles: [style],
          page: tf.url.replace(/\/resolve\/main\/.*$/, ''),
          url: tf.url,
          bytes: meta.bytes,
          sha256: meta.sha256,
          licenseStatus: 'ok',
          sources: sourcesFor({ file: tf.file, url: tf.url }, { preferMirror }),
        })
      }
    }
    if (sm.lora) {
      const workflow = custom || template.workflow
      if (!hasWan14bModel(workflow)) {
        skipped.push({ style, file: sm.lora, reason: `当前模板（${getComfyTemplate('video', template.id)?.label || template.id}）不是 Wan 14B，风格 LoRA 用不上，不下载` })
      } else {
        const f = findCatalogFile(sm.lora)
        if (f) add(fromCatalog(f, 'lora', style, preferMirror))
        else skipped.push({ style, file: sm.lora, reason: '风格覆盖里填的 LoRA 不在推荐清单里，无法自动下载' })
      }
    }
  }
  return { files: [...files.values()], skipped, notes }
}

/** 对照目标机上的模型目录，标出每个文件的状态 */
export async function checkPlanFiles(fs: TargetFs, layout: InstallLayout, files: PlanFile[]): Promise<PlanFileState[]> {
  const out: PlanFileState[] = []
  for (const f of files) {
    const folder = layout.folders[f.role]
    if (!folder) continue
    const dest = fs.join(folder, f.file)
    const cur = await fs.stat(dest)
    const part = await fs.stat(`${dest}.uu889part`)
    let state: PlanFileState['state'] = 'missing'
    if (cur && !cur.isDir) {
      state = f.bytes && cur.size !== f.bytes ? 'size_mismatch' : 'present'
      // 不知道精确大小时：小于 1MB 的「模型文件」多半是下载失败留下的错误页
      if (!f.bytes && cur.size < 1024 * 1024) state = 'size_mismatch'
    } else if (part && part.size > 0) {
      state = 'partial'
    }
    out.push({ ...f, dest, state, currentBytes: cur?.size || 0, partBytes: part?.size || 0 })
  }
  return out
}

export function allStyleKeys(): StyleKey[] {
  return [...STYLE_KEYS]
}
