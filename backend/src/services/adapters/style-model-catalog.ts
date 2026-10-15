/**
 * 视觉风格 → 推荐模型清单（数据，供本地生图 / 生视频按项目视觉风格自动换模型，以及设置页展示下载方法）
 * 所有文件名 / 下载地址均按 Civitai / Hugging Face 模型页面核对（2026-10）；权重为作者推荐值，作者未给出时取常用值 0.8。
 */
import type { StyleKey } from './style-models'

export type CatalogKind = 'sdwebui' | 'hf_image' | 'comfyui_video'

/**
 * 许可等级（以「用生成的图 / 视频做商业短剧」为准）：
 * - ok：可商用，无需额外授权（apache-2.0 / MIT / OpenRAIL 系列的使用限制条款除外）
 * - attention：可以用，但有附加条件或来源不清（如不得做付费生成服务、需署名、转载账号未注明原作者）
 * - restricted：非商用，或商用需联系作者授权
 */
export type LicenseStatus = 'ok' | 'attention' | 'restricted'

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
  /** 许可等级（见 LicenseStatus） */
  licenseStatus?: LicenseStatus
  /** 许可的具体限制（attention / restricted 时必须写清楚） */
  licenseNote?: string
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
  /** 没有 LoRA 时的风格关键词（加在提示词最前，优先于底模的质量标签） */
  trigger?: string
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
  /** 可选替代（通常效果更好但需要注意许可，不在下载命令里，设置页 / 文档单独标注） */
  alternatives?: CatalogFile[]
}

export interface StyleVideoPreset {
  /** 内置视频模板 ID（comfyui-templates.ts） */
  template: string
  lora?: CatalogFile | null
  note: string
  alternatives?: CatalogFile[]
}

/** 内置视频模板用到的基础模型（Wan 2.2 / 2.1 Comfy-Org 重打包）的许可 */
export const WAN_BASE_LICENSE = { license: 'apache-2.0', licenseStatus: 'ok' as LicenseStatus }

const LICENSE_RANK: Record<LicenseStatus, number> = { ok: 0, attention: 1, restricted: 2 }

/** 一组文件里最严格的许可等级（未标注按 attention 处理） */
export function worstLicense(files: Array<CatalogFile | null | undefined>): LicenseStatus {
  let worst: LicenseStatus = 'ok'
  for (const f of files) {
    if (!f) continue
    const st = f.licenseStatus || 'attention'
    if (LICENSE_RANK[st] > LICENSE_RANK[worst]) worst = st
  }
  return worst
}

export const LICENSE_LABELS: Record<LicenseStatus, string> = {
  ok: '可商用',
  attention: '注意许可',
  restricted: '需授权 / 非商用',
}

/** 各服务商的模型目录（相对安装根目录） */
export const MODEL_FOLDERS = {
  sdwebui: { checkpoint: 'models/Stable-diffusion', lora: 'models/Lora' },
  comfyui: { checkpoint: 'models/checkpoints', lora: 'models/loras', diffusion: 'models/diffusion_models' },
  fooocus: { checkpoint: 'repositories/Fooocus/models/checkpoints', lora: 'repositories/Fooocus/models/loras' },
} as const

// ─── Stable Diffusion WebUI：Civitai（SDXL 1.0 生态）─────────────────────────────
// 下载直链 https://civitai.com/api/download/models/<模型版本 ID>；部分模型需登录，带 ?token=<Civitai API Key>
// 许可按各版本的 https://civitai.com/models/license/<版本 ID>（CreativeML Open RAIL++-M + Attachment B 附加限制）核对，2026-10

function civitai(name: string, modelId: number, versionId: number, file: string, extra: Partial<CatalogFile> = {}): CatalogFile {
  return {
    name,
    file,
    source: 'civitai',
    page: `https://civitai.com/models/${modelId}?modelVersionId=${versionId}`,
    url: `https://civitai.com/api/download/models/${versionId}`,
    baseModel: 'SDXL 1.0',
    license: 'CreativeML Open RAIL++-M',
    ...extra,
  }
}

const NO_PAID_SERVICE = '允许出售生成的图片；但不允许把模型部署成收费的生图服务（对外按次 / 按量收费），本地自用做短剧不受影响'

const CIVITAI_ANIMAGINE4 = civitai('Animagine XL 4.0（v4 Opt）', 1188071, 1408658, 'animagine-xl-4.0-opt.safetensors', {
  size: '6.46 GB',
  license: 'Animagine XL 4.0 License（CreativeML Open RAIL++-M，明确允许商用）',
  licenseStatus: 'ok',
  trigger: 'masterpiece, high score, great score, absurdres',
  note: '动漫专用底模，提示词用 Danbooru 标签效果最好；分辨率不要超过 1536',
})
const CIVITAI_SDXL_BASE = civitai('SD XL 1.0（VAE fix，官方底模）', 101055, 128078, 'sd_xl_base_1.0_0.9vae.safetensors', {
  size: '6.46 GB',
  licenseStatus: 'ok',
  note: 'Stability AI 官方 SDXL 底模；画风 LoRA 大多按它训练，风格还原度最高',
})
const ANIMAGINE_NEGATIVE = 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry'
const ANIMAGINE_PARAMS = { sampler: 'Euler a', steps: 28, cfg: 5, baseSize: 1024, negative: ANIMAGINE_NEGATIVE }
const SDXL_PARAMS = { sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 6, baseSize: 1024 }

const SDWEBUI_CATALOG: Record<StyleKey, StyleImagePreset> = {
  '3d': {
    checkpoint: civitai('ProtoVision XL（v6.6.0 BakedVAE）', 125703, 265938, 'ProtoVisionXL_0.6.6.0.fp16.safetensors', {
      size: '6.46 GB',
      licenseStatus: 'attention',
      licenseNote: NO_PAID_SERVICE,
      note: '3D / CG 质感底模，不需要 Refiner，提示词越简单越好',
    }),
    lora: civitai('Samaritan 3D Cartoon SDXL', 121932, 132727, 'samaritan_3d_cartoon_sdxl.safetensors', {
      size: '870 MB',
      weight: 0.8,
      trigger: '3d cartoon',
      licenseStatus: 'attention',
      licenseNote: NO_PAID_SERVICE,
      note: '3D 动画卡通风；作者没给权重，0.7~0.9 之间调。默认表情偏凶，提示词里加 smiling 等表情词',
    }),
    params: { ...SDXL_PARAMS },
    note: '没找到同等效果且完全无条件的 3D 组合；想要完全可商用可改用 Hugging Face 清单里的 SDXL 底模 + 3D Render Style XL（apache-2.0）',
  },
  anime: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: null,
    params: ANIMAGINE_PARAMS,
    note: '底模本身就是赛璐璐日漫风，不需要 LoRA',
  },
  ghibli: {
    checkpoint: CIVITAI_SDXL_BASE,
    lora: civitai('Studio Ghibli [Art Style Capture] LoRA XL（v2）', 187938, 216231, 'studio_ghibli_xl_v2.safetensors', {
      size: '163 MB',
      weight: 0.8,
      trigger: 'Studio Ghibli',
      licenseStatus: 'ok',
      note: '许可无附加限制；画风本身不受版权保护，但不要用 totoro、chihiro 等作品名 / 角色名触发词，避免生成具体作品角色',
    }),
    params: { ...SDXL_PARAMS },
    alternatives: [
      civitai('AlbedoBase XL（v3.1 Large）', 140737, 1041855, 'albedobaseXL_v31Large.safetensors', {
        size: '6.46 GB',
        licenseStatus: 'attention',
        licenseNote: '可出售图片、可做付费服务，但要求署名（注明使用 AlbedoBase XL 并附许可链接）',
        note: '通用 SDXL 融合底模，画面比官方底模更精致，可替换水彩 / 美漫 / 吉卜力的底模',
      }),
    ],
  },
  watercolor: {
    checkpoint: CIVITAI_SDXL_BASE,
    lora: civitai('Picture-Story Book For Children XL 儿童绘本', 119288, 129548, 'picbookXLloraV1.safetensors', {
      size: '325 MB',
      weight: 0.8,
      trigger: 'watercolor, picture book, paper texture',
      licenseStatus: 'attention',
      licenseNote: NO_PAID_SERVICE,
      note: '作者推荐 Clip skip 2；完全可商用可换 Hugging Face 清单里的 ostris 水彩 LoRA（apache-2.0）',
    }),
    params: { ...SDXL_PARAMS, clipSkip: 2 },
  },
  comic: {
    checkpoint: CIVITAI_SDXL_BASE,
    lora: civitai('Comic realism（SDXL）', 219089, 247021, 'Comic_realism.safetensors', {
      size: '218 MB',
      weight: 0.5,
      trigger: 'a comic book illustration of',
      licenseStatus: 'ok',
      note: '没有专用触发词，作者建议提示词以 a comic book illustration of 开头，权重 0.5',
    }),
    params: { ...SDXL_PARAMS },
    alternatives: [
      civitai('GraphicNovel_LineArt（SDXL）', 1111750, 1249232, 'GraphicNovel_LineArt.safetensors', {
        size: '218 MB',
        licenseStatus: 'ok',
        note: '更强调漫画 / 图像小说的描线，无触发词',
      }),
      civitai('Comic style SDXL - Jhyd', 134144, 147719, 'jhyd-step00001000.smaller.safetensors', {
        size: '212 MB',
        trigger: 'jhyd style',
        licenseStatus: 'restricted',
        licenseNote: '禁止出售生成的图片、禁止做付费服务，并要求署名 CowKing；商用需联系作者授权',
      }),
    ],
  },
  guofeng: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: civitai('Chinese style illustration design（ChineseMyth）', 526483, 584967, 'Chinese_myth_animagineXLV31.safetensors', {
      size: '55 MB',
      weight: 0.85,
      trigger: 'ChineseMyth, chinese style, hanfu, xianxia',
      licenseStatus: 'ok',
      note: '国风神话插画（龙、凤、麒麟、山水），偏动漫质感而不是 2.5D CG；作者在 Animagine 上测试，推荐 DPM++ 2M Karras 22 步',
    }),
    params: { ...ANIMAGINE_PARAMS, sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 22 },
    note: '没找到完全可商用的国风 2.5D 底模；GuoFeng4 是非商用许可，只作为可选替代列出',
    alternatives: [
      civitai('Starlight XL 星光 Animated（v3，2.5D）', 143043, 182077, 'starlightXLAnimated_v3.safetensors', {
        size: '6.46 GB',
        licenseStatus: 'attention',
        licenseNote: '可出售图片、可做付费服务，但要求署名 chillpixel，且不允许分享融合模型',
        note: '最接近 2.5D 的可商用底模；推荐 DPM++ 3M SDE Karras、40 步、CFG 3.6',
      }),
      civitai('国风4 GuoFeng4 XL（v1.2 fp16）', 118009, 199325, 'GuoFeng4.2Fp16.safetensors', {
        size: '6.46 GB',
        licenseStatus: 'restricted',
        licenseNote: '附加条款禁止出售或授权生成的图片（含游戏、书籍等），也禁止付费服务；商用需联系作者授权',
        note: '国风 2.5D 效果最好；DPM++ 2M SDE Karras、CFG 8、Clip skip 2',
      }),
    ],
  },
  webtoon: {
    checkpoint: CIVITAI_ANIMAGINE4,
    lora: civitai('Manhwa Artstyle | Webtoon（SDXL v1.0）', 257995, 290917, 'manhwa-artstyle-000018.safetensors', {
      size: '218 MB',
      weight: 0.6,
      trigger: 'manhwa-artstyle',
      licenseStatus: 'attention',
      licenseNote: NO_PAID_SERVICE,
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
      licenseStatus: 'ok',
      note: '模型页默认版本已换成 Z-Image，请认准 SDXL 版本 177544；只用底模也能出黑白漫画（monochrome, greyscale, screentone 标签）',
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
  license: 'openrail++（明确允许商用）',
  licenseStatus: 'ok',
  trigger: 'masterpiece, high score, great score, absurdres',
  note: '动漫专用底模，提示词用 Danbooru 标签效果最好',
})
const HF_SDXL_BASE = hf('Stable Diffusion XL Base 1.0', 'stabilityai/stable-diffusion-xl-base-1.0', 'sd_xl_base_1.0.safetensors', 'sd_xl_base_1.0.safetensors', {
  size: '6.94 GB',
  license: 'openrail++',
  licenseStatus: 'ok',
  note: '官方 SDXL 底模；画风 LoRA 都是在它上面训练的，风格还原度最高',
})
const STRKYYY_NOTE = '作者卡片未说明训练数据，效果请先出几张图确认'
const MIRROR_NOTE = '转载账号，未注明原作者和原许可，无法确认是否允许商用'

const HF_IMAGE_CATALOG: Record<StyleKey, StyleImagePreset> = {
  '3d': {
    checkpoint: HF_SDXL_BASE,
    lora: hf('3D Render Style XL', 'goofyai/3d_render_style_xl', '3d_render_style_xl.safetensors', '3d_render_style_xl.safetensors', {
      size: '85 MB',
      license: 'apache-2.0',
      licenseStatus: 'ok',
      weight: 0.8,
      trigger: '3d style, 3d render',
      note: '作者推荐权重 0.7~1.0，建议开高清修复',
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2', 'SAI 3D Model'] },
    alternatives: [
      hf('Juggernaut XL v9', 'RunDiffusion/Juggernaut-XL-v9', 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', {
        size: '7.11 GB',
        license: 'creativeml-openrail-m + 作者附加声明',
        licenseStatus: 'restricted',
        licenseNote: '作者声明：部署成付费 API / 收费生成服务需要 RunDiffusion 单独授权（juggernaut@rundiffusion.com）',
        note: '质感 / 光影更强，换成它做底模 3D 渲染感更好；Fooocus 默认底模 v8 同属此系列',
      }),
    ],
  },
  anime: {
    checkpoint: HF_ANIMAGINE4,
    lora: null,
    params: { ...ANIMAGINE_PARAMS, fooocusStyles: ['Fooocus V2', 'SAI Anime'] },
    note: '底模本身就是赛璐璐日漫风，不需要 LoRA',
  },
  ghibli: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Anime Ghibli Soft', 'strkyyy/anime-ghibli-soft', 'anime-ghibli-soft.safetensors', 'anime-ghibli-soft.safetensors', {
      size: '93 MB',
      license: 'openrail++',
      licenseStatus: 'ok',
      weight: 0.85,
      trigger: 'gh1bl1st, hand-drawn anime film, soft watercolor background',
      note: `柔和手绘动画电影风；作者推荐权重 0.85~0.9。${STRKYYY_NOTE}`,
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2'] },
    alternatives: [
      hf('Studio Ghibli Style（KappaNeuro）', 'KappaNeuro/studio-ghibli-style', 'Studio Ghibli Style.safetensors', 'studio_ghibli_style_sdxl.safetensors', {
        size: '228 MB',
        license: 'other（未写明条款）',
        licenseStatus: 'restricted',
        licenseNote: '许可写的是 other 但没有任何条款，转自 Civitai 106712；商用前需联系作者确认',
        trigger: 'Studio Ghibli Style',
      }),
    ],
  },
  watercolor: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Watercolor Style LoRA SDXL（ostris）', 'ostris/watercolor_style_lora_sdxl', 'watercolor_v1_sdxl.safetensors', 'watercolor_v1_sdxl.safetensors', {
      size: '12 MB',
      license: 'apache-2.0',
      licenseStatus: 'ok',
      weight: 1,
      trigger: 'watercolor, picture book illustration',
      note: '无需触发词，权重 1.0 通常合适',
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2', 'Artstyle Watercolor'] },
  },
  comic: {
    checkpoint: HF_SDXL_BASE,
    lora: hf('Comic Ink Halftone', 'strkyyy/comic-ink-halftone', 'comic-ink-halftone.safetensors', 'comic-ink-halftone.safetensors', {
      size: '93 MB',
      license: 'openrail++',
      licenseStatus: 'ok',
      weight: 0.85,
      trigger: 'c0m1cink, comic book, bold ink outlines, halftone',
      note: `粗墨线 + 网点的美漫风；作者推荐权重 0.85~0.9。${STRKYYY_NOTE}`,
    }),
    params: { ...SDXL_PARAMS, fooocusStyles: ['Fooocus V2', 'SAI Comic Book'] },
    alternatives: [
      hf('Graphic Novel Illustration', 'blink7630/graphic-novel-illustration', 'Graphic_Novel_Illustration-000007.safetensors', 'Graphic_Novel_Illustration-000007.safetensors', {
        size: '457 MB',
        license: 'other（未写明条款）',
        licenseStatus: 'restricted',
        licenseNote: '许可写的是 other 但没有任何条款，商用前需联系作者确认',
        trigger: 'graphic novel illustration',
      }),
    ],
  },
  guofeng: {
    checkpoint: HF_ANIMAGINE4,
    lora: hf('Chinese Ink Painting LoRA SDXL', 'ming-yang/sdxl_chinese_ink_lora', 'Chinese_Ink_Painting_Lora_SDXL.safetensors', 'Chinese_Ink_Painting_Lora_SDXL.safetensors', {
      size: '57 MB',
      license: 'creativeml-openrail-m',
      licenseStatus: 'ok',
      weight: 0.6,
      trigger: 'Chinese Ink, chinese style, hanfu, xianxia',
      note: '水墨背景 / 国风气质；权重高了人物会变平，0.5~0.7 之间调',
    }),
    params: { ...ANIMAGINE_PARAMS, fooocusStyles: ['Fooocus V2'] },
    note: 'Hugging Face 上没有完全可商用的国风 2.5D 模型，这里用动漫底模 + 水墨 LoRA 代替，2.5D 质感弱一些。也可以下载 Civitai 清单里的 ChineseMyth LoRA（可商用）放进 loras 目录，在覆盖里填文件名',
    alternatives: [
      hf('国风4 GuoFeng4.1 2.5D XL', 'xiaolxl/GuoFeng4_XL', 'GuoFeng4.1_2.5D.safetensors', 'GuoFeng4.1_2.5D.safetensors', {
        size: '6.94 GB',
        license: 'cc-by-nc-sa-4.0',
        licenseStatus: 'restricted',
        licenseNote: '非商用许可（CC BY-NC-SA 4.0）：生成的图不能用于商业用途，商用需联系作者授权；其他网站标成 openrail 的转载版本同样不能当作可商用',
        note: '国风 2.5D 效果最好；DPM++ 2M SDE Karras、CFG 8',
      }),
    ],
  },
  webtoon: {
    checkpoint: HF_ANIMAGINE4,
    lora: null,
    trigger: 'korean webtoon, manhwa, semi-realistic, soft cel shading, clean lineart',
    params: { ...ANIMAGINE_PARAMS, cfg: 6, fooocusStyles: ['Fooocus V2', 'SAI Anime'] },
    note: 'Hugging Face 上没有原作者发布、许可清楚的 SDXL 韩漫 LoRA，这里只用动漫底模 + 韩漫关键词；Civitai 清单里的 Manhwa Artstyle LoRA 效果更好（可出售图片，不能做付费生图服务）',
    alternatives: [
      hf('Anime Cel Shaded', 'strkyyy/anime-cel-shaded', 'anime-cel-shaded.safetensors', 'anime-cel-shaded.safetensors', {
        size: '93 MB',
        license: 'openrail++',
        licenseStatus: 'ok',
        trigger: '4n1mec3l',
        weight: 0.85,
        note: `赛璐璐上色，接近网漫但不是韩漫专用。${STRKYYY_NOTE}`,
      }),
      hf('Manhwa Artstyle Webtoon LoRA（Muapi 转载）', 'Muapi/manhwa-artstyle-webtoon-lora', 'manhwa-artstyle-webtoon-lora.safetensors', 'manhwa-artstyle-webtoon-lora.safetensors', {
        size: '228 MB',
        license: 'openrail++（转载者标注）',
        licenseStatus: 'restricted',
        licenseNote: MIRROR_NOTE,
        trigger: 'manhwa-artstyle',
      }),
    ],
  },
  noir: {
    checkpoint: HF_ANIMAGINE4,
    lora: hf('Manga Ink Screentone', 'strkyyy/manga-ink-screentone', 'manga-ink-screentone.safetensors', 'manga-ink-screentone.safetensors', {
      size: '93 MB',
      license: 'openrail++',
      licenseStatus: 'ok',
      weight: 0.85,
      trigger: 'm4ng41nk, monochrome, greyscale, manga, screentone',
      note: `黑白漫画墨线 + 网点；作者推荐权重 0.6~1.0。${STRKYYY_NOTE}`,
    }),
    params: { ...ANIMAGINE_PARAMS, negative: `${ANIMAGINE_NEGATIVE}, color`, fooocusStyles: ['Fooocus V2', 'MRE Manga'] },
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
    lora: wanLora('3D 动画电影风（Remade-AI）', 'Remade-AI/Pixar', 'pixar_10_epochs.safetensors', 'p1x4r_5ty13 Pixar animation style', {
      license: 'apache-2.0',
      licenseStatus: 'ok',
      note: '作者推荐权重 1.0（Wan 2.1 上），挂在 2.2 低噪声模型上 0.8 起调；触发词里的 Pixar 是商标，只作触发用，不要写进片名 / 宣传文案',
    }),
    note: WAN_NOTE,
  },
  anime: {
    template: WAN_I2V,
    lora: wanLora('Flat Color 赛璐璐平涂 v2（motimalu）', 'motimalu/wan-flat-color-v2', 'wan_flat_color_v2.safetensors', 'flat color, no lineart', {
      license: 'apache-2.0',
      licenseStatus: 'attention',
      licenseNote: '标注 apache-2.0（可商用），但卡片写明「应请求转载自 Civitai」，无法核实上传者就是原作者',
      note: '平涂动画质感',
    }),
    note: WAN_NOTE,
  },
  ghibli: {
    template: WAN_I2V,
    lora: null,
    note: `没有原作者发布、许可清楚的吉卜力风 Wan LoRA：画风靠吉卜力风首帧保持，提示词加 hand-drawn anime film, soft painted background。${WAN_NOTE}`,
    alternatives: [
      wanLora('90s Anime M8T（mushroomfleet）', 'mushroomfleet/wanmagic-M8T-90s-anime', 'wan-m8t-style-img-v0p.safetensors', 'M8T style anime', {
        baseModel: 'Wan 2.2 T2V A14B',
        license: 'apache-2.0',
        licenseStatus: 'attention',
        licenseNote: '许可可商用，但作者没说明挂高噪声还是低噪声模型、推荐权重，需自己试',
        note: '90 年代赛璐璐动画风，接近手绘动画电影',
      }),
      wanLora('Studio Ghibli Wan2.1（Muapi 转载）', 'Muapi/studio-ghibli-wan2.1-t2v-14b', 'studio-ghibli-wan2.1-t2v-14b.safetensors', 'Studio Ghibli style', {
        license: 'openrail++（转载者标注）',
        licenseStatus: 'restricted',
        licenseNote: MIRROR_NOTE,
      }),
    ],
  },
  watercolor: {
    template: WAN_I2V,
    lora: null,
    note: `没有合适的水彩绘本 Wan LoRA：画风靠水彩首帧保持，提示词加 watercolor animation, soft brush strokes。${WAN_NOTE}`,
    alternatives: [
      wanLora('Old Book Illustrations（AdamLucek）', 'AdamLucek/Wan2.1-T2V-14B-OldBookIllustrations', 'oldbookillustrations_adapter.safetensors', 'An old book illustration of a', {
        license: 'mit',
        licenseStatus: 'ok',
        note: '复古书籍插画风，不是水彩，但同属绘本质感',
      }),
    ],
  },
  comic: {
    template: WAN_I2V,
    lora: null,
    note: `没有原作者发布、许可清楚且适配文生 / 图生 14B 的美漫 Wan LoRA：画风靠美漫首帧保持，提示词加 comic book style, bold ink outlines。${WAN_NOTE}`,
    alternatives: [
      wanLora('Realistic Comicbook Style（maDcaDDie，I2V 480p）', 'maDcaDDie/realistic_comicbook_style_wan_2_2_i2v_480p-lora', 'realistic_comicbook_style_wan_2_2_i2v_480p.safetensors', 'comic book style', {
        baseModel: 'Wan 2.1 I2V 14B 480P',
        license: 'creativeml-openrail-m',
        licenseStatus: 'attention',
        licenseNote: '许可可商用，但按 480p 图生视频训练、没给权重和触发词，挂在 2.2 低噪声模型上的效果未经验证',
      }),
      wanLora('Comic Book Wan2.1（Muapi 转载）', 'Muapi/comicbook-wan2.1-t2v-14b', 'comicbook-wan2.1-t2v-14b.safetensors', 'comic style', {
        license: 'openrail++（转载者标注）',
        licenseStatus: 'restricted',
        licenseNote: MIRROR_NOTE,
      }),
    ],
  },
  guofeng: {
    template: WAN_I2V,
    lora: null,
    note: `没有国风 2.5D 动画的 Wan LoRA：画风靠国风首帧保持，提示词加 chinese style, xianxia, flowing hanfu。${WAN_NOTE}`,
    alternatives: [
      wanLora('Traditional Chinese Paintings（Muapi 转载）', 'Muapi/wan2.1-traditional-chinese-paintings-style', 'wan2.1-traditional-chinese-paintings-style.safetensors', 'chinese traditional painting in tc artstyle', {
        license: 'openrail++（转载者标注）',
        licenseStatus: 'restricted',
        licenseNote: MIRROR_NOTE,
        note: '水墨画效果，不是 2.5D',
      }),
    ],
  },
  webtoon: {
    template: WAN_I2V,
    lora: null,
    note: `没有韩漫 / 网漫的 Wan LoRA：画风靠网漫首帧保持，提示词加 korean webtoon style, clean lineart, soft cel shading。${WAN_NOTE}`,
  },
  noir: {
    template: WAN_I2V,
    lora: null,
    note: `没有黑白漫画线稿的 Wan LoRA：画风靠黑白首帧保持，提示词加 black and white manga, monochrome, ink lines。${WAN_NOTE}`,
    alternatives: [
      wanLora('Film Noir（Remade-AI）', 'Remade-AI/Film-Noir', 'film_noir_10_epochs.safetensors', 'f11m_n01r film noir, black and white video', {
        license: 'apache-2.0',
        licenseStatus: 'ok',
        note: '真人电影式黑白，不是漫画线稿；想要黑白电影感时可用',
      }),
    ],
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
