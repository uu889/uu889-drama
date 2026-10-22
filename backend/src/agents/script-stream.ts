/**
 * 剧本改写「打字机模式」：不走工具调用，让模型直接把改写后的剧本作为正文流式输出，
 * 前端边收边显示，写完由路由保存到 episodes.script_content。
 * （工具调用的参数要等整段生成完才能拿到，用户只能干等；正文流式输出可以一个字一个字地看到。）
 */

/** 发给剧本改写 Agent 的用户消息：原文附在消息里，明确不调用工具、只输出剧本正文 */
export function buildTypewriterMessage(source: string, extra?: string): string {
  return [
    '请把下面的原始内容改写为格式化剧本。',
    '（打字机模式：原始内容已经附在下面，不需要也不要调用任何工具；直接输出改写后的完整格式化剧本正文，'
      + '从第一个场景头开始写，不要开场白、解释和总结，也不要用代码块包裹。系统会自动保存你的输出。）',
    extra ? `补充要求：${extra}` : '',
    '【原始内容】',
    source,
  ].filter(Boolean).join('\n\n')
}

/** 去掉模型输出里的思考块、代码块包裹和场景头之前的简短开场白 */
export function cleanStreamedScript(text: string): string {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = /^```[\w-]*\s*\n([\s\S]*?)\n```\s*$/.exec(s)
  if (fenced) s = fenced[1].trim()
  const firstHeading = s.search(/^#{1,3}\s/m)
  if (firstHeading > 0 && firstHeading < 200) s = s.slice(firstHeading)
  return s.trim()
}
