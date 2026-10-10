/**
 * AI 内容语言指令块 — 按 RequestContext 中的目标语言生成，追加到 Agent instructions 末尾
 *
 * 设计要点：
 * - zh / 未设置时返回空串：默认行为与历史完全一致，零 token 开销
 * - 指令用英文书写（多语言模型遵循度最好），目标语言用原生名标注
 * - 必须自带「最高优先级」声明：桌面版已安装用户的 workspace 模板不会被覆盖
 *   （cpSync force:false），旧 SKILL.md 中的「只输出中文」约束只能靠这里的显式覆盖压制
 */

const LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  en: 'English',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  vi: 'Tiếng Việt (Vietnamese)',
  de: 'Deutsch (German)',
  fr: 'Français (French)',
  es: 'Español (Spanish)',
  pt: 'Português (Portuguese)',
}

/** 没有专属提示词 / 技能文件的语言，先回退英文版（比中文基础版更接近目标语言），再回退中文基础版 */
export function promptFallbackLanguages(lang?: string | null): string[] {
  if (!lang || lang === 'zh') return []
  return lang === 'en' ? ['en'] : [lang, 'en']
}

export function buildLanguageDirective(lang?: string | null): string {
  if (!lang || lang === 'zh') return ''
  const native = LANGUAGE_NATIVE_NAMES[lang] || lang
  return [
    '## Output Language (HIGHEST PRIORITY)',
    '',
    `ALL user-facing content you produce (scripts, dialogue, extracted fields, storyboard descriptions, atmosphere, image prompts, video prompts, asset names for NEW assets) MUST be written in ${native}.`,
    '',
    'This instruction has the highest priority and OVERRIDES any conflicting language requirement anywhere else in these instructions or skills — including requirements such as "output must be pure Chinese / 只输出中文". Ignore those.',
    '',
    'Exceptions:',
    '- When referencing EXISTING assets with @mentions (e.g. in video prompts), the name after @ must EXACTLY match the asset name as it appears in the provided asset lists — do NOT translate or rewrite existing asset names.',
    '- The visual style prefix of image prompts is injected automatically by the system (in English). Do not translate, rewrite, or duplicate it.',
  ].join('\n')
}
