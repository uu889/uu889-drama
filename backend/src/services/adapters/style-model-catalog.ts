/**
 * 视觉风格 → 推荐模型清单（数据，供本地生图 / 生视频按项目视觉风格自动换模型，以及设置页展示下载方法）
 * 所有文件名 / 下载地址均按 Civitai / Hugging Face 模型页面核对（2026-10）；权重为作者推荐值，作者未给出时取常用值 0.8。
 */
import type { StyleKey } from './style-models'

export type CatalogKind = 'sdwebui' | 'hf_image' | 'comfyui_video'

export interface CatalogFile {
  /** 显示名 */
  name: string
  /** 放进模型目录后的文件名（工作流 / 接口里引用的名字） */
  file: string
  source: 'civitai' | 'huggingface'
  /** 模型页面 */
  page: string
  /** 直链下载地址 */
  url: string
  size?: string
  baseModel?: string
  license?: string
  /** 触发词（LoRA） */
  trigger?: string
  /** 推荐 LoRA 权重 */
  weight?: number
  /** Wan 2.2 14B 双模型时挂在哪个模型上 */
  applyTo?: 'all' | 'high' | 'low'
  /** 需要登录 / 同意协议才能下载 */
  loginRequired?: boolean
  note?: string
}

export interface StyleImagePreset {
  checkpoint: CatalogFile
  lora?: CatalogFile | null
  params?: {
    sampler?: string
    scheduler?: string
    steps?: number
    cfg?: number
    clipSkip?: number
    baseSize?: number
    negative?: string
    /** Fooocus 风格（style_selections），未填写风格时使用 */
    fooocusStyles?: string[]
  }
  note?: string
}

export interface StyleVideoPreset {
  /** 内置视频模板 ID（comfyui-templates.ts） */
  template: string
  lora?: CatalogFile | null
  note: string
}

/** 各服务商的模型目录（相对安装根目录） */
export const MODEL_FOLDERS = {
  sdwebui: { checkpoint: 'models/Stable-diffusion', lora: 'models/Lora' },
  comfyui: { checkpoint: 'models/checkpoints', lora: 'models/loras', diffusion: 'models/diffusion_models' },
  fooocus: { checkpoint: 'repositories/Fooocus/models/checkpoints', lora: 'repositories/Fooocus/models/loras' },
} as const

// ─── Stable Diffusion WebUI：Civitai（SDXL 1.0 生态）─────────────────────────────
// 下载直链 https://civitai.com/api/download/models/<模型版本 ID>；部分模型需登录，带 ?token=<Civitai API Key>

function civitai(name: string, modelId: number, versionId: number, file: string, extra: Partial<CatalogFile> = {}): CatalogFile {
  return {
    name,
    file,
    source: 'civitai',
    page: `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
    url: `https://civitai.com/api/download/models/${versionId}`,
    baseModel: 'SDXL 1.0',
    ...extra,
  }
}

const CIVITAI_ANIMAGINE4 = civitai('Animagine XL 4.0（v4 Opt）', 1188071, 1408658, 'animagine-xl-4.0-opt.safetensors', {
  size: '6.46 GB',
  trigger: 'masterpiece, high score, great score, absurdres',
  note: '动漫专用底模，提示词用 Danbooru 标签效果最好；分辨率不要超过 1536',
})
const CIVITAI_ALBEDO = civitai('AlbedoBase XL（v3.1 Large）', 140737, 1041855, 'albedobaseXL_v31Large.safetensors', {
  size: '6.46 GB',
  note: '通用 SDXL 融合底模，兼容按 SDXL 1.0 训练的风格 LoRA',
})
const ANIMAGINE_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry'
const ANIMAGINE_PARAMS = { sampler: 'Euler a', steps: 28, cfg: 5, baseSize: 1024, negative: ANIMAGINE_NEGATIVE }

const SDWEBUI_CATALOG: Record<StyleKey, StyleImagePreset> = {
  '3d': {
    checkpoint: civitai('ProtoVision XL（v6.6.0 BakedVAE）', 125703, 265938, 'ProtoVisionXL_0.6.6.0.fp16.safetensors', {
      size: '6.46 GB',
      note: '3D / CG 质感底模，不需要 Refiner，提示词越简单越好',
    }),
    lora: civitai('Samaritan 3D Cartoon SDXL', 121932, 132727, 'samaritan_3d_cartoon_sdxl.safetensors', {
      size: '870 MB',
      weight: 0.8,
      trigger: '3d cartoon',
      note: '皮克斯式 3D 卡通；作者没给权重，0.7~0.9 之间调。默认表情偏凶，提示词里加 smiling 等表情词',
    }),
    params: { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, baseSize: 1024 },
  },
  anime: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: null,
    params: ANIMAGINE_PARAMS,
    note: '底模本身就是赛璐璐日漫风，不需要 LoRA',
  },
  ghibli: {
    checkpoint: CIVITAI_ALBEDO,
    lora: civitai('Studio Ghibli [Art Style Capture] LoRA XL（v2）', 187938, 216231, 'studio_ghibli_xl_v2.safetensors', {
      size: '163 MB',
      weight: 0.8,
      trigger: 'Studio Ghibli',
    }),
    params: { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, baseSize: 1024 },
  },
  watercolor: {
    checkpoint: CIVITAI_ALBEDO,
    lora: civitai('Picture-Story Book For Children XL 儿童绘本', 119288, 129548, 'picbookXLloraV1.safetensors', {
      size: '325 MB',
      weight: 0.8,
      trigger: 'watercolor, picture book, paper texture',
      note: '作者推荐 Clip skip 2',
    }),
    params: { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, clipSkip: 2, baseSize: 1024 },
  },
  comic: {
    checkpoint: CIVITAI_ALBEDO,
    lora: civitai('Comic style SDXL - Jhyd（BF16 精简版）', 134144, 147719, 'jhyd-step00001000.smaller.safetensors', {
      size: '212 MB',
      weight: 0.8,
      trigger: 'jhyd style, comic book, bold ink outlines, high saturation',
      note: '下载页有两个文件：默认下载的是 870 MB 完整版，效果相同；用完整版时把 LoRA 文件名改成 jhyd-step00001000.safetensors',
    }),
    params: { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, baseSize: 1024 },
  },
  guofeng: {
    checkpoint: civitai('国风4 GuoFeng4 XL（v1.2 fp16）', 118009, 199325, 'GuoFeng4.2Fp16.safetensors', {
      size: '6.46 GB',
      note: '国风 2.5D / CG 游戏质感底模，不需要 LoRA；全身镜头建议开面部修复',
    }),
    lora: null,
    params: { sampler: 'DPM++ 2M SDE', scheduler: 'Karras', steps: 30, cfg: 8, clipSkip: 2, baseSize: 1024 },
  },
  webtoon: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: civitai('Manhwa Artstyle | Webtoon（SDXL v1.0）', 257995, 290917, 'manhwa-artstyle-000018.safetensors', {
      size: '218 MB',
      weight: 0.6,
      trigger: 'manhwa-artstyle',
      note: '作者推荐权重 0.4~0.6、DPM++ 2M Karras、CFG 7；模型页默认是 Illustrious 版本，请认准 SDXL 版本 290917',
    }),
    params: { ...ANIMAGINE_PARAMS, sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 28, cfg: 7 },
  },
  noir: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: civitai('LineAniRedmond 线稿漫画（v2.0 SDXL）', 127018, 177544, 'LineAniRedmondV2-Lineart-LineAniAF.safetensors', {
      size: '163 MB',
      weight: 0.8,
      trigger: 'lineart, LineAniAF, monochrome, greyscale, manga, screentone',
      note: '模型页默认版本已换成 Z-Image，请认准 SDXL 版本 177544；只要底模也能出黑白漫画（monochrome, greyscale, screentone 标签）',
    }),
    params: ANIMAGINE_PARAMS,
  },
}

// ─── ComfyUI / Fooocus 生图：Hugging Face（SDXL 1.0 生态，均无需登录）────────────
// 直链 https://huggingface.co/<仓库>/resolve/main/<文件>；国内可把域名换成 hf-mirror.com

function hf(name: string, repo: string, remoteFile: string, file: string, extra: Partial<CatalogFile> = {}): CatalogFile {
  return {
    name,
    file,
    source: 'huggingface',
    page: `https://huggingface.co/${repo}`,
    url: `https://huggingface.co/${repo}/resolve/main/${remoteFile.split('/').map(encodeURIComponent).join('/')}`,
    baseModel: 'SDXL 1.0',
    ...extra,
  }
}

const HF_ANIMAGINE4 = hf('Animagine XL 4.0 Opt', 'cagliostrolab/animagine-xl-4.0', 'animagine-xl-4.0-opt.safetensors', 'animagine-xl-4.0-opt.safetensors', {
  size: '6.94 GB',
  license: 'openrail++',
  trigger: 'masterpiece, high score, great score, absurdres',
  note: '动漫专用底模，提示词用 Danbooru 标签效果最好',
})
const HF_SDXL_BASE = hf('Stable Diffusion XL Base 1.0', 'stabilityai/stable-diffusion-xl-base-1.0', 'sd_xl_base_1.0.safetensors', 'sd_xl_base_1.0.safetensors', {
  size: '6.94 GB',
  license: 'openrail++',
  note: '官方 SDXL 底模；画风 LoRA 都是在它上面训练的，风格还原度最高',
})
const HF_JUGGERNAUT9 = hf('Juggernaut XL v9', 'RunDiffusion/Juggernaut-XL-v9', 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', {
  size: '7.11 GB',
  license: 'creativeml-openrail-m（作者声明：做付费 API 服务需 RunDiffusion 授权）',
  note: '质感 / 光影很强的写实向 SDXL，配 3D 渲染 LoRA 出 CG 动画质感；Fooocus 默认底模 v8 也可直接用',
})
const SDXL_PARAMS = { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, baseSize: 1024 }

const HF_IMAGE_CATALOG: Record<StyleKey, StyleImagePreset> = {
  '3d': {
    checkpoint: HF_JUGGERNAUT9,
    lora: hf('3D Render Style XL', 'goofyai/3d_render_style_xl', '3d_render_style_xl.safetensors', '3d_render_style_xl.safetensors', {
      license: 'apache-2.0',
      weight: 0.8,
      trigger: '3d style, 3d render',
      note: '作者推荐权重 0.7~1.0；皮克斯感更强可换 prithivMLmods/Canopus-Pixar-Art（触发词 Pixar）',
    }),
    params: { ...SDXL_PARAMS, cfg: 5, fooocusStyles: ['Fooocus V2', 'SAI 3D Model'] },
  },
  anime: {
    checkpoint: HF_ANIMAGINE4,
    lora: null,
    params: { sampler: 'Euler a', steps: 28, cfg: 5, baseSize: 1024, negative: ANIMAGINE_NEGATIVE, fooocusStyles: ['Fooocus V2', 'SAI Anime'] },
    note: '底模本身就是赛璐璐日漫风，不需要 LoRA',
  },
  ghibli: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Studio Ghibli Style（KappaNeuro）', 'KappaNeuro/studio-ghibli-style', 'Studio Ghibli Style.safetensors', 'studio_ghibli_style_sdxl.safetensors', {
      size: '228 MB',
      license: 'other（作者未写明条款）',
      weight: 0.9,
      trigger: 'Studio Ghibli Style',
      note: '原文件名带空格，下载命令已改存为 studio_ghibli_style_sdxl.safetensors',
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2'] },
  },
  watercolor: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Watercolor Style LoRA SDXL（ostris）', 'ostris/watercolor_style_lora_sdxl', 'watercolor_v1_sdxl.safetensors', 'watercolor_v1_sdxl.safetensors', {
      size: '12 MB',
      license: 'apache-2.0',
      weight: 1,
      trigger: 'watercolor, picture book illustration',
      note: '无需触发词，权重 1.0 通常合适；更偏童书绘本可换 artificialguybr/StoryBookRedmond（触发词 KidsRedmAF）',
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2', 'Artstyle Watercolor'] },
  },
  comic: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Graphic Novel Illustration', 'blink7630/graphic-novel-illustration', 'Graphic_Novel_Illustration-000007.safetensors', 'Graphic_Novel_Illustration-000007.safetensors', {
      size: '457 MB',
      license: 'other（作者未写明条款）',
      weight: 0.9,
      trigger: 'graphic novel illustration, comic book',
      note: '想要网点 / 粗墨线可换 strkyyy/comic-ink-halftone（触发词 c0m1cink，权重 0.85）',
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2', 'SAI Comic Book'] },
  },
  guofeng: {
    checkpoint: hf('国风4 GuoFeng4.1 2.5D XL', 'xiaolxl/GuoFeng4_XL', 'GuoFeng4.1_2.5D.safetensors', 'GuoFeng4.1_2.5D.safetensors', {
      size: '6.94 GB',
      license: 'cc-by-nc-sa-4.0（非商用）',
      note: '国风 2.5D / CG 游戏质感底模；全身镜头脸部易崩，可去掉 full body 或开面部修复',
    }),
    lora: null,
    params: { sampler: 'DPM++ 2M SDE', scheduler: 'Karras', steps: 30, cfg: 8, baseSize: 1024, fooocusStyles: ['Fooocus V2'] },
    note: '想要水墨背景可在覆盖里加 LoRA：ming-yang/sdxl_chinese_ink_lora 的 Chinese_Ink_Painting_Lora_SDXL.safetensors（触发词 Chinese Ink，权重 0.5~0.7）',
  },
  webtoon: {
    checkpoint: HF_ANIMAGINE4,
    lora: hf('Manhwa Artstyle Webtoon LoRA', 'Muapi/manhwa-artstyle-webtoon-lora', 'manhwa-artstyle-webtoon-lora.safetensors', 'manhwa-artstyle-webtoon-lora.safetensors', {
      size: '228 MB',
      license: 'openrail++',
      weight: 0.7,
      trigger: 'manhwa-artstyle, korean webtoon',
      note: 'Hugging Face 上唯一的 SDXL 韩漫 LoRA（镜像账号）；效果不理想时把 LoRA 设为 none，只用底模 + korean webtoon, manhwa, soft cel shading',
    }),
    params: { sampler: 'Euler a', steps: 28, cfg: 6, baseSize: 1024, negative: ANIMAGINE_NEGATIVE, fooocusStyles: ['Fooocus V2', 'SAI Anime'] },
  },
  noir: {
    checkpoint: HF_ANIMAGINE4,
    lora: hf('Manga Ink Screentone', 'strkyyy/manga-ink-screentone', 'manga-ink-screentone.safetensors', 'manga-ink-screentone.safetensors', {
      size: '93 MB',
      license: 'openrail++',
      weight: 0.85,
      trigger: 'm4ng41nk, monochrome, greyscale, manga, screentone',
      note: '黑白漫画墨线 + 网点；作者推荐权重 0.6~1.0',
    }),
    params: { sampler: 'Euler a', steps: 28, cfg: 5, baseSize: 1024, negative: `${ANIMAGINE_NEGATIVE}, color`, fooocusStyles: ['Fooocus V2', 'MRE Manga'] },
  },
}

// ─── ComfyUI 生视频：Wan 2.2 14B 图生视频 + Wan 2.1 14B 风格 LoRA（Hugging Face）────────
// 画风主要由「首帧」决定：先用上面的风格生图模型出分镜图，再图生视频；风格 LoRA 挂在低噪声模型上稳住画风。
// Wan 2.1 14B 的 LoRA 可直接用于 Wan 2.2 14B 低噪声模型（结构相同）；Wan 2.2 TI2V 5B 结构不同，不能挂这些 LoRA。

const WAN_I2V = 'wan2.2-i2v-14b'
const WAN_NOTE = '用风格生图模型出的分镜图作首帧，Wan 2.2 I2V 14B 图生视频（需约 24GB 显存）；显存不够可改用 wan2.2-ti2v-5b（5B 不能挂 14B 风格 LoRA，会自动跳过）'

function wanLora(name: string, repo: string, remoteFile: string, trigger: string, extra: Partial<CatalogFile> = {}): CatalogFile {
  return { ...hf(name, repo, remoteFile, remoteFile.split('/').pop()!, { baseModel: 'Wan 2.1 T2V 14B', trigger, weight: 0.8, applyTo: 'low' }), ...extra }
}

const COMFYUI_VIDEO_CATALOG: Record<StyleKey, StyleVideoPreset> = {
  '3d': {
    template: WAN_I2V,
    lora: wanLora('Pixar 动画风（Remade-AI）', 'Remade-AI/Pixar', 'pixar_10_epochs.safetensors', 'p1x4r_5ty13 Pixar animation style', {
      license: 'apache-2.0',
      note: '作者推荐权重 1.0（Wan 2.1 上）；挂在 2.2 低噪声模型上 0.8 起调，触发词放在提示词最前',
    }),
    note: WAN_NOTE,
  },
  anime: {
    template: WAN_I2V,
    lora: wanLora('Flat Color 赛璐璐平涂 v2（motimalu）', 'motimalu/wan-flat-color-v2', 'wan_flat_color_v2.safetensors', 'flat color, no lineart', {
      license: 'apache-2.0',
      note: '平涂动画质感；想要新海诚式背景可换 Cseti/wan-14b-shinkai-anime-style-lora-v1（触发词 sh1nka1 style）',
    }),
    note: WAN_NOTE,
  },
  ghibli: {
    template: WAN_I2V,
    lora: wanLora('Studio Ghibli Wan2.1（Muapi）', 'Muapi/studio-ghibli-wan2.1-t2v-14b', 'studio-ghibli-wan2.1-t2v-14b.safetensors', 'Studio Ghibli style', {
      license: 'openrail++（Civitai 转载，原作者未注明）',
    }),
    note: WAN_NOTE,
  },
  watercolor: {
    template: WAN_I2V,
    lora: null,
    note: `Hugging Face 上没有合适的水彩绘本 Wan LoRA：画风靠水彩首帧保持，提示词加 watercolor animation, soft brush strokes。${WAN_NOTE}`,
  },
  comic: {
    template: WAN_I2V,
    lora: wanLora('Comic Book Wan2.1（Muapi）', 'Muapi/comicbook-wan2.1-t2v-14b', 'comicbook-wan2.1-t2v-14b.safetensors', 'comic style', {
      license: 'openrail++（Civitai 转载，原作者未注明）',
    }),
    note: WAN_NOTE,
  },
  guofeng: {
    template: WAN_I2V,
    lora: null,
    note: `没有国风 2.5D 动画的 Wan LoRA：画风靠国风首帧保持。要水墨画效果可在覆盖里填 LoRA wan2.1-traditional-chinese-paintings-style.safetensors（Muapi/wan2.1-traditional-chinese-paintings-style，触发词 chinese traditional painting in tc artstyle）。${WAN_NOTE}`,
  },
  webtoon: {
    template: WAN_I2V,
    lora: null,
    note: `没有韩漫 / 网漫的 Wan LoRA：画风靠网漫首帧保持，提示词加 korean webtoon style, clean lineart, soft cel shading。${WAN_NOTE}`,
  },
  noir: {
    template: WAN_I2V,
    lora: null,
    note: `没有黑白漫画线稿的 Wan LoRA：画风靠黑白首帧保持，提示词加 black and white manga, monochrome, ink lines。想要真人电影式黑白可在覆盖里填 film_noir_10_epochs.safetensors（Remade-AI/Film-Noir，触发词 f11m_n01r film noir, black and white video）。${WAN_NOTE}`,
  },
}

export const STYLE_MODEL_CATALOG: {
  sdwebui: Record<StyleKey, StyleImagePreset>
  hf_image: Record<StyleKey, StyleImagePreset>
  comfyui_video: Record<StyleKey, StyleVideoPreset>
} = {
  sdwebui: SDWEBUI_CATALOG,
  hf_image: HF_IMAGE_CATALOG,
  comfyui_video: COMFYUI_VIDEO_CATALOG,
}
