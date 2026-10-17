import type { ProgressReporter, TaskProgressPatch } from '../task-progress'

/**
 * 图片生成 Provider Adapter 接口
 */
export interface ImageProviderAdapter {
  /** 厂商标识 */
  provider: string

  /**
   * 构建图片生成请求
   * @param config AI 配置 { baseUrl, apiKey, model }
   * @param record 图片生成记录
   * 允许异步：需要先上传素材等前置步骤的厂商可返回 Promise
   */
  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord, ctx?: GenerateContext): ProviderRequest | Promise<ProviderRequest>

  /**
   * 解析生成响应，判断是同步还是异步
   */
  parseGenerateResponse(result: any): ImageGenResponse

  /**
   * 构建轮询请求
   * @param config AI 配置
   * @param taskId 任务 ID
   */
  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  /**
   * 解析轮询响应
   */
  parsePollResponse(result: any): ImagePollResponse

  /**
   * 从响应中提取图片 URL（用于直接下载）
   * 返回 null 表示图片数据是 base64 格式，需要用 extractImageBase64 处理
   */
  extractImageUrl(result: any): string | null

  /**
   * 从响应中提取 base64 图片数据
   * 仅用于 Gemini 等只返回 base64 的厂商
   */
  extractImageBase64(result: any): { data: string; mimeType: string } | null

  /** 可选：结果图下载需要鉴权或相对地址需要补全（如 ComfyUI /view） */
  resolveDownload?(config: AIConfig, imageUrl: string): DownloadRequest

  /** 以下可选钩子含义同 VideoProviderAdapter（本地生图服务排队久、需要按队列判断状态） */
  pollProfile?: PollProfile
  fetchPollResult?(config: AIConfig, taskId: string): Promise<any>
  cancel?(config: AIConfig, taskId: string): Promise<void>
  describeError?(status: number, bodyText: string): string | null
  onSubmitted?(config: AIConfig, taskId: string, request: ProviderRequest, report?: ProgressReporter): void
  describeProgress?(config: AIConfig, taskId: string, pollResult: any): TaskProgressPatch | null
  onFinished?(config: AIConfig, taskId: string): void
  trackSyncProgress?(config: AIConfig, request: ProviderRequest, report: ProgressReporter): () => void
  prepareRetry?(config: AIConfig, ctx: RetryContext): Promise<boolean>
}

/**
 * 生成过程的上下文：适配器在构建请求（上传素材等）时上报进度。
 * buildGenerateRequest 的第三个参数，可选，旧适配器忽略即可。
 */
export interface GenerateContext {
  report: ProgressReporter
}

/** 轮询节奏：attempts 次、每次间隔 intervalMs；maxDurationMs 为总时长上限（null 不限） */
export interface PollProfile {
  attempts: number
  intervalMs: number
  maxDurationMs?: number | null
}

/**
 * 视频生成 Provider Adapter 接口
 */
export interface VideoProviderAdapter {
  provider: string

  /** 允许异步：ComfyUI 需先上传参考图，aiask 需把参考图读成文件后走 multipart */
  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord, ctx?: GenerateContext): ProviderRequest | Promise<ProviderRequest>

  parseGenerateResponse(result: any): VideoGenResponse

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  parsePollResponse(result: any): VideoPollResponse

  extractVideoUrl(result: any): string | null

  /**
   * 可选：成片下载需要鉴权或相对地址需要补全时提供（如 aiask /v1/videos/{id}/content
   * 需带 API Key、ComfyUI /view 相对路径需拼本地服务地址）。未实现时直接 GET videoUrl。
   */
  resolveDownload?(config: AIConfig, videoUrl: string): DownloadRequest

  /** 可选：覆盖默认轮询节奏（如本地 ComfyUI 串行出片，排队时间长） */
  pollProfile?: PollProfile

  /**
   * 可选：自定义取状态（需要多次请求才能判断时，如 ComfyUI 先查 history 再查 queue）。
   * 返回值交给 parsePollResponse；抛错按网络抖动重试。
   */
  fetchPollResult?(config: AIConfig, taskId: string): Promise<any>

  /** 可选：轮询超时放弃时取消上游任务，避免继续占用资源 */
  cancel?(config: AIConfig, taskId: string): Promise<void>

  /** 可选：把上游错误响应整理成可读文案（返回 null 用通用格式） */
  describeError?(status: number, bodyText: string): string | null

  /** 可选：任务已提交（拿到上游任务 ID）后调用，如 ComfyUI 开始订阅该 prompt 的执行事件；report 用于实时推送进度 */
  onSubmitted?(config: AIConfig, taskId: string, request: ProviderRequest, report?: ProgressReporter): void

  /** 可选：每次轮询后给出细粒度进度（排队位置、采样步数等）；返回 null 用通用的「生成中」 */
  describeProgress?(config: AIConfig, taskId: string, pollResult: any): TaskProgressPatch | null

  /** 可选：任务结束（成功 / 失败 / 放弃）后清理订阅 */
  onFinished?(config: AIConfig, taskId: string): void

  /**
   * 可选：上游执行失败后，判断能否处理后原样重新提交（如 ComfyUI 显存不足：先让 ComfyUI 释放缓存的模型）。
   * 返回 true = 已处理，由 generation.ts 用同一个请求重新提交；false = 照常判失败。
   */
  prepareRetry?(config: AIConfig, ctx: RetryContext): Promise<boolean>

  /**
   * 可选：同步接口（请求阻塞到出结果，如 SD WebUI txt2img）在请求进行期间另行查询进度。
   * 返回停止函数，请求结束后调用。
   */
  trackSyncProgress?(config: AIConfig, request: ProviderRequest, report: ProgressReporter): () => void
}

export interface DownloadRequest {
  url: string
  headers?: Record<string, string>
  /** URL 与响应头都推断不出扩展名时使用（如 .mp4） */
  fallbackExt?: string
}

// ============ 通用类型 ============

export interface ProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  /**
   * 普通请求为可 JSON 序列化的对象（generation.ts 统一 JSON.stringify）；
   * multipart 上传（如 OpenAI /v1/images/edits）直接返回 FormData，
   * 此时 headers 不要设置 Content-Type，边界由 fetch 自动生成。
   */
  body: any
}

/** prepareRetry 的上下文 */
export interface RetryContext {
  taskId: string
  error: string
  /** 已经重试过的次数（第一次失败时为 0） */
  attempt: number
  /** 同一台机器上同一服务商的其他启用配置（如另一个 ComfyUI 端口），可一并释放资源 */
  peers: AIConfig[]
  report?: ProgressReporter
}

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** ai_service_configs.settings 解析后的对象（如 ComfyUI 工作流），未设置为 null */
  settings?: Record<string, any> | null
}

export interface ImageGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  size?: string | null
  frameType?: string | null
  referenceImages?: string | null
  /** 项目视觉风格（style_presets.value，如 anime / ghibli），本地服务按它切换风格模型 */
  style?: string | null
  // ... 其他字段
}

export interface VideoGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referenceVideoUrls?: string | null
  referenceAudioUrls?: string | null
  referenceFileUrl?: string | null
  referenceLinkUrl?: string | null
  generateAudio?: number | boolean | null
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  seed?: number | null
  promptExtend?: number | boolean | null
  watermark?: number | boolean | null
  /** 项目视觉风格（style_presets.value） */
  style?: string | null
  // ... 其他字段
}

export interface ImageGenResponse {
  isAsync: boolean
  taskId?: string
  /** 同步模式下直接返回的图片 URL */
  imageUrl?: string
}

export interface ImagePollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
}

export interface VideoGenResponse {
  isAsync: boolean
  taskId?: string
  videoUrl?: string
}

export interface VideoPollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  duration?: number
  error?: string
}
