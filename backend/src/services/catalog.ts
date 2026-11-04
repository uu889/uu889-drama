/**
 * 模板库（catalog）— 一键生成 / 智能体 / 工作流三个板块的内容来源
 *
 * 目录结构（内置在 workspace/catalog/，用户自建在 workspace/catalog-user/，同 id 用户版优先）：
 *   styles/<id>.json          视觉风格 { id, name, prompt, description, tags, source }
 *   skills/<id>/SKILL.md      Skill：frontmatter name / description / source / source_url，正文为全文
 *   agents/<id>/AGENT.md      智能体：frontmatter name / description / category / icon / skills: [..] /
 *                             starters: [..] / source / source_url，正文为系统提示词
 *   workflows/<id>.json       工作流 { id, name, description, category, tags, source, inputs, steps, handoff }
 *
 * 内容是文件，不进数据库：新增模板只要丢文件进目录，不用改代码；读取时每次扫描（文件少，开销可忽略）。
 * 桌面版：catalog/ 随模板版本整体覆盖，catalog-user/ 不在模板里，升级不动。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const WORKSPACE_DIR = process.env.WORKSPACE_PATH
  ? path.resolve(process.env.WORKSPACE_PATH)
  : path.resolve(__dirname, '../../workspace')
export const BUILTIN_CATALOG_DIR = path.join(WORKSPACE_DIR, 'catalog')
export const USER_CATALOG_DIR = path.join(WORKSPACE_DIR, 'catalog-user')

export const CATALOG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface CatalogSource { name?: string; url?: string; license?: string }

export interface CatalogStyle {
  id: string
  name: string
  prompt: string
  description: string
  tags: string[]
  source: CatalogSource | null
  builtin: boolean
}

export interface CatalogSkill {
  id: string
  name: string
  description: string
  content: string
  source: CatalogSource | null
  builtin: boolean
}

export interface CatalogAgent {
  id: string
  name: string
  description: string
  category: string
  icon: string
  skills: string[]
  starters: string[]
  instructions: string
  source: CatalogSource | null
  builtin: boolean
}

export interface WorkflowInput {
  key: string
  label: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  default?: string
}

export interface WorkflowStep {
  id: string
  name: string
  /** 智能体 id：用它的系统提示词 + skill；不填用通用助手 */
  agent?: string
  /** 本步的用户消息模板，{{inputs.key}} / {{steps.id}} 引用前面的结果 */
  prompt: string
}

export interface WorkflowHandoff {
  type: 'one-click'
  /** 哪一步的输出作为第一集原文；不填用最后一步 */
  content_step?: string
  /** 项目名模板，默认 {{inputs.<第一个输入>}} 截前 30 字 */
  title?: string
  style?: string
  aspect_ratio?: string
}

export interface CatalogWorkflow {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  source: CatalogSource | null
  inputs: WorkflowInput[]
  steps: WorkflowStep[]
  handoff: WorkflowHandoff | null
  builtin: boolean
}

// ───────────────────────── 解析（纯函数，测试覆盖） ─────────────────────────

/** 极简 frontmatter：key: value / key: [a, b, "c, d"]；不引入 yaml 依赖 */
export function parseFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string } {
  const text = raw.replace(/^\uFEFF/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { data: {}, body: text.trim() }
  const data: Record<string, string | string[]> = {}
  // 值留空的键：后面可能跟 YAML 块列表（"  - a"），没有列表项就当空字符串
  let listKey = ''
  const blockKeys = new Set<string>()
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const value = kv[2].trim()
    listKey = ''
    if (!value) {
      data[kv[1]] = []
      listKey = kv[1]
      blockKeys.add(kv[1])
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[kv[1]] = splitInlineList(value.slice(1, -1))
    } else {
      data[kv[1]] = unquote(value)
    }
  }
  for (const k of blockKeys) if ((data[k] as string[]).length === 0) data[k] = ''
  return { data, body: text.slice(m[0].length).trim() }
}

function unquote(v: string): string {
  const s = v.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    // JSON 风格的双引号字符串（可能带 \" \n 转义）
    try { return String(JSON.parse(s)) } catch { return s.slice(1, -1) }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

function splitInlineList(inner: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',' || ch === '，') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [])

function parseSource(v: unknown, name?: unknown, url?: unknown): CatalogSource | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const src = { name: str(o.name, 200) || undefined, url: str(o.url, 500) || undefined, license: str(o.license, 100) || undefined }
    return src.name || src.url ? src : null
  }
  const n = str(typeof v === 'string' ? v : name, 200)
  const u = str(url, 500)
  return n || u ? { name: n || undefined, url: u || undefined } : null
}

export function parseStyle(id: string, json: any, builtin: boolean): CatalogStyle | null {
  if (!json || typeof json !== 'object') return null
  const prompt = str(json.prompt)
  const name = str(json.name, 100)
  if (!prompt || !name) return null
  return { id, name, prompt, description: str(json.description, 1000), tags: list(json.tags), source: parseSource(json.source), builtin }
}

export function parseSkill(id: string, raw: string, builtin: boolean): CatalogSkill | null {
  const { data, body } = parseFrontmatter(raw)
  if (!body) return null
  return {
    id,
    name: str(data.name, 100) || id,
    description: str(data.description, 1000),
    content: body,
    source: parseSource(data.source, data.source, data.source_url),
    builtin,
  }
}

export function parseAgent(id: string, raw: string, builtin: boolean): CatalogAgent | null {
  const { data, body } = parseFrontmatter(raw)
  if (!body) return null
  return {
    id,
    name: str(data.name, 100) || id,
    description: str(data.description, 1000),
    category: str(data.category, 40) || '其他',
    icon: str(data.icon, 40),
    skills: list(data.skills).filter(s => CATALOG_ID.test(s)),
    starters: list(data.starters).slice(0, 8),
    instructions: body,
    source: parseSource(data.source, data.source, data.source_url),
    builtin,
  }
}

export function parseWorkflow(id: string, json: any, builtin: boolean): CatalogWorkflow | null {
  if (!json || typeof json !== 'object') return null
  const name = str(json.name, 100)
  const steps: WorkflowStep[] = (Array.isArray(json.steps) ? json.steps : [])
    .map((s: any, i: number) => ({
      id: CATALOG_ID.test(String(s?.id || '')) ? String(s.id) : `step-${i + 1}`,
      name: str(s?.name, 100) || `步骤 ${i + 1}`,
      agent: CATALOG_ID.test(String(s?.agent || '')) ? String(s.agent) : undefined,
      prompt: str(s?.prompt),
    }))
    .filter((s: WorkflowStep) => s.prompt)
  if (!name || !steps.length) return null
  const inputs: WorkflowInput[] = (Array.isArray(json.inputs) ? json.inputs : [])
    .map((x: any) => ({
      key: String(x?.key || '').trim(),
      label: str(x?.label, 60) || String(x?.key || ''),
      placeholder: str(x?.placeholder, 500) || undefined,
      multiline: !!x?.multiline,
      required: x?.required !== false,
      default: str(x?.default, 5000) || undefined,
    }))
    .filter((x: WorkflowInput) => /^[A-Za-z_][\w-]*$/.test(x.key))
  const h = json.handoff
  const handoff: WorkflowHandoff | null = h && typeof h === 'object' && (h.type ?? 'one-click') === 'one-click'
    ? {
        type: 'one-click',
        content_step: steps.some(s => s.id === h.content_step) ? h.content_step : undefined,
        title: str(h.title, 200) || undefined,
        style: str(h.style, 64) || undefined,
        aspect_ratio: ['16:9', '9:16', '1:1', 'adaptive'].includes(h.aspect_ratio) ? h.aspect_ratio : undefined,
      }
    : null
  return {
    id,
    name,
    description: str(json.description, 1000),
    category: str(json.category, 40) || '其他',
    tags: list(json.tags),
    source: parseSource(json.source),
    inputs,
    steps,
    handoff,
    builtin,
  }
}

/** 渲染步骤模板：{{inputs.key}} / {{steps.id}} / {{input}}（第一个输入）/ {{previous}}（上一步输出） */
export function renderTemplate(
  template: string,
  ctx: { inputs: Record<string, string>; steps: Record<string, string>; previous?: string },
): string {
  const firstInput = Object.values(ctx.inputs)[0] ?? ''
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => {
    if (key === 'input') return firstInput
    if (key === 'previous') return ctx.previous ?? ''
    const [scope, name] = key.split('.', 2)
    if (scope === 'inputs' && name in ctx.inputs) return ctx.inputs[name]
    if (scope === 'steps' && name in ctx.steps) return ctx.steps[name]
    return whole
  })
}

/** 智能体系统提示词 = 正文 + 所列 skill 全文（缺失的 skill 跳过） */
export function composeAgentInstructions(agent: CatalogAgent, skills: CatalogSkill[]): string {
  const byId = new Map(skills.map(s => [s.id, s]))
  const parts = [agent.instructions]
  for (const id of agent.skills) {
    const s = byId.get(id)
    if (s) parts.push(`## Skill：${s.name}\n\n${s.content}`)
  }
  return parts.join('\n\n---\n\n')
}

// ───────────────────────── 读文件 ─────────────────────────

function listDir(dir: string): string[] {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function readJsonItems<T>(kind: string, parse: (id: string, json: any, builtin: boolean) => T | null): T[] {
  const out = new Map<string, T>()
  for (const [root, builtin] of [[BUILTIN_CATALOG_DIR, true], [USER_CATALOG_DIR, false]] as const) {
    const dir = path.join(root, kind)
    for (const file of listDir(dir)) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5)
      if (!CATALOG_ID.test(id)) continue
      try {
        const item = parse(id, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), builtin)
        if (item) out.set(id, item)
      } catch (err) {
        console.warn(`[catalog] ${kind}/${file} 解析失败：${(err as Error).message}`)
      }
    }
  }
  return [...out.values()]
}

function readMdItems<T>(kind: string, fileName: string, parse: (id: string, raw: string, builtin: boolean) => T | null): T[] {
  const out = new Map<string, T>()
  for (const [root, builtin] of [[BUILTIN_CATALOG_DIR, true], [USER_CATALOG_DIR, false]] as const) {
    const dir = path.join(root, kind)
    for (const id of listDir(dir)) {
      if (!CATALOG_ID.test(id)) continue
      const file = path.join(dir, id, fileName)
      if (!fs.existsSync(file)) continue
      try {
        const item = parse(id, fs.readFileSync(file, 'utf8'), builtin)
        if (item) out.set(id, item)
      } catch (err) {
        console.warn(`[catalog] ${kind}/${id} 读取失败：${(err as Error).message}`)
      }
    }
  }
  return [...out.values()]
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'zh-CN')

export function listStyles(): CatalogStyle[] { return readJsonItems('styles', parseStyle).sort(byName) }
export function listSkills(): CatalogSkill[] { return readMdItems('skills', 'SKILL.md', parseSkill).sort(byName) }
export function listAgents(): CatalogAgent[] { return readMdItems('agents', 'AGENT.md', parseAgent).sort(byName) }
export function listWorkflows(): CatalogWorkflow[] { return readJsonItems('workflows', parseWorkflow).sort(byName) }

export function getAgent(id: string) { return listAgents().find(a => a.id === id) || null }
export function getWorkflow(id: string) { return listWorkflows().find(w => w.id === id) || null }

/** 用户自建 / 覆盖智能体：写到 catalog-user/agents/<id>/AGENT.md */
export function saveUserAgent(input: {
  id: string; name: string; description?: string; category?: string; icon?: string
  skills?: string[]; starters?: string[]; instructions: string
}): CatalogAgent {
  if (!CATALOG_ID.test(input.id)) throw new Error('id 只能用小写字母、数字和连字符')
  if (!input.name?.trim()) throw new Error('名称必填')
  if (!input.instructions?.trim()) throw new Error('系统提示词必填')
  const q = (s: string) => JSON.stringify(s.replace(/\r?\n/g, ' '))
  const arr = (a?: string[]) => `[${(a || []).map(q).join(', ')}]`
  const raw = [
    '---',
    `name: ${q(input.name.trim())}`,
    `description: ${q((input.description || '').trim())}`,
    `category: ${q((input.category || '').trim() || '我的')}`,
    `icon: ${q((input.icon || '').trim())}`,
    `skills: ${arr(input.skills)}`,
    `starters: ${arr(input.starters)}`,
    '---',
    '',
    input.instructions.trim(),
    '',
  ].join('\n')
  const dir = path.join(USER_CATALOG_DIR, 'agents', input.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'AGENT.md'), raw)
  return parseAgent(input.id, raw, false)!
}

/** 用户自建 / 覆盖工作流：写到 catalog-user/workflows/<id>.json */
export function saveUserWorkflow(id: string, json: any): CatalogWorkflow {
  if (!CATALOG_ID.test(id)) throw new Error('id 只能用小写字母、数字和连字符')
  const wf = parseWorkflow(id, json, false)
  if (!wf) throw new Error('工作流至少要有名称和一个带提示词的步骤')
  const { builtin: _b, ...data } = wf
  const dir = path.join(USER_CATALOG_DIR, 'workflows')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`)
  return wf
}

/** 删除用户版（内置版不能删；删掉用户覆盖后内置版重新生效） */
export function deleteUserItem(kind: 'agents' | 'workflows', id: string): boolean {
  if (!CATALOG_ID.test(id)) return false
  const target = kind === 'agents'
    ? path.join(USER_CATALOG_DIR, 'agents', id)
    : path.join(USER_CATALOG_DIR, 'workflows', `${id}.json`)
  if (!fs.existsSync(target)) return false
  fs.rmSync(target, { recursive: true, force: true })
  return true
}

/** 通用助手：工作流步骤没指定智能体时用 */
export const GENERIC_AGENT: CatalogAgent = {
  id: 'generic',
  name: '通用助手',
  description: '',
  category: '',
  icon: '',
  skills: [],
  starters: [],
  instructions: '你是短剧 / 漫剧创作助手。严格按用户要求输出，只输出结果正文，不要寒暄、不要解释你做了什么。',
  source: null,
  builtin: true,
}
