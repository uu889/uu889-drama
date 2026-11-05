/**
 * 影像参数（Cinematic Spec）：一份结构化的「电影级提示词底座」
 *
 *   全局视觉与硬件底座（风格锚定 / 摄影机 / 镜头 / 焦段 / 胶片 / 画幅 / 色调占比）
 *   核心人物锚定（五官、发型、年龄、性别、风格、脸型、服饰、参考图、音色）
 *   三维场景与空间逻辑锚定（环境 + 分区站位 + 四周环境，可上传参考图）
 *   关键道具与资产（外观 + 固定位置，可上传参考图）
 *   面部明暗与立体塑造（主光位与光比 / 明暗交界线 / 环境反射 / 动态落影 / 材质 / 硬性约束）
 *   动态时间戳分镜剧本（时间段 + 三维空间构图 + 运镜美学 + 微观表演与氛围镜头）
 *
 * 一键生成：存在项目 dramas.metadata.cinematic，四个 Agent 的指令里按需要附加（cinematicAgentDirective），
 *           生成视频时附加【影像底座】（cinematicVideoBlock）；
 * 智能体 / 工作流：请求体带 cinematic，拼在系统提示词后面（cinematicChatDirective）。
 * 纯函数，不读库（读写库见 ./index.ts）。
 */
import {
  ASPECT_RATIOS, ATMOSPHERE_DETAILS, CAMERAS, CAMERA_ANGLES, CAMERA_MOVES, COMPOSITION_LAYERS, COMPOSITION_TECHNIQUES,
  FILM_STOCKS, FOCAL_LENGTHS, KEY_LIGHTS, LENSES, LIGHT_RATIOS, MICRO_PERFORMANCES, PALETTES, SHOT_SIZES, STYLE_ANCHORS,
  TECH_CONSTRAINTS, findOption, type CineOption, type PaletteColor,
} from './options.js'

export interface CineCharacter {
  id: string
  name: string
  gender: string
  age: string
  face: string
  hair: string
  style: string
  outfit: string
  accessories: string
  /** 其它细节（神态、体态、标志性动作…） */
  details: string
  /** 五官 / 发型参考图（上传或 AI 生成后的地址） */
  image_url: string
  /** 音色参考：上传的音频地址 */
  voice_url: string
  /** 音色参考标记（如 @syq1_trim_0-5000ms），不填用文件名 */
  voice_ref: string
}

export interface CineZone { area: string; content: string }

export interface CineScene {
  /** 场景名（同步到项目场景时用） */
  name: string
  image_url: string
  environment: string
  zones: CineZone[]
  surroundings: string
}

export interface CineProp {
  id: string
  name: string
  description: string
  /** 固定位置 / 归属（如：全程固定于女侠左腰） */
  placement: string
  image_url: string
}

export interface CinematicSpec {
  enabled: boolean
  visual: {
    style_ids: string[]
    /** 风格锚定的补充描述（如：清冷苍茫水墨意境与江湖市井黑色幽默反差） */
    style_anchor: string
    camera_ids: string[]
    lens_ids: string[]
    focal_ids: string[]
    film_ids: string[]
    camera_notes: string
    aspect_id: string
    palette_id: string
    palette: PaletteColor[]
    tone_notes: string
  }
  characters: CineCharacter[]
  scene: CineScene
  props: CineProp[]
  lighting: {
    key_light_id: string
    /** 主光位的具体写法（如：江面漫射天光自船篷开口呈 45 度侧逆光切入篷内） */
    key_light: string
    ratio_id: string
    terminator: string
    fill: string
    dynamic: string
    materials: string
    constraint_ids: string[]
    constraints: string
  }
  storyboard: {
    enabled: boolean
    /** 每个时间段大约几秒（0 = 按动作自然划分） */
    segment_seconds: number
    shot_size_ids: string[]
    angle_ids: string[]
    layer_ids: string[]
    technique_ids: string[]
    move_ids: string[]
    performance_ids: string[]
    atmosphere_ids: string[]
    /** 声音要求（如：不需要配乐，仅保留同期声） */
    sound: string
    notes: string
  }
}

export const MAX_CHARACTERS = 12
export const MAX_PROPS = 12
export const MAX_ZONES = 10

export function emptyCinematicSpec(): CinematicSpec {
  return {
    enabled: false,
    visual: { style_ids: [], style_anchor: '', camera_ids: [], lens_ids: [], focal_ids: [], film_ids: [], camera_notes: '', aspect_id: '', palette_id: '', palette: [], tone_notes: '' },
    characters: [],
    scene: { name: '', image_url: '', environment: '', zones: [], surroundings: '' },
    props: [],
    lighting: { key_light_id: '', key_light: '', ratio_id: '', terminator: '', fill: '', dynamic: '', materials: '', constraint_ids: [], constraints: '' },
    storyboard: { enabled: false, segment_seconds: 0, shot_size_ids: [], angle_ids: [], layer_ids: [], technique_ids: [], move_ids: [], performance_ids: [], atmosphere_ids: [], sound: '', notes: '' },
  }
}

// ── 清洗 ──

function str(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  return String(v).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max)
}

function line(v: unknown, max: number): string {
  return str(v, max).replace(/\s*\n\s*/g, ' ')
}

/** 只留选项表里有的 id（去重，保持顺序） */
function ids(v: unknown, list: CineOption[], max = 12): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    const id = String(x ?? '')
    if (list.some((o) => o.id === id) && !out.includes(id)) out.push(id)
    if (out.length >= max) break
  }
  return out
}

function oneId(v: unknown, list: CineOption[]): string {
  const id = String(v ?? '')
  return list.some((o) => o.id === id) ? id : ''
}

/** 站内静态文件 / 上传地址 / http(s)，其它一律丢掉（防止拼进提示词奇怪的东西） */
function url(v: unknown): string {
  const s = str(v, 500)
  return /^(\/(static|uploads|data)\/|https?:\/\/|static\/|uploads\/)/i.test(s) ? s : ''
}

function rid(v: unknown, prefix: string, i: number): string {
  const s = String(v ?? '')
  return /^[a-z0-9_-]{1,40}$/i.test(s) ? s : `${prefix}${i + 1}`
}

function hex(v: unknown): string {
  const s = String(v ?? '').trim()
  const m = s.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (!m) return ''
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return `#${h.toUpperCase()}`
}

function palette(v: unknown): PaletteColor[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 6).map((c: any) => ({
    name: line(c?.name, 30),
    hex: hex(c?.hex),
    percent: Math.max(0, Math.min(100, Math.round(Number(c?.percent) || 0))),
  })).filter((c) => c.name || c.hex)
}

const bool = (v: unknown, dflt = false) => v === undefined || v === null ? dflt : v === true || v === 1 || v === 'true'

export function normalizeCinematicSpec(raw: unknown): CinematicSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as any
  const v = r.visual || {}
  const l = r.lighting || {}
  const s = r.scene || {}
  const b = r.storyboard || {}
  return {
    enabled: bool(r.enabled),
    visual: {
      style_ids: ids(v.style_ids, STYLE_ANCHORS, 4),
      style_anchor: line(v.style_anchor, 200),
      camera_ids: ids(v.camera_ids, CAMERAS, 4),
      lens_ids: ids(v.lens_ids, LENSES, 4),
      focal_ids: ids(v.focal_ids, FOCAL_LENGTHS, 4),
      film_ids: ids(v.film_ids, FILM_STOCKS, 4),
      camera_notes: str(v.camera_notes, 400),
      aspect_id: oneId(v.aspect_id, ASPECT_RATIOS),
      palette_id: PALETTES.some((p) => p.id === v.palette_id) ? String(v.palette_id) : '',
      palette: palette(v.palette),
      tone_notes: line(v.tone_notes, 200),
    },
    characters: (Array.isArray(r.characters) ? r.characters : []).slice(0, MAX_CHARACTERS).map((c: any, i: number) => ({
      id: rid(c?.id, 'c', i),
      name: line(c?.name, 30),
      gender: line(c?.gender, 20),
      age: line(c?.age, 20),
      face: line(c?.face, 60),
      hair: line(c?.hair, 100),
      style: line(c?.style, 80),
      outfit: line(c?.outfit, 300),
      accessories: line(c?.accessories, 200),
      details: str(c?.details, 400),
      image_url: url(c?.image_url),
      voice_url: url(c?.voice_url),
      voice_ref: line(c?.voice_ref, 60),
    })).filter((c: CineCharacter) => c.name),
    scene: {
      name: line(s.name, 40),
      image_url: url(s.image_url),
      environment: str(s.environment, 600),
      zones: (Array.isArray(s.zones) ? s.zones : []).slice(0, MAX_ZONES)
        .map((z: any) => ({ area: line(z?.area, 40), content: str(z?.content, 400) }))
        .filter((z: CineZone) => z.area || z.content),
      surroundings: str(s.surroundings, 300),
    },
    props: (Array.isArray(r.props) ? r.props : []).slice(0, MAX_PROPS).map((p: any, i: number) => ({
      id: rid(p?.id, 'p', i),
      name: line(p?.name, 30),
      description: str(p?.description, 400),
      placement: line(p?.placement, 120),
      image_url: url(p?.image_url),
    })).filter((p: CineProp) => p.name),
    lighting: {
      key_light_id: oneId(l.key_light_id, KEY_LIGHTS),
      key_light: str(l.key_light, 300),
      ratio_id: oneId(l.ratio_id, LIGHT_RATIOS),
      terminator: str(l.terminator, 300),
      fill: str(l.fill, 300),
      dynamic: str(l.dynamic, 300),
      materials: str(l.materials, 400),
      constraint_ids: ids(l.constraint_ids, TECH_CONSTRAINTS, 16),
      constraints: str(l.constraints, 300),
    },
    storyboard: {
      enabled: bool(b.enabled),
      segment_seconds: Math.max(0, Math.min(15, Math.round((Number(b.segment_seconds) || 0) * 2) / 2)),
      shot_size_ids: ids(b.shot_size_ids, SHOT_SIZES),
      angle_ids: ids(b.angle_ids, CAMERA_ANGLES),
      layer_ids: ids(b.layer_ids, COMPOSITION_LAYERS),
      technique_ids: ids(b.technique_ids, COMPOSITION_TECHNIQUES),
      move_ids: ids(b.move_ids, CAMERA_MOVES, 16),
      performance_ids: ids(b.performance_ids, MICRO_PERFORMANCES, 16),
      atmosphere_ids: ids(b.atmosphere_ids, ATMOSPHERE_DETAILS, 12),
      sound: line(b.sound, 200),
      notes: str(b.notes, 600),
    },
  }
}

// ── 判断是否有内容 ──

export function hasVisual(s: CinematicSpec): boolean {
  const v = s.visual
  return !!(v.style_ids.length || v.style_anchor || v.camera_ids.length || v.lens_ids.length || v.focal_ids.length
    || v.film_ids.length || v.camera_notes || v.aspect_id || v.palette.length || v.tone_notes)
}

export function hasLighting(s: CinematicSpec): boolean {
  const l = s.lighting
  return !!(l.key_light_id || l.key_light || l.ratio_id || l.terminator || l.fill || l.dynamic || l.materials || l.constraint_ids.length || l.constraints)
}

export function hasScene(s: CinematicSpec): boolean {
  return !!(s.scene.environment || s.scene.zones.length || s.scene.surroundings || s.scene.image_url)
}

/** 开着并且至少填了一项 */
export function isCinematicActive(s: CinematicSpec | null | undefined): s is CinematicSpec {
  if (!s?.enabled) return false
  return hasVisual(s) || hasLighting(s) || hasScene(s) || s.characters.length > 0 || s.props.length > 0 || s.storyboard.enabled
}

// ── 渲染 ──

export interface RenderOptions {
  /** 内容语言（zh 之外一律英文标题，器材用英文术语） */
  lang?: string | null
  /**
   * image：参考图写成 @image（智能体 / 工作流的对话，用户自己去视频平台挂图）；
   * name：写成 @名字（一键生成：名字和项目角色 / 场景 / 道具一致，系统自动换成参考图）
   */
  refs?: 'image' | 'name'
}

const isZh = (lang?: string | null) => !lang || lang === 'zh'

function pick(list: CineOption[], idList: string[]): CineOption[] {
  return idList.map((id) => findOption(list, id)).filter(Boolean) as CineOption[]
}

/** 「标签（英文术语）：作用」 */
function describe(o: CineOption, zh: boolean, withDesc = true): string {
  if (!zh) return o.en || o.label
  const term = o.en && o.en !== o.label ? `${o.label}（${o.en}）` : o.label
  return withDesc ? `${term}：${o.desc}` : term
}

export function formatPalette(colors: PaletteColor[], zh: boolean): string {
  return colors.map((c) => {
    const name = c.name || c.hex
    const pct = c.percent ? `${c.percent}% ` : ''
    return zh ? `${pct}${name}${c.hex && c.hex !== name ? `（${c.hex}）` : ''}` : `${pct}${name}${c.hex && c.hex !== name ? ` (${c.hex})` : ''}`
  }).join(' + ')
}

function styleLine(s: CinematicSpec, zh: boolean): string {
  const anchors = pick(STYLE_ANCHORS, s.visual.style_ids).map((o) => (zh ? o.label : o.en || o.label))
  const main = anchors.join(' • ')
  if (!main) return s.visual.style_anchor
  return s.visual.style_anchor ? `${main}${zh ? `（${s.visual.style_anchor}）` : ` (${s.visual.style_anchor})`}` : main
}

function characterLine(c: CineCharacter, zh: boolean, refs: 'image' | 'name'): string {
  const ref = c.image_url ? (refs === 'image' ? '@image' : `@${c.name}`) : ''
  const voiceTag = c.voice_ref || (c.voice_url ? `@${c.voice_url.split('/').pop()!.replace(/\.[a-z0-9]+$/i, '')}` : '')
  const voice = voiceTag ? (voiceTag.startsWith('@') ? voiceTag : `@${voiceTag}`) : ''
  if (zh) {
    const who = [c.age, c.style, c.gender].filter(Boolean).join('')
    const parts = [who, c.face, c.hair].filter(Boolean).join('，')
    const look = [parts, c.outfit, c.accessories].filter(Boolean).join('；')
    return [
      `${c.name}：`,
      ref ? `参考${ref}的五官长相和发型。` : '',
      look ? `${look.replace(/[。；，]$/, '')}。` : '',
      c.details ? `${c.details.replace(/[。]?$/, '。')}` : '',
      voice ? `音色参考${voice}，${voice} 仅作为${c.name}的音色，不用参考音频内容。` : '',
    ].join('')
  }
  const who = [c.age, c.style, c.gender].filter(Boolean).join(' ')
  return [
    `${c.name}: `,
    ref ? `match the face and hairstyle of ${ref}. ` : '',
    [who, c.face, c.hair, c.outfit, c.accessories].filter(Boolean).join(', '),
    c.details ? `. ${c.details}` : '',
    voice ? `. Voice reference ${voice} — use it only as ${c.name}'s timbre, not its content.` : '',
  ].join('').replace(/\s+\./g, '.')
}

function propLine(p: CineProp, zh: boolean, refs: 'image' | 'name'): string {
  const ref = p.image_url ? (refs === 'image' ? '@image' : `@${p.name}`) : ''
  if (zh) {
    return `${p.name}${ref ? `（${ref}）` : ''}：${[p.description, p.placement].filter(Boolean).map((x) => x.replace(/[。，；]$/, '')).join('，')}。`
  }
  return `${p.name}${ref ? ` (${ref})` : ''}: ${[p.description, p.placement].filter(Boolean).join('; ')}.`
}

/** 全局视觉与硬件底座 */
export function renderVisual(s: CinematicSpec, opts: RenderOptions = {}): string {
  if (!hasVisual(s)) return ''
  const zh = isZh(opts.lang)
  const v = s.visual
  const rows: string[] = []
  const style = styleLine(s, zh)
  if (style) rows.push(zh ? `风格锚定：${style}` : `Style anchor: ${style}`)
  const gear = [...pick(CAMERAS, v.camera_ids), ...pick(LENSES, v.lens_ids)]
  if (gear.length) {
    rows.push(zh ? '摄影机与镜头：' : 'Camera & lenses:')
    for (const o of gear) rows.push(zh ? `- ${describe(o, true)}` : `- ${o.en || o.label} — ${o.desc}`)
  }
  const focals = pick(FOCAL_LENGTHS, v.focal_ids)
  if (focals.length) {
    rows.push(zh
      ? `焦段：${focals.map((o) => `${o.en}（${o.desc}）`).join(' & ')}`
      : `Focal lengths: ${focals.map((o) => o.en).join(' & ')}`)
  }
  const films = pick(FILM_STOCKS, v.film_ids)
  if (films.length) {
    rows.push(zh ? `胶片与质感：${films.map((o) => describe(o, true)).join('；')}` : `Film & texture: ${films.map((o) => o.en || o.label).join(', ')}`)
  }
  if (v.camera_notes) rows.push(zh ? `器材补充：${v.camera_notes}` : `Camera notes: ${v.camera_notes}`)
  const aspect = findOption(ASPECT_RATIOS, v.aspect_id)
  if (aspect) rows.push(zh ? `构图画幅：${aspect.en}（${aspect.label}）` : `Aspect ratio: ${aspect.en}`)
  if (v.palette.length || v.tone_notes) {
    const pal = formatPalette(v.palette, zh)
    rows.push(zh
      ? `核心色调与影调：${[pal, v.tone_notes].filter(Boolean).join('。')}。`.replace(/。。$/, '。')
      : `Color palette & tone: ${[pal, v.tone_notes].filter(Boolean).join('. ')}`)
  }
  return rows.join('\n')
}

export function renderCharacters(s: CinematicSpec, opts: RenderOptions = {}): string {
  const zh = isZh(opts.lang)
  return s.characters.map((c) => characterLine(c, zh, opts.refs || 'image')).join('\n')
}

export function renderScene(s: CinematicSpec, opts: RenderOptions = {}): string {
  if (!hasScene(s)) return ''
  const zh = isZh(opts.lang)
  const sc = s.scene
  const ref = sc.image_url ? (opts.refs === 'name' && sc.name ? `@${sc.name}` : '@image') : ''
  const rows: string[] = []
  const envHead = zh
    ? `环境与空间定义${ref ? `（参考${ref}的场景）` : ''}：`
    : `Environment${ref ? ` (match the location in ${ref})` : ''}: `
  if (sc.environment || ref) rows.push(`${envHead}${sc.environment}`)
  for (const z of sc.zones) rows.push(zh ? `${z.area}：${z.content}` : `${z.area}: ${z.content}`)
  if (sc.surroundings) rows.push(zh ? `四周环境：${sc.surroundings}` : `Surroundings: ${sc.surroundings}`)
  return rows.join('\n')
}

export function renderProps(s: CinematicSpec, opts: RenderOptions = {}): string {
  const zh = isZh(opts.lang)
  return s.props.map((p) => propLine(p, zh, opts.refs || 'image')).join('\n')
}

export function renderLighting(s: CinematicSpec, opts: RenderOptions = {}): string {
  if (!hasLighting(s)) return ''
  const zh = isZh(opts.lang)
  const l = s.lighting
  const rows: string[] = []
  const key = findOption(KEY_LIGHTS, l.key_light_id)
  const ratio = findOption(LIGHT_RATIOS, l.ratio_id)
  const keyText = [l.key_light || (key ? describe(key, zh, false) : ''), ratio ? (zh ? ratio.label : ratio.en) : ''].filter(Boolean).join(zh ? '，' : ', ')
  if (keyText) rows.push(zh ? `主光位与光比：${keyText}` : `Key light & ratio: ${keyText}`)
  if (l.terminator) rows.push(zh ? `面部明暗交界线（Terminator）：${l.terminator}` : `Terminator line: ${l.terminator}`)
  if (l.fill) rows.push(zh ? `环境光与阴影侧反射：${l.fill}` : `Ambient fill & bounce: ${l.fill}`)
  if (l.dynamic) rows.push(zh ? `动态光影落影：${l.dynamic}` : `Moving light & shadows: ${l.dynamic}`)
  if (l.materials) rows.push(zh ? `材质与物理细节：${l.materials}` : `Materials & physical detail: ${l.materials}`)
  const cons = pick(TECH_CONSTRAINTS, l.constraint_ids).map((o) => o.en || o.label)
  if (cons.length || l.constraints) {
    const tail = [cons.length ? `${cons.join(', ')}.` : '', l.constraints].filter(Boolean).join(' ')
    rows.push(zh ? `硬性技术约束：${tail}` : `Hard technical constraints: ${tail}`)
  }
  return rows.join('\n')
}

/** 动态时间戳分镜剧本的写法说明（分镜 / 视频提示词用） */
export function renderStoryboardGuide(s: CinematicSpec, opts: RenderOptions = {}): string {
  if (!s.storyboard.enabled) return ''
  const zh = isZh(opts.lang)
  const b = s.storyboard
  const vocab = (label: string, list: CineOption[], idList: string[]) => {
    const items = pick(list, idList)
    if (!items.length) return ''
    return zh
      ? `- ${label}优先用：${items.map((o) => `${o.label}（${o.en}，${o.desc}）`).join('；')}`
      : `- Preferred ${label}: ${items.map((o) => `${o.en || o.label} (${o.desc})`).join('; ')}`
  }
  const seg = b.segment_seconds > 0
    ? (zh ? `每个时间段约 ${b.segment_seconds} 秒（按动作节拍可以长短不一）` : `each time range roughly ${b.segment_seconds}s (vary with the action beats)`)
    : (zh ? '时间段按动作节拍划分（通常 2~4 秒一段）' : 'split time ranges by action beats (usually 2-4s each)')
  if (zh) {
    return [
      '每个分镜按「动态时间戳分镜剧本」写，时间精确到 0.5 秒，段与段首尾相接，从 0.0s 开始：',
      '【0.0s-2.5s】（运镜概括 • 本段叙事目的）：',
      '三维空间构图：景别 + 机位角度（中英文术语），再按层写清：前景 / 中景主体 / 中景左侧 / 中景右侧 / 中后景 / 背景 各放什么、谁在左谁在右、背景虚化等焦点技巧；',
      '运镜美学：摄影机怎么动（横移跟拍、极缓推进、低角度仰视……）、运动速度、焦点锁定在谁身上、为什么这样动；',
      '微观表演与氛围镜头：每个人物的面部微表情（眉、眼、嘴角、鼻翼、喉结）与肢体动作（写清用哪只手、受力、惯性），服装 / 头发 / 配饰随风或惯性的物理反应，环境氛围细节；有台词时写成「角色名说：「台词」」。',
      `- ${seg}；同一分镜内的时间段严格延续上一段的座次、站位与道具位置。`,
      vocab('景别', SHOT_SIZES, b.shot_size_ids),
      vocab('机位角度', CAMERA_ANGLES, b.angle_ids),
      vocab('构图层次', COMPOSITION_LAYERS, b.layer_ids),
      vocab('构图技巧', COMPOSITION_TECHNIQUES, b.technique_ids),
      vocab('运镜', CAMERA_MOVES, b.move_ids),
      vocab('微观表演', MICRO_PERFORMANCES, b.performance_ids),
      vocab('氛围细节', ATMOSPHERE_DETAILS, b.atmosphere_ids),
      b.sound ? `- 声音：${b.sound}` : '',
      b.notes ? `- 补充要求：${b.notes}` : '',
    ].filter(Boolean).join('\n')
  }
  return [
    'Write each shot as a "dynamic timestamp storyboard", times to 0.5s, contiguous ranges starting at 0.0s:',
    '[0.0s-2.5s] (camera summary • narrative purpose):',
    '3D composition: shot size + camera angle, then each layer — foreground / midground subject / midground left / midground right / mid-background / background — who is where, left/right, focus techniques such as background blur;',
    'Camera movement: how the camera moves, its speed, who the focus is locked on and why;',
    'Micro-performance & atmosphere: each character\'s facial micro-expressions and body actions (which hand, force, inertia), physical reactions of clothes / hair / accessories, ambient details; dialogue as Name says: "line".',
    `- ${seg}; later ranges keep the seating, positions and prop placement of earlier ones.`,
    vocab('shot sizes', SHOT_SIZES, b.shot_size_ids),
    vocab('camera angles', CAMERA_ANGLES, b.angle_ids),
    vocab('composition layers', COMPOSITION_LAYERS, b.layer_ids),
    vocab('composition techniques', COMPOSITION_TECHNIQUES, b.technique_ids),
    vocab('camera moves', CAMERA_MOVES, b.move_ids),
    vocab('micro-performances', MICRO_PERFORMANCES, b.performance_ids),
    vocab('atmosphere details', ATMOSPHERE_DETAILS, b.atmosphere_ids),
    b.sound ? `- Sound: ${b.sound}` : '',
    b.notes ? `- Extra notes: ${b.notes}` : '',
  ].filter(Boolean).join('\n')
}

export type CinematicSection = 'visual' | 'characters' | 'scene' | 'props' | 'lighting' | 'storyboard'

const TITLES: Record<CinematicSection, [string, string]> = {
  visual: ['全局视觉与硬件底座（Global Visual Baseline）', 'Global Visual Baseline'],
  characters: ['核心人物锚定（Character Specs）', 'Character Specs'],
  scene: ['三维场景与空间逻辑锚定（Scene & Spatial Specs）', 'Scene & Spatial Specs'],
  props: ['关键道具与资产（Props & Objects）', 'Props & Objects'],
  lighting: ['面部明暗与立体塑造（Facial Lighting & Modeling）', 'Facial Lighting & Modeling'],
  storyboard: ['动态时间戳分镜剧本（Dynamic Timestamp Storyboard）', 'Dynamic Timestamp Storyboard'],
}

export function renderSection(s: CinematicSpec, section: CinematicSection, opts: RenderOptions = {}): string {
  switch (section) {
    case 'visual': return renderVisual(s, opts)
    case 'characters': return renderCharacters(s, opts)
    case 'scene': return renderScene(s, opts)
    case 'props': return renderProps(s, opts)
    case 'lighting': return renderLighting(s, opts)
    case 'storyboard': return renderStoryboardGuide(s, opts)
  }
}

/** 整份参数（按六大块，空块跳过）；sections 指定只渲染哪些 */
export function renderCinematicSpec(s: CinematicSpec, opts: RenderOptions & { sections?: CinematicSection[] } = {}): string {
  const zh = isZh(opts.lang)
  const sections = opts.sections || (['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard'] as CinematicSection[])
  return sections
    .map((sec) => {
      const body = renderSection(s, sec, opts)
      return body ? `[${TITLES[sec][zh ? 0 : 1]}]\n${body}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

// ── 指令 ──

/** 智能体 / 工作流：附在系统提示词后面 */
export function cinematicChatDirective(s: CinematicSpec | null | undefined, lang?: string | null): string {
  if (!isCinematicActive(s)) return ''
  const zh = isZh(lang)
  const body = renderCinematicSpec(s, { lang, refs: 'image' })
  if (!body) return ''
  return zh
    ? [
      '## 影像参数（用户锁定，必须遵守）',
      '用户为这次创作设定了以下影像参数。凡是你写剧本、人物 / 场景 / 道具设定、生图或视频提示词、分镜，都要以这些参数为准：人物外观、服饰、道具位置、场景座次逐字沿用，不得改动或自相矛盾；风格、器材、画幅、色调、布光写进提示词时保留原有术语和色值。',
      '需要输出完整的视频提示词时，按「全局视觉与硬件底座 → 核心人物锚定 → 三维场景与空间逻辑锚定 → 关键道具与资产 → 面部明暗与立体塑造 → 动态时间戳分镜剧本」的顺序组织（与下方结构一致）。参考图写成 @image，音色写成 @音频名。',
      '',
      body,
    ].join('\n')
    : [
      '## Cinematic parameters (locked by the user — follow them)',
      'Whenever you write scripts, character / scene / prop specs, image or video prompts or storyboards, follow these parameters exactly: keep character looks, outfits, prop placement and seating word for word; keep the style, gear, aspect ratio, palette hex values and lighting terms.',
      'When asked for a full video prompt, organise it as Global Visual Baseline → Character Specs → Scene & Spatial Specs → Props & Objects → Facial Lighting & Modeling → Dynamic Timestamp Storyboard, as below. Write reference images as @image and voices as @audio-name.',
      '',
      body,
    ].join('\n')
}

/** 一键生成四个 Agent 的附加说明 */
export function cinematicAgentDirective(agentType: string, s: CinematicSpec | null | undefined, lang?: string | null): string {
  if (!isCinematicActive(s)) return ''
  const zh = isZh(lang)
  const opts: RenderOptions = { lang, refs: 'name' }
  const block = (sections: CinematicSection[]) => renderCinematicSpec(s, { ...opts, sections })
  const head = zh ? '## 影像参数（本项目已锁定，必须遵守）' : '## Cinematic parameters (locked for this project)'
  switch (agentType) {
    case 'script_rewriter': {
      const body = block(['visual', 'characters', 'scene', 'props'])
      if (!body) return ''
      return [head, zh
        ? '- 剧本里的人物名、身份、外形特征、标志性道具与下面的设定一致（不要另起名字或改设定）；动作描写贴合风格锚定的基调，场景描写沿用下面的空间座次。'
        : '- Character names, identities, looks and signature props must match the specs below; action lines follow the style anchor and the spatial layout below.', '', body].join('\n')
    }
    case 'extractor': {
      const body = block(['visual', 'characters', 'scene', 'props', 'lighting'])
      if (!body) return ''
      return [head, zh
        ? [
          '- 下面「核心人物锚定」里的人物，提取时同名角色的 appearance（年龄、性别、脸型、五官、体态、神态）与 styling（发型、服装、配饰、随身道具）必须以设定为准，关键特征逐字保留；设定里没有的人物照常从剧本提取。',
          '- 场景的 prompt 写清「三维场景与空间逻辑锚定」里的环境与分区，lighting 采用「面部明暗与立体塑造」的主光位、光比和色调。',
          '- 「关键道具与资产」里的道具优先提取，description 以设定的外观为准（不写剧情用途）。',
        ].join('\n')
        : [
          '- For characters listed in Character Specs, appearance and styling must follow the spec (keep key traits word for word); extract other characters from the script as usual.',
          '- Scene prompt follows the Scene & Spatial Specs; scene lighting follows the key light, ratio and palette below.',
          '- Prefer the props listed in Props & Objects; their description follows the spec.',
        ].join('\n'), '', body].join('\n')
    }
    case 'storyboard_breaker': {
      const body = block(['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard'])
      if (!body) return ''
      const rules = zh
        ? [
          '- description 与 video_prompt 里的人物外观、服饰、道具固定位置、场景座次严格沿用下面的设定，不能和设定矛盾（比如剑始终在左腰）。',
          '- 布光、色调、构图画幅、器材质感按下面的全局底座与面部明暗写；atmosphere 字段写本段的光线与色调（取自设定）。',
          '- video_prompt 不用重复抄写整份全局底座与人物外观：生成视频时系统会自动附加【影像底座】和【人物外观锁定】，提示词篇幅留给本段的构图、运镜和表演。',
          ...(s.storyboard.enabled ? [
            '- video_prompt 用下面「动态时间戳分镜剧本」的格式代替「3 秒一段」：每个时间段一行以【0.0s-2.5s】开头（时间段之和 = duration），后面紧跟三维空间构图 / 运镜美学 / 微观表演与氛围镜头；description 的【镜头N】与时间段一一对应、顺序一致。',
          ] : []),
        ].join('\n')
        : [
          '- Character looks, outfits, fixed prop placement and seating in description and video_prompt must follow the specs below.',
          '- Lighting, palette, aspect ratio and gear texture follow the baseline and facial lighting below; the atmosphere field uses them.',
          '- Do not copy the whole baseline into every video_prompt: the system appends [Cinematic baseline] and [Character lock] automatically.',
          ...(s.storyboard.enabled ? ['- Instead of 3-second lines, write video_prompt in the Dynamic Timestamp Storyboard format below: one line per range starting with 【0.0s-2.5s】 (ranges add up to duration), followed by 3D composition / camera movement / micro-performance; each 【镜头N】 in description maps to a range in order.'] : []),
        ].join('\n')
      return [head, rules, '', body].join('\n')
    }
    case 'prompt_generator': {
      const body = block(['visual', 'characters', 'scene', 'props', 'lighting', 'storyboard'])
      if (!body) return ''
      const rules = zh
        ? [
          '- 角色最终提示词：外观、发型、服饰、配饰逐字沿用「核心人物锚定」，质感采用全局底座的胶片 / 器材质感（角色三视图仍是干净背景，不加场景色调）。',
          '- 场景最终提示词：按「三维场景与空间逻辑锚定」的环境写（场景图不出现人物），色调按核心色调占比，光线按「面部明暗与立体塑造」的主光位与环境光。',
          '- 道具最终提示词：外观逐字沿用「关键道具与资产」（白底单品，不写佩戴位置）。',
          '- 视频提示词不用重复抄写全局底座和人物外观（生成视频时系统自动附加【影像底座】【人物外观锁定】），篇幅留给本段的构图、运镜、微观表演与光影变化。',
          ...(s.storyboard.enabled ? ['- 视频提示词按下面「动态时间戳分镜剧本」的格式写：每个时间段一行以【0.0s-2.5s】开头，时间段之和等于分镜时长，取代「3 秒一段」。'] : []),
        ].join('\n')
        : [
          '- Character final prompts copy looks, hair, outfit and accessories from Character Specs and use the film / camera texture (keep the clean reference-sheet background).',
          '- Scene final prompts follow the Scene & Spatial Specs (no people), the palette ratios and the key / ambient light.',
          '- Prop final prompts copy the Props & Objects descriptions (isolated product shot).',
          '- Video prompts need not repeat the baseline or character looks (the system appends them); spend the words on composition, camera, micro-performance and light changes.',
          ...(s.storyboard.enabled ? ['- Write video prompts in the Dynamic Timestamp Storyboard format below: one line per range starting with 【0.0s-2.5s】, ranges adding up to the shot duration, instead of 3-second lines.'] : []),
        ].join('\n')
      return [head, rules, '', body].join('\n')
    }
    default:
      return ''
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * 生成视频时附加的【影像底座】：风格 / 器材 / 画幅 / 色调 / 布光 / 材质 / 硬性约束。
 * compact：限制了提示词长度时用短版（只写术语，不写作用说明）
 */
export function cinematicVideoBlock(s: CinematicSpec | null | undefined, zh: boolean, compact = false): string {
  if (!isCinematicActive(s) || !(hasVisual(s) || hasLighting(s))) return ''
  const v = s.visual
  const l = s.lighting
  const parts: string[] = []
  const style = styleLine(s, zh)
  if (style) parts.push(zh ? `风格：${clip(style, compact ? 40 : 120)}` : `Style: ${clip(style, compact ? 80 : 200)}`)
  const gear = [...pick(CAMERAS, v.camera_ids), ...pick(LENSES, v.lens_ids), ...pick(FOCAL_LENGTHS, v.focal_ids), ...pick(FILM_STOCKS, v.film_ids)]
  if (gear.length) {
    const terms = gear.map((o) => o.en || o.label)
    parts.push(zh
      ? `摄影：${(compact ? terms.slice(0, 4) : terms).join(', ')}${compact ? '' : `（${gear.slice(0, 4).map((o) => o.desc.split('，')[0]).join('；')}）`}`
      : `Camera: ${(compact ? terms.slice(0, 4) : terms).join(', ')}`)
  }
  const aspect = findOption(ASPECT_RATIOS, v.aspect_id)
  if (aspect) parts.push(zh ? `画幅：${aspect.en}` : `Frame: ${aspect.en}`)
  if (v.palette.length) parts.push(zh ? `色调：${formatPalette(v.palette, true)}` : `Palette: ${formatPalette(v.palette, false)}`)
  else if (v.tone_notes) parts.push(zh ? `色调：${clip(v.tone_notes, 60)}` : `Palette: ${clip(v.tone_notes, 100)}`)
  const key = findOption(KEY_LIGHTS, l.key_light_id)
  const ratio = findOption(LIGHT_RATIOS, l.ratio_id)
  const light = [l.key_light ? clip(l.key_light, compact ? 40 : 100) : key ? (zh ? key.label : key.en) : '', ratio ? ratio.en : ''].filter(Boolean).join(zh ? '，' : ', ')
  if (light) parts.push(zh ? `光影：${light}` : `Light: ${light}`)
  if (!compact) {
    if (l.terminator) parts.push(zh ? `明暗交界：${clip(l.terminator, 80)}` : `Terminator: ${clip(l.terminator, 120)}`)
    if (l.fill) parts.push(zh ? `反射与轮廓光：${clip(l.fill, 80)}` : `Fill: ${clip(l.fill, 120)}`)
    if (l.dynamic) parts.push(zh ? `动态落影：${clip(l.dynamic, 80)}` : `Moving shadows: ${clip(l.dynamic, 120)}`)
    if (l.materials) parts.push(zh ? `材质：${clip(l.materials, 100)}` : `Materials: ${clip(l.materials, 150)}`)
  }
  const cons = pick(TECH_CONSTRAINTS, l.constraint_ids).map((o) => o.en || o.label)
  const consText = [cons.join(', '), compact ? '' : l.constraints].filter(Boolean).join('; ')
  if (consText) parts.push(zh ? `约束：${clip(consText, compact ? 120 : 300)}` : `Constraints: ${clip(consText, compact ? 160 : 360)}`)
  if (!parts.length) return ''
  return zh ? `【影像底座】${parts.join('；')}。` : `[Cinematic baseline] ${parts.join('; ')}.`
}

/** 预设模板的大致介绍（列表里显示） */
export function summarizeSpec(s: CinematicSpec): string {
  const bits = [styleLine(s, true), s.characters.length ? `${s.characters.length} 个人物` : '', s.props.length ? `${s.props.length} 个道具` : '']
  return bits.filter(Boolean).join(' · ')
}
