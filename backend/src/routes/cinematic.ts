/**
 * 影像参数（Cinematic Spec）
 *   GET    /cinematic/options          全部可选项（风格 / 摄影机 / 镜头 / 焦段 / 胶片 / 画幅 / 色调 / 布光 / 景别 / 机位 / 构图 / 运镜 / 表演 / 氛围 / 约束）
 *   GET    /cinematic/presets          预设库（内置 catalog/cinematic + 我的 catalog-user/cinematic）
 *   PUT    /cinematic/presets/:id      保存为我的预设 { name, description, category, spec }；DELETE 删除我的预设
 *   POST   /cinematic/generate         AI 生成 { sections?, text?, drama_id?, spec, model?, config_id? } → 合并后的 spec
 *   POST   /cinematic/render           渲染成提示词文本 { spec, lang? } → { text }
 * 项目级（一键生成）见 routes/dramas.ts：GET / PUT /dramas/:id/cinematic、POST /dramas/:id/cinematic/apply
 */
import { Hono } from 'hono'
import { success, badRequest, notFound } from '../utils/response.js'
import { describeModelError } from '../utils/model-error.js'
import { getContentLanguage } from '../services/app-settings.js'
import { deleteUserItem, saveUserCinematicPreset } from '../services/catalog.js'
import {
  CINEMATIC_OPTIONS, dramaSourceText, generateCinematic, listPresets, normalizeCinematicSpec, renderCinematicSpec,
  type CinematicSection,
} from '../services/cinematic/index.js'

const app = new Hono()

app.get('/options', (c) => success(c, CINEMATIC_OPTIONS))

app.get('/presets', (c) => success(c, listPresets()))

app.put('/presets/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const saved = saveUserCinematicPreset(c.req.param('id'), { ...body, spec: normalizeCinematicSpec({ ...(body.spec || {}), enabled: true }) })
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/presets/:id', (c) => {
  if (!deleteUserItem('cinematic', c.req.param('id'))) return notFound(c, '内置预设不能删除（只能删除你保存的预设）')
  return success(c)
})

const SECTIONS: CinematicSection[] = ['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard']

app.post('/generate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const sections = (Array.isArray(body.sections) ? body.sections : []).filter((s: string) => SECTIONS.includes(s as CinematicSection))
  let source = String(body.text || '').trim()
  const dramaId = Number(body.drama_id) || 0
  if (!source && dramaId) source = await dramaSourceText(dramaId)
  try {
    const spec = await generateCinematic({
      sections,
      source,
      current: normalizeCinematicSpec(body.spec),
      model: body.model || undefined,
      configId: Number(body.config_id) || undefined,
    })
    return success(c, spec)
  } catch (err) {
    return badRequest(c, describeModelError(err))
  }
})

app.post('/render', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const spec = normalizeCinematicSpec({ ...(body.spec || {}), enabled: true })
  return success(c, { text: renderCinematicSpec(spec, { lang: body.lang || getContentLanguage(), refs: body.refs === 'name' ? 'name' : 'image' }) })
})

export default app
