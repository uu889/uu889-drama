/**
 * 设置页「配置说明」：每个服务商 × 服务类型（文字 / 图片 / 视频）的上手步骤、字段填法、注意事项。
 * 中文界面用 zh，其余语言用 en。
 */

export interface ProviderGuide {
  /** 一句话：这个服务适合做什么 */
  summary: string
  /** 按顺序操作的步骤 */
  steps: string[]
  /** 字段怎么填：[字段, 填法] */
  fields: Array<[string, string]>
  /** 注意事项 / 常见问题 */
  tips: string[]
  /** 相关链接：[名称, 地址] */
  links: Array<[string, string]>
}

type ServiceType = 'text' | 'image' | 'video'
type GuideTable = Partial<Record<ServiceType, Record<string, ProviderGuide>>>

/** 各服务类型在 UU889-Drama 里的用途 */
export const SERVICE_USAGE: Record<'zh' | 'en', Record<ServiceType, string>> = {
  zh: {
    text: '文字模型负责：小说改写成剧本、提取角色 / 场景 / 道具、拆分镜、为每张图和每段视频写提示词。启用多个配置时，优先级最高的为默认，工作台里可按集切换。',
    image: '图片模型负责：角色定妆照、场景图、道具图、分镜首帧 / 尾帧。生成后自动下载回 UU889-Drama，写回对应的角色 / 场景 / 分镜。',
    video: '视频模型负责：把每个分镜生成视频（提示词 + 首帧 / 尾帧 / 参考图 + 时长 / 比例 / 分辨率），完成后下载回来，可在「导出」里用 FFmpeg 拼成整集。',
  },
  en: {
    text: 'Text models rewrite novels into scripts, extract characters / scenes / props, break down storyboards and write the prompts for every image and video. With several active configs, the highest priority one is the default; each episode can switch.',
    image: 'Image models render character portraits, scenes, props and storyboard first / last frames. Results are downloaded back into UU889-Drama and attached to the right character / scene / shot.',
    video: 'Video models turn each storyboard shot into a clip (prompt + first / last frame / references + duration / ratio / resolution). Clips are downloaded back and can be merged into a full episode with FFmpeg in Export.',
  },
}

const zhOpenAICompatTips = [
  '「测试连接」会请求 /v1/models：200 = Key 和地址都正确；401 = Key 错误；404 = Base URL 多写或少写了路径。',
  'Base URL 只填域名（如 https://api.example.com），不要带 /v1/chat/completions，程序会自动拼接。',
]
const enOpenAICompatTips = [
  '"Test" calls /v1/models: 200 = key and URL are fine; 401 = wrong key; 404 = the Base URL has an extra or missing path.',
  'Enter just the domain as Base URL (e.g. https://api.example.com) — do not append /v1/chat/completions.',
]

const zh: GuideTable = {
  text: {
    aiask: {
      summary: 'aiask.me 是 OpenAI 兼容网关，一个 Key 同时可用 GPT / DeepSeek / Gemini 等文字模型，国内直连。',
      steps: [
        '登录 https://aiask.me ，在「API 令牌」里创建一个 Key（以 sk- 开头）。',
        '点上方「aiask.me」预设，自动填好 Base URL 与推荐模型。',
        '把 Key 粘贴到 API Key，点「测试连接」看到 200 即可保存。',
        '也可以在 AI 服务页顶部用「aiask.me 一键配置」，一次写入文字 + 图片 + 视频三套配置。',
      ],
      fields: [['Base URL', 'https://aiask.me'], ['API Key', 'sk-…'], ['模型', '首位为默认，如 gpt-6-astra、gpt-5.5、deepseek-v4-pro']],
      tips: zhOpenAICompatTips,
      links: [['aiask.me', 'https://aiask.me']],
    },
    openai: {
      summary: 'OpenAI 官方或任意 OpenAI 兼容中转站（/v1/chat/completions）。',
      steps: [
        '在 https://platform.openai.com/api-keys 创建 Key；用中转站则在中转站后台创建。',
        '点「OpenAI 官方」预设，或把 Base URL 改成中转站域名。',
        '在「模型」里添加要用的模型名（与中转站模型列表一致），首位为默认。',
        '点「测试连接」确认 200 后保存。',
      ],
      fields: [['Base URL', 'https://api.openai.com 或中转站域名'], ['API Key', 'sk-…'], ['模型', '如 gpt-5.5']],
      tips: [...zhOpenAICompatTips, '部分中转站不支持 temperature / max_tokens 参数，程序已自动兼容；仍报错时清空 Temperature 再试。'],
      links: [['OpenAI API Keys', 'https://platform.openai.com/api-keys']],
    },
    gemini: {
      summary: 'Google Gemini 官方接口（generateContent），长上下文适合整本小说改写。',
      steps: [
        '在 Google AI Studio（https://aistudio.google.com/apikey）创建 API Key。',
        '点「Gemini 官方」预设，粘贴 Key。',
        '国内网络需要代理或使用支持 Gemini 协议的中转站（Base URL 改为中转站地址）。',
        '点「测试连接」，200 即可保存。',
      ],
      fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['API Key', 'AIza…'], ['模型', '如 gemini-3.1-pro-preview、gemini-3-flash-preview']],
      tips: ['测试会发一条 "hi" 到 generateContent，会消耗极少量额度。', '429 表示配额用完或请求过快，稍后再试或换模型。'],
      links: [['Google AI Studio', 'https://aistudio.google.com/apikey']],
    },
    deepseek: {
      summary: 'DeepSeek 官方接口，中文写作性价比高。',
      steps: ['在 https://platform.deepseek.com/api_keys 创建 Key 并充值。', '点「DeepSeek 官方」预设，粘贴 Key。', '测试连接 200 后保存。'],
      fields: [['Base URL', 'https://api.deepseek.com'], ['API Key', 'sk-…'], ['模型', 'deepseek-v4-pro / deepseek-v4-flash']],
      tips: zhOpenAICompatTips,
      links: [['DeepSeek 开放平台', 'https://platform.deepseek.com/api_keys']],
    },
    qwen: {
      summary: '通义千问（阿里云百炼）OpenAI 兼容模式。',
      steps: ['在阿里云百炼控制台（https://bailian.console.aliyun.com）开通服务并创建 API Key。', '点「通义千问」预设；国际站把 Base URL 换成 https://dashscope-intl.aliyuncs.com/compatible-mode/v1。', '测试连接后保存。'],
      fields: [['Base URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'], ['API Key', 'sk-…'], ['模型', 'qwen3-max / qwen-plus / qwen-flash']],
      tips: ['Base URL 需要保留 /compatible-mode/v1 这一段。'],
      links: [['阿里云百炼', 'https://bailian.console.aliyun.com']],
    },
    claude: {
      summary: 'Anthropic Claude 原生接口（不是 OpenAI 兼容格式），长篇写作与结构化提取稳定。',
      steps: ['在 https://console.anthropic.com 的 API Keys 页面创建 Key。', '点「Claude（Anthropic）」预设，粘贴 Key。', '测试连接（/v1/models）200 后保存。'],
      fields: [['Base URL', 'https://api.anthropic.com'], ['API Key', 'sk-ant-…'], ['模型', '如 claude-opus-5-5、claude-sonnet-5-5']],
      tips: ['使用 Claude 中转站时，中转站必须支持 Anthropic 原生协议（/v1/messages）。'],
      links: [['Anthropic Console', 'https://console.anthropic.com']],
    },
    xai: {
      summary: 'xAI Grok 文字模型（OpenAI 兼容）。',
      steps: ['在 https://console.x.ai 创建 API Key。', '点「Grok（xAI）」预设，粘贴 Key。', '测试连接后保存。'],
      fields: [['Base URL', 'https://api.x.ai'], ['API Key', 'xai-…'], ['模型', '如 grok-4.7']],
      tips: zhOpenAICompatTips,
      links: [['xAI Console', 'https://console.x.ai']],
    },
    volcengine: {
      summary: '火山引擎方舟（豆包）文字模型。',
      steps: ['在火山方舟控制台（https://console.volcengine.com/ark）开通模型并创建 API Key。', 'Base URL 填 https://ark.cn-beijing.volces.com，程序自动拼 /api/v3。', '「模型」填控制台里的模型 ID 或推理接入点 ID（ep-…）。'],
      fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['API Key', '方舟 API Key'], ['模型', '模型 ID 或 ep-xxxx']],
      tips: ['报 404 / 模型不存在时，多半是模型没在控制台开通，或填成了显示名而不是模型 ID。'],
      links: [['火山方舟', 'https://console.volcengine.com/ark']],
    },
  },
  image: {
    aiask: {
      summary: 'aiask.me 图片：gpt-image-2、grok-imagine-image、gemini-3-pro-image 等，支持参考图保持角色一致。',
      steps: ['用文字配置里同一个 aiask.me Key。', '点「aiask.me」预设，粘贴 Key，测试连接后保存。', '模型列表首位为默认；工作台生图时可切换。'],
      fields: [['Base URL', 'https://aiask.me'], ['API Key', 'sk-…'], ['模型', 'gpt-image-2 / grok-imagine-image / gemini-3-pro-image']],
      tips: ['分镜生图会自动带上角色 / 场景图作为参考图，提升一致性。'],
      links: [['aiask.me', 'https://aiask.me']],
    },
    openai: {
      summary: 'OpenAI 图片接口（/v1/images/generations，有参考图时走 /v1/images/edits）。',
      steps: ['准备 OpenAI 或兼容中转站的 Key。', '点「OpenAI 官方」预设或改成中转站地址。', '模型填 gpt-image-2 等，测试连接后保存。'],
      fields: [['Base URL', 'https://api.openai.com'], ['API Key', 'sk-…'], ['模型', 'gpt-image-2']],
      tips: ['中转站需要同时支持 images/generations 与 images/edits，否则带参考图的分镜会失败。'],
      links: [['OpenAI API Keys', 'https://platform.openai.com/api-keys']],
    },
    gemini: {
      summary: 'Gemini 原生生图（返回 base64，自动保存）。',
      steps: ['在 Google AI Studio 创建 Key。', '点「Gemini 官方」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['API Key', 'AIza…'], ['模型', 'gemini-3-pro-image / gemini-3.1-flash-image']],
      tips: ['参考图会以 inline_data 发送，单张已压缩到 768px 以内。'],
      links: [['Google AI Studio', 'https://aistudio.google.com/apikey']],
    },
    xai: {
      summary: 'xAI Grok 图片模型。',
      steps: ['在 https://console.x.ai 创建 Key。', '点「Grok 图片（xAI）」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://api.x.ai'], ['API Key', 'xai-…'], ['模型', 'grok-imagine-image-2.0 等']],
      tips: ['画面比例按项目尺寸自动换算成 Grok 支持的比例。'],
      links: [['xAI Console', 'https://console.x.ai']],
    },
    volcengine: {
      summary: '火山方舟 Seedream 图片模型。',
      steps: ['在火山方舟开通 Seedream 并创建 Key。', 'Base URL 填 https://ark.cn-beijing.volces.com，模型填模型 ID。'],
      fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['API Key', '方舟 API Key'], ['模型', 'Seedream 模型 ID']],
      tips: ['参考图需要公网可访问时，后端要配置 PUBLIC_BASE_URL。'],
      links: [['火山方舟', 'https://console.volcengine.com/ark']],
    },
    comfyui: {
      summary: '本地 ComfyUI 生图：内置 SDXL / SD1.5 / FLUX 模板开箱即用，也可以粘贴自己的工作流，提示词、尺寸、种子、参考图、模型都会自动接入。',
      steps: [
        '启动 ComfyUI：便携版 / 源码版默认 http://127.0.0.1:8188；ComfyUI Desktop 默认端口是 8000。ComfyUI 不在本机时加 --listen 0.0.0.0 启动，Base URL 填那台机器的 IP。',
        '「工作流来源」选一个内置模板（推荐 SDXL；显存 12GB 以上可选 FLUX.1 dev），按下方清单把模型文件下载到对应目录（如 ComfyUI/models/checkpoints/）。',
        '「模型」里填 checkpoint 文件名（与 ComfyUI 里显示的完全一致），可点「读取 ComfyUI 模型」直接点选。',
        '想用自己的工作流：在 ComfyUI 菜单「工作流 → 导出 (API)」（Workflow → Export (API)）得到 JSON，选「自定义工作流」粘贴进来。不用手写占位符——「自动绑定」会识别正 / 负提示词、尺寸、种子、LoadImage 参考图和 Checkpoint。',
        '点「检查工作流」，确认每一项都接上了（绿色），缺的模型文件会标红。',
        '可选：填「提示词模板」给所有提示词加统一的画质词或风格词；「中文提示词自动翻译成英文」默认开启。',
        '点「测试连接」后保存。生成时工作台「任务」里能看到排队位置、当前节点、第几步、预计剩余时间和下载进度。',
      ],
      fields: [
        ['Base URL', 'http://127.0.0.1:8188（Desktop 版 :8000）'],
        ['API Key', '一般留空；ComfyUI 前面有带鉴权的反向代理时填 Token（以 Bearer 发送）'],
        ['模型', 'checkpoint 文件名，如 sd_xl_base_1.0.safetensors；填 default 用模板推荐文件'],
        ['基准尺寸', 'SDXL / FLUX 填 1024，SD1.5 填 512；按项目画面比例换算宽高（对齐 64）'],
        ['步数 / CFG', '留空 = 用模板 / 工作流自己的值；填写后会覆盖所有采样节点'],
      ],
      tips: [
        'SD / SDXL / FLUX 的文本编码器只懂英文：保持「中文提示词自动翻译成英文」开启（默认开），提交前会用当前启用的文字模型翻译。',
        '报「模型文件不存在 (value_not_in_list)」：文件名不对或没放进对应目录；放好后在 ComfyUI 里按 R 刷新或重启。',
        '报「模型文件不完整或已损坏」：下载中断，删除后重新下载并核对大小。',
        '显存不足：降低基准尺寸、换 fp8 / GGUF 模型，或用 --lowvram 启动 ComfyUI。',
        '参考图只在工作流里有 LoadImage 节点时才会上传使用（如 IP-Adapter / Redux / Kontext 工作流）。',
      ],
      links: [['ComfyUI', 'https://github.com/comfyanonymous/ComfyUI'], ['ComfyUI 官方示例工作流', 'https://comfyanonymous.github.io/ComfyUI_examples/']],
    },
    sdwebui: {
      summary: 'Stable Diffusion WebUI（AUTOMATIC1111 / Forge / reForge）的 /sdapi/v1/txt2img 接口，出图后直接把图片传回 UU889-Drama。',
      steps: [
        '用 --api 参数启动 WebUI：Windows 在 webui-user.bat 里写 set COMMANDLINE_ARGS=--api（远程访问再加 --listen）；Linux / macOS 运行 ./webui.sh --api。',
        '浏览器打开 http://127.0.0.1:7860/docs 能看到接口文档，说明 API 已开启。',
        'Base URL 填 http://127.0.0.1:7860。',
        '「模型」填 default 沿用 WebUI 当前选中的模型；填模型名（点「读取 WebUI 模型」可选）则每次生成临时切换到该模型。',
        '点一个「参数预设」（SDXL / SD1.5 / Lightning / Pony），按需修改采样器、步数、CFG。',
        '可选：选一个「提示词模板」，{{prompt}} 处插入 UU889-Drama 写好的提示词。',
        '测试连接后保存。出图时任务里会显示排队位置、采样步数和预计剩余时间。',
      ],
      fields: [
        ['Base URL', 'http://127.0.0.1:7860'],
        ['API Key', '开启 --api-auth 用户名:密码 时填「用户名:密码」，否则留空'],
        ['模型', 'default，或 checkpoint 名（sd-models 列表里的 model_name / title）'],
        ['采样器', '如 DPM++ 2M、Euler a；留空用 WebUI 默认'],
      ],
      tips: [
        '提示词需要英文：保持「中文提示词自动翻译成英文」开启（默认开），会用当前启用的文字模型先翻译。',
        '404：没加 --api；401：--api-auth 的用户名密码不对。',
        'WebUI 一次只跑一张，批量生成会排队，任务里能看到前面还有几张。',
        '较老的 WebUI 不支持按任务 ID 查询进度时，会退回显示全局采样进度（步数与预计剩余时间）。',
        '参考图不会传给 WebUI（ControlNet / IP-Adapter 插件参数各异）；需要角色一致性请用 ComfyUI 或 Fooocus。',
      ],
      links: [['AUTOMATIC1111 API 说明', 'https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API'], ['Forge', 'https://github.com/lllyasviel/stable-diffusion-webui-forge']],
    },
    fooocus: {
      summary: 'Fooocus-API（Fooocus 的接口版）：SDXL 出图质量稳定，支持把角色 / 场景图作为「图片提示」保持一致性。',
      steps: [
        '注意：需要运行 Fooocus-API（https://github.com/mrhan1993/Fooocus-API），不是 Fooocus 网页版（7865 端口那个没有接口）。',
        '按 Fooocus-API 说明安装后运行：python main.py --host 127.0.0.1 --port 8888（远程访问用 --host 0.0.0.0）。',
        '浏览器打开 http://127.0.0.1:8888/docs 能看到接口文档即为正常。',
        'Base URL 填 http://127.0.0.1:8888，「模型」填 default 或 checkpoint 文件名（点「读取 Fooocus 模型」可选）。',
        '选「性能模式」（Speed 均衡；Lightning / Hyper-SD 最快；Quality 最慢最好）和「风格」（可点预设）。',
        '可选：选一个「提示词模板」。测试连接后保存。',
      ],
      fields: [
        ['Base URL', 'http://127.0.0.1:8888'],
        ['API Key', '启动时加了 --apikey 才填同样的值，否则留空'],
        ['模型', 'default 或 checkpoint 文件名，如 juggernautXL_v8Rundiffusion.safetensors'],
        ['风格', '逗号分隔，如 Fooocus V2, Fooocus Enhance, Fooocus Sharp'],
      ],
      tips: [
        '分镜的参考图（最多 4 张）会作为 Image Prompt 发送，自动走 /v2/generation/text-to-image-with-ip。',
        '提示词需要英文：保持「中文提示词自动翻译成英文」开启（默认开）；Fooocus V2 风格还会自动扩写英文提示词。',
        '画面比例只能取 Fooocus 内置的 SDXL 尺寸，程序会按项目比例取最接近的一档。',
        '出图时任务里会显示 Fooocus 的进度百分比与当前步数。',
      ],
      links: [['Fooocus-API', 'https://github.com/mrhan1993/Fooocus-API']],
    },
  },
  video: {
    aiask: {
      summary: 'aiask.me 的 Grok 视频（grok-imagine-video），支持首帧 / 参考图。',
      steps: ['用 aiask.me 的 Key。', '点「aiask.me Grok 视频」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://aiask.me'], ['API Key', 'sk-…'], ['模型', 'grok-imagine-video-1.5']],
      tips: ['时长、比例、分辨率会自动换算成 Grok 支持的档位。'],
      links: [['aiask.me', 'https://aiask.me']],
    },
    xai: {
      summary: 'xAI 原生 Grok 视频接口（/v1/videos/generations）。',
      steps: ['直连官方：Base URL 填 https://api.x.ai，Key 在 console.x.ai 创建。', '用 aiask.me 的 Grok 分组 Key：Base URL 填 https://aiask.me。'],
      fields: [['Base URL', 'https://api.x.ai'], ['API Key', 'xai-…'], ['模型', 'grok-imagine-video-1.5']],
      tips: ['参考图在提示词里以 <IMAGE_n> 引用，程序自动处理。'],
      links: [['xAI Console', 'https://console.x.ai']],
    },
    veo: {
      summary: 'Google Veo 3.1（Gemini API 长任务）。',
      steps: ['在 Google AI Studio 创建 Key（需开通付费）。', '点「Google Veo」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['API Key', 'AIza…'], ['模型', 'veo-3.1-generate-preview 等']],
      tips: ['Veo 生成通常需要 1~5 分钟，任务里显示已等待时长。'],
      links: [['Google AI Studio', 'https://aistudio.google.com/apikey']],
    },
    runway: {
      summary: 'Runway 官方 API（gen4.5 / gen4_turbo / veo3.1）。',
      steps: ['在 https://dev.runwayml.com 创建 API Key 并充值。', '点「Runway」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://api.dev.runwayml.com'], ['API Key', 'key_…'], ['模型', 'gen4.5 / gen4_turbo']],
      tips: ['gen4 系列图生视频必须有首帧。'],
      links: [['Runway Developer', 'https://dev.runwayml.com']],
    },
    volcengine: {
      summary: '火山方舟 Seedance 2.0（豆包视频），支持首尾帧、多参考图、参考视频 / 音频。',
      steps: ['在火山方舟开通 Seedance 并创建 Key。', '点「Seedance 2.0 官方」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['API Key', '方舟 API Key'], ['模型', 'doubao-seedance-2-0-…']],
      tips: ['参考视频 / 音频是本地文件时，后端需要配置 PUBLIC_BASE_URL（公网地址）。桌面版不支持。'],
      links: [['火山方舟', 'https://console.volcengine.com/ark']],
    },
    minimax: {
      summary: 'MiniMax 视频（H3）。',
      steps: ['在 https://platform.minimaxi.com 创建 Key。', '点「MiniMax H3 官方」预设，粘贴 Key 后保存。'],
      fields: [['Base URL', 'https://api.minimaxi.com'], ['API Key', 'MiniMax Key'], ['模型', 'MiniMax-H3']],
      tips: ['支持首帧 / 尾帧与参考图。'],
      links: [['MiniMax 开放平台', 'https://platform.minimaxi.com']],
    },
    aliyun: {
      summary: '阿里云百炼 Wan 3.0 视频。',
      steps: ['在百炼控制台创建 API Key，并找到业务空间 ID（WorkspaceId）。', '点预设后把 Base URL 里的 {WorkspaceId} 换成你的空间 ID。'],
      fields: [['Base URL', 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com'], ['API Key', 'sk-…'], ['模型', 'wan3.0-video / wan3.0-video-prime']],
      tips: ['Base URL 里的 {WorkspaceId} 必须替换，否则会连接失败。'],
      links: [['阿里云百炼', 'https://bailian.console.aliyun.com']],
    },
    comfyui: {
      summary: '本地 ComfyUI 生视频：内置 Wan 2.2 模板（5B 文图二合一 / 14B 图生 / 14B 首尾帧 / 14B 文生）与 MiniMax H3 模板（音画同出，20 步 / Turbo 8 步 / Turbo 4 步）开箱即用；也可粘贴自己的工作流，UU889-Drama 的提示词、首尾帧、参考图、时长、比例、分辨率、种子、FPS、模型都会自动接入，做到强控制。',
        steps: [
        '启动 ComfyUI（建议更新到最新版，内置 Wan 2.2 节点）：默认 http://127.0.0.1:8188，ComfyUI Desktop 默认 :8000；在另一台机器上运行时加 --listen 0.0.0.0，Base URL 填那台机器的 IP。',
        '「工作流来源」选一个内置模板：显存 12GB 左右选「Wan 2.2 TI2V 5B」；24GB 以上选 14B 图生（画质最好）或首尾帧（镜头衔接）；32GB 以上可选 MiniMax H3（视频自带对白 / 音效 / 配乐，推荐 Turbo 8 步）。',
        'MiniMax H3 需要 ComfyUI 0.30.0 以上（自带 MiniMaxH3ImageToVideo 节点）和 4 个文件：diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors、text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors、vae/minimax_h3_video_vae_fp16.safetensors、vae/minimax_h3_audio_vae_fp32.safetensors；Turbo 模板再加 loras/ 里对应的 8 步或 4 步 LoRA。MiniMaxH3_Director 是交互式时间线编辑插件，UU889-Drama 通过接口提交时用不到，可以不装。',
        '按模板下方的清单下载模型文件，放到对应目录（diffusion_models / text_encoders / vae），文件名保持不变。',
        '「模型」填模板 ID（如 wan2.2-i2v-14b，会自动选中对应模板），或填模型文件名直接替换工作流里的扩散模型；Wan 2.2 14B 双模型写成「高噪声文件|低噪声文件」。',
        '用自己的工作流：在 ComfyUI 里「工作流 → 导出 (API)」得到 JSON，选「自定义工作流」粘贴。保持「自动绑定」开启，不需要手写占位符；想精确控制也可以在任意字段写 {{prompt}}、{{image}}、{{last_frame}} 等占位符（见下方列表），写了的类别以手写为准。',
        '点「检查工作流」：表格会列出每个节点哪个字段接到了 UU889-Drama 的哪个参数，没接上的会给出提醒，缺的模型文件标红。',
        '点「测试连接」后保存。生成时工作台的视频面板和「任务」抽屉会显示：上传参考图 → 排队第几位 → 当前节点 → 采样第几段第几步 → 预计剩余时间 → 解码 / 合成 → 下载进度（MB）。',
      ],
      fields: [
        ['Base URL', 'http://127.0.0.1:8188（Desktop 版 :8000）'],
        ['API Key', '一般留空；有鉴权反向代理时填 Token'],
        ['模型', '模板 ID（wan2.2-ti2v-5b、minimax-h3-fl2v-turbo-8step 等）或模型文件名；双模型用 | 分隔；填 Turbo LoRA 文件名会选中对应的 H3 Turbo 模板'],
        ['FPS', '留空 = 模板推荐值（5B 为 24，14B 为 16）或自定义工作流里的值'],
        ['步数 / CFG', '留空 = 不改工作流；填写后覆盖所有采样节点（两段采样会按比例换算分段点）'],
        ['负向提示词', '留空用 Wan 官方负向词'],
      ],
      tips: [
        '时长 × FPS 自动换算帧数（Wan 要求 4n+1，如 5 秒 16fps = 81 帧）；分辨率 480p / 720p / 1080p 按画面比例换算宽高（对齐 32）。',
        'MiniMax H3 固定 24fps，帧数按 17k+5 取整（5 秒 = 124 帧，官方建议 5~15 秒）；短边最高 768（16:9 为 1344×768），选 1080p 也按 768p 出片。H3 没有负向提示词，声音（对白 / 音效 / 配乐）直接写在提示词里。',
        '没有首帧的分镜：5B 模板自动变成纯文生；14B 图生模板会降级运行，建议先生成分镜首帧。',
        '输出必须是 mp4：用 SaveVideo 或 VHS_VideoCombine（format 选 video/h264-mp4），只输出 GIF / WebP 会报错。',
        'ComfyUI 一次只跑一个任务，批量生成会排队；任务里能看到前面还有几个。',
        '进度细节依赖 ComfyUI 的 WebSocket（/ws）；经过不支持 WebSocket 的反向代理时只显示排队与已等待时长，不影响生成。',
        '显存不足：降低分辨率或时长、换 fp8 / GGUF 模型、用 --lowvram 启动。',
      ],
      links: [['ComfyUI Wan 2.2 教程', 'https://docs.comfy.org/tutorials/video/wan/wan2_2'], ['Wan 2.2 模型下载', 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged']],
    },
  },
}

const en: GuideTable = {
  text: {
    aiask: {
      summary: 'aiask.me is an OpenAI-compatible gateway: one key for GPT / DeepSeek / Gemini text models.',
      steps: ['Sign in at https://aiask.me and create a key (starts with sk-).', 'Click the "aiask.me" preset to fill Base URL and models.', 'Paste the key, click Test, save once you see 200.', 'Or use the "aiask.me quick setup" at the top of the AI page to create text + image + video configs at once.'],
      fields: [['Base URL', 'https://aiask.me'], ['API Key', 'sk-…'], ['Models', 'first one is the default, e.g. gpt-6-astra']],
      tips: enOpenAICompatTips,
      links: [['aiask.me', 'https://aiask.me']],
    },
    openai: {
      summary: 'OpenAI or any OpenAI-compatible relay (/v1/chat/completions).',
      steps: ['Create a key at https://platform.openai.com/api-keys (or in your relay).', 'Click the preset or replace Base URL with the relay domain.', 'Add model names exactly as the relay lists them.', 'Test, then save.'],
      fields: [['Base URL', 'https://api.openai.com or relay domain'], ['API Key', 'sk-…'], ['Models', 'e.g. gpt-5.5']],
      tips: [...enOpenAICompatTips, 'Some relays reject temperature / max_tokens; clear Temperature if errors persist.'],
      links: [['OpenAI API Keys', 'https://platform.openai.com/api-keys']],
    },
    gemini: {
      summary: 'Google Gemini native API (generateContent); long context suits whole-novel rewrites.',
      steps: ['Create a key in Google AI Studio (https://aistudio.google.com/apikey).', 'Click the Gemini preset and paste the key.', 'Test, then save.'],
      fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['API Key', 'AIza…'], ['Models', 'e.g. gemini-3.1-pro-preview']],
      tips: ['The test sends "hi" and uses a tiny amount of quota.', '429 means quota exhausted or rate limited.'],
      links: [['Google AI Studio', 'https://aistudio.google.com/apikey']],
    },
    deepseek: {
      summary: 'DeepSeek official API.',
      steps: ['Create a key at https://platform.deepseek.com/api_keys.', 'Click the preset, paste the key, test and save.'],
      fields: [['Base URL', 'https://api.deepseek.com'], ['API Key', 'sk-…'], ['Models', 'deepseek-v4-pro / deepseek-v4-flash']],
      tips: enOpenAICompatTips,
      links: [['DeepSeek Platform', 'https://platform.deepseek.com/api_keys']],
    },
    qwen: {
      summary: 'Qwen (Alibaba Cloud Model Studio) in OpenAI-compatible mode.',
      steps: ['Create an API key in Model Studio.', 'Click the preset; international accounts use https://dashscope-intl.aliyuncs.com/compatible-mode/v1.', 'Test and save.'],
      fields: [['Base URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'], ['API Key', 'sk-…'], ['Models', 'qwen3-max / qwen-plus']],
      tips: ['Keep the /compatible-mode/v1 path in Base URL.'],
      links: [['Model Studio', 'https://bailian.console.aliyun.com']],
    },
    claude: {
      summary: 'Anthropic Claude native API (not OpenAI format).',
      steps: ['Create a key at https://console.anthropic.com.', 'Click the Claude preset, paste the key, test and save.'],
      fields: [['Base URL', 'https://api.anthropic.com'], ['API Key', 'sk-ant-…'], ['Models', 'e.g. claude-opus-5-5']],
      tips: ['Relays must support the native /v1/messages protocol.'],
      links: [['Anthropic Console', 'https://console.anthropic.com']],
    },
    xai: {
      summary: 'xAI Grok text models (OpenAI-compatible).',
      steps: ['Create a key at https://console.x.ai.', 'Click the preset, paste the key, test and save.'],
      fields: [['Base URL', 'https://api.x.ai'], ['API Key', 'xai-…'], ['Models', 'e.g. grok-4.7']],
      tips: enOpenAICompatTips,
      links: [['xAI Console', 'https://console.x.ai']],
    },
    volcengine: {
      summary: 'Volcengine Ark (Doubao) text models.',
      steps: ['Enable a model and create an API key in the Ark console.', 'Base URL: https://ark.cn-beijing.volces.com (/api/v3 is added automatically).', 'Models: the model ID or endpoint ID (ep-…).'],
      fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['API Key', 'Ark key'], ['Models', 'model ID or ep-xxxx']],
      tips: ['404 / model not found usually means the model is not enabled or you used a display name.'],
      links: [['Volcengine Ark', 'https://console.volcengine.com/ark']],
    },
  },
  image: {
    aiask: {
      summary: 'aiask.me images: gpt-image-2, grok-imagine-image, gemini-3-pro-image; reference images keep characters consistent.',
      steps: ['Reuse your aiask.me key.', 'Click the preset, paste the key, test and save.'],
      fields: [['Base URL', 'https://aiask.me'], ['API Key', 'sk-…'], ['Models', 'gpt-image-2 / grok-imagine-image']],
      tips: ['Storyboard frames automatically include character / scene images as references.'],
      links: [['aiask.me', 'https://aiask.me']],
    },
    openai: {
      summary: 'OpenAI images (/v1/images/generations, /v1/images/edits with references).',
      steps: ['Prepare an OpenAI or relay key.', 'Click the preset, set models, test and save.'],
      fields: [['Base URL', 'https://api.openai.com'], ['API Key', 'sk-…'], ['Models', 'gpt-image-2']],
      tips: ['Relays must support both generations and edits.'],
      links: [['OpenAI API Keys', 'https://platform.openai.com/api-keys']],
    },
    gemini: {
      summary: 'Gemini native image generation (base64, saved automatically).',
      steps: ['Create a key in Google AI Studio.', 'Click the preset, paste the key and save.'],
      fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['API Key', 'AIza…'], ['Models', 'gemini-3-pro-image']],
      tips: ['References are sent inline, downscaled to 768 px.'],
      links: [['Google AI Studio', 'https://aistudio.google.com/apikey']],
    },
    xai: {
      summary: 'xAI Grok image models.',
      steps: ['Create a key at https://console.x.ai.', 'Click the preset, paste the key and save.'],
      fields: [['Base URL', 'https://api.x.ai'], ['API Key', 'xai-…'], ['Models', 'grok-imagine-image-2.0']],
      tips: ['Aspect ratio is mapped from the project size.'],
      links: [['xAI Console', 'https://console.x.ai']],
    },
    volcengine: {
      summary: 'Volcengine Ark Seedream image models.',
      steps: ['Enable Seedream in Ark and create a key.', 'Base URL https://ark.cn-beijing.volces.com, models = model ID.'],
      fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['API Key', 'Ark key'], ['Models', 'Seedream model ID']],
      tips: ['Public references need PUBLIC_BASE_URL on the backend.'],
      links: [['Volcengine Ark', 'https://console.volcengine.com/ark']],
    },
    comfyui: {
      summary: 'Local ComfyUI images: built-in SDXL / SD1.5 / FLUX templates, or paste your own workflow — prompt, size, seed, references and model are wired in automatically.',
      steps: [
        'Start ComfyUI: portable / source build at http://127.0.0.1:8188, ComfyUI Desktop at :8000. On another machine start with --listen 0.0.0.0 and use its IP.',
        'Pick a built-in template (SDXL recommended; FLUX.1 dev with 12 GB+ VRAM) and download the listed model files into the shown folders.',
        'Put the checkpoint file name in Models (exactly as ComfyUI shows it) — or click "Read ComfyUI models" and pick one.',
        'Own workflow: in ComfyUI use Workflow → Export (API), choose "Custom workflow" and paste the JSON. No placeholders needed — Auto-bind finds the positive / negative prompt, size, seed, LoadImage references and checkpoint.',
        'Click "Check workflow" to see every binding; missing model files are marked red.',
        'Optional: a prompt template adds quality / style words to every prompt.',
        'Test and save. While generating, the Tasks drawer shows queue position, current node, step, ETA and download progress.',
      ],
      fields: [['Base URL', 'http://127.0.0.1:8188 (Desktop :8000)'], ['API Key', 'usually empty; a token if behind an auth proxy'], ['Models', 'checkpoint file name; "default" = template file'], ['Base size', '1024 for SDXL / FLUX, 512 for SD1.5'], ['Steps / CFG', 'empty = keep the workflow values; filled = override every sampler']],
      tips: ['SD / SDXL / FLUX text encoders only understand English: keep "Translate non-English prompts to English" on (default) so the active text model translates them first.', '"value_not_in_list": wrong file name or folder — press R in ComfyUI to refresh after copying files.', 'Out of memory: lower the base size, use fp8 / GGUF models or start ComfyUI with --lowvram.'],
      links: [['ComfyUI', 'https://github.com/comfyanonymous/ComfyUI'], ['ComfyUI examples', 'https://comfyanonymous.github.io/ComfyUI_examples/']],
    },
    sdwebui: {
      summary: 'Stable Diffusion WebUI (AUTOMATIC1111 / Forge / reForge) via /sdapi/v1/txt2img; images come straight back into UU889-Drama.',
      steps: ['Start WebUI with --api (Windows: set COMMANDLINE_ARGS=--api in webui-user.bat; Linux / macOS: ./webui.sh --api; add --listen for remote access).', 'Open http://127.0.0.1:7860/docs to confirm the API is on.', 'Base URL: http://127.0.0.1:7860.', 'Models: "default" keeps the loaded model; a model name switches per request (click "Read WebUI models").', 'Pick a parameter preset (SDXL / SD1.5 / Lightning / Pony) and adjust sampler, steps, CFG.', 'Optional: a prompt template wraps the UU889-Drama prompt at {{prompt}}.', 'Test and save. Tasks show queue position, sampling step and ETA.'],
      fields: [['Base URL', 'http://127.0.0.1:7860'], ['API Key', '"user:password" when started with --api-auth, otherwise empty'], ['Models', 'default or a checkpoint name'], ['Sampler', 'e.g. DPM++ 2M, Euler a']],
      tips: ['Prompts must be English — keep "Translate non-English prompts to English" on (default).', '404: --api missing; 401: wrong --api-auth credentials.', 'Reference images are not sent to WebUI; use ComfyUI or Fooocus for character consistency.'],
      links: [['AUTOMATIC1111 API', 'https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API']],
    },
    fooocus: {
      summary: 'Fooocus-API (the API edition of Fooocus): reliable SDXL quality, character / scene images sent as Image Prompts.',
      steps: ['Run Fooocus-API (https://github.com/mrhan1993/Fooocus-API), not the Fooocus web UI on :7865.', 'Start it with: python main.py --host 127.0.0.1 --port 8888 (use 0.0.0.0 for remote access).', 'Open http://127.0.0.1:8888/docs to confirm.', 'Base URL http://127.0.0.1:8888; Models "default" or a checkpoint file name.', 'Choose a performance mode and styles (click a preset).', 'Optional: prompt template. Test and save.'],
      fields: [['Base URL', 'http://127.0.0.1:8888'], ['API Key', 'only if started with --apikey'], ['Models', 'default or checkpoint file'], ['Styles', 'comma separated, e.g. Fooocus V2, Fooocus Enhance']],
      tips: ['Up to 4 references are sent as Image Prompts.', 'Prompts should be English — keep "Translate non-English prompts to English" on (default).', 'Tasks show the Fooocus progress percentage and step.'],
      links: [['Fooocus-API', 'https://github.com/mrhan1993/Fooocus-API']],
    },
  },
  video: {
    aiask: { summary: 'Grok video through aiask.me.', steps: ['Reuse your aiask.me key.', 'Click the preset, paste the key and save.'], fields: [['Base URL', 'https://aiask.me'], ['Models', 'grok-imagine-video-1.5']], tips: ['Duration, ratio and resolution are mapped to Grok tiers.'], links: [['aiask.me', 'https://aiask.me']] },
    xai: { summary: 'xAI native Grok video API.', steps: ['Official: Base URL https://api.x.ai with a console.x.ai key.', 'aiask.me Grok key: Base URL https://aiask.me.'], fields: [['Base URL', 'https://api.x.ai'], ['Models', 'grok-imagine-video-1.5']], tips: ['References are referenced as <IMAGE_n> automatically.'], links: [['xAI Console', 'https://console.x.ai']] },
    veo: { summary: 'Google Veo 3.1 via the Gemini API.', steps: ['Create a paid key in Google AI Studio.', 'Click the preset, paste the key and save.'], fields: [['Base URL', 'https://generativelanguage.googleapis.com'], ['Models', 'veo-3.1-generate-preview']], tips: ['Generation takes 1–5 minutes; Tasks show the elapsed time.'], links: [['Google AI Studio', 'https://aistudio.google.com/apikey']] },
    runway: { summary: 'Runway API (gen4.5 / gen4_turbo / veo3.1).', steps: ['Create a key at https://dev.runwayml.com.', 'Click the preset, paste the key and save.'], fields: [['Base URL', 'https://api.dev.runwayml.com'], ['Models', 'gen4.5']], tips: ['gen4 image-to-video needs a first frame.'], links: [['Runway Developer', 'https://dev.runwayml.com']] },
    volcengine: { summary: 'Volcengine Seedance 2.0.', steps: ['Enable Seedance in Ark and create a key.', 'Click the preset, paste the key and save.'], fields: [['Base URL', 'https://ark.cn-beijing.volces.com'], ['Models', 'doubao-seedance-2-0-…']], tips: ['Local reference video / audio needs PUBLIC_BASE_URL on the backend.'], links: [['Volcengine Ark', 'https://console.volcengine.com/ark']] },
    minimax: { summary: 'MiniMax video (H3).', steps: ['Create a key at https://platform.minimaxi.com.', 'Click the preset, paste the key and save.'], fields: [['Base URL', 'https://api.minimaxi.com'], ['Models', 'MiniMax-H3']], tips: ['Supports first / last frame and references.'], links: [['MiniMax', 'https://platform.minimaxi.com']] },
    aliyun: { summary: 'Alibaba Cloud Wan 3.0 video.', steps: ['Create a key and find your WorkspaceId in Model Studio.', 'Replace {WorkspaceId} in Base URL.'], fields: [['Base URL', 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com'], ['Models', 'wan3.0-video']], tips: ['{WorkspaceId} must be replaced.'], links: [['Model Studio', 'https://bailian.console.aliyun.com']] },
    comfyui: {
      summary: 'Local ComfyUI video: built-in Wan 2.2 templates (5B text+image, 14B image-to-video, 14B first-last frame, 14B text-to-video) and MiniMax H3 templates with native audio (20 steps / Turbo 8 / Turbo 4), or your own workflow — prompt, first / last frame, references, duration, ratio, resolution, seed, FPS and model are all wired in for full control.',
      steps: [
        'Start an up-to-date ComfyUI (Wan 2.2 nodes are built in): http://127.0.0.1:8188, Desktop :8000; use --listen 0.0.0.0 on another machine.',
        'Pick a template: ~12 GB VRAM → Wan 2.2 TI2V 5B; 24 GB+ → 14B image-to-video (best quality) or first-last frame (transitions); 32 GB+ → MiniMax H3 (video with dialogue / SFX / music; Turbo 8-step recommended).',
        'MiniMax H3 needs ComfyUI 0.30.0+ (built-in MiniMaxH3ImageToVideo node) and four files: diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors, text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors, vae/minimax_h3_video_vae_fp16.safetensors, vae/minimax_h3_audio_vae_fp32.safetensors; Turbo templates also need the 8-step or 4-step LoRA in loras/. MiniMaxH3_Director is an interactive timeline editor plugin that UU889-Drama does not need.',
        'Download the listed model files into the shown folders without renaming them.',
        'Models: a template ID (e.g. wan2.2-i2v-14b selects that template) or model file names to replace the diffusion model; for the 14B pair write "high-noise-file|low-noise-file".',
        'Own workflow: Workflow → Export (API) in ComfyUI, choose "Custom workflow" and paste it. Keep Auto-bind on — no placeholders needed; you can still write {{prompt}}, {{image}}, {{last_frame}} … in any field, and hand-written categories win.',
        'Click "Check workflow" to see which node field receives which UU889-Drama parameter; missing model files are marked red.',
        'Test and save. The video panel and Tasks drawer show: reference upload → queue position → current node → sampler stage & step → ETA → decode / encode → download (MB).',
      ],
      fields: [['Base URL', 'http://127.0.0.1:8188 (Desktop :8000)'], ['Models', 'template ID or model file names (| for pairs)'], ['FPS', 'empty = template value (24 for 5B, 16 for 14B) or the workflow value'], ['Steps / CFG', 'empty = keep the workflow; filled = override every sampler (two-stage split rescaled)']],
      tips: ['Frames = duration × FPS aligned to 4n+1 (5 s at 16 fps = 81); 480p / 720p / 1080p map to width / height by ratio.', 'MiniMax H3 is fixed at 24 fps with frames snapped to 17k+5 (5 s = 124); short edge up to 768 (1344×768 at 16:9), so 1080p renders at 768p. H3 has no negative prompt — describe dialogue / SFX / music in the prompt.', 'Output must be mp4 (SaveVideo or VHS_VideoCombine h264-mp4).', 'Detailed progress uses ComfyUI\'s WebSocket (/ws); behind a proxy without WebSocket only queue / elapsed time is shown.', 'Out of memory: lower resolution / duration, use fp8 / GGUF, or --lowvram.'],
      links: [['ComfyUI Wan 2.2 guide', 'https://docs.comfy.org/tutorials/video/wan/wan2_2'], ['Wan 2.2 models', 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged']],
    },
  },
}

export function getProviderGuide(locale: string, type: string, provider: string): ProviderGuide | null {
  const table = locale === 'zh' ? zh : en
  return table[type as ServiceType]?.[provider] || (locale === 'zh' ? null : zh[type as ServiceType]?.[provider] || null)
}

export function getServiceUsage(locale: string, type: string): string {
  return SERVICE_USAGE[locale === 'zh' ? 'zh' : 'en'][type as ServiceType] || ''
}

/** 提示词模板预设（{{prompt}} 处插入 UU889-Drama 的提示词） */
export const PROMPT_TEMPLATE_PRESETS: Array<{ id: string; zh: string; en: string; value: string; for: Array<'image' | 'video'> }> = [
  { id: 'none', zh: '不使用模板', en: 'None', value: '', for: ['image', 'video'] },
  { id: 'quality', zh: '通用高画质（SD / SDXL）', en: 'Quality tags (SD / SDXL)', value: 'masterpiece, best quality, highly detailed, {{prompt}}', for: ['image'] },
  { id: 'photo', zh: '写实摄影', en: 'Photoreal', value: '{{prompt}}, photorealistic, 35mm photograph, natural lighting, sharp focus, film grain', for: ['image'] },
  { id: 'anime', zh: '动漫插画', en: 'Anime', value: 'anime style, cel shading, vibrant colors, clean lineart, {{prompt}}', for: ['image'] },
  { id: 'pony', zh: 'Pony 系模型', en: 'Pony models', value: 'score_9, score_8_up, score_7_up, {{prompt}}', for: ['image'] },
  { id: 'cinematic', zh: '电影感镜头', en: 'Cinematic', value: '{{prompt}}，电影感镜头，光影层次丰富，画面稳定，主体清晰，细节丰富', for: ['video', 'image'] },
  { id: 'guofeng', zh: '国风 / 古风', en: 'Chinese style', value: '{{prompt}}，中国风，古典东方美学，细腻质感', for: ['video', 'image'] },
  { id: 'stable', zh: '稳定运镜（减少抖动变形）', en: 'Stable camera', value: '{{prompt}}，镜头平稳缓慢移动，人物动作自然连贯，五官与肢体保持稳定', for: ['video'] },
]

/** SD WebUI 参数预设 */
export const SDWEBUI_PRESETS: Array<{ id: string; label: string; base: number; steps: number; cfg: number; sampler: string; prompt?: string }> = [
  { id: 'sdxl', label: 'SDXL', base: 1024, steps: 25, cfg: 7, sampler: 'DPM++ 2M' },
  { id: 'sd15', label: 'SD 1.5', base: 512, steps: 25, cfg: 7, sampler: 'Euler a' },
  { id: 'lightning', label: 'SDXL Lightning / Turbo', base: 1024, steps: 6, cfg: 2, sampler: 'DPM++ SDE' },
  { id: 'pony', label: 'Pony XL', base: 1024, steps: 25, cfg: 7, sampler: 'Euler a', prompt: 'score_9, score_8_up, score_7_up, {{prompt}}' },
]

/** Fooocus 预设 */
export const FOOOCUS_PRESETS: Array<{ id: string; zh: string; en: string; performance: string; styles: string }> = [
  { id: 'default', zh: '默认均衡', en: 'Balanced', performance: 'Speed', styles: 'Fooocus V2, Fooocus Enhance, Fooocus Sharp' },
  { id: 'photo', zh: '写实照片', en: 'Photo', performance: 'Quality', styles: 'Fooocus V2, Fooocus Photograph, Fooocus Negative' },
  { id: 'anime', zh: '动漫', en: 'Anime', performance: 'Speed', styles: 'Fooocus V2, SAI Anime' },
  { id: 'cinematic', zh: '电影感', en: 'Cinematic', performance: 'Speed', styles: 'Fooocus V2, SAI Cinematic' },
  { id: 'fast', zh: '极速草图', en: 'Fast drafts', performance: 'Lightning', styles: 'Fooocus V2' },
]
