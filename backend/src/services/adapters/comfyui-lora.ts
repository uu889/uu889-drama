/**
 * 往 ComfyUI API 格式工作流里插入风格 LoRA（不改原模板，返回副本）
 *
 * - Checkpoint 工作流（SDXL 等）：在 CheckpointLoaderSimple 后插 LoraLoader（同时作用于 MODEL 与 CLIP），
 *   原来接 Checkpoint 的 MODEL / CLIP 连线全部改接 LoraLoader
 * - 扩散模型工作流（Wan 视频等）：在 UNETLoader 后插 LoraLoaderModelOnly；Wan 2.2 14B 高 / 低噪声双模型
 *   可按 applyTo 只挂在低噪声（细节 / 风格阶段）或高噪声模型上
 */

const CHECKPOINT_LOADERS = new Set(['CheckpointLoaderSimple', 'CheckpointLoader', 'ImageOnlyCheckpointLoader'])
const UNET_LOADERS = new Set(['UNETLoader', 'UnetLoaderGGUF', 'UnetLoaderGGUFAdvanced'])

function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number') && typeof value[1] === 'number'
}

function nextId(workflow: Record<string, any>): () => string {
  let n = Math.max(1000, ...Object.keys(workflow).map((k) => Number(k)).filter(Number.isFinite)) + 1
  return () => String(n++)
}

/** 把所有指向 [from, slot] 的连线改为指向 [to, slot]（跳过 skip 节点自身） */
function rewire(workflow: Record<string, any>, from: string, slot: number, to: string, toSlot: number, skip: string) {
  for (const [id, node] of Object.entries(workflow)) {
    if (id === skip) continue
    for (const [key, value] of Object.entries(node?.inputs || {})) {
      if (isLink(value) && String(value[0]) === from && value[1] === slot) node.inputs[key] = [to, toSlot]
    }
  }
}

export interface LoraSpec {
  /** LoRA 文件名（ComfyUI/models/loras 下，可含子目录） */
  file: string
  strength: number
  /** 双模型（Wan 2.2 14B 高 / 低噪声）时挂在哪个上；默认 all */
  applyTo?: 'all' | 'high' | 'low'
}

/** 已经挂了同名 LoRA 就不重复插 */
function alreadyHas(workflow: Record<string, any>, file: string): boolean {
  return Object.values(workflow).some((n: any) => /^LoraLoader/.test(String(n?.class_type)) && n?.inputs?.lora_name === file)
}

/** 工作流里的扩散模型是不是 14B（Wan 2.1 / 2.2 14B 风格 LoRA 只能挂在 14B 上，5B / 其他模型会加载失败） */
export function hasWan14bModel(workflow: Record<string, any>): boolean {
  return Object.values(workflow).some((n: any) => UNET_LOADERS.has(String(n?.class_type)) && /14b/i.test(String(n?.inputs?.unet_name || '')))
}

export function injectStyleLora(template: Record<string, any>, lora: LoraSpec | null | undefined): Record<string, any> {
  if (!lora?.file) return template
  const workflow: Record<string, any> = JSON.parse(JSON.stringify(template))
  if (alreadyHas(workflow, lora.file)) return workflow
  const newId = nextId(workflow)

  const ckpts = Object.keys(workflow).filter((id) => CHECKPOINT_LOADERS.has(workflow[id]?.class_type))
  if (ckpts.length) {
    for (const ck of ckpts) {
      const id = newId()
      workflow[id] = {
        class_type: 'LoraLoader',
        inputs: { lora_name: lora.file, strength_model: lora.strength, strength_clip: lora.strength, model: [ck, 0], clip: [ck, 1] },
        _meta: { title: '风格 LoRA' },
      }
      rewire(workflow, ck, 0, id, 0, id)
      rewire(workflow, ck, 1, id, 1, id)
    }
    return workflow
  }

  let unets = Object.keys(workflow).filter((id) => UNET_LOADERS.has(workflow[id]?.class_type))
  if (unets.length > 1 && lora.applyTo && lora.applyTo !== 'all') {
    // 双模型：按文件名 / 标题里的 high / low 判断；判断不了按出现顺序（高噪声在前）
    const tag = (id: string) => `${workflow[id]?.inputs?.unet_name || ''} ${workflow[id]?._meta?.title || ''}`.toLowerCase()
    const matched = unets.filter((id) => (lora.applyTo === 'low' ? /low|低噪/.test(tag(id)) : /high|高噪/.test(tag(id))))
    unets = matched.length ? matched : [lora.applyTo === 'low' ? unets[unets.length - 1] : unets[0]]
  }
  for (const un of unets) {
    // 已经接了 LoRA（如 Turbo LoRA）的 UNet：插在该 LoRA 之后
    const chained = Object.keys(workflow).find((id) => /^LoraLoaderModelOnly$/.test(workflow[id]?.class_type)
      && isLink(workflow[id]?.inputs?.model) && String(workflow[id].inputs.model[0]) === un)
    const source = chained || un
    const id = newId()
    workflow[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: lora.file, strength_model: lora.strength, model: [source, 0] },
      _meta: { title: '风格 LoRA' },
    }
    rewire(workflow, source, 0, id, 0, id)
  }
  return workflow
}
