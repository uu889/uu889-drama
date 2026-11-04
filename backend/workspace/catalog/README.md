# 模板库（catalog）

「一键生成 / 智能体 / 工作流」三个板块的内容。丢文件进来就会出现在界面上，不用改代码。
用户在界面里新建 / 修改的版本存到同级的 `catalog-user/`（同 id 优先），这里的内置版不会被改。

id（文件名 / 目录名）一律小写字母、数字、连字符。每项都请写出处（source），以便标注来源和许可。

## 视觉风格 `styles/<id>.json`（一键生成）

```json
{ "id": "ink-wash", "name": "水墨国风", "prompt": "生图风格提示词片段", "description": "一句话说明",
  "tags": ["国风"], "source": { "name": "出处", "url": "https://...", "license": "MIT" } }
```

在「一键生成 → 风格库」点「加入我的风格」后进入风格预设（style_presets），新建项目时可选。

## Skill `skills/<id>/SKILL.md`

frontmatter：`name` / `description` / `source` / `source_url`，正文为 skill 全文。

## 智能体 `agents/<id>/AGENT.md`

```markdown
---
name: 短剧编剧
description: 一句话说明
category: 编剧
icon: pen
skills: [short-drama-hooks]
starters: [示例提问 1, 示例提问 2]
source: 出处
source_url: https://...
---

系统提示词正文
```

运行时系统提示词 = 正文 + 所列 skill 全文 + 内容语言指令。

## 工作流 `workflows/<id>.json`

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
`agent` 不填用通用助手。`handoff` 可选：把某步输出作为第一集原文建成一键生成项目，接着走 改写 → 提取 → 生图 → 分镜 → 生视频 → 导出。
