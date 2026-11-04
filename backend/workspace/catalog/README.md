# 模板目录（catalog）

一键生成 / 智能体 / 工作流三个板块的数据源。来源调研见 `docs/reference-research.md`。

- `styles/<id>.json`：视觉风格（30）
- `skills/<id>/SKILL.md`：skill（22）
- `agents/<id>/AGENT.md`：智能体模板（14），`skills` 引用上面的 skill id
- `workflows/<id>.json`：工作流模板（12），步骤 `agent` 引用智能体 id，`handoff.style` 引用风格 id

全部条目为中文原创整理，每条带 `source` 注明思路来源；AGPL / GPL / 无许可证的来源只借鉴思路，未复制原文。
