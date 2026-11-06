/**
 * 创作会话的工具（Mastra createTool），每次运行按会话闭包创建：
 * update_plan / set_look / create_reference / generate_image / generate_video / extract_frame /
 * inspect_media / generate_voiceover / fetch_webpage / render_video / list_assets
 *
 * 生图 / 生视频走 generation.ts 同一套任务（sys_task），工具等任务完成再返回结果（同一步里多个调用并行）。
 * 画面一贯性在这里强制套用（consistency.ts）：画风基调、设定图参考、外观锁定、接戏代数上限。
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { generateImage, generateVideo, cancelTask } from '../generation.js'
import { getActiveConfigId, getConfigById } from '../ai.js'
import { promptByteLimitFor } from '../adapters/video-common.js'
import { synthesizeSpeech } from '../voice/index.js'
import { listStyles } from '../catalog.js'
import { ffmpeg } from '../../utils/ffmpeg.js'
import { STORAGE_ROOT } from '../../utils/paths.js'
import { getAbsolutePath, readImageAsCompressedDataUrl, generateImageThumb } from '../../utils/storage.js'
import { endFramePathFor, extractVideoEndFrame, extractVideoPoster } from '../../utils/video-poster.js'
import { probeMedia } from '../bgm.js'
import {
  buildImagePrompt, buildVideoPrompt, imageSizeFor, normalizeName, pickReferences, planFirstFrame, shotEntries, upsertEntry,
  RATIOS, RESOLUTIONS, type BibleType, type ImagePurpose, type RefImage, type StudioBible, type StudioSettings,
} from './consistency.js'
import { addAsset, getAsset, getSession, listAssets, syncAssets, updateAsset, updateSession, type StudioAsset } from './store.js'
import { assetLine } from './prompt.js'
import { renderStudioVideo, type RenderScene } from './render.js'
import { fetchPublic, parseHtml } from './web.js'

export interface ToolContext {
  sessionId: number
  signal: AbortSignal
  /** 读最新设置 / 设定（工具之间会改） */
  state: { settings: StudioSettings; bible: StudioBible }
  /** 本轮已提交的视频片段数（费用上限） */
  clipCount: { n: number }
  /** 本轮提交的生成任务（停止时一并取消） */
  taskIds: Set<number>
  /** 看图用的文字模型 */
  model?: string
  configId?: number
  /** 任务清单更新（界面显示） */
  onPlan: (steps: Array<{ title: string; status: string }>) => void
}

const IMAGE_WAIT_MS = 15 * 60_000
const VIDEO_WAIT_MS = 45 * 60_000

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('已停止'))
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(new Error('已停止')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 等素材的生成任务结束（完成 / 失败 / 超时） */
export async function waitAsset(id: number, timeoutMs: number, signal: AbortSignal): Promise<StudioAsset> {
  const start = Date.now()
  for (;;) {
    const a = await getAsset(id)
    if (!a) throw new Error(`素材 #${id} 不存在`)
    const [synced] = await syncAssets([a])
    if (synced.status !== 'processing') return synced
    if (Date.now() - start > timeoutMs) return synced
    await sleep(2500, signal)
  }
}

async function requireAsset(sessionId: number, id: unknown): Promise<StudioAsset> {
  const n = Number(String(id ?? '').replace(/^#/, ''))
  const a = n > 0 ? await getAsset(n) : null
  if (!a || a.sessionId !== sessionId) throw new Error(`没有素材 #${String(id)}（用 list_assets 查看本会话的素材 id）`)
  if (a.status === 'processing') {
    const [s] = await syncAssets([a])
    if (s.status === 'processing') throw new Error(`素材 #${a.id} 还在生成中`)
    return s
  }
  if (a.status !== 'completed' || !a.path) throw new Error(`素材 #${a.id} 没有可用文件（${a.errorMsg || a.status}）`)
  return a
}

const isVideo = (a: StudioAsset) => a.kind === 'video' || a.kind === 'render' || (a.kind === 'upload' && /\.(mp4|mov|webm|mkv|m4v)$/i.test(a.path || ''))
const isImage = (a: StudioAsset) => !isVideo(a) && a.kind !== 'voice' && !(a.kind === 'upload' && /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a.path || ''))

/** 视频素材 → 一帧图片（first / middle / last / 秒数），存为 frame 素材 */
export async function extractFrameFile(videoRel: string, at: 'first' | 'middle' | 'last' | number): Promise<string> {
  if (at === 'last') {
    const end = await extractVideoEndFrame(videoRel)
    if (end) return end
  }
  const abs = getAbsolutePath(videoRel)
  const info = await probeMedia(abs).catch(() => ({ duration: 0 }))
  const t = typeof at === 'number' ? Math.max(0, Math.min(at, Math.max(0, (info.duration || 0) - 0.05)))
    : at === 'middle' ? (info.duration || 0) / 2
      : at === 'last' ? Math.max(0, (info.duration || 0) - 0.15) : 0
  const dir = path.join(STORAGE_ROOT, 'studio', 'frames')
  fs.mkdirSync(dir, { recursive: true })
  const name = `${uuid()}.jpg`
  await new Promise<void>((resolve, reject) => {
    ffmpeg(abs).inputOptions(['-ss', t.toFixed(3)]).outputOptions(['-frames:v', '1', '-q:v', '2', '-y'])
      .output(path.join(dir, name)).on('end', () => resolve()).on('error', reject).run()
  })
  return `static/studio/frames/${name}`
}

function errorResult(err: any) {
  return { ok: false, error: String(err?.message || err).slice(0, 600) }
}

function assetResult(a: StudioAsset, extra: Record<string, any> = {}) {
  return {
    ok: a.status === 'completed',
    asset_id: a.id,
    status: a.status,
    summary: assetLine(a),
    ...(a.status === 'failed' ? { error: a.errorMsg } : {}),
    ...(a.status === 'processing' ? { note: '还在生成，稍后用 list_assets 查看结果' } : {}),
    ...extra,
  }
}

const nameList = z.array(z.string()).max(8).optional()

export function buildStudioTools(ctx: ToolContext) {
  const { sessionId, signal } = ctx

  async function saveBible(bible: StudioBible) {
    ctx.state.bible = bible
    await updateSession(sessionId, { bible })
  }

  /** 会话指定的配置（还在启用）优先，否则当前启用的配置；返回配置与 id */
  async function resolveConfig(type: 'image' | 'video', wanted: number | null | undefined) {
    if (wanted) {
      const cfg = await getConfigById(wanted)
      if (cfg) return { cfg, id: wanted }
    }
    const id = await getActiveConfigId(type)
    const cfg = id ? await getConfigById(id) : null
    if (!cfg || !id) throw new Error(`还没有启用的${type === 'image' ? '图片' : '视频'}生成服务，请先到「设置」添加并启用`)
    return { cfg, id }
  }

  async function imageConfigId() {
    return (await resolveConfig('image', ctx.state.settings.image_config_id)).id
  }

  async function videoConfig() {
    return resolveConfig('video', ctx.state.settings.video_config_id)
  }

  async function explicitRefs(ids: unknown[] | undefined): Promise<RefImage[]> {
    const out: RefImage[] = []
    for (const id of ids || []) {
      const a = await requireAsset(sessionId, id)
      if (isVideo(a)) {
        const end = await extractVideoEndFrame(a.path!)
        if (end) out.push({ path: end, label: a.name, type: 'asset' })
      } else if (isImage(a)) {
        out.push({ path: a.path!, label: a.name, type: 'asset' })
      }
    }
    return out
  }

  /** 提交一张图片并等它出来 */
  async function makeImage(input: {
    prompt: string; name: string; role: string; purpose: ImagePurpose; names: string[]; refIds?: unknown[]; aspect?: string
  }) {
    const bible = ctx.state.bible
    const entries = input.purpose === 'keyframe' || input.purpose === 'free' ? shotEntries(bible, input.names, input.prompt) : []
    const refs = pickReferences({ bible, names: input.purpose === 'keyframe' || input.purpose === 'free' ? input.names : [], prompt: input.purpose === 'keyframe' ? input.prompt : '', extra: await explicitRefs(input.refIds), max: 6 })
    const prompt = buildImagePrompt({ prompt: input.prompt, bible, purpose: input.purpose, refs, entries })
    const size = input.purpose === 'character' || input.purpose === 'prop' ? '1024x1024' : imageSizeFor(input.aspect || ctx.state.settings.aspect_ratio)
    const taskId = await generateImage({
      prompt,
      size,
      model: ctx.state.settings.image_model || undefined,
      referenceImages: refs.map(r => r.path),
      configId: await imageConfigId(),
    })
    ctx.taskIds.add(taskId)
    const asset = await addAsset({
      sessionId, kind: 'image', role: input.role, name: input.name, prompt, taskId,
      meta: { references: refs.map(r => r.label), size },
    })
    return waitAsset(asset.id, IMAGE_WAIT_MS, signal)
  }

  const update_plan = createTool({
    id: 'update_plan',
    description: '展示 / 更新给用户看的任务清单。复杂任务开始时调用一次，每完成一个阶段再更新状态。',
    inputSchema: z.object({
      steps: z.array(z.object({ title: z.string(), status: z.enum(['pending', 'in_progress', 'done']) })).min(1).max(20),
    }),
    execute: async (input) => {
      ctx.onPlan(input.steps)
      return { ok: true }
    },
  })

  const set_look = createTool({
    id: 'set_look',
    description: '定下全片的画风基调（之后每张图、每段视频提示词开头都会自动带上）与画幅 / 分辨率。style_id 用风格库里的风格（可选），style 写一段具体的画风 / 色调 / 光影 / 质感描述。第一次出图前必须先调用。',
    inputSchema: z.object({
      style: z.string().max(1200).optional().describe('画风基调，例如：电影感写实，35mm 胶片质感，低饱和冷青色调，侧逆光，浅景深'),
      style_id: z.string().max(64).optional().describe('风格库 id（可选）'),
      aspect_ratio: z.enum(RATIOS).optional(),
      resolution: z.enum(RESOLUTIONS).optional(),
    }),
    execute: async (input) => {
      try {
        let style = (input.style || '').trim()
        let styleId: string | null = ctx.state.bible.style_id ?? null
        if (input.style_id) {
          const s = listStyles().find(x => x.id === input.style_id)
          if (!s) return { ok: false, error: `风格库里没有 ${input.style_id}`, styles: listStyles().slice(0, 40).map(x => `${x.id}（${x.name}）`) }
          styleId = s.id
          style = style ? `${s.prompt}；${style}` : s.prompt
        }
        if (!style && !input.aspect_ratio && !input.resolution) return { ok: false, error: '至少给 style / style_id / aspect_ratio 之一' }
        if (style) await saveBible({ ...ctx.state.bible, style, style_id: styleId })
        if (input.aspect_ratio || input.resolution) {
          ctx.state.settings = {
            ...ctx.state.settings,
            ...(input.aspect_ratio ? { aspect_ratio: input.aspect_ratio } : {}),
            ...(input.resolution ? { resolution: input.resolution } : {}),
          }
          await updateSession(sessionId, { settings: ctx.state.settings })
        }
        return { ok: true, style: ctx.state.bible.style, aspect_ratio: ctx.state.settings.aspect_ratio, resolution: ctx.state.settings.resolution }
      } catch (err) { return errorResult(err) }
    },
  })

  const create_reference = createTool({
    id: 'create_reference',
    description: '为固定出场的角色 / 场景 / 道具生成设定图并锁定外观描述。之后提到这个名字的关键帧和视频会自动带上这张设定图做参考，并附加外观锁定。同名再调用 = 换造型 / 重出设定图。多个设定请在同一次回复里并行调用。',
    inputSchema: z.object({
      type: z.enum(['character', 'scene', 'prop']),
      name: z.string().min(1).max(40).describe('名字，之后在 characters / scene / props 或提示词 @名字 里用'),
      description: z.string().min(4).max(800).describe('锁定的外观：角色写年龄、脸型五官、发型发色、体型、标志特征；场景写空间布局、陈设、门窗、时间与光线；道具写形状、颜色、材质、Logo 位置'),
      styling: z.string().max(400).optional().describe('角色的服装、配饰、配色'),
      prompt: z.string().max(1500).optional().describe('额外的出图描述（可选）'),
      reference_asset_ids: z.array(z.union([z.number(), z.string()])).max(4).optional().describe('用户给的参考图素材 id（照着它出设定图）'),
    }),
    execute: async (input) => {
      try {
        const body = [input.name, input.description, input.styling, input.prompt].filter(Boolean).join('，')
        const a = await makeImage({
          prompt: body, name: `${input.name}·设定图`, role: input.type, purpose: input.type as ImagePurpose,
          names: [], refIds: input.reference_asset_ids,
        })
        if (a.status === 'completed' && a.path) {
          await saveBible(upsertEntry(ctx.state.bible, {
            name: input.name.trim(), type: input.type as BibleType, description: input.description.trim(),
            styling: input.styling?.trim() || undefined, asset_id: a.id, path: a.path,
          }))
        }
        return assetResult(a, a.status === 'completed' ? { locked: `${input.name} 已写入一贯性设定，之后出场会自动带设定图` } : {})
      } catch (err) { return errorResult(err) }
    },
  })

  const generate_image = createTool({
    id: 'generate_image',
    description: '用图片模型生成关键帧（镜头开始那一刻的画面）/ 封面 / 产品图。characters / scene / props 写出场设定的名字，设定图会自动作为参考图带上。多个镜头请在同一次回复里并行调用。',
    inputSchema: z.object({
      prompt: z.string().min(2).max(3000).describe('画面：主体外观与动作姿态、构图景别机位、背景、光线、色调。不要要求画面出现大段文字'),
      name: z.string().max(60).optional().describe('短名字，如「镜头1首帧」'),
      characters: nameList.describe('出场角色名字（一贯性设定里的）'),
      scene: z.string().max(40).optional().describe('场景名字'),
      props: nameList.describe('道具名字'),
      reference_asset_ids: z.array(z.union([z.number(), z.string()])).max(4).optional().describe('额外参考图素材 id（视频取最后一帧）'),
      aspect_ratio: z.enum(RATIOS).optional().describe('默认用会话画幅'),
    }),
    execute: async (input) => {
      try {
        const names = [...(input.characters || []), ...(input.scene ? [input.scene] : []), ...(input.props || [])]
        const missing = names.filter(n => !ctx.state.bible.entries.some(e => normalizeName(e.name) === normalizeName(n)))
        const a = await makeImage({
          prompt: input.prompt, name: input.name || '关键帧', role: 'keyframe', purpose: 'keyframe', names,
          refIds: input.reference_asset_ids, aspect: input.aspect_ratio,
        })
        return assetResult(a, missing.length ? { warning: `这些名字还没有设定图，画面可能和其他镜头不一致：${missing.join('、')}（先 create_reference）` } : {})
      } catch (err) { return errorResult(err) }
    },
  })

  const generate_video = createTool({
    id: 'generate_video',
    description: '用视频模型生成一个 1–15 秒片段。first_frame_asset_id 给关键帧图片 = 图生视频（推荐）；给视频素材 id = 取它的最后一帧接上一镜。characters / scene / props 写出场设定，自动带设定图并附加外观 / 场景 / 画风锁定。多个镜头请在同一次回复里并行调用。',
    inputSchema: z.object({
      prompt: z.string().min(2).max(3000).describe('主体与一个清晰动作、场景、镜头运动、光线、声音（台词写清谁说、用引号）'),
      name: z.string().max(60).optional().describe('短名字，如「镜头2-推门进店」'),
      duration_seconds: z.number().int().min(1).max(15).optional(),
      first_frame_asset_id: z.union([z.number(), z.string()]).optional().describe('首帧：图片素材 id；视频素材 id 则取其最后一帧接上一镜'),
      last_frame_asset_id: z.union([z.number(), z.string()]).optional().describe('尾帧图片素材 id（部分模型支持）'),
      characters: nameList,
      scene: z.string().max(40).optional(),
      props: nameList,
      reference_asset_ids: z.array(z.union([z.number(), z.string()])).max(4).optional(),
      generate_audio: z.boolean().optional().describe('同期声，默认按会话设置'),
    }),
    execute: async (input) => {
      try {
        if (ctx.clipCount.n >= ctx.state.settings.max_clips) {
          return { ok: false, error: `本轮已经提交了 ${ctx.clipCount.n} 个视频片段，达到上限（${ctx.state.settings.max_clips}）。先把已有片段剪成成片，或请用户在设置里调高上限后继续。` }
        }
        const settings = ctx.state.settings
        const bible = ctx.state.bible
        const { cfg: config, id: videoConfigId } = await videoConfig()
        const names = [...(input.characters || []), ...(input.scene ? [input.scene] : []), ...(input.props || [])]

        // 首帧：关键帧图片 / 上一镜结尾帧（接戏代数上限）
        let firstImage: string | null = null
        let fromVideo: { endFrame: string | null; chainDepth: number } | null = null
        let parentId: number | null = null
        if (input.first_frame_asset_id != null) {
          const f = await requireAsset(sessionId, input.first_frame_asset_id)
          parentId = f.id
          if (isVideo(f)) fromVideo = { endFrame: await extractVideoEndFrame(f.path!), chainDepth: Number(f.meta?.chain_depth) || 0 }
          else firstImage = f.path
        }
        const plan = planFirstFrame({ image: firstImage, fromVideo })
        let lastFrame: string | null = null
        if (input.last_frame_asset_id != null) {
          const l = await requireAsset(sessionId, input.last_frame_asset_id)
          lastFrame = isVideo(l) ? await extractFrameFile(l.path!, 'first') : l.path
        }
        const extra = await explicitRefs(input.reference_asset_ids)
        if (plan.referenceFrame) extra.unshift({ path: plan.referenceFrame, label: '上一镜结尾', type: 'asset' })
        const refs = pickReferences({ bible, names, prompt: input.prompt, extra, max: 7 })
        const entries = shotEntries(bible, names, input.prompt)
        const duration = input.duration_seconds || settings.clip_seconds
        const audio = input.generate_audio ?? settings.generate_audio
        const prompt = buildVideoPrompt({
          prompt: input.prompt, bible, refs, entries, duration, continued: plan.continued,
          compact: promptByteLimitFor(config) > 0, audio, firstFrame: !!plan.firstFrame,
        })
        const taskId = await generateVideo({
          prompt,
          model: settings.video_model || undefined,
          referenceMode: 'reference',
          firstFrameUrl: plan.firstFrame || undefined,
          lastFrameUrl: lastFrame || undefined,
          referenceImageUrls: refs.map(r => r.path),
          generateAudio: audio,
          duration,
          aspectRatio: settings.aspect_ratio,
          resolution: settings.resolution,
          configId: videoConfigId,
        })
        ctx.taskIds.add(taskId)
        ctx.clipCount.n++
        const asset = await addAsset({
          sessionId, kind: 'video', role: 'clip', name: input.name || `片段 ${ctx.clipCount.n}`, prompt, taskId,
          meta: { chain_depth: plan.chainDepth, parent: parentId, references: refs.map(r => r.label), duration, first_frame: plan.firstFrame },
        })
        const done = await waitAsset(asset.id, VIDEO_WAIT_MS, signal)
        if (done.status === 'completed' && done.path) {
          await extractVideoEndFrame(done.path)
          const info = await probeMedia(getAbsolutePath(done.path)).catch(() => null)
          if (info?.duration) {
            done.meta = { ...done.meta, duration: Math.round(info.duration * 10) / 10 }
            await updateAsset(done.id, { meta: done.meta })
          }
        }
        return assetResult(done, plan.note ? { note: plan.note } : {})
      } catch (err) { return errorResult(err) }
    },
  })

  const extract_frame = createTool({
    id: 'extract_frame',
    description: '从视频素材截一帧存为图片素材（下一镜首帧、改图参考、封面）。',
    inputSchema: z.object({
      asset_id: z.union([z.number(), z.string()]),
      position: z.enum(['first', 'middle', 'last']).optional().describe('默认 last'),
      time_seconds: z.number().min(0).optional().describe('指定秒数，优先于 position'),
    }),
    execute: async (input) => {
      try {
        const a = await requireAsset(sessionId, input.asset_id)
        if (!isVideo(a)) return { ok: false, error: `#${a.id} 不是视频` }
        const at = input.time_seconds != null ? input.time_seconds : input.position || 'last'
        const rel = await extractFrameFile(a.path!, at)
        await generateImageThumb(rel).catch(() => null)
        const f = await addAsset({ sessionId, kind: 'frame', role: 'frame', name: `${a.name}·${typeof at === 'number' ? `${at}s` : { first: '首帧', middle: '中间帧', last: '尾帧' }[at]}`, path: rel, meta: { from: a.id } })
        return assetResult(f)
      } catch (err) { return errorResult(err) }
    },
  })

  const inspect_media = createTool({
    id: 'inspect_media',
    description: '亲眼看素材（图片直接看；视频看首 / 中 / 尾三帧），返回画面描述与问题。用于质检（和设定图对比长相 / 服装是否一致、有无畸形穿帮）或理解用户上传的素材。',
    inputSchema: z.object({
      asset_ids: z.array(z.union([z.number(), z.string()])).min(1).max(6),
      question: z.string().max(500).optional().describe('要重点检查什么，如「林小雨的发型和服装是否与设定图一致」'),
    }),
    execute: async (input) => {
      try {
        const images: Array<{ label: string; url: string }> = []
        for (const id of input.asset_ids) {
          const a = await requireAsset(sessionId, id)
          if (isVideo(a)) {
            for (const pos of ['first', 'middle', 'last'] as const) {
              const rel = await extractFrameFile(a.path!, pos)
              images.push({ label: `#${a.id}「${a.name}」${{ first: '首帧', middle: '中间', last: '尾帧' }[pos]}`, url: await readImageAsCompressedDataUrl(rel, { maxWidth: 768, maxHeight: 768, quality: 75 }) })
              if (pos !== 'last') fs.rmSync(getAbsolutePath(rel), { force: true })
            }
          } else if (isImage(a)) {
            images.push({ label: `#${a.id}「${a.name}」`, url: await readImageAsCompressedDataUrl(a.path!, { maxWidth: 1024, maxHeight: 1024, quality: 78 }) })
          }
        }
        // 一贯性对照：把出场设定的设定图也放进来
        const refs = ctx.state.bible.entries.filter(e => e.path && input.question && input.question.includes(e.name)).slice(0, 3)
        for (const e of refs) images.push({ label: `设定图「${e.name}」`, url: await readImageAsCompressedDataUrl(e.path!, { maxWidth: 640, maxHeight: 640, quality: 72 }) })
        if (!images.length) return { ok: false, error: '没有可看的图片 / 视频素材' }
        const { Agent } = await import('@mastra/core/agent')
        const { getTextModelFor } = await import('../../agents/index.js')
        const viewer = new Agent({
          id: 'studio_inspector',
          name: 'Studio Inspector',
          instructions: '你是视频质检。逐张看图，简洁说明画面内容（人物长相 / 服装 / 场景 / 光线 / 构图），指出问题：畸形（手指、五官、肢体）、穿帮、文字乱码、和设定图不一致（脸、发型、服装颜色、场景布局）、画风不统一。最后一行给结论：「可用」或「建议重做：原因」。',
          model: () => getTextModelFor(ctx.model, ctx.configId),
        })
        const content: any[] = [{ type: 'text', text: input.question ? `重点检查：${input.question}` : '请质检这些画面。' }]
        for (const img of images) {
          content.push({ type: 'text', text: img.label })
          content.push({ type: 'image', image: img.url, mimeType: 'image/jpeg' })
        }
        let res: any
        try {
          res = await viewer.generate([{ role: 'user', content }] as any, { abortSignal: signal } as any)
        } catch (err: any) {
          return { ok: false, error: `当前文字模型看不了图（${String(err?.message || err).slice(0, 160)}）：换一个能看图的模型（如 gpt-6.1-sol、claude 系列）再质检，或跳过质检` }
        }
        return { ok: true, report: String(res?.text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 3000) }
      } catch (err) { return errorResult(err) }
    },
  })

  const generate_voiceover = createTool({
    id: 'generate_voiceover',
    description: '把旁白稿合成配音（用设置里的语音服务），返回配音素材 id 与时长。镜头时长按配音定：镜头 ≥ 配音时长 + 0.5 秒。',
    inputSchema: z.object({
      text: z.string().min(1).max(1000),
      voice: z.string().max(80).optional().describe('音色 ID（不填用语音服务的默认音色）'),
      speed: z.number().min(0.5).max(2).optional(),
      name: z.string().max(60).optional(),
    }),
    execute: async (input) => {
      try {
        const out = await synthesizeSpeech({ text: input.text, voice: input.voice, speed: input.speed })
        const a = await addAsset({
          sessionId, kind: 'voice', role: 'voiceover', name: input.name || `旁白：${input.text.slice(0, 12)}`, prompt: input.text, path: out.url,
          meta: { duration: out.duration ? Math.round(out.duration * 10) / 10 : null, voice: out.voice, provider: out.provider },
        })
        return assetResult(a, { duration: a.meta.duration })
      } catch (err: any) {
        const msg = err?.check ? [...(err.check.errors || [])].join('；') : ''
        return errorResult(msg ? new Error(msg) : err)
      }
    },
  })

  const fetch_webpage = createTool({
    id: 'fetch_webpage',
    description: '读取网页（商品页、文章、落地页）：返回标题、描述、正文摘要，并把主要图片下载为素材（网址转视频）。',
    inputSchema: z.object({
      url: z.string().url(),
      max_images: z.number().int().min(0).max(8).optional().describe('下载几张图片，默认 4'),
    }),
    execute: async (input) => {
      try {
        const page = await fetchPublic(input.url, { accept: 'text/html,application/xhtml+xml', maxBytes: 5 * 1024 * 1024, signal })
        const html = page.buffer.toString('utf8')
        const info = parseHtml(html, page.finalUrl)
        const saved: number[] = []
        const sharp = (await import('sharp')).default
        for (const src of info.images) {
          if (saved.length >= (input.max_images ?? 4)) break
          try {
            const img = await fetchPublic(src, { accept: 'image/*', maxBytes: 12 * 1024 * 1024, timeout: 20_000, signal })
            const meta = await sharp(img.buffer).metadata()
            if ((meta.width || 0) < 240 || (meta.height || 0) < 240) continue
            const dir = path.join(STORAGE_ROOT, 'studio', 'web')
            fs.mkdirSync(dir, { recursive: true })
            const name = `${uuid()}.jpg`
            await sharp(img.buffer).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(path.join(dir, name))
            const rel = `static/studio/web/${name}`
            await generateImageThumb(rel).catch(() => null)
            const a = await addAsset({ sessionId, kind: 'upload', role: 'web', name: `网页图 ${saved.length + 1}`, path: rel, meta: { source: src } })
            saved.push(a.id)
          } catch { /* 跳过下载失败的图 */ }
        }
        return { ok: true, url: page.finalUrl, title: info.title, description: info.description, text: info.text.slice(0, 4000), image_asset_ids: saved }
      } catch (err) { return errorResult(err) }
    },
  })

  const render_video = createTool({
    id: 'render_video',
    description: '把素材剪成成片：按顺序拼接（统一画幅、30fps）、镜头字幕、镜头旁白（自动压低原声）、片头标题卡、背景音乐（人声处自动压低）、淡入淡出。只改剪辑时直接重新调用，不用重新生成片段。',
    inputSchema: z.object({
      title: z.string().max(60).optional().describe('成片名'),
      scenes: z.array(z.object({
        asset_id: z.union([z.number(), z.string()]),
        duration: z.number().min(0.5).max(60).optional().describe('镜头时长：视频默认用完整长度，图片默认 4 秒'),
        trim_start: z.number().min(0).optional(),
        caption: z.string().max(80).optional().describe('这一镜的字幕（台词 / 卖点），底部显示'),
        voiceover_asset_id: z.union([z.number(), z.string()]).optional().describe('这一镜的旁白配音'),
        keep_audio: z.boolean().optional().describe('保留片段原声，默认 true'),
        motion: z.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'none']).optional().describe('图片镜头动效'),
      })).min(1).max(80),
      intro_title: z.string().max(40).optional().describe('片头标题卡大标题（不填不加片头）'),
      intro_subtitle: z.string().max(40).optional(),
      music_asset_id: z.union([z.number(), z.string()]).optional().describe('背景音乐：上传的音频，或有音轨的视频'),
      music_volume: z.number().min(0.05).max(1).optional(),
      fade: z.boolean().optional().describe('整片淡入淡出，默认 true'),
      subtitle_style: z.enum(['classic', 'yellow', 'box', 'shadow', 'pink']).optional(),
    }),
    execute: async (input) => {
      try {
        const scenes: RenderScene[] = []
        const used: number[] = []
        for (const s of input.scenes) {
          const a = await requireAsset(sessionId, s.asset_id)
          if (!isVideo(a) && !isImage(a)) return { ok: false, error: `#${a.id} 不是图片或视频，不能作为镜头` }
          let voiceover: RenderScene['voiceover'] = null
          if (s.voiceover_asset_id != null) {
            const v = await requireAsset(sessionId, s.voiceover_asset_id)
            voiceover = { path: v.path! }
          }
          used.push(a.id)
          scenes.push({
            path: a.path!, type: isVideo(a) ? 'video' : 'image', duration: s.duration, trim_start: s.trim_start,
            caption: s.caption, keep_audio: s.keep_audio, motion: s.motion, voiceover,
          })
        }
        let music: { path: string; volume?: number } | null = null
        if (input.music_asset_id != null) {
          const m = await requireAsset(sessionId, input.music_asset_id)
          music = { path: m.path!, volume: input.music_volume }
        }
        const r = await renderStudioVideo({
          scenes,
          aspect_ratio: ctx.state.settings.aspect_ratio,
          resolution: ctx.state.settings.resolution,
          title: input.intro_title ? { text: input.intro_title, subtitle: input.intro_subtitle } : null,
          music,
          fade: input.fade !== false,
          subtitle_style: input.subtitle_style,
        })
        await extractVideoPoster(r.path).catch(() => null)
        const a = await addAsset({
          sessionId, kind: 'render', role: 'final', name: input.title || '成片', path: r.path,
          meta: { duration: r.duration, scenes: used, warnings: r.warnings },
        })
        if (input.title) await updateSession(sessionId, {})
        return assetResult(a, { duration: r.duration, ...(r.warnings.length ? { warnings: r.warnings } : {}) })
      } catch (err) { return errorResult(err) }
    },
  })

  const list_assets = createTool({
    id: 'list_assets',
    description: '列出本会话全部素材（设定图、关键帧、片段、成片、配音、上传）及 id 和状态。',
    inputSchema: z.object({}),
    execute: async () => {
      const assets = await syncAssets(await listAssets(sessionId))
      const s = await getSession(sessionId)
      return { ok: true, assets: assets.map(assetLine), bible: s?.bible.entries.map(e => `${e.type}:${e.name}${e.asset_id ? `#${e.asset_id}` : ''}`) }
    },
  })

  return { update_plan, set_look, create_reference, generate_image, generate_video, extract_frame, inspect_media, generate_voiceover, fetch_webpage, render_video, list_assets }
}

/** 停止时把本轮还在跑的生成任务取消掉 */
export async function cancelRunTasks(taskIds: Iterable<number>) {
  for (const id of taskIds) await cancelTask(id).catch(() => null)
}

export const TOOL_LABELS: Record<string, string> = {
  update_plan: '任务清单',
  set_look: '定画风',
  create_reference: '设定图',
  generate_image: '生成图片',
  generate_video: '生成视频',
  extract_frame: '截帧',
  inspect_media: '看图质检',
  generate_voiceover: '配音',
  fetch_webpage: '读取网页',
  render_video: '剪辑合成',
  list_assets: '素材清单',
}
