/**
 * 每个模型文件的下载来源（按优先级）与校验信息。
 *
 * 顺序：Hugging Face 原站 → Hugging Face 镜像（hf-mirror.com）→ Civitai 原站 → Civitai 镜像。
 * Civitai 上的文件如果在 Hugging Face 有「SHA256 完全相同」的副本，优先从 Hugging Face（及镜像）下载。
 * 同一个文件的所有来源内容完全相同，所以换来源时可以接着已下载的部分续传。
 * 「优先镜像」打开时（国内网络），镜像排在原站前面。
 */
export type SourceLabel = 'huggingface' | 'hf-mirror' | 'civitai' | 'civitai-mirror'

export interface DownloadSource {
  label: SourceLabel
  url: string
  /** 需要带的请求头（HF Token） */
  auth?: 'hf' | 'civitai'
}

export interface FileMeta {
  /** 精确字节数（用于判断是否下完、续传是否对得上） */
  bytes?: number
  sha256?: string
  /** Civitai 文件在 Hugging Face 上 SHA256 相同的副本（https://huggingface.co/...） */
  hfCopy?: string
}

export const HF_HOST = 'https://huggingface.co'
export const HF_MIRROR_HOST = 'https://hf-mirror.com'

/**
 * Civitai 镜像：CivArchive 的 /api/download/models/<版本 ID> 会跳转到它收录的同哈希镜像（不需要 Civitai Key）。
 * 镜像内容由下载后的 SHA256 校验兜底；civitai.green / civitai.red 是 Civitai 自己的域名，不算独立镜像。
 */
export const CIVITAI_MIRROR_HOSTS: string[] = ['https://civarchive.com']

const HF = (repoPath: string) => `${HF_HOST}/${repoPath.split('/').map(encodeURIComponent).join('/')}`

/**
 * 已核对的文件大小 / SHA256 / Hugging Face 同哈希副本（键为放进模型目录后的文件名）。
 * 数据来自 Hugging Face API（size + lfs sha256）与 Civitai / CivArchive 版本页（SHA256），2026-10。
 * 只有 Civitai 上有、且 Civitai 只给出四舍五入大小的文件不写 bytes，用 SHA256 校验。
 */
export const FILE_META: Record<string, FileMeta> = {
  // ── Hugging Face 生图 ──
  'sd_xl_base_1.0.safetensors': { bytes: 6938078334, sha256: '31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b' },
  'sd_xl_base_1.0_0.9vae.safetensors': { bytes: 6938078334, sha256: 'e6bb9ea85bbf7bf6478a7c6d18b71246f22e95d41bcdd80ed40aa212c33cfeff', hfCopy: HF('stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors') },
  'animagine-xl-4.0-opt.safetensors': { bytes: 6938350040, sha256: '6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac', hfCopy: HF('cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors') },
  '3d_render_style_xl.safetensors': { bytes: 85450700, sha256: '393de3e04d956b13ac1a41c3a932e196330ad03d7a70abc2a174d911376ec397' },
  'anime-ghibli-soft.safetensors': { bytes: 93065304, sha256: 'da85caafb57db3fa4671534eeabbf4a5207c2b8fe723aaef18ccd0f1006d6741' },
  'watercolor_v1_sdxl.safetensors': { bytes: 11860808, sha256: 'd375ae7e68e1377305c168b0550a0fda33925421f570f87870fb19278786e9ac' },
  'comic-ink-halftone.safetensors': { bytes: 93065304, sha256: '40478f80cbf63cce3be92652c23337380df12f62c10b8071da7030faa1a94018' },
  'Chinese_Ink_Painting_Lora_SDXL.safetensors': { bytes: 57428460, sha256: '79d5a46e204b08179217622703e93342249298318d2bc9a80bc2ae02e9bee229' },
  'manga-ink-screentone.safetensors': { bytes: 93065304, sha256: 'e9fa7b9c4eb781d6cdf8329c6d056133e08c6cc72e730738575497d4ab3da6c9' },
  // ── Civitai（有 Hugging Face 同哈希副本的优先从 HF 下载）──
  'ProtoVisionXL_0.6.6.0.fp16.safetensors': { bytes: 6938041098, sha256: '440a7f226b3afad84bd5b716635a631fe25c99dea71760e0a8be56d1e7a2f447', hfCopy: HF('JoshuaChak/SD-WebUI-Safetensors/resolve/main/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors') },
  'samaritan_3d_cartoon_sdxl.safetensors': { bytes: 912562996, sha256: '3724f4f0074eb213bd0e3bdbc8d8f07f90e023099ab5e7d1bc8756f089be998a', hfCopy: HF('openartai/model_hub_loras/resolve/main/Samaritan 3d Cartoon SDXL.safetensors') },
  'studio_ghibli_xl_v2.safetensors': { sha256: '2447df46f72c6503ef86ff96f70d1a29e728e39a401b4863f279f0925ecf1855' },
  'picbookXLloraV1.safetensors': { bytes: 340778540, sha256: '75052d03a19ae137da02012b172cc25632520dc427c8a7f3a4052079bfe3a55e', hfCopy: HF('Muapi/picture-story-book-for-children-xl-xl/resolve/main/picture-story-book-for-children-xl-xl.safetensors') },
  'Comic_realism.safetensors': { sha256: 'f7a4752eb77282eb09a89b8d3e1c3f32b82303972d11b6bf0a23aa6d92d66470' },
  'Chinese_myth_animagineXLV31.safetensors': { sha256: '08782ef7c9eb6b9077513503cd05aec6a5013d633a54b65ff44446d1233e4edc' },
  'manhwa-artstyle-000018.safetensors': { bytes: 228468644, sha256: '98120f81ceb10d1c8d6d820b30a88810853d8ece92bf1d80a7da914c4f0e2a18', hfCopy: HF('Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors') },
  'manhwa-artstyle-webtoon-lora.safetensors': { bytes: 228468644, sha256: '98120f81ceb10d1c8d6d820b30a88810853d8ece92bf1d80a7da914c4f0e2a18' },
  'LineAniRedmondV2-Lineart-LineAniAF.safetensors': { bytes: 170540028, sha256: '1692a2c7d285f6c94b7910bc8f8ec2758163ba2710214bd35bb20cc94d2488c8', hfCopy: HF('artificialguybr/LineAniRedmond-LinearMangaSDXL-V2/resolve/main/LineAniRedmondV2-Lineart-LineAniAF.safetensors') },
  // ── Wan 视频 ──
  'pixar_10_epochs.safetensors': { bytes: 359257680, sha256: '0117b1ca731f1c757170d4de1414037dac34d62fbf0f38de178ad3865193e204' },
  'wan_flat_color_v2.safetensors': { bytes: 306807976, sha256: 'e61910ec19fc602d72248c4f3abd338b614d82394f357d2d67f6e1575b4f4819' },
  'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors': { bytes: 14294742832, sha256: '6122e79d55e0f235698d11d657f3b196c5273c830da00b2b013c5a048d5e6a42' },
  'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors': { bytes: 14294742832, sha256: '5471a457b6ac404202a5fbe6c11595a3d5641fc766b00f38763f72303fffc21e' },
  'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors': { bytes: 14293923632, sha256: 'cad711ae211c8b23455ec68cd6a190a33a3d874234a77eb57266d73f8f0e6c9f' },
  'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors': { bytes: 14293923632, sha256: 'e71b96d7c82e638694c5e7fb98fac4bfb0e4ddc5fbbb4b1df40da8f0f1278a97' },
  'wan2.2_ti2v_5B_fp16.safetensors': { bytes: 9999658848, sha256: '456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e' },
  'wan2.2_vae.safetensors': { bytes: 1409400960, sha256: 'e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156' },
  'wan_2.1_vae.safetensors': { bytes: 253815318, sha256: '2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b' },
  'umt5_xxl_fp8_e4m3fn_scaled.safetensors': { bytes: 6735906897, sha256: 'c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68' },
  // ── 按显存档位的 Wan 2.2 图生视频 14B 模板（comfyui-templates.ts COMFY_VRAM_TEMPLATES）──
  'umt5_xxl_fp16.safetensors': { bytes: 11366399385, sha256: '7b8850f1961e1cf8a77cca4c964a358d303f490833c6c087d0cff4b2f99db2af' },
  'wan2.2_i2v_high_noise_14B_fp16.safetensors': { bytes: 28577914792, sha256: 'c21c21efa368d529a982a7d89dd11d86608b5937cae9a125d0ffe5491918a100' },
  'wan2.2_i2v_low_noise_14B_fp16.safetensors': { bytes: 28577914792, sha256: 'edb89340c8a6fbf1a70e76a839ae01eaf7d289f05ea1ebd6b1a3fc6f533826e9' },
  'wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors': { bytes: 1226977424, sha256: 'd176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e' },
  'wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors': { bytes: 1226977424, sha256: '024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9' },
  'Wan2.2-I2V-A14B-HighNoise-Q4_K_S.gguf': { bytes: 8748151296, sha256: '8fc5f726ccf1214e43c6a599bdef1e63daf7fab06e71fb74081416c4b9ce200b' },
  'Wan2.2-I2V-A14B-LowNoise-Q4_K_S.gguf': { bytes: 8748151296, sha256: '54e2313ef7fbb169e72ab1d7cecdc90a04db01097c86f9f39097b8caacea50fb' },
  'Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf': { bytes: 10792055296, sha256: '163e9e5ae7ff83a4598d55242c767384be8909749dc07240d388a24838e8bac6' },
  'Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf': { bytes: 10792055296, sha256: 'c5affcba15576959fa6d63c18261275b6407c3edd5ad3d8ab1c420e96f9d05d0' },
  // ── MiniMax H3（Comfy-Org/MiniMax-H3、lightx2v Turbo LoRA、Abiray 剪枝版 GGUF）──
  'minimax_h3_fl2va_bf16.safetensors': { bytes: 66280487368, sha256: '907d4add438438ec1544f5240c3b38532ed934fe6be75677a6bbda2a6fdd6182' },
  'minimax_h3_fl2va_int8_convrot.safetensors': { bytes: 34038892334, sha256: '7ad4c73e6e378b822ffd1629f27f632d3787d95f5e468e3af958f98c58df96a5' },
  'minimax_h3_fl2va_pruned_int8_convrot.safetensors': { bytes: 20970379616, sha256: 'e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a' },
  'minimax_h3_fl2va_pruned_fp8_scaled.safetensors': { bytes: 20958205608, sha256: '12944c1f7791637e7de12208aef04da82bd26b95271b1b47d817364315ade993' },
  'MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf': { bytes: 8902845536, sha256: 'c844d70dbb4df67b7d9605c669bff35d9c631bd0507143cf0276f984de32247d' },
  'MiniMax-H3-FL2VA-Pruned-Q4_K_M.gguf': { bytes: 11564180576, sha256: 'd74e644906fe95b8c7bf4837ba9d3f9392925f7301675a0993d419b62a4824a3' },
  'MiniMax-H3-FL2VA-Pruned-Q5_K_M.gguf': { bytes: 14068966496, sha256: 'abe739ac98bc14d6e4e56987198765b02899da632ad254c820f559b6dc4d1171' },
  'qwen3vl_32b_minimax_h3_bf16.safetensors': { bytes: 51506295256, sha256: '600d567f6a9629c8574e8e7041b199bdd9c59a986afa7906910a81919610607d' },
  'qwen3vl_32b_minimax_h3_int8_convrot.safetensors': { bytes: 27141342152, sha256: 'bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923' },
  'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors': { bytes: 15687142551, sha256: '35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6' },
  'minimax_h3_video_vae_fp16.safetensors': { bytes: 5207808496, sha256: '7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522' },
  'minimax_h3_video_vae_int8_convrot.safetensors': { bytes: 2811065184, sha256: '52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e' },
  'minimax_h3_audio_vae_fp32.safetensors': { bytes: 605254808, sha256: '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48' },
  'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors': { bytes: 1956193000, sha256: '2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e' },
  'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors': { bytes: 1956192992, sha256: 'c396a9a06f58399e9df9754b18299818d84a2ddd371724ba48fe4a41221437dc' },
  // 参考图生视频（Ref2VA）
  'minimax_h3_ref2va_bf16.safetensors': { bytes: 66280487368, sha256: 'e32c54c1a7b4f5f397f195cea267ccb18806303bb665678c4bee60953bdf3026' },
  'minimax_h3_ref2va_int8_convrot.safetensors': { bytes: 34038894550, sha256: '9eef934046a0671bc8a5daf87100705e1478419c574cfde70c50fbe6885f76a9' },
  'minimax_h3_ref2va_pruned_int8_convrot.safetensors': { bytes: 20970379616, sha256: '9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779' },
  'minimax_h3_ref2va_pruned_fp8_scaled.safetensors': { bytes: 20958205608, sha256: 'f86f2f79ebd2d76eb8eeb46091e83982e6ff51d255747e7b16e92834b392b8e9' },
  'MiniMax-H3-Ref2VA-Pruned-Q3_K_M.gguf': { bytes: 8902845536, sha256: '6e22b83e7c2213018ab0e66542633564fc6ffc05df25ed6fce2285716f335e58' },
  'MiniMax-H3-Ref2VA-Pruned-Q4_K_M.gguf': { bytes: 11564180576, sha256: 'a67ff28c56f0bcf05f7a5edb2d215f2dce5c302587d4caf748e2e61e1ffea736' },
  'MiniMax-H3-Ref2VA-Pruned-Q5_K_M.gguf': { bytes: 14068966496, sha256: 'dd220ed3888317740af9cc9b84baaf14c4d2e330ec89f2f445a758c21f4e98c5' },
  'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors': { bytes: 1956193000, sha256: '5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c' },
}

export const SOURCE_LABELS: Record<SourceLabel, string> = {
  huggingface: 'Hugging Face',
  'hf-mirror': 'Hugging Face 镜像（hf-mirror.com）',
  civitai: 'Civitai',
  'civitai-mirror': 'Civitai 镜像',
}

function hfPair(url: string, preferMirror: boolean): DownloadSource[] {
  const pathPart = url.startsWith(HF_HOST) ? url.slice(HF_HOST.length) : ''
  if (!pathPart) return [{ label: 'huggingface', url, auth: 'hf' }]
  const pair: DownloadSource[] = [
    { label: 'huggingface', url, auth: 'hf' },
    { label: 'hf-mirror', url: `${HF_MIRROR_HOST}${pathPart}`, auth: 'hf' },
  ]
  return preferMirror ? pair.reverse() : pair
}

function civitaiSources(url: string, preferMirror: boolean): DownloadSource[] {
  const m = url.match(/^https:\/\/civitai\.com(\/api\/download\/models\/\d+.*)$/)
  const list: DownloadSource[] = [{ label: 'civitai', url, auth: 'civitai' }]
  // 镜像不带 Civitai Key（不把 Key 发给第三方）
  if (m) for (const host of CIVITAI_MIRROR_HOSTS) list.push({ label: 'civitai-mirror', url: `${host}${m[1]}` })
  return preferMirror ? [...list.slice(1), list[0]] : list
}

/** 文件的全部下载来源（已按优先级排好） */
export function sourcesFor(file: { file: string; url: string; source?: string }, opts: { preferMirror?: boolean } = {}): DownloadSource[] {
  const meta = FILE_META[file.file] || {}
  const preferMirror = !!opts.preferMirror
  if (file.url.startsWith(HF_HOST)) return hfPair(file.url, preferMirror)
  const out: DownloadSource[] = []
  if (meta.hfCopy) out.push(...hfPair(meta.hfCopy, preferMirror))
  out.push(...civitaiSources(file.url, preferMirror))
  return out
}

/** 给来源 URL 加上鉴权（Civitai 用 ?token=，HF 用 Authorization 头） */
export function authorize(src: DownloadSource, tokens: { civitai?: string; hf?: string }): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {}
  let url = src.url
  // Civitai 推荐用 Authorization 头（跳转到存储地址时不会带过去）
  if (src.auth === 'civitai' && tokens.civitai) headers.Authorization = `Bearer ${tokens.civitai}`
  if (src.auth === 'hf' && tokens.hf) headers.Authorization = `Bearer ${tokens.hf}`
  return { url, headers }
}

/** 日志 / 前端展示用：去掉 URL 里的 token */
export function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&]+/, '$1***')
}
