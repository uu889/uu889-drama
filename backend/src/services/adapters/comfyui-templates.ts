/**
 * ComfyUI 内置工作流模板库（API 格式，已写好 UU889-Drama 占位符）
 *
 * - 设置页可选择模板直接使用，或「填入编辑框」后按自己的模型 / 节点修改
 * - 未配置自定义工作流时，按 settings.comfyui_template → 模型名（模板 ID 或模板用到的模型文件名）→ 默认模板 的顺序选择
 * - 每个模板列出所需模型文件、放置目录与下载地址，设置页「配置说明」直接展示
 */

export type ComfyTemplateKind = 'image' | 'video'

export interface ComfyTemplateModelFile {
  /** 文件名（与工作流加载节点里的值一致） */
  file: string
  /** 相对 ComfyUI 根目录的放置目录 */
  folder: string
  /** 下载地址（Hugging Face） */
  url: string
}

export interface ComfyWorkflowTemplate {
  id: string
  kind: ComfyTemplateKind
  label: string
  /** 中文说明：适用场景、显存需求、输入要求 */
  description: string
  descriptionEn: string
  /** 模板需要的模型文件 */
  files: ComfyTemplateModelFile[]
  /** 推荐填在「模型」列表里的值（视频填模板 ID，图片填 checkpoint 文件名） */
  defaultModel: string
  /** 推荐参数：视频 fps / 最大短边（低显存档位限制分辨率，避免显存不足）；图片基准尺寸 / 步数 / CFG */
  recommended: { fps?: number; baseSize?: number; steps?: number; cfg?: number; maxShortEdge?: number }
  /** 按显存档位设计的模板：适用的显存（GB），设置页按档位分组显示 */
  vram?: number
  /** 显存档位所属的模型系列（设置页分组标题），如「Wan 2.2 图生视频 14B」 */
  vramFamily?: string
  /** 是否需要首帧 / 参考图（没有图片时会降级或报错，设置页给出提示） */
  needsImage?: 'required' | 'optional' | 'none'
  workflow: Record<string, any>
}

const HF_WAN22 = 'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files'
const HF_WAN21 = 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files'

const UMT5: ComfyTemplateModelFile = { file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', folder: 'models/text_encoders', url: `${HF_WAN21}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` }
const WAN21_VAE: ComfyTemplateModelFile = { file: 'wan_2.1_vae.safetensors', folder: 'models/vae', url: `${HF_WAN22}/vae/wan_2.1_vae.safetensors` }

const SAVE_VIDEO = (images: [string, number]) => ({
  '60': { class_type: 'CreateVideo', inputs: { fps: '{{fps}}', images }, _meta: { title: '合成视频' } },
  '61': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/uu889-drama', format: 'auto', codec: 'auto', video: ['60', 0] }, _meta: { title: '保存视频' } },
})

/** Wan 2.2 14B 高 / 低噪声双模型 + 两段 KSamplerAdvanced 的公共部分 */
function wan14bTwoStage(highFile: string, lowFile: string, cond: [string, number], neg: [string, number], latent: [string, number]) {
  return {
    '37': { class_type: 'UNETLoader', inputs: { unet_name: highFile, weight_dtype: 'default' }, _meta: { title: '高噪声模型' } },
    '56': { class_type: 'UNETLoader', inputs: { unet_name: lowFile, weight_dtype: 'default' }, _meta: { title: '低噪声模型' } },
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: UMT5.file, type: 'wan', device: 'default' } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: WAN21_VAE.file } },
    '54': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['37', 0] } },
    '55': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['56', 0] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['38', 0] }, _meta: { title: '正向提示词' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['38', 0] }, _meta: { title: '负向提示词' } },
    '57': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'enable', noise_seed: '{{seed}}', steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: 0, end_at_step: 10, return_with_leftover_noise: 'enable',
        model: ['54', 0], positive: cond, negative: neg, latent_image: latent,
      },
      _meta: { title: '采样（高噪声段）' },
    },
    '58': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'disable', noise_seed: 0, steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: 10, end_at_step: 10000, return_with_leftover_noise: 'disable',
        model: ['55', 0], positive: cond, negative: neg, latent_image: ['57', 0],
      },
      _meta: { title: '采样（低噪声段）' },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['58', 0], vae: ['39', 0] } },
    ...SAVE_VIDEO(['8', 0]),
  }
}

// ─── MiniMax H3（ComfyUI 原生节点 MiniMaxH3ImageToVideo，音画同出）─────────────────────
// 结构照 Comfy-Org 官方模板 video_minimax_h3_i2v：UNETLoader → (Turbo LoRA) → BasicGuider，
// CLIPLoader(type=minimax) + 视频 VAE 进 MiniMaxH3ImageToVideo（自带提示词编码，无负向词），
// SamplerCustomAdvanced(res_multistep / simple) 出音视频联合 latent，分别 VAEDecode / VAEDecodeAudio 后 CreateVideo 合成。
const HF_H3 = 'https://huggingface.co/Comfy-Org/MiniMax-H3'
const H3_FILES = {
  unet: { file: 'minimax_h3_fl2va_int8_convrot.safetensors', folder: 'models/diffusion_models', url: `${HF_H3}/resolve/main/diffusion_models/minimax_h3_fl2va_int8_convrot.safetensors` },
  clip: { file: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', folder: 'models/text_encoders', url: `${HF_H3}/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors` },
  videoVae: { file: 'minimax_h3_video_vae_fp16.safetensors', folder: 'models/vae', url: `${HF_H3}/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors` },
  audioVae: { file: 'minimax_h3_audio_vae_fp32.safetensors', folder: 'models/vae', url: `${HF_H3}/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors` },
  turbo8: { file: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', folder: 'models/loras', url: 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors' },
  turbo4: { file: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', folder: 'models/loras', url: `${HF_H3}/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` },
} satisfies Record<string, ComfyTemplateModelFile>

function minimaxH3Workflow(opts: { steps: number; lora?: string; unet?: string; clip?: string; videoVae?: string; gguf?: boolean }): Record<string, any> {
  const model: [string, number] = opts.lora ? ['121', 0] : ['6', 0]
  const unet = opts.unet || H3_FILES.unet.file
  return {
    '6': opts.gguf
      ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: unet }, _meta: { title: '扩散模型（GGUF）' } }
      : { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' }, _meta: { title: '扩散模型' } },
    ...(opts.lora ? { '121': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: opts.lora, strength_model: 1, model: ['6', 0] }, _meta: { title: 'Turbo LoRA' } } } : {}),
    '13': { class_type: 'CLIPLoader', inputs: { clip_name: opts.clip || H3_FILES.clip.file, type: 'minimax', device: 'default' }, _meta: { title: '文本编码器' } },
    '11': { class_type: 'VAELoader', inputs: { vae_name: opts.videoVae || H3_FILES.videoVae.file }, _meta: { title: '视频 VAE' } },
    '24': { class_type: 'VAELoader', inputs: { vae_name: H3_FILES.audioVae.file }, _meta: { title: '音频 VAE' } },
    '52': { class_type: 'LoadImage', inputs: { image: '{{image}}' }, _meta: { title: '首帧' } },
    '53': { class_type: 'LoadImage', inputs: { image: '{{last_frame}}' }, _meta: { title: '尾帧' } },
    '104': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        prompt: '{{prompt}}', width: '{{width}}', height: '{{height}}', length: '{{frames}}',
        clip: ['13', 0], vae: ['11', 0], first_frame: ['52', 0], last_frame: ['53', 0],
      },
      _meta: { title: 'MiniMax H3 图生视频（提示词）' },
    },
    '15': { class_type: 'RandomNoise', inputs: { noise_seed: '{{seed}}' } },
    '17': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '9': { class_type: 'BasicScheduler', inputs: { scheduler: 'simple', steps: opts.steps, denoise: 1, model } },
    '16': { class_type: 'BasicGuider', inputs: { model, conditioning: ['104', 0] } },
    '14': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['15', 0], guider: ['16', 0], sampler: ['17', 0], sigmas: ['9', 0], latent_image: ['104', 1] }, _meta: { title: '采样' } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['11', 0] } },
    '23': { class_type: 'VAEDecodeAudio', inputs: { samples: ['14', 0], vae: ['24', 0] }, _meta: { title: '解码音频' } },
    '60': { class_type: 'CreateVideo', inputs: { fps: '{{fps}}', images: ['10', 0], audio: ['23', 0] }, _meta: { title: '合成视频' } },
    '61': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/uu889-drama', format: 'auto', codec: 'auto', video: ['60', 0] }, _meta: { title: '保存视频' } },
  }
}

const H3_BASE_FILES = [H3_FILES.unet, H3_FILES.clip, H3_FILES.videoVae, H3_FILES.audioVae]
const H3_NOTE = '音画同出（对白 / 音效 / 配乐写进提示词）；无首尾帧时为文生视频，有首帧 / 尾帧时为首尾帧图生视频。固定 24fps，帧数按 17k+5 取整（5 秒 = 124 帧），短边最高 768（16:9 为 1344×768）。需要 ComfyUI 0.30.0 以上。'
const H3_NOTE_EN = 'Video with native stereo audio (describe dialogue / SFX / music in the prompt); text-to-video without frames, first/last-frame image-to-video with them. Fixed 24 fps, frames snapped to 17k+5 (5 s = 124), short edge up to 768 (1344×768 at 16:9). Needs ComfyUI 0.30.0+.'

// ─── 按显存档位：Wan 2.2 图生视频 14B（12G ~ 288G）──────────────────────────────
// 同一个模型（Wan 2.2 I2V A14B 高 / 低噪声双专家）按显存选精度与采样方式：
//   12G / 16G：GGUF 量化（需要 ComfyUI-GGUF 插件）+ lightx2v 4 步加速 LoRA，限制分辨率
//   24G：fp8 + 4 步加速；32G：fp8 标准 20 步；48G 起：fp16（文本编码器也用 fp16），步数随显存增加
// 4 步加速的参数照 ComfyUI 官方 Wan 2.2 14B lightx2v 模板：shift 5、CFG 1、高 / 低噪声各 2 步。
const HF_WAN22_GGUF = 'https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/resolve/main'
const UMT5_FP16: ComfyTemplateModelFile = { file: 'umt5_xxl_fp16.safetensors', folder: 'models/text_encoders', url: `${HF_WAN21}/text_encoders/umt5_xxl_fp16.safetensors` }
const I2V14B = {
  fp16: [
    { file: 'wan2.2_i2v_high_noise_14B_fp16.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_high_noise_14B_fp16.safetensors` },
    { file: 'wan2.2_i2v_low_noise_14B_fp16.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_low_noise_14B_fp16.safetensors` },
  ],
  fp8: [
    { file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` },
    { file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` },
  ],
  q5: [
    { file: 'Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf', folder: 'models/diffusion_models', url: `${HF_WAN22_GGUF}/HighNoise/Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf` },
    { file: 'Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf', folder: 'models/diffusion_models', url: `${HF_WAN22_GGUF}/LowNoise/Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf` },
  ],
  q4: [
    { file: 'Wan2.2-I2V-A14B-HighNoise-Q4_K_S.gguf', folder: 'models/diffusion_models', url: `${HF_WAN22_GGUF}/HighNoise/Wan2.2-I2V-A14B-HighNoise-Q4_K_S.gguf` },
    { file: 'Wan2.2-I2V-A14B-LowNoise-Q4_K_S.gguf', folder: 'models/diffusion_models', url: `${HF_WAN22_GGUF}/LowNoise/Wan2.2-I2V-A14B-LowNoise-Q4_K_S.gguf` },
  ],
} satisfies Record<string, ComfyTemplateModelFile[]>
const LIGHTX2V_I2V: ComfyTemplateModelFile[] = [
  { file: 'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors', folder: 'models/loras', url: `${HF_WAN22}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` },
  { file: 'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors', folder: 'models/loras', url: `${HF_WAN22}/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors` },
]

interface WanTierOpts {
  vram: number
  label: string
  description: string
  descriptionEn: string
  models: ComfyTemplateModelFile[]
  textEncoder: ComfyTemplateModelFile
  /** GGUF 量化模型用 ComfyUI-GGUF 的 UnetLoaderGGUF */
  gguf?: boolean
  /** lightx2v 4 步加速 LoRA */
  fast?: boolean
  steps: number
  maxShortEdge: number
}

/** Wan 2.2 I2V 14B 双专家两段采样（可选 GGUF 加载器 / 4 步加速 LoRA） */
function wanI2vTierWorkflow(o: WanTierOpts): Record<string, any> {
  const loader = o.gguf ? 'UnetLoaderGGUF' : 'UNETLoader'
  const unet = (file: string) => (o.gguf ? { unet_name: file } : { unet_name: file, weight_dtype: 'default' })
  const steps = o.fast ? 4 : o.steps
  const split = Math.floor(steps / 2)
  const cfg = o.fast ? 1 : 3.5
  const shift = o.fast ? 5 : 8
  const high: [string, number] = o.fast ? ['101', 0] : ['37', 0]
  const low: [string, number] = o.fast ? ['102', 0] : ['56', 0]
  const cond: [string, number] = ['50', 0]
  const neg: [string, number] = ['50', 1]
  return {
    '37': { class_type: loader, inputs: unet(o.models[0].file), _meta: { title: '高噪声模型' } },
    '56': { class_type: loader, inputs: unet(o.models[1].file), _meta: { title: '低噪声模型' } },
    ...(o.fast ? {
      '101': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: LIGHTX2V_I2V[0].file, strength_model: 1, model: ['37', 0] }, _meta: { title: '4 步加速 LoRA（高噪声）' } },
      '102': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: LIGHTX2V_I2V[1].file, strength_model: 1, model: ['56', 0] }, _meta: { title: '4 步加速 LoRA（低噪声）' } },
    } : {}),
    '38': { class_type: 'CLIPLoader', inputs: { clip_name: o.textEncoder.file, type: 'wan', device: 'default' } },
    '39': { class_type: 'VAELoader', inputs: { vae_name: WAN21_VAE.file } },
    '54': { class_type: 'ModelSamplingSD3', inputs: { shift, model: high } },
    '55': { class_type: 'ModelSamplingSD3', inputs: { shift, model: low } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['38', 0] }, _meta: { title: '正向提示词' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['38', 0] }, _meta: { title: '负向提示词' } },
    '52': { class_type: 'LoadImage', inputs: { image: '{{image}}' }, _meta: { title: '首帧' } },
    '50': { class_type: 'WanImageToVideo', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1, positive: ['6', 0], negative: ['7', 0], vae: ['39', 0], start_image: ['52', 0] } },
    '57': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'enable', noise_seed: '{{seed}}', steps, cfg, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: 0, end_at_step: split, return_with_leftover_noise: 'enable',
        model: ['54', 0], positive: cond, negative: neg, latent_image: ['50', 2],
      },
      _meta: { title: '采样（高噪声段）' },
    },
    '58': {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'disable', noise_seed: 0, steps, cfg, sampler_name: 'euler', scheduler: 'simple',
        start_at_step: split, end_at_step: 10000, return_with_leftover_noise: 'disable',
        model: ['55', 0], positive: cond, negative: neg, latent_image: ['57', 0],
      },
      _meta: { title: '采样（低噪声段）' },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['58', 0], vae: ['39', 0] } },
    ...SAVE_VIDEO(['8', 0]),
  }
}

function wanI2vTier(o: WanTierOpts): ComfyWorkflowTemplate {
  const id = `wan2.2-i2v-14b-${o.vram}g`
  return {
    id,
    kind: 'video',
    vram: o.vram,
    vramFamily: 'Wan 2.2 图生视频 14B',
    label: o.label,
    description: o.description,
    descriptionEn: o.descriptionEn,
    files: [...o.models, ...(o.fast ? LIGHTX2V_I2V : []), o.textEncoder, WAN21_VAE],
    defaultModel: id,
    recommended: { fps: 16, steps: o.fast ? 4 : o.steps, maxShortEdge: o.maxShortEdge },
    needsImage: 'required',
    workflow: wanI2vTierWorkflow(o),
  }
}

const TIER_NOTE = '必须有首帧（分镜图）；没有图片的纯文生视频请选 TI2V 5B 或 T2V 14B。16fps，单镜建议 5 秒（81 帧）。'
const TIER_NOTE_EN = 'Needs a first frame (storyboard image); for text-only video pick TI2V 5B or T2V 14B. 16 fps; 5-second shots (81 frames) recommended.'
const GGUF_NOTE = '需要先安装 ComfyUI-GGUF 插件（ComfyUI-Manager 里搜 ComfyUI-GGUF，或把 github.com/city96/ComfyUI-GGUF 克隆到 custom_nodes 后重启）。'
const GGUF_NOTE_EN = 'Requires the ComfyUI-GGUF custom node (search ComfyUI-GGUF in ComfyUI-Manager, or clone github.com/city96/ComfyUI-GGUF into custom_nodes and restart).'

export const COMFY_VRAM_TEMPLATES: ComfyWorkflowTemplate[] = [
  wanI2vTier({
    vram: 12,
    label: '【12G 显存】Wan 2.2 图生视频 14B · GGUF Q4 + 4 步加速（480p）',
    description: `适合 RTX 3060 12G / 4070 / 5070 等。14B 图生视频的 GGUF Q4_K_S 量化版（每个约 8.7 GB）+ lightx2v 4 步加速 LoRA，画质明显好于 5B；最高 480p（16:9 为 864×480），每段采样只有 2 步所以很快。电脑内存建议 32GB 以上（两个模型在内存和显存之间轮换）。${GGUF_NOTE}${TIER_NOTE}`,
    descriptionEn: `For 12 GB cards (RTX 3060 12G / 4070 / 5070). 14B image-to-video as GGUF Q4_K_S (~8.7 GB each) plus the lightx2v 4-step LoRA; up to 480p (864×480 at 16:9). 32 GB+ system RAM recommended. ${GGUF_NOTE_EN} ${TIER_NOTE_EN}`,
    models: I2V14B.q4, textEncoder: UMT5, gguf: true, fast: true, steps: 4, maxShortEdge: 480,
  }),
  wanI2vTier({
    vram: 16,
    label: '【16G 显存】Wan 2.2 图生视频 14B · GGUF Q5 + 4 步加速（640p）',
    description: `适合 RTX 4060 Ti 16G / 4080 / 5060 Ti 16G / 5070 Ti 等。GGUF Q5_K_M 量化（每个约 10.8 GB，画质接近 fp8）+ lightx2v 4 步加速 LoRA；最高 640p（16:9 为 1152×640）。电脑内存建议 32GB 以上。${GGUF_NOTE}${TIER_NOTE}`,
    descriptionEn: `For 16 GB cards (RTX 4060 Ti 16G / 4080 / 5070 Ti). GGUF Q5_K_M (~10.8 GB each, close to fp8) plus the lightx2v 4-step LoRA; up to 640p (1152×640 at 16:9). 32 GB+ system RAM recommended. ${GGUF_NOTE_EN} ${TIER_NOTE_EN}`,
    models: I2V14B.q5, textEncoder: UMT5, gguf: true, fast: true, steps: 4, maxShortEdge: 640,
  }),
  wanI2vTier({
    vram: 24,
    label: '【24G 显存】Wan 2.2 图生视频 14B · fp8 + 4 步加速（720p）',
    description: `适合 RTX 3090 / 4090 / A5000 等。官方 fp8 模型（每个约 14.3 GB）+ lightx2v 4 步加速 LoRA，720p 一镜几分钟出片；动作幅度比 20 步标准采样略小。不需要额外插件。${TIER_NOTE}`,
    descriptionEn: `For 24 GB cards (RTX 3090 / 4090 / A5000). Official fp8 models (~14.3 GB each) plus the lightx2v 4-step LoRA: 720p in a few minutes; slightly less motion than 20-step sampling. No extra custom nodes. ${TIER_NOTE_EN}`,
    models: I2V14B.fp8, textEncoder: UMT5, fast: true, steps: 4, maxShortEdge: 720,
  }),
  wanI2vTier({
    vram: 32,
    label: '【32G 显存】Wan 2.2 图生视频 14B · fp8 标准 20 步（720p）',
    description: `适合 RTX 5090 32G / V100 32G 等。官方 fp8 模型，标准 20 步两段采样（高 / 低噪声各 10 步），动作和细节比 4 步加速好，耗时约 5 倍。V100 等不支持 fp8 计算的显卡也能用（ComfyUI 自动转成 fp16 计算）。${TIER_NOTE}`,
    descriptionEn: `For 32 GB cards (RTX 5090 / V100 32G). Official fp8 models with standard 20-step two-stage sampling: better motion and detail than 4-step, ~5× slower. Works on GPUs without fp8 compute (ComfyUI casts to fp16). ${TIER_NOTE_EN}`,
    models: I2V14B.fp8, textEncoder: UMT5, steps: 20, maxShortEdge: 720,
  }),
  wanI2vTier({
    vram: 48,
    label: '【48G 显存】Wan 2.2 图生视频 14B · fp16 20 步（720p）',
    description: `适合 RTX 6000 Ada / A6000 / L40S 48G 等。fp16 原精度模型（每个约 28.6 GB，两段之间自动换模型）+ fp16 文本编码器，画质比 fp8 更稳定。${TIER_NOTE}`,
    descriptionEn: `For 48 GB cards (RTX 6000 Ada / A6000 / L40S). Full-precision fp16 models (~28.6 GB each, swapped between stages) and the fp16 text encoder for the most stable quality. ${TIER_NOTE_EN}`,
    models: I2V14B.fp16, textEncoder: UMT5_FP16, steps: 20, maxShortEdge: 720,
  }),
  wanI2vTier({
    vram: 96,
    label: '【96G 显存】Wan 2.2 图生视频 14B · fp16 30 步（最高 1080p）',
    description: `适合 RTX Pro 6000 96G、A100 / H100 80G 等。fp16 模型 + 30 步，高 / 低噪声模型和文本编码器（共约 68 GB）可以同时常驻显存，最高 1080p。80~84G 的显卡选 1080p 偶尔会显存不足，建议用 720p。${TIER_NOTE}`,
    descriptionEn: `For 96 GB cards (RTX Pro 6000 96G) and 80 GB A100 / H100. fp16 with 30 steps; both experts plus the text encoder (~68 GB) can stay in VRAM; up to 1080p (prefer 720p on 80–84 GB cards). ${TIER_NOTE_EN}`,
    models: I2V14B.fp16, textEncoder: UMT5_FP16, steps: 30, maxShortEdge: 1080,
  }),
  wanI2vTier({
    vram: 141,
    label: '【141G 显存】Wan 2.2 图生视频 14B · fp16 40 步（1080p）',
    description: `适合 H200 141G、GH200 等。fp16 模型 + 40 步（Wan 官方图生视频默认步数），1080p 单镜 5 秒宽裕。启动 ComfyUI 时加 --highvram，让所有模型常驻显存，省掉两段之间换模型的时间。${TIER_NOTE}`,
    descriptionEn: `For H200 141G / GH200-class cards. fp16 with 40 steps (Wan's official I2V default); 1080p 5-second shots with headroom. Start ComfyUI with --highvram to keep every model resident and skip swaps between stages. ${TIER_NOTE_EN}`,
    models: I2V14B.fp16, textEncoder: UMT5_FP16, steps: 40, maxShortEdge: 1080,
  }),
  wanI2vTier({
    vram: 192,
    label: '【192G 显存】Wan 2.2 图生视频 14B · fp16 40 步（1080p 长镜头）',
    description: `适合 B200 192G、MI300X / MI325X 等。和 141G 档同样的最高画质设置（fp16 + 40 步 + 1080p），多出的显存用来出更长的镜头：1080p 单镜 10 秒（161 帧）也能一次生成，解码不需要分块。启动 ComfyUI 时加 --highvram。${TIER_NOTE}`,
    descriptionEn: `For B200 192G / MI300X / MI325X. Same top settings as the 141G tier (fp16, 40 steps, 1080p); the extra VRAM goes to longer shots: 10-second 1080p shots (161 frames) in one pass without tiled decoding. Start ComfyUI with --highvram. ${TIER_NOTE_EN}`,
    models: I2V14B.fp16, textEncoder: UMT5_FP16, steps: 40, maxShortEdge: 1080,
  }),
  wanI2vTier({
    vram: 288,
    label: '【288G 显存】Wan 2.2 图生视频 14B · fp16 40 步（1080p 超长镜头）',
    description: `适合 B300 288G、MI355X 等。同样是 fp16 + 40 步 + 1080p，Wan 2.2 在这之上不会再变清晰；多出的显存够 1080p 单镜 15 秒以上一次出片，或在同一张卡上再开一个 ComfyUI 实例（换个端口）给生图用，互不抢显存。启动 ComfyUI 时加 --highvram。${TIER_NOTE}`,
    descriptionEn: `For B300 288G / MI355X. Still fp16, 40 steps, 1080p (Wan 2.2 gets no sharper beyond this); the extra VRAM covers 15-second+ 1080p shots in one pass, or a second ComfyUI instance on another port for images without competing for memory. Start ComfyUI with --highvram. ${TIER_NOTE_EN}`,
    models: I2V14B.fp16, textEncoder: UMT5_FP16, steps: 40, maxShortEdge: 1080,
  }),
]


// ─── 按显存档位：MiniMax H3 音画同出（12G ~ 288G）─────────────────────────────────
// 参照 ComfyUI 官方 MiniMax H3 模板（docs.comfy.org）：默认组合是剪枝版 int8 + nvfp4 文本编码器 + int8 视频 VAE
// + 8 步 Turbo LoRA（不含 adaln 权重，剪枝版 / 完整版都能加载）；res_multistep / simple，标准 20 步，细节到 ~50 步仍有提升。
//   12G / 16G / 24G：社区剪枝版 GGUF（Abiray/MiniMax-H3-Pruned-GGUF：Q3 → 12G、Q4 → 16G、Q5 → 24G，需 ComfyUI-GGUF）
//   32G：官方剪枝版 int8（官方模板同款）；48G / 96G：完整版 int8；141G 起：完整版 bf16
// H3 原生最高 768p（再往上要单独的放大流程），所以显存越大加的是精度和步数，不是分辨率。
const HF_H3_GGUF = 'https://huggingface.co/Abiray/MiniMax-H3-Pruned-GGUF/resolve/main'
const h3File = (folder: string, file: string): ComfyTemplateModelFile => ({ file, folder: `models/${folder}`, url: `${HF_H3}/resolve/main/${folder}/${file}` })
const H3_TIER_FILES = {
  ggufQ3: { file: 'MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf', folder: 'models/diffusion_models', url: `${HF_H3_GGUF}/MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf` },
  ggufQ4: { file: 'MiniMax-H3-FL2VA-Pruned-Q4_K_M.gguf', folder: 'models/diffusion_models', url: `${HF_H3_GGUF}/MiniMax-H3-FL2VA-Pruned-Q4_K_M.gguf` },
  ggufQ5: { file: 'MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf', folder: 'models/diffusion_models', url: `${HF_H3_GGUF}/MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf` },
  prunedInt8: h3File('diffusion_models', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'),
  fullInt8: H3_FILES.unet,
  fullBf16: h3File('diffusion_models', 'minimax_h3_fl2va_bf16.safetensors'),
  clipNvfp4: h3File('text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'),
  clipInt8: H3_FILES.clip,
  clipBf16: h3File('text_encoders', 'qwen3vl_32b_minimax_h3_bf16.safetensors'),
  vaeInt8: h3File('vae', 'minimax_h3_video_vae_int8_convrot.safetensors'),
  vaeFp16: H3_FILES.videoVae,
} satisfies Record<string, ComfyTemplateModelFile>

interface H3TierOpts {
  vram: number
  label: string
  description: string
  descriptionEn: string
  unet: ComfyTemplateModelFile
  clip: ComfyTemplateModelFile
  videoVae: ComfyTemplateModelFile
  gguf?: boolean
  /** 8 步 Turbo LoRA */
  turbo?: boolean
  steps: number
  maxShortEdge: number
}

function h3Tier(o: H3TierOpts): ComfyWorkflowTemplate {
  const id = `minimax-h3-${o.vram}g`
  const steps = o.turbo ? 8 : o.steps
  return {
    id,
    kind: 'video',
    vram: o.vram,
    vramFamily: 'MiniMax H3 音画同出',
    label: o.label,
    description: o.description,
    descriptionEn: o.descriptionEn,
    files: [o.unet, o.clip, o.videoVae, H3_FILES.audioVae, ...(o.turbo ? [H3_FILES.turbo8] : [])],
    defaultModel: id,
    recommended: { fps: 24, steps, maxShortEdge: o.maxShortEdge },
    needsImage: 'optional',
    workflow: minimaxH3Workflow({ steps, lora: o.turbo ? H3_FILES.turbo8.file : undefined, unet: o.unet.file, clip: o.clip.file, videoVae: o.videoVae.file, gguf: o.gguf }),
  }
}

const H3_TIER_NOTE = '音画同出（对白 / 音效 / 配乐写进提示词）；有首帧 / 尾帧时为首尾帧图生视频，没有时为文生视频。固定 24fps，需要 ComfyUI 0.30.0 以上。'
const H3_TIER_NOTE_EN = 'Video with native audio (put dialogue / SFX / music in the prompt); first/last-frame image-to-video with frames, text-to-video without. Fixed 24 fps; needs ComfyUI 0.30.0+.'
const H3_GGUF_NOTE = '扩散模型是社区剪枝版 GGUF（Abiray/MiniMax-H3-Pruned-GGUF，MiniMax H3 社区许可），需要安装最新版 ComfyUI-GGUF 插件（ComfyUI-Manager 里搜 ComfyUI-GGUF）。文本编码器（nvfp4，约 15.7 GB）比显存大，ComfyUI 会自动分批放进显存，电脑内存建议 64GB 以上。'
const H3_GGUF_NOTE_EN = 'The diffusion model is the community pruned GGUF (Abiray/MiniMax-H3-Pruned-GGUF, MiniMax H3 community license); install the latest ComfyUI-GGUF custom node. The nvfp4 text encoder (~15.7 GB) is larger than VRAM and is streamed by ComfyUI; 64 GB+ system RAM recommended.'
const H3_INT8_NOTE = 'int8_convrot 模型官方建议配 PyTorch cu130；老显卡或环境用不了时，在「模型」里填 minimax_h3_fl2va_pruned_fp8_scaled.safetensors（同一仓库）替换扩散模型。'
const H3_INT8_NOTE_EN = 'int8_convrot weights are recommended with PyTorch cu130; on older GPUs or setups put minimax_h3_fl2va_pruned_fp8_scaled.safetensors (same repo) in Models to replace the diffusion model.'

export const COMFY_H3_VRAM_TEMPLATES: ComfyWorkflowTemplate[] = [
  h3Tier({
    vram: 12,
    label: '【12G 显存】MiniMax H3 音画同出 · 剪枝 GGUF Q3 + 8 步加速（480p）',
    description: `适合 RTX 3060 12G / 4070 / 5070 等。剪枝版 GGUF Q3_K_M（约 8.9 GB）+ 8 步 Turbo LoRA，最高 480p（16:9 为 864×480），画质和声音比完整版弱，适合出草稿。${H3_GGUF_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 12 GB cards (RTX 3060 12G / 4070 / 5070). Pruned GGUF Q3_K_M (~8.9 GB) plus the 8-step Turbo LoRA, up to 480p (864×480 at 16:9); weaker picture and audio than the full model, good for drafts. ${H3_GGUF_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.ggufQ3, clip: H3_TIER_FILES.clipNvfp4, videoVae: H3_TIER_FILES.vaeInt8, gguf: true, turbo: true, steps: 8, maxShortEdge: 480,
  }),
  h3Tier({
    vram: 16,
    label: '【16G 显存】MiniMax H3 音画同出 · 剪枝 GGUF Q4 + 8 步加速（768p）',
    description: `适合 RTX 4060 Ti 16G / 4080 / 5070 Ti 等。剪枝版 GGUF Q4_K_M（约 11.6 GB）+ 8 步 Turbo LoRA，原生 768p（16:9 为 1344×768）；显存不足时选 480p。${H3_GGUF_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 16 GB cards (RTX 4060 Ti 16G / 4080 / 5070 Ti). Pruned GGUF Q4_K_M (~11.6 GB) plus the 8-step Turbo LoRA at native 768p (1344×768 at 16:9); pick 480p if VRAM runs out. ${H3_GGUF_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.ggufQ4, clip: H3_TIER_FILES.clipNvfp4, videoVae: H3_TIER_FILES.vaeInt8, gguf: true, turbo: true, steps: 8, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 24,
    label: '【24G 显存】MiniMax H3 音画同出 · 剪枝 GGUF Q5 + 8 步加速（768p）',
    description: `适合 RTX 3090 / 4090 等。剪枝版 GGUF Q5_K_M（约 14.1 GB，接近 int8 画质）+ 8 步 Turbo LoRA，768p。${H3_GGUF_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 24 GB cards (RTX 3090 / 4090). Pruned GGUF Q5_K_M (~14.1 GB, close to int8) plus the 8-step Turbo LoRA at 768p. ${H3_GGUF_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.ggufQ5, clip: H3_TIER_FILES.clipNvfp4, videoVae: H3_TIER_FILES.vaeInt8, gguf: true, turbo: true, steps: 8, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 32,
    label: '【32G 显存】MiniMax H3 音画同出 · 官方剪枝 int8 + 8 步加速（768p）',
    description: `适合 RTX 5090 32G 等。和 ComfyUI 官方 MiniMax H3 模板同一套：剪枝版 int8（约 21 GB）+ nvfp4 文本编码器 + int8 视频 VAE + 8 步 Turbo LoRA，不需要额外插件。${H3_INT8_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 32 GB cards (RTX 5090). Same set as ComfyUI's official MiniMax H3 template: pruned int8 (~21 GB), nvfp4 text encoder, int8 video VAE and the 8-step Turbo LoRA; no custom nodes. ${H3_INT8_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.prunedInt8, clip: H3_TIER_FILES.clipNvfp4, videoVae: H3_TIER_FILES.vaeInt8, turbo: true, steps: 8, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 48,
    label: '【48G 显存】MiniMax H3 音画同出 · 完整版 int8 标准 20 步（768p）',
    description: `适合 RTX 6000 Ada / A6000 / L40S 48G 等。完整版 int8（约 34 GB，比剪枝版画面和声音更好）+ 标准 20 步（不用加速 LoRA，对白更清楚），fp16 视频 VAE。${H3_INT8_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 48 GB cards (RTX 6000 Ada / A6000 / L40S). Full int8 model (~34 GB, better picture and audio than pruned) with standard 20 steps (no Turbo LoRA, clearer dialogue) and the fp16 video VAE. ${H3_INT8_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.fullInt8, clip: H3_TIER_FILES.clipNvfp4, videoVae: H3_TIER_FILES.vaeFp16, steps: 20, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 96,
    label: '【96G 显存】MiniMax H3 音画同出 · 完整版 int8 25 步（768p）',
    description: `适合 RTX Pro 6000 96G、A100 / H100 80G 等（80~84G 的卡也够）。完整版 int8 + int8 文本编码器（比 nvfp4 理解提示词更准，两者共约 61 GB 可常驻显存），25 步（官方建议动作要更好时用 25 步）。${H3_INT8_NOTE}${H3_TIER_NOTE}`,
    descriptionEn: `For 96 GB cards (RTX Pro 6000 96G) and 80 GB A100 / H100 (80–84 GB is enough). Full int8 with the int8 text encoder (follows prompts better than nvfp4; ~61 GB together, can stay resident), 25 steps (the official tip for better motion). ${H3_INT8_NOTE_EN} ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.fullInt8, clip: H3_TIER_FILES.clipInt8, videoVae: H3_TIER_FILES.vaeFp16, steps: 25, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 141,
    label: '【141G 显存】MiniMax H3 音画同出 · 完整版 bf16 30 步（768p）',
    description: `适合 H200 141G、GH200 等。完整版 bf16 原精度（约 66 GB）+ int8 文本编码器，30 步，画面细节和声音质量最好的一档起点。${H3_TIER_NOTE}`,
    descriptionEn: `For H200 141G / GH200. Full-precision bf16 model (~66 GB) with the int8 text encoder, 30 steps: the start of the best-quality tiers. ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.fullBf16, clip: H3_TIER_FILES.clipInt8, videoVae: H3_TIER_FILES.vaeFp16, steps: 30, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 192,
    label: '【192G 显存】MiniMax H3 音画同出 · 完整版 bf16 + bf16 文本编码器 40 步（768p）',
    description: `适合 B200 192G、MI300X / MI325X 等。扩散模型和文本编码器都用 bf16 原精度（共约 118 GB），40 步。启动 ComfyUI 时加 --highvram，所有模型常驻显存，不用来回换。${H3_TIER_NOTE}`,
    descriptionEn: `For B200 192G / MI300X / MI325X. bf16 diffusion model and bf16 text encoder (~118 GB together), 40 steps. Start ComfyUI with --highvram to keep everything resident. ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.fullBf16, clip: H3_TIER_FILES.clipBf16, videoVae: H3_TIER_FILES.vaeFp16, steps: 40, maxShortEdge: 768,
  }),
  h3Tier({
    vram: 288,
    label: '【288G 显存】MiniMax H3 音画同出 · 完整版 bf16 50 步（768p 长镜头）',
    description: `适合 B300 288G、MI355X 等。全 bf16 + 50 步（官方说明细节到 50 步左右仍在提升），多出的显存够单镜 15 秒（H3 支持的最长时长）一次出片。启动 ComfyUI 时加 --highvram。${H3_TIER_NOTE}`,
    descriptionEn: `For B300 288G / MI355X. All bf16 with 50 steps (detail keeps improving up to ~50 per the official notes); the extra VRAM covers 15-second shots (H3's longest) in one pass. Start ComfyUI with --highvram. ${H3_TIER_NOTE_EN}`,
    unet: H3_TIER_FILES.fullBf16, clip: H3_TIER_FILES.clipBf16, videoVae: H3_TIER_FILES.vaeFp16, steps: 50, maxShortEdge: 768,
  }),
]

export const COMFY_VIDEO_TEMPLATES: ComfyWorkflowTemplate[] = [
  {
    id: 'wan2.2-ti2v-5b',
    kind: 'video',
    label: 'Wan 2.2 TI2V 5B（文生 / 图生二合一，推荐入门）',
    description: '一个 5B 模型同时支持文生视频和图生视频：有首帧时用首帧，没有就纯文生。24fps，显存约 12GB 起（--lowvram 可 8GB）。',
    descriptionEn: 'One 5B model for both text-to-video and image-to-video (uses the first frame when present). 24 fps, ~12 GB VRAM.',
    files: [
      { file: 'wan2.2_ti2v_5B_fp16.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors` },
      UMT5,
      { file: 'wan2.2_vae.safetensors', folder: 'models/vae', url: `${HF_WAN22}/vae/wan2.2_vae.safetensors` },
    ],
    defaultModel: 'wan2.2-ti2v-5b',
    recommended: { fps: 24 },
    needsImage: 'optional',
    workflow: {
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1, model: ['48', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['55', 0] }, _meta: { title: '采样' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['38', 0] }, _meta: { title: '正向提示词' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['38', 0] }, _meta: { title: '负向提示词' } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['39', 0] } },
      '37': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_ti2v_5B_fp16.safetensors', weight_dtype: 'default' } },
      '38': { class_type: 'CLIPLoader', inputs: { clip_name: UMT5.file, type: 'wan', device: 'default' } },
      '39': { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
      '48': { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['37', 0] } },
      '55': { class_type: 'Wan22ImageToVideoLatent', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1, vae: ['39', 0], start_image: ['56', 0] } },
      '56': { class_type: 'LoadImage', inputs: { image: '{{image}}' }, _meta: { title: '首帧' } },
      '57': { class_type: 'CreateVideo', inputs: { fps: '{{fps}}', images: ['8', 0] } },
      '58': { class_type: 'SaveVideo', inputs: { filename_prefix: 'video/uu889-drama', format: 'auto', codec: 'auto', video: ['57', 0] } },
    },
  },
  {
    id: 'wan2.2-i2v-14b',
    kind: 'video',
    label: 'Wan 2.2 I2V 14B（图生视频，高质量）',
    description: '首帧图生视频，高 / 低噪声双模型两段采样，画质与动作明显优于 5B。16fps，fp8 模型显存约 24GB 起。必须有首帧或参考图。',
    descriptionEn: 'Image-to-video with the high/low-noise 14B pair (two-stage sampling). 16 fps, ~24 GB VRAM with fp8. Needs a first frame or reference image.',
    files: [
      { file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` },
      { file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` },
      UMT5,
      WAN21_VAE,
    ],
    defaultModel: 'wan2.2-i2v-14b',
    recommended: { fps: 16 },
    needsImage: 'required',
    workflow: {
      ...wan14bTwoStage('wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', ['50', 0], ['50', 1], ['50', 2]),
      '52': { class_type: 'LoadImage', inputs: { image: '{{image}}' }, _meta: { title: '首帧' } },
      '50': { class_type: 'WanImageToVideo', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1, positive: ['6', 0], negative: ['7', 0], vae: ['39', 0], start_image: ['52', 0] } },
    },
  },
  {
    id: 'wan2.2-flf2v-14b',
    kind: 'video',
    label: 'Wan 2.2 首尾帧 14B（首帧 + 尾帧控制）',
    description: '同时控制开头和结尾画面，适合镜头衔接：分镜的首帧图 → 尾帧图。没有尾帧时退化为普通图生视频。16fps，显存约 24GB 起。',
    descriptionEn: 'First + last frame control with the 14B I2V pair, good for shot transitions. Falls back to plain I2V without a last frame. 16 fps, ~24 GB VRAM.',
    files: [
      { file: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` },
      { file: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` },
      UMT5,
      WAN21_VAE,
    ],
    defaultModel: 'wan2.2-flf2v-14b',
    recommended: { fps: 16 },
    needsImage: 'required',
    workflow: {
      ...wan14bTwoStage('wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors', 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', ['50', 0], ['50', 1], ['50', 2]),
      '52': { class_type: 'LoadImage', inputs: { image: '{{image}}' }, _meta: { title: '首帧' } },
      '53': { class_type: 'LoadImage', inputs: { image: '{{last_frame}}' }, _meta: { title: '尾帧' } },
      '50': { class_type: 'WanFirstLastFrameToVideo', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1, positive: ['6', 0], negative: ['7', 0], vae: ['39', 0], start_image: ['52', 0], end_image: ['53', 0] } },
    },
  },
  {
    id: 'wan2.2-t2v-14b',
    kind: 'video',
    label: 'Wan 2.2 T2V 14B（纯文生视频，高质量）',
    description: '只用提示词生成，忽略图片。高 / 低噪声双模型两段采样。16fps，fp8 模型显存约 24GB 起。',
    descriptionEn: 'Text-to-video only (images are ignored) with the 14B high/low-noise pair. 16 fps, ~24 GB VRAM with fp8.',
    files: [
      { file: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors` },
      { file: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors', folder: 'models/diffusion_models', url: `${HF_WAN22}/diffusion_models/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors` },
      UMT5,
      WAN21_VAE,
    ],
    defaultModel: 'wan2.2-t2v-14b',
    recommended: { fps: 16 },
    needsImage: 'none',
    workflow: {
      ...wan14bTwoStage('wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors', 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors', ['6', 0], ['7', 0], ['40', 0]),
      '40': { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: '{{width}}', height: '{{height}}', length: '{{frames}}', batch_size: 1 } },
    },
  },
  {
    id: 'minimax-h3-fl2v',
    kind: 'video',
    label: 'MiniMax H3 首尾帧 / 文生（20 步，带声音）',
    description: `MiniMax H3 FL2VA 完整版（int8）。${H3_NOTE} 显存建议 32GB 以上，20 步质量最好但最慢。`,
    descriptionEn: `MiniMax H3 FL2VA full build (int8). ${H3_NOTE_EN} 32 GB+ VRAM recommended; 20 steps for best quality.`,
    files: H3_BASE_FILES,
    defaultModel: 'minimax-h3-fl2v',
    recommended: { fps: 24, steps: 20 },
    needsImage: 'optional',
    workflow: minimaxH3Workflow({ steps: 20 }),
  },
  {
    id: 'minimax-h3-fl2v-turbo-8step',
    kind: 'video',
    label: 'MiniMax H3 Turbo 8 步（带声音，推荐）',
    description: `在 H3 完整版上加 8 步 Turbo LoRA（lightx2v），速度约为 20 步的 2.5 倍，画质接近。${H3_NOTE}`,
    descriptionEn: `H3 full build plus the 8-step Turbo LoRA (lightx2v): about 2.5× faster than 20 steps with similar quality. ${H3_NOTE_EN}`,
    files: [...H3_BASE_FILES, H3_FILES.turbo8],
    defaultModel: 'minimax-h3-fl2v-turbo-8step',
    recommended: { fps: 24, steps: 8 },
    needsImage: 'optional',
    workflow: minimaxH3Workflow({ steps: 8, lora: H3_FILES.turbo8.file }),
  },
  {
    id: 'minimax-h3-fl2v-turbo-4step',
    kind: 'video',
    label: 'MiniMax H3 Turbo 4 步 768p（带声音，最快）',
    description: `在 H3 完整版上加 4 步 768p Turbo LoRA，最快，适合预览草稿；分辨率按 768p 训练，选 1080p 也按 768p 出片。${H3_NOTE}`,
    descriptionEn: `H3 full build plus the 4-step 768p Turbo LoRA: fastest, good for drafts; trained at 768p, so 1080p renders at 768p. ${H3_NOTE_EN}`,
    files: [...H3_BASE_FILES, H3_FILES.turbo4],
    defaultModel: 'minimax-h3-fl2v-turbo-4step',
    recommended: { fps: 24, steps: 4 },
    needsImage: 'optional',
    workflow: minimaxH3Workflow({ steps: 4, lora: H3_FILES.turbo4.file }),
  },
  ...COMFY_VRAM_TEMPLATES,
  ...COMFY_H3_VRAM_TEMPLATES,
]

const SAVE_IMAGE = { class_type: 'SaveImage', inputs: { filename_prefix: 'uu889-drama', images: ['8', 0] }, _meta: { title: '保存图片' } }

export const COMFY_IMAGE_TEMPLATES: ComfyWorkflowTemplate[] = [
  {
    id: 'sdxl',
    kind: 'image',
    label: 'SDXL 文生图（默认，Checkpoint 通用）',
    description: 'ComfyUI 默认文生图结构：Checkpoint + KSampler。SDXL 及其微调模型（Juggernaut、RealVis、Animagine 等）都能直接用，「模型」填 checkpoint 文件名。基准尺寸 1024。',
    descriptionEn: 'Default checkpoint text-to-image graph. Works with SDXL and its fine-tunes; put the checkpoint file name in Models. Base size 1024.',
    files: [
      { file: 'sd_xl_base_1.0.safetensors', folder: 'models/checkpoints', url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors' },
    ],
    defaultModel: 'sd_xl_base_1.0.safetensors',
    recommended: { baseSize: 1024, steps: 25, cfg: 7 },
    needsImage: 'none',
    workflow: {
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}', sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{model}}' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] }, _meta: { title: '正向提示词' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] }, _meta: { title: '负向提示词' } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': SAVE_IMAGE,
    },
  },
  {
    id: 'sd15',
    kind: 'image',
    label: 'SD 1.5 文生图（低显存）',
    description: '结构同 SDXL，适合 SD1.5 系列模型（4GB 显存可跑），基准尺寸自动按 512 计算。',
    descriptionEn: 'Same graph as SDXL for SD 1.5 checkpoints (runs on 4 GB VRAM); base size 512.',
    files: [
      { file: 'v1-5-pruned-emaonly-fp16.safetensors', folder: 'models/checkpoints', url: 'https://huggingface.co/Comfy-Org/stable-diffusion-v1-5-archive/resolve/main/v1-5-pruned-emaonly-fp16.safetensors' },
    ],
    defaultModel: 'v1-5-pruned-emaonly-fp16.safetensors',
    recommended: { baseSize: 512, steps: 25, cfg: 7 },
    needsImage: 'none',
    workflow: {
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: '{{cfg}}', sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{model}}' } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] }, _meta: { title: '正向提示词' } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}', clip: ['4', 1] }, _meta: { title: '负向提示词' } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': SAVE_IMAGE,
    },
  },
  {
    id: 'flux1-dev',
    kind: 'image',
    label: 'FLUX.1 dev fp8（高质量，能理解长句提示词）',
    description: 'FLUX.1 dev 单文件 fp8 checkpoint，CFG 固定 1、引导强度 3.5、20 步。显存约 12GB 起。FLUX 不使用负向提示词。',
    descriptionEn: 'FLUX.1 dev single-file fp8 checkpoint: CFG 1, guidance 3.5, 20 steps, ~12 GB VRAM. No negative prompt.',
    files: [
      { file: 'flux1-dev-fp8.safetensors', folder: 'models/checkpoints', url: 'https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors' },
    ],
    defaultModel: 'flux1-dev-fp8.safetensors',
    recommended: { baseSize: 1024, steps: 20, cfg: 1 },
    needsImage: 'none',
    workflow: {
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['35', 0], negative: ['33', 0], latent_image: ['27', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{model}}' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] }, _meta: { title: '正向提示词' } },
      '33': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] }, _meta: { title: '负向（FLUX 不使用）' } },
      '35': { class_type: 'FluxGuidance', inputs: { guidance: 3.5, conditioning: ['6', 0] } },
      '27': { class_type: 'EmptySD3LatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': SAVE_IMAGE,
    },
  },
  {
    id: 'flux1-schnell',
    kind: 'image',
    label: 'FLUX.1 schnell fp8（4 步快速出图）',
    description: 'FLUX.1 schnell 单文件 fp8 checkpoint，4 步出图，速度最快，适合批量出角色 / 场景草图。',
    descriptionEn: 'FLUX.1 schnell single-file fp8 checkpoint, 4 steps — the fastest option for drafts.',
    files: [
      { file: 'flux1-schnell-fp8.safetensors', folder: 'models/checkpoints', url: 'https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors' },
    ],
    defaultModel: 'flux1-schnell-fp8.safetensors',
    recommended: { baseSize: 1024, steps: 4, cfg: 1 },
    needsImage: 'none',
    workflow: {
      '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['33', 0], latent_image: ['27', 0] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{model}}' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}', clip: ['4', 1] }, _meta: { title: '正向提示词' } },
      '33': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] }, _meta: { title: '负向（FLUX 不使用）' } },
      '27': { class_type: 'EmptySD3LatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': SAVE_IMAGE,
    },
  },
]

export const DEFAULT_VIDEO_TEMPLATE_ID = 'wan2.2-ti2v-5b'
export const DEFAULT_IMAGE_TEMPLATE_ID = 'sdxl'

export function listComfyTemplates(kind: ComfyTemplateKind): ComfyWorkflowTemplate[] {
  return kind === 'video' ? COMFY_VIDEO_TEMPLATES : COMFY_IMAGE_TEMPLATES
}

export function getComfyTemplate(kind: ComfyTemplateKind, id: string | null | undefined): ComfyWorkflowTemplate | null {
  if (!id) return null
  const key = String(id).trim().toLowerCase()
  return listComfyTemplates(kind).find((t) => t.id === key) || null
}

/** 模型名里出现的文件名（支持「高噪声文件|低噪声文件」或逗号分隔多个） */
export function splitModelFiles(model: string | null | undefined): string[] {
  return String(model || '')
    .split(/[|,，+]/)
    .map((s) => s.trim())
    .filter((s) => /\.(safetensors|sft|ckpt|pt|pth|bin|gguf)$/i.test(s))
}

/** 所有模板里放在 models/loras 的文件名（这些不是主模型，不能写进 UNETLoader / CheckpointLoader） */
const LORA_FILES = new Set(
  [...COMFY_VIDEO_TEMPLATES, ...COMFY_IMAGE_TEMPLATES]
    .flatMap((t) => t.files)
    .filter((f) => f.folder.endsWith('loras'))
    .map((f) => f.file.toLowerCase()),
)

/**
 * 「模型」里需要写进主模型加载节点的文件：去掉 LoRA 文件；用内置模板时再去掉模板本来就用的文件
 * （它们只是用来识别模板，工作流里已经是这些文件，不需要覆盖）。
 */
export function modelOverrideFiles(model: string | null | undefined, template?: ComfyWorkflowTemplate | null): string[] {
  const own = new Set((template?.files || []).map((f) => f.file.toLowerCase()))
  const files = splitModelFiles(model).filter((f) => !LORA_FILES.has(f.toLowerCase()) && !own.has(f.toLowerCase()))
  return files
}

/** 工作流是否是 MiniMax H3（固定 24fps、17k+5 帧、768p 画布） */
export function isMiniMaxH3Workflow(workflow: Record<string, any>): boolean {
  return Object.values(workflow).some((n: any) => /^MiniMaxH3/.test(String(n?.class_type || '')))
}

/**
 * 选择内置模板：显式设置的模板 ID → 模型名等于模板 ID → 模型文件属于某个模板 → 默认模板
 */
export function resolveComfyTemplate(
  kind: ComfyTemplateKind,
  templateId: string | null | undefined,
  model: string | null | undefined,
): ComfyWorkflowTemplate {
  const templates = listComfyTemplates(kind)
  const explicit = getComfyTemplate(kind, templateId)
  if (explicit) return explicit
  const byId = getComfyTemplate(kind, model)
  if (byId) return byId
  const files = splitModelFiles(model).map((f) => f.toLowerCase())
  if (files.length) {
    const byFile = templates.find((t) => t.files.some((f) => files.includes(f.file.toLowerCase())))
    if (byFile) return byFile
    // FLUX 等按文件名关键字识别
    if (kind === 'image') {
      if (files.some((f) => /flux.*schnell/.test(f))) return getComfyTemplate('image', 'flux1-schnell')!
      if (files.some((f) => /flux/.test(f))) return getComfyTemplate('image', 'flux1-dev')!
    }
  }
  return getComfyTemplate(kind, kind === 'video' ? DEFAULT_VIDEO_TEMPLATE_ID : DEFAULT_IMAGE_TEMPLATE_ID)!
}

/** 设置页展示用（不含工作流本体时传 includeWorkflow=false） */
export function describeComfyTemplates(kind: ComfyTemplateKind, includeWorkflow = true) {
  return listComfyTemplates(kind).map((t) => ({
    id: t.id,
    kind: t.kind,
    label: t.label,
    description: t.description,
    description_en: t.descriptionEn,
    files: t.files,
    default_model: t.defaultModel,
    recommended: t.recommended,
    vram: t.vram ?? null,
    vram_family: t.vramFamily ?? null,
    needs_image: t.needsImage || 'none',
    ...(includeWorkflow ? { workflow: t.workflow } : {}),
  }))
}
