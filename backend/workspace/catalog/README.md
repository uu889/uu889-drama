# 模板目录（catalog）

一键生成 / 智能体 / 工作流三个板块的数据源。来源调研见 `docs/reference-research.md`。

- `styles/<id>.json`：视觉风格（30）
- `skills/<id>/SKILL.md`：skill（23）
- `agents/<id>/AGENT.md`：智能体模板（19），`skills` 引用上面的 skill id；「视频生成」分类的 5 个复刻自 uu889-video
- `workflows/<id>.json`：工作流模板（15），步骤 `agent` 引用智能体 id，`handoff.style` / `video.style` 引用风格 id
- `cinematic/<id>.json`：影像参数预设（7），全局视觉底座 / 人物 / 场景 / 道具 / 面部明暗 / 时间戳分镜

全部条目为中文原创整理，每条带 `source` 注明思路来源；AGPL / GPL / 无许可证的来源只借鉴思路，未复制原文。

## 文件格式

「一键生成 / 智能体 / 工作流」三个板块的内容。丢文件进来就会出现在界面上，不用改代码。
用户在界面里新建 / 修改的版本存到同级的 `catalog-user/`（同 id 优先），这里的内置版不会被改。

id（文件名 / 目录名）一律小写字母、数字、连字符。每项都请写出处（source），以便标注来源和许可。

### 视觉风格 `styles/<id>.json`（一键生成）

```json
{ "id": "ink-wash", "name": "水墨国风", "prompt": "生图风格提示词片段", "description": "一句话说明",
  "tags": ["国风"], "source": { "name": "出处", "url": "https://...", "license": "MIT" } }
```

在「一键生成 → 风格库」点「加入我的风格」后进入风格预设（style_presets），新建项目时可选。

### Skill `skills/<id>/SKILL.md`

frontmatter：`name` / `description` / `source` / `source_url`，正文为 skill 全文。

### 智能体 `agents/<id>/AGENT.md`

```markdown
---
name: 短剧编剧
description: 一句话说明
category: 编剧
icon: pen
skills: [episode-script-craft]
starters: [示例提问 1, 示例提问 2]
source: 出处
source_url: https://...
---

系统提示词正文
```

运行时系统提示词 = 正文 + 所列 skill 全文 + 内容语言指令。

### 工作流 `workflows/<id>.json`

```json
{
  "id": "topic-to-drama", "name": "…", "description": "…", "category": "…", "tags": [],
  "source": { "name": "…", "url": "…" },
  "inputs": [{ "key": "topic", "label": "主题", "placeholder": "…", "multiline": true }],
  "steps": [
    { "id": "outline", "name": "大纲", "agent": "drama-screenwriter", "prompt": "根据 {{inputs.topic}} 写大纲" },
    { "id": "script", "name": "剧本", "prompt": "按大纲写剧本：\n{{steps.outline}}" }
  ],
  "handoff": { "type": "one-click", "content_step": "script", "style": "风格 id，可省", "aspect_ratio": "9:16" }
}
```

步骤按顺序用文字模型执行。模板变量：`{{inputs.key}}`、`{{steps.<步骤id>}}`、`{{input}}`（第一个输入）、`{{previous}}`（上一步输出）。
`agent` 不填用通用助手。

`video` 可选：工作流跑完后在本页直接出片（创作会话，不跳一键生成），`{ "agent": "video-director", "prompt": "按下面的分镜出片：{{steps.storyboard}}", "aspect_ratio": "9:16", "style": "风格 id" }`。
不写 `video` 时也能出片：用「视频智能体」+ 最后一步的输出。

### 智能体直接出片

智能体页的对话就是「创作会话」（`/api/v1/studio`）：智能体可以调用工具生图、生视频、截帧、看图质检、配音、读网页、剪成片，素材和进度显示在对话里。
画面一贯性由工具强制套用（`backend/src/services/studio/consistency.ts`）：画风基调、角色 / 场景 / 道具设定图自动作参考图、外观锁定、关键帧优先、接上一镜代数上限。

`handoff` 可选：把某步输出作为第一集原文建成一键生成项目，接着走 改写 → 提取 → 生图 → 分镜 → 生视频 → 导出。

### 影像参数预设 `cinematic/<id>.json`（一键生成 / 智能体 / 工作流共用）

```json
{ "name": "寒江孤舟 · 写实新国风武侠", "description": "一句话说明", "category": "古装武侠",
  "spec": { "visual": {…}, "characters": […], "scene": {…}, "props": […], "lighting": {…}, "storyboard": {…} } }
```

`spec` 的字段与可选 id 见 `backend/src/services/cinematic/spec.ts` / `options.ts`（`GET /api/v1/cinematic/options`）。
界面「影像参数」面板里「载入预设」可选；用户另存的预设写到 `catalog-user/cinematic/`。
