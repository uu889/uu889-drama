/**
 * 模板库（一键生成风格 / 智能体 / 工作流）：frontmatter 解析、模板变量、内置文件都能读出来、用户版覆盖
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WS = fs.mkdtempSync(path.join(os.tmpdir(), 'uu889-catalog-'))
fs.cpSync(path.resolve(import.meta.dirname, '../workspace/catalog'), path.join(WS, 'catalog'), { recursive: true })
process.env.WORKSPACE_PATH = WS

const cat = await import('../src/services/catalog')

test('frontmatter：标量、引号、行内列表（含中文逗号与引号里的逗号）', () => {
  const { data, body } = cat.parseFrontmatter('---\nname: "短剧, 编剧"\nskills: [a-b, c]\nstarters: [第一句，第二句, "带, 逗号"]\n---\n\n正文')
  assert.equal(data.name, '短剧, 编剧')
  assert.deepEqual(data.skills, ['a-b', 'c'])
  assert.deepEqual(data.starters, ['第一句', '第二句', '带, 逗号'])
  assert.equal(body, '正文')
})

test('frontmatter：YAML 块列表、JSON 转义的双引号字符串、留空的值', () => {
  const raw = ['---', 'name: "说 \\"你好\\""', 'starters:', '  - "第一句"', '  - 第二句', 'category: 分析', 'icon:', '---', '正文'].join('\n')
  const { data } = cat.parseFrontmatter(raw)
  assert.equal(data.name, '说 "你好"')
  assert.deepEqual(data.starters, ['第一句', '第二句'])
  assert.equal(data.category, '分析')
  assert.equal(data.icon, '')
})

test('模板变量：inputs / steps / input / previous，未知变量原样保留', () => {
  const out = cat.renderTemplate('{{input}}|{{inputs.b}}|{{steps.s1}}|{{previous}}|{{steps.nope}}', {
    inputs: { a: 'A', b: 'B' }, steps: { s1: 'S1' }, previous: 'P',
  })
  assert.equal(out, 'A|B|S1|P|{{steps.nope}}')
})

test('工作流：无效步骤被丢弃，handoff 的 content_step 必须是存在的步骤', () => {
  const wf = cat.parseWorkflow('x', {
    name: 'W', steps: [{ id: 'a', prompt: 'p' }, { id: 'b' }],
    inputs: [{ key: 'topic' }, { key: '坏 key' }],
    handoff: { content_step: 'zzz', aspect_ratio: '4:5' },
  }, true)!
  assert.equal(wf.steps.length, 1)
  assert.deepEqual(wf.inputs.map(i => i.key), ['topic'])
  assert.equal(wf.handoff?.content_step, undefined)
  assert.equal(wf.handoff?.aspect_ratio, undefined)
  assert.equal(cat.parseWorkflow('y', { name: 'W', steps: [] }, true), null)
})

test('内置模板都能读出来，智能体引用的 skill 和工作流引用的智能体都存在', () => {
  const agents = cat.listAgents()
  const skills = cat.listSkills()
  const workflows = cat.listWorkflows()
  assert.ok(agents.length > 0 && workflows.length > 0)
  const skillIds = new Set(skills.map(s => s.id))
  for (const a of agents) for (const s of a.skills) assert.ok(skillIds.has(s), `${a.id} 引用的 skill ${s} 不存在`)
  const agentIds = new Set(agents.map(a => a.id))
  for (const w of workflows) for (const s of w.steps) if (s.agent) assert.ok(agentIds.has(s.agent), `${w.id} 的步骤 ${s.id} 引用的智能体不存在`)
  const styleIds = new Set(cat.listStyles().map(s => s.id))
  for (const w of workflows) if (w.handoff?.style) assert.ok(styleIds.has(w.handoff.style), `${w.id} 的风格 ${w.handoff.style} 不存在`)
  // 文件名就是 id
  const dir = path.join(WS, 'catalog', 'workflows')
  for (const f of fs.readdirSync(dir)) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    if (json.id) assert.equal(json.id, f.replace(/\.json$/, ''))
  }
})

test('系统提示词拼上 skill 全文', () => {
  const agent = cat.listAgents().find(a => a.skills.length)!
  const text = cat.composeAgentInstructions(agent, cat.listSkills())
  assert.ok(text.startsWith(agent.instructions))
  assert.ok(text.includes('## Skill：'))
})

test('用户版覆盖内置版，删掉后内置版回来；内置版不能删', () => {
  const builtin = cat.listAgents()[0]
  cat.saveUserAgent({ id: builtin.id, name: '我的版本', instructions: '新的提示词', skills: [], starters: ['a, b'] })
  const mine = cat.getAgent(builtin.id)!
  assert.equal(mine.name, '我的版本')
  assert.equal(mine.builtin, false)
  assert.deepEqual(mine.starters, ['a, b'])
  assert.equal(cat.deleteUserItem('agents', builtin.id), true)
  assert.equal(cat.getAgent(builtin.id)!.name, builtin.name)
  assert.equal(cat.deleteUserItem('agents', builtin.id), false)

  const wf = cat.saveUserWorkflow('my-flow', { name: 'M', steps: [{ id: 's', prompt: '{{input}}' }] })
  assert.equal(wf.builtin, false)
  assert.ok(cat.getWorkflow('my-flow'))
  assert.throws(() => cat.saveUserWorkflow('Bad Id', { name: 'M', steps: [{ prompt: 'x' }] }))
})
