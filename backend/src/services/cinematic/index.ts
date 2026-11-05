/**
 * 影像参数：项目存取（dramas.metadata.cinematic）、预设库、AI 自动生成、同步到项目角色 / 场景 / 道具
 */
import { eq } from 'drizzle-orm'
import { Agent } from '@mastra/core/agent'
import { db, schema } from '../../db/index.js'
import { listCinematicPresets } from '../catalog.js'
import {
  ASPECT_RATIOS, ATMOSPHERE_DETAILS, CAMERAS, CAMERA_ANGLES, CAMERA_MOVES, COMPOSITION_LAYERS, COMPOSITION_TECHNIQUES,
  FILM_STOCKS, FOCAL_LENGTHS, KEY_LIGHTS, LENSES, LIGHT_RATIOS, MICRO_PERFORMANCES, SHOT_SIZES, STYLE_ANCHORS,
  TECH_CONSTRAINTS, type CineOption,
} from './options.js'
import {
  emptyCinematicSpec, normalizeCinematicSpec, summarizeSpec,
  type CinematicSection, type CinematicSpec, type CineCharacter,
} from './spec.js'

export * from './spec.js'
export { CINEMATIC_OPTIONS } from './options.js'

function parseMetadata(text: string | null | undefined): Record<string, any> {
  if (!text) return {}
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export async function getDramaCinematic(dramaId: number | null | undefined): Promise<CinematicSpec> {
  if (!dramaId) return emptyCinematicSpec()
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  return normalizeCinematicSpec(parseMetadata(drama?.metadata).cinematic)
}

export async function getEpisodeCinematic(episodeId: number | null | undefined): Promise<CinematicSpec> {
  if (!episodeId) return emptyCinematicSpec()
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  return getDramaCinematic(ep?.dramaId)
}

/** 保存到 dramas.metadata.cinematic（metadata 里其他字段原样保留） */
export async function saveDramaCinematic(dramaId: number, raw: unknown): Promise<CinematicSpec | null> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return null
  const spec = normalizeCinematicSpec(raw)
  const meta = parseMetadata(drama.metadata)
  meta.cinematic = spec
  await db.update(schema.dramas).set({ metadata: JSON.stringify(meta), updatedAt: new Date().toISOString() }).where(eq(schema.dramas.id, dramaId))
  return spec
}

export function listPresets() {
  return listCinematicPresets().map((p) => {
    const spec = normalizeCinematicSpec({ ...(p.spec as any), enabled: true })
    return { id: p.id, name: p.name, description: p.description, category: p.category, builtin: p.builtin, summary: summarizeSpec(spec), spec }
  })
}

// ── 同步到项目 ──

function characterAppearance(c: CineCharacter): string {
  const who = [c.age, c.style, c.gender].filter(Boolean).join('')
  return [who, c.face, c.details].filter(Boolean).join('，')
}

function characterStyling(c: CineCharacter): string {
  return [c.hair, c.outfit, c.accessories].filter(Boolean).join('；')
}

/**
 * 把参数里的人物 / 场景 / 道具写进项目（同名更新，没有就新增）：
 * 人物 appearance / styling、场景 prompt / lighting、道具 description；上传了参考图而项目里还没有图的，用这张图。
 */
export async function applyCinematicToProject(dramaId: number, spec: CinematicSpec) {
  const ts = new Date().toISOString()
  const result = { characters_created: 0, characters_updated: 0, scenes_created: 0, scenes_updated: 0, props_created: 0, props_updated: 0 }
  const chars = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId))).filter((c) => !c.deletedAt)
  for (const c of spec.characters) {
    const existing = chars.find((x) => x.name === c.name)
    const appearance = characterAppearance(c) || null
    const styling = characterStyling(c) || null
    if (existing) {
      await db.update(schema.characters).set({
        appearance: appearance ?? existing.appearance,
        styling: styling ?? existing.styling,
        ...(c.image_url && !existing.imageUrl ? { imageUrl: c.image_url } : {}),
        updatedAt: ts,
      }).where(eq(schema.characters.id, existing.id))
      result.characters_updated++
    } else {
      await db.insert(schema.characters).values({
        dramaId, name: c.name, appearance, styling, imageUrl: c.image_url || null, createdAt: ts, updatedAt: ts,
      })
      result.characters_created++
    }
  }

  const sc = spec.scene
  if (sc.name && (sc.environment || sc.zones.length || sc.surroundings)) {
    const prompt = [sc.environment, ...sc.zones.map((z) => `${z.area}：${z.content}`), sc.surroundings ? `四周环境：${sc.surroundings}` : '']
      .filter(Boolean).join('\n')
    const l = spec.lighting
    const lighting = [l.key_light, l.fill, l.dynamic].filter(Boolean).join('；') || null
    const scenes = (await db.select().from(schema.scenes).where(eq(schema.scenes.dramaId, dramaId))).filter((s) => !s.deletedAt)
    const existing = scenes.find((s) => s.location === sc.name)
    if (existing) {
      await db.update(schema.scenes).set({
        prompt,
        lighting: lighting ?? existing.lighting,
        ...(sc.image_url && !existing.imageUrl ? { imageUrl: sc.image_url } : {}),
        updatedAt: ts,
      }).where(eq(schema.scenes.id, existing.id))
      result.scenes_updated++
    } else {
      await db.insert(schema.scenes).values({
        dramaId, location: sc.name, time: '', prompt, lighting, imageUrl: sc.image_url || null, createdAt: ts, updatedAt: ts,
      })
      result.scenes_created++
    }
  }

  const props = (await db.select().from(schema.props).where(eq(schema.props.dramaId, dramaId))).filter((p) => !p.deletedAt)
  for (const p of spec.props) {
    const existing = props.find((x) => x.name === p.name)
    if (existing) {
      await db.update(schema.props).set({
        description: p.description || existing.description,
        ...(p.image_url && !existing.imageUrl ? { imageUrl: p.image_url } : {}),
        updatedAt: ts,
      }).where(eq(schema.props.id, existing.id))
      result.props_updated++
    } else {
      await db.insert(schema.props).values({
        dramaId, name: p.name, description: p.description || null, imageUrl: p.image_url || null, createdAt: ts, updatedAt: ts,
      })
      result.props_created++
    }
  }
  return result
}

// ── AI 自动生成 ──

const ALL_SECTIONS: CinematicSection[] = ['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard']

function optionIds(list: CineOption[]): string {
  return list.map((o) => `${o.id}=${o.label}`).join('；')
}

/** 给模型看的输出格式（只列要生成的块） */
export function buildGenerationPrompt(sections: CinematicSection[], source: string, current: CinematicSpec): string {
  const shape: string[] = []
  if (sections.includes('visual')) {
    shape.push(`"visual": { "style_ids": [风格锚定 id，1~2 个], "style_anchor": "一句话补充风格反差 / 意境", "camera_ids": [摄影机 id，1~2 个], "lens_ids": [镜头 id，1~2 个], "focal_ids": [焦段 id，1~2 个], "film_ids": [胶片质感 id，1~2 个], "camera_notes": "器材补充（可空）", "aspect_id": "画幅 id", "palette": [{ "name": "颜色名（贴合故事的意象命名）", "hex": "#RRGGBB", "percent": 占比整数 }]（3 个，占比合计 100）, "tone_notes": "影调补充" }
可选 id —
风格锚定：${optionIds(STYLE_ANCHORS)}
摄影机：${optionIds(CAMERAS)}
镜头：${optionIds(LENSES)}
焦段：${optionIds(FOCAL_LENGTHS)}
胶片质感：${optionIds(FILM_STOCKS)}
画幅：${optionIds(ASPECT_RATIOS)}`)
  }
  if (sections.includes('characters')) {
    shape.push(`"characters": [{ "name": "人物名（与原文一致）", "gender": "性别", "age": "如 20岁左右", "face": "脸型与五官", "hair": "发型发色与发饰", "style": "气质风格（如 清冷飒爽）", "outfit": "服饰（层次、材质、颜色）", "accessories": "配饰与随身道具（写清挂在哪）", "details": "神态、体态、标志性特征" }]（只写核心人物，最多 8 个）`)
  }
  if (sections.includes('scene')) {
    shape.push(`"scene": { "name": "主场景名（短）", "environment": "环境与空间定义：天气、地点、主体载具 / 建筑", "zones": [{ "area": "空间分区（如 船头侧（靠前））", "content": "这个位置有谁、什么姿态、朝向、遮挡关系" }]（3~5 个），"surroundings": "四周环境" }`)
  }
  if (sections.includes('props')) {
    shape.push(`"props": [{ "name": "道具名", "description": "材质、颜色、形状、装饰与新旧", "placement": "固定位置 / 归属（如 全程固定于女侠左腰）" }]（只写推动剧情或反复出现的关键道具，最多 5 个）`)
  }
  if (sections.includes('lighting')) {
    shape.push(`"lighting": { "key_light_id": "主光位 id", "key_light": "主光位的具体写法（光源、方向、角度）", "ratio_id": "光比 id", "terminator": "面部明暗交界线怎么过渡", "fill": "环境光与阴影侧反射、次表面散射、轮廓光", "dynamic": "动态光影落影", "materials": "材质与物理细节", "constraint_ids": [硬性约束 id，3~6 个], "constraints": "其它硬性约束（可空）" }
可选 id —
主光位：${optionIds(KEY_LIGHTS)}
光比：${optionIds(LIGHT_RATIOS)}
硬性约束：${optionIds(TECH_CONSTRAINTS)}`)
  }
  if (sections.includes('storyboard')) {
    shape.push(`"storyboard": { "enabled": true, "segment_seconds": 每段大约秒数（2~4）, "shot_size_ids": [], "angle_ids": [], "layer_ids": [], "technique_ids": [], "move_ids": [], "performance_ids": [], "atmosphere_ids": [], "sound": "声音要求", "notes": "补充要求" }（每个列表挑 3~6 个最适合这个故事的）
可选 id —
景别：${optionIds(SHOT_SIZES)}
机位：${optionIds(CAMERA_ANGLES)}
构图层次：${optionIds(COMPOSITION_LAYERS)}
构图技巧：${optionIds(COMPOSITION_TECHNIQUES)}
运镜：${optionIds(CAMERA_MOVES)}
微观表演：${optionIds(MICRO_PERFORMANCES)}
氛围细节：${optionIds(ATMOSPHERE_DETAILS)}`)
  }
  const keep = JSON.stringify({
    visual: current.visual, characters: current.characters.map(({ image_url, voice_url, voice_ref, id, ...c }) => c),
    scene: { ...current.scene, image_url: undefined }, props: current.props.map(({ image_url, id, ...p }) => p),
    lighting: current.lighting,
  })
  return [
    '根据下面的故事素材，为 AI 短剧 / 漫剧制定影像参数。只输出一个 JSON 对象（不要 markdown 代码块、不要解释），字段如下：',
    `{\n${shape.join(',\n')}\n}`,
    '要求：选项 id 必须从给出的列表里选；描述具体到能直接画出来（材质、颜色、位置、左右、受力），不要空泛形容词；人物、道具和场景都要来自素材，不要编造素材里没有的人物。',
    `用户已经填写的参数（有内容的尽量保留和细化，不要推翻）：${keep}`,
    '',
    '故事素材：',
    source,
  ].join('\n')
}

/** 从模型输出里取 JSON 对象 */
export function extractJsonObject(text: string): any {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON，请换个文字模型再试')
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的 JSON 格式不对，请重试或换个文字模型')
  }
}

/** 把生成结果并进当前参数：生成了的块整块替换，人物 / 道具按名字保留已上传的参考图和音色 */
export function mergeGenerated(current: CinematicSpec, generated: any, sections: CinematicSection[]): CinematicSpec {
  const next = normalizeCinematicSpec({ ...current, ...pickSections(generated, sections), enabled: true })
  next.characters = next.characters.map((c) => {
    const old = current.characters.find((x) => x.name === c.name)
    return old ? { ...c, id: old.id, image_url: old.image_url, voice_url: old.voice_url, voice_ref: old.voice_ref } : c
  })
  next.props = next.props.map((p) => {
    const old = current.props.find((x) => x.name === p.name)
    return old ? { ...p, id: old.id, image_url: old.image_url } : p
  })
  if (sections.includes('scene') && current.scene.image_url) next.scene.image_url = current.scene.image_url
  if (sections.includes('visual') && !generated?.visual?.palette_id) next.visual.palette_id = ''
  return next
}

function pickSections(generated: any, sections: CinematicSection[]) {
  const out: Record<string, unknown> = {}
  if (!generated || typeof generated !== 'object') return out
  for (const s of sections) if (generated[s] !== undefined) out[s] = generated[s]
  return out
}

const MAX_SOURCE = 14_000

/** 项目的故事素材：各集改写后的剧本（没有就用原文）+ 已有角色 */
export async function dramaSourceText(dramaId: number): Promise<string> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return ''
  const eps = (await db.select().from(schema.episodes).where(eq(schema.episodes.dramaId, dramaId)))
    .filter((e) => !e.deletedAt)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
  const chars = (await db.select().from(schema.characters).where(eq(schema.characters.dramaId, dramaId))).filter((c) => !c.deletedAt)
  const parts = [`项目：${drama.title}${drama.description ? `（${drama.description}）` : ''}`]
  if (chars.length) parts.push(`已有角色：${chars.map((c) => `${c.name}${c.appearance ? `（${c.appearance.slice(0, 60)}）` : ''}`).join('；')}`)
  let budget = MAX_SOURCE
  for (const ep of eps) {
    const text = String(ep.scriptContent || ep.content || '').trim()
    if (!text || budget <= 0) continue
    const piece = text.slice(0, budget)
    budget -= piece.length
    parts.push(`【${ep.title || `第${ep.episodeNumber}集`}】\n${piece}`)
  }
  return parts.join('\n\n')
}

export async function generateCinematic(input: {
  sections?: CinematicSection[]
  source: string
  current: CinematicSpec
  model?: string
  configId?: number
}): Promise<CinematicSpec> {
  const sections = (input.sections?.length ? input.sections : ALL_SECTIONS).filter((s) => ALL_SECTIONS.includes(s))
  const source = input.source.trim().slice(0, MAX_SOURCE)
  if (!source) throw new Error('请先填写故事素材（剧本、梗概或画面描述），AI 才能据此生成')
  const { getTextModelFor } = await import('../../agents/index.js')
  const agent = new Agent({
    id: 'cinematic_designer',
    name: '影像参数设计',
    instructions: '你是电影摄影指导兼美术指导，擅长把故事落成可执行的影像参数（风格、器材、色调、人物造型、空间调度、布光、分镜语言）。只输出 JSON。',
    model: () => getTextModelFor(input.model, input.configId),
  })
  const res: any = await agent.generate([{ role: 'user', content: buildGenerationPrompt(sections, source, input.current) }] as any, { maxSteps: 1 } as any)
  const generated = extractJsonObject(String(res?.text || ''))
  return mergeGenerated(input.current, generated, sections)
}
