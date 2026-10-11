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
  /** 推荐参数：视频 fps；图片基准尺寸 / 步数 / CFG */
  recommended: { fps?: number; baseSize?: number; steps?: number; cfg?: number }
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
  unet: { file: 'minimax_h3_fl2va_int8_convrot.safetensors', folder: 'models/diffusion_models', url: `${HF_H3}/tree/main/diffusion_models` },
  clip: { file: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', folder: 'models/text_encoders', url: `${HF_H3}/tree/main/text_encoders` },
  videoVae: { file: 'minimax_h3_video_vae_fp16.safetensors', folder: 'models/vae', url: `${HF_H3}/tree/main/vae` },
  audioVae: { file: 'minimax_h3_audio_vae_fp32.safetensors', folder: 'models/vae', url: `${HF_H3}/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors` },
  turbo8: { file: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', folder: 'models/loras', url: 'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors' },
  turbo4: { file: 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', folder: 'models/loras', url: `${HF_H3}/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors` },
} satisfies Record<string, ComfyTemplateModelFile>

function minimaxH3Workflow(opts: { steps: number; lora?: string }): Record<string, any> {
  const model: [string, number] = opts.lora ? ['121', 0] : ['6', 0]
  return {
    '6': { class_type: 'UNETLoader', inputs: { unet_name: H3_FILES.unet.file, weight_dtype: 'default' }, _meta: { title: '扩散模型' } },
    ...(opts.lora ? { '121': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: opts.lora, strength_model: 1, model: ['6', 0] }, _meta: { title: 'Turbo LoRA' } } } : {}),
    '13': { class_type: 'CLIPLoader', inputs: { clip_name: H3_FILES.clip.file, type: 'minimax', device: 'default' }, _meta: { title: '文本编码器' } },
    '11': { class_type: 'VAELoader', inputs: { vae_name: H3_FILES.videoVae.file }, _meta: { title: '视频 VAE' } },
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
    needs_image: t.needsImage || 'none',
    ...(includeWorkflow ? { workflow: t.workflow } : {}),
  }))
}
