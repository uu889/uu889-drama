/**
 * Provider Adapter 注册表
 * 根据 provider 名称返回对应的 Adapter 实例
 */
import { OpenAIImageAdapter } from './openai-image'
import { GeminiImageAdapter } from './gemini-image'
import { VolcEngineImageAdapter } from './volcengine-image'
import { VolcEngineVideoAdapter } from './volcengine-video'
import { MiniMaxVideoAdapter } from './minimax-video'
import { AliyunWanVideoAdapter } from './aliyun-wan-video'
import { AiaskImageAdapter, XaiImageAdapter } from './aiask-image'
import { AiaskVideoAdapter } from './aiask-video'
import { ComfyUIVideoAdapter } from './comfyui-video'
import { XaiVideoAdapter } from './xai-video'
import { VeoVideoAdapter } from './veo-video'
import { RunwayVideoAdapter } from './runway-video'
import { ComfyUIImageAdapter } from './comfyui-image'
import { SdWebuiImageAdapter } from './sdwebui-image'
import { FooocusImageAdapter } from './fooocus-image'
import type { ImageProviderAdapter, VideoProviderAdapter } from './types'

// 图片 Adapter 注册表
export const imageAdapters: Record<string, ImageProviderAdapter> = {
  aiask: new AiaskImageAdapter(),
  openai: new OpenAIImageAdapter(),
  gemini: new GeminiImageAdapter(),
  volcengine: new VolcEngineImageAdapter(),
  xai: new XaiImageAdapter(),
  // 本地生图服务
  comfyui: new ComfyUIImageAdapter(),
  sdwebui: new SdWebuiImageAdapter(),
  fooocus: new FooocusImageAdapter(),
}

// 视频 Adapter 注册表
export const videoAdapters: Record<string, VideoProviderAdapter> = {
  aiask: new AiaskVideoAdapter(),
  xai: new XaiVideoAdapter(),
  veo: new VeoVideoAdapter(),
  runway: new RunwayVideoAdapter(),
  comfyui: new ComfyUIVideoAdapter(),
  volcengine: new VolcEngineVideoAdapter(),
  minimax: new MiniMaxVideoAdapter(),
  aliyun: new AliyunWanVideoAdapter(),
}

/**
 * 获取图片 Adapter
 * @param provider 厂商名称
 * @returns 对应的 Adapter
 */
export function getImageAdapter(provider: string): ImageProviderAdapter {
  const adapter = imageAdapters[provider.toLowerCase()]
  if (!adapter) throw new Error(`Unsupported image provider: ${provider}`)
  return adapter
}

/**
 * 获取视频 Adapter
 * @param provider 厂商名称
 * @returns 对应的 Adapter
 */
export function getVideoAdapter(provider: string): VideoProviderAdapter {
  const adapter = videoAdapters[provider.toLowerCase()]
  if (!adapter) throw new Error(`Unsupported video provider: ${provider}`)
  return adapter
}
