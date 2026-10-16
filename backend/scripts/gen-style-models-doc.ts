/**
 * 由 style-model-catalog.ts 生成 docs/style-models.md（视觉风格 → 模型对应表、接口调用、下载方法）
 * 用法：cd backend && npx tsx scripts/gen-style-models-doc.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LICENSE_LABELS, MODEL_FOLDERS, STYLE_MODEL_CATALOG, worstLicense, type CatalogFile, type LicenseStatus } from '../src/services/adapters/style-model-catalog'
import { STYLE_KEYS } from '../src/services/adapters/style-models'
import { STYLE_LABELS, describeStyleModelCatalog } from '../src/services/adapters/style-model-guide'
import { getComfyTemplate } from '../src/services/adapters/comfyui-templates'

const out: string[] = []
const w = (...lines: string[]) => out.push(...lines)
const link = (f?: CatalogFile | null) => (f ? `[${f.name.replace(/\[/g, '（').replace(/\]/g, '）').replace(/\|/g, '/')}](${f.page})` : '—')
const code = (s?: string | number | null) => (s === undefined || s === null || s === '' ? '—' : `\`${s}\``)
/** 格式化 JSON，ComfyUI 连线 ["节点", 槽位] 保持一行 */
const json = (v: unknown) => JSON.stringify(v, null, 2).replace(/\[\s+("[^"]*"),\s+(\d+)\s+\]/g, '[$1, $2]')
const esc = (s?: string) => (s || '').replace(/\|/g, '\\|')
const LIC_ICON: Record<LicenseStatus, string> = { ok: '✅', attention: '⚠️', restricted: '⛔' }
const lic = (st: LicenseStatus) => `${LIC_ICON[st]} ${LICENSE_LABELS[st]}`

/** 表格下方：非 ok 文件的许可说明 + 可选替代 */
function licenseNotes(kind: 'sdwebui' | 'hf_image' | 'comfyui_video') {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const k of STYLE_KEYS) {
    const p = (STYLE_MODEL_CATALOG[kind] as any)[k]
    for (const f of [p.checkpoint, p.lora] as Array<CatalogFile | null | undefined>) {
      if (!f || seen.has(f.file)) continue
      seen.add(f.file)
      const st = f.licenseStatus || 'attention'
      lines.push(`| ${link(f)} | ${esc(f.license) || '—'} | ${lic(st)} | ${esc(f.licenseNote) || '—'} |`)
    }
  }
  w('**许可**（以「用生成的图 / 视频做商业短剧」为准；✅ 可商用无需授权，⚠️ 可以用但有条件或来源不清，⛔ 非商用或需作者授权）：', '', '| 模型 | 许可 | 等级 | 说明 |', '| --- | --- | --- | --- |', ...lines, '')
  const alts: string[] = []
  for (const k of STYLE_KEYS) {
    for (const a of ((STYLE_MODEL_CATALOG[kind] as any)[k].alternatives || []) as CatalogFile[]) {
      alts.push(`| ${STYLE_LABELS[k]} | ${link(a)}<br>${code(a.file)} | ${lic(a.licenseStatus || 'attention')} | ${esc(a.licenseNote || a.note) || '—'} |`)
    }
  }
  if (alts.length) {
    w('**可选替代**（不在默认推荐和下载命令里；需要时在设置页「覆盖」里填文件名，⚠️ / ⛔ 的请先确认授权）：', '', '| 风格 | 模型 | 许可等级 | 说明 |', '| --- | --- | --- | --- |', ...alts, '')
  }
}

function paramText(p: Record<string, any> = {}, fooocus = false) {
  const parts: string[] = []
  if (p.sampler) parts.push(`${p.sampler}${p.scheduler ? ` ${p.scheduler}` : ''}`)
  if (p.steps) parts.push(`${p.steps} 步`)
  if (p.cfg != null) parts.push(`CFG ${p.cfg}`)
  if (p.clipSkip) parts.push(`Clip skip ${p.clipSkip}`)
  if (fooocus && p.fooocusStyles?.length) parts.push(`风格 ${p.fooocusStyles.join(' + ')}`)
  return parts.join('，') || '—'
}

function scripts(provider: string, serviceType: 'image' | 'video') {
  const d = describeStyleModelCatalog(provider, serviceType)!
  w('<details><summary>macOS / Linux（bash）</summary>', '', '```bash', d.scripts_all.bash, '```', '', '</details>', '')
  w('<details><summary>Windows（PowerShell）</summary>', '', '```powershell', d.scripts_all.powershell, '```', '', '</details>', '')
}

w(
  '# 视觉风格 → 本地模型对应表',
  '',
  '> 本文由 `backend/scripts/gen-style-models-doc.ts` 根据 `backend/src/services/adapters/style-model-catalog.ts` 生成，请勿手改。',
  '',
  '项目「视觉风格」（新建项目 / 项目设置里的下拉框）决定整部剧的画风。使用本地服务（Stable Diffusion WebUI、ComfyUI、Fooocus）时，',
  '打开 **设置 → AI 服务 → 编辑本地服务配置 → 视觉风格 → 模型 → 按项目视觉风格自动切换模型**，生成时会按项目风格自动换成下表对应的',
  'Checkpoint、风格 LoRA、触发词和推荐参数。设置页里可以逐个风格覆盖文件名 / 权重 / 触发词，「检查本机是否已下载」会对照本机模型列表标出缺失文件，',
  '每个风格都有可直接复制的下载命令。',
  '',
  '| 风格值 | 名称 |',
  '| --- | --- |',
  ...STYLE_KEYS.map((k) => `| \`${k}\` | ${STYLE_LABELS[k]} |`),
  '',
  '**规则**',
  '',
  '- 默认关闭：没下载模型前开启会导致服务报「找不到模型」。',
  '- 你在配置里明确填写的步数、CFG、采样器、基准尺寸、负向提示词、Fooocus 风格优先于推荐值；没填才用推荐值。',
  '- 触发词自动加在提示词最前面（已包含就不重复）。',
  '- LoRA 填 `none` 表示该风格不用 LoRA；覆盖里的文件名必须与服务模型目录里的文件名一致（ComfyUI 子目录写成 `子目录/文件名`）。',
  '- **许可**：默认推荐只用 ✅ 可商用 或 ⚠️ 有条件可用的模型（条件写在每张表下面，最常见的是「可以卖图，但不能把模型做成收费生图服务」）；⛔ 非商用 / 需作者授权的模型（如 GuoFeng4、Juggernaut、Jhyd）只放在「可选替代」，不在下载命令里。许可按 2026-10 的模型页面核对，作者可能修改条款，商用前请以模型页为准，本文不构成法律意见。',
  '- 所有生图底模都是 SDXL 1.0 生态（显存 8GB 起，推荐 12GB）。风格 LoRA 都是按 SDXL 1.0 训练的，换别的 SDXL 底模也能用，但效果需要自己试。',
  '',
)

// ─── SD WebUI ────────────────────────────────────────────────
w('## 一、Stable Diffusion WebUI（模型来自 Civitai）', '')
w(
  '适用 AUTOMATIC1111 / Forge（启动参数加 `--api`）。Checkpoint 放 `models/Stable-diffusion/`，LoRA 放 `models/Lora/`。',
  '',
  '| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 | 许可 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
)
for (const k of STYLE_KEYS) {
  const p = STYLE_MODEL_CATALOG.sdwebui[k]
  w(`| ${STYLE_LABELS[k]} | ${link(p.checkpoint)}<br>${code(p.checkpoint.file)} | ${p.lora ? `${link(p.lora)}<br>${code(p.lora.file)}` : '不需要'} | ${p.lora?.weight ?? '—'} | ${esc(p.lora?.trigger || p.trigger || p.checkpoint.trigger) || '—'} | ${paramText(p.params)} | ${lic(worstLicense([p.checkpoint, p.lora]))} |`)
}
w('')
licenseNotes('sdwebui')
w('', '**接口调用**（UU889-Drama 实际发送的请求，以「韩系网漫」为例）：', '', '```http')
const wt = STYLE_MODEL_CATALOG.sdwebui.webtoon
w(
  'POST http://127.0.0.1:7860/sdapi/v1/txt2img',
  'Content-Type: application/json',
  '',
  json({
    prompt: `${wt.lora!.trigger}, a boy standing in the rain, night street <lora:${wt.lora!.file.replace(/\.safetensors$/, '')}:${wt.lora!.weight}>`,
    negative_prompt: wt.params!.negative,
    width: 1344, height: 768, steps: wt.params!.steps, cfg_scale: wt.params!.cfg, seed: -1,
    sampler_name: wt.params!.sampler, scheduler: wt.params!.scheduler,
    override_settings: { sd_model_checkpoint: wt.checkpoint.file },
  }),
  '```',
  '',
  '- `override_settings.sd_model_checkpoint`：切换底模（WebUI 会先加载模型，第一次较慢）。',
  '- `<lora:文件名(不含扩展名):权重>`：写在提示词里挂 LoRA；Clip skip 写 `override_settings.CLIP_stopAtLastLayers`。',
  '- 旧版 WebUI 没有 `scheduler` 字段时，采样器写成 `DPM++ 2M Karras` 这种合并名称。',
  '',
  '**下载**（Civitai 直链 `https://civitai.com/api/download/models/<模型版本 ID>`，需要登录的模型带 `?token=<API Key>`）：',
  '',
)
scripts('sdwebui', 'image')

// ─── ComfyUI / Fooocus 生图 ──────────────────────────────────
w('## 二、ComfyUI 生图 / Fooocus（模型来自 Hugging Face）', '')
w(
  `ComfyUI：Checkpoint 放 \`${MODEL_FOLDERS.comfyui.checkpoint}/\`，LoRA 放 \`${MODEL_FOLDERS.comfyui.lora}/\`。`,
  `Fooocus-API：Checkpoint 放 \`${MODEL_FOLDERS.fooocus.checkpoint}/\`，LoRA 放 \`${MODEL_FOLDERS.fooocus.lora}/\`（单独安装的 Fooocus 是 \`models/checkpoints\` 与 \`models/loras\`）。`,
  '',
  '| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 / Fooocus 风格 | 许可 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
)
for (const k of STYLE_KEYS) {
  const p = STYLE_MODEL_CATALOG.hf_image[k]
  w(`| ${STYLE_LABELS[k]} | ${link(p.checkpoint)}<br>${code(p.checkpoint.file)} | ${p.lora ? `${link(p.lora)}<br>${code(p.lora.file)}` : '不需要'} | ${p.lora?.weight ?? '—'} | ${esc(p.lora?.trigger || p.trigger || p.checkpoint.trigger) || '—'} | ${paramText(p.params, true)} | ${lic(worstLicense([p.checkpoint, p.lora]))} |`)
}
w('')
licenseNotes('hf_image')
const gh = STYLE_MODEL_CATALOG.hf_image.ghibli
w(
  '',
  '**ComfyUI 接口调用**：用内置 SDXL 模板（开启后固定用 SDXL 模板；自定义工作流也可以，风格 Checkpoint 会写进 `CheckpointLoaderSimple`），',
  '在 Checkpoint 后插入 `LoraLoader`，原来接 Checkpoint 的 MODEL / CLIP 连线改接 LoRA：',
  '',
  '```json',
  json({
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: gh.checkpoint.file } },
    '1001': { class_type: 'LoraLoader', inputs: { lora_name: gh.lora!.file, strength_model: gh.lora!.weight, strength_clip: gh.lora!.weight, model: ['4', 0], clip: ['4', 1] }, _meta: { title: '风格 LoRA' } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: `${gh.lora!.trigger}, a forest spirit beside a girl`, clip: ['1001', 1] } },
    '3': { class_type: 'KSampler', inputs: { model: ['1001', 0], steps: gh.params!.steps, cfg: gh.params!.cfg, '…': '…' } },
  }),
  '```',
  '',
  '提交：`POST http://127.0.0.1:8188/prompt`，body `{ "prompt": <上面的工作流>, "client_id": "…" }`，结果在 `/history/{prompt_id}`，图片用 `/view` 下载。',
  '',
)
const nr = STYLE_MODEL_CATALOG.hf_image.noir
w(
  '**Fooocus-API 接口调用**（以「黑白漫画」为例）：',
  '',
  '```http',
  'POST http://127.0.0.1:8888/v1/generation/text-to-image',
  'Content-Type: application/json',
  '',
  json({
    prompt: `${nr.lora!.trigger}, a detective in a rainy alley`,
    negative_prompt: nr.params!.negative,
    style_selections: nr.params!.fooocusStyles,
    performance_selection: 'Speed',
    aspect_ratios_selection: '1344*768',
    base_model_name: nr.checkpoint.file,
    loras: [{ enabled: true, model_name: nr.lora!.file, weight: nr.lora!.weight }],
    guidance_scale: nr.params!.cfg,
    async_process: true,
  }),
  '```',
  '',
  '- `loras` 会替换 Fooocus 默认 LoRA（不需要 LoRA 的风格传空列表，避免默认的写实增强 LoRA 拉偏画风）。',
  '- 有参考图时改用 `/v2/generation/text-to-image-with-ip`，参数相同。',
  '',
  '**下载**（Hugging Face 直链 `https://huggingface.co/<仓库>/resolve/main/<文件>`；国内把域名换成 `https://hf-mirror.com`，或 `export HF_ENDPOINT=https://hf-mirror.com`）：',
  '',
  '### ComfyUI',
  '',
)
scripts('comfyui', 'image')
w('### Fooocus-API', '')
scripts('fooocus', 'image')
w(
  '也可以用 Hugging Face 官方命令行（会保留仓库里的原文件名，文件名带空格的需要自己改名）：',
  '',
  '```bash',
  'pip install -U "huggingface_hub[cli]"',
  `huggingface-cli download ${STYLE_MODEL_CATALOG.hf_image.anime.checkpoint.page.replace('https://huggingface.co/', '')} ${STYLE_MODEL_CATALOG.hf_image.anime.checkpoint.file} --local-dir "$COMFY_DIR/${MODEL_FOLDERS.comfyui.checkpoint}"`,
  '```',
  '',
)

// ─── ComfyUI 视频 ─────────────────────────────────────────────
w('## 三、ComfyUI 生视频（Wan 2.2 + 风格 LoRA，来自 Hugging Face）', '')
w(
  '画风主要由**首帧**决定：先用上面的风格生图模型出分镜图，再用 Wan 2.2 图生视频；风格 LoRA 挂在 14B **低噪声**模型上稳住画风。',
  'Wan 2.1 14B 的 LoRA 与 Wan 2.2 14B 结构相同，可直接挂在 2.2 的低噪声模型上（高噪声模型不挂，避免影响构图和动作）；',
  'Wan 2.2 TI2V 5B 与 MiniMax H3 结构不同，不能挂这些 LoRA，选这些模板时会自动跳过 LoRA，只靠首帧保持画风。',
  '',
  '模板选择：风格覆盖里填的模板 > 配置里选的模板 > 「模型」指向的模板 > 下表推荐模板。',
  '',
  '| 风格 | 推荐模板 | 风格 LoRA（挂低噪声模型） | 权重 | 触发词（自动加） | 说明 | 许可 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
)
for (const k of STYLE_KEYS) {
  const p = STYLE_MODEL_CATALOG.comfyui_video[k]
  w(`| ${STYLE_LABELS[k]} | ${code(p.template)} | ${p.lora ? `${link(p.lora)}<br>${code(p.lora.file)}` : '无合适 LoRA'} | ${p.lora?.weight ?? '—'} | ${esc(p.lora?.trigger) || '—'} | ${esc(p.lora?.note || (p.lora ? '' : p.note.split('：')[0]))} | ${lic(worstLicense([p.lora]))} |`)
}
w('', 'Wan 2.2 / 2.1 基础模型（Comfy-Org 重打包）为 apache-2.0，✅ 可商用。', '')
licenseNotes('comfyui_video')
const tpl = getComfyTemplate('video', 'wan2.2-i2v-14b')!
w(
  '',
  `**${tpl.label}** 需要的基础模型（所有风格共用）：`,
  '',
  '| 文件 | 目录 |',
  '| --- | --- |',
  ...tpl.files.map((f) => `| [${f.file}](${f.url}) | \`${f.folder}\` |`),
  '',
  '**加速（可选）**：Wan 2.2 Lightning 4 步 LoRA（Comfy-Org 重打包，`split_files/loras/`）—— `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` / `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`，',
  '分别挂高 / 低噪声模型、强度 1.0，两段采样共 4 步、CFG 1。需要用自定义工作流接入（风格 LoRA 会自动接在已有 LoRA 之后）。',
  '',
  '**接口调用**：内置模板的低噪声模型后插入 `LoraLoaderModelOnly`：',
  '',
  '```json',
  json({
    '38': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    '1001': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: STYLE_MODEL_CATALOG.comfyui_video['3d'].lora!.file, strength_model: 0.8, model: ['38', 0] }, _meta: { title: '风格 LoRA' } },
    '…': '原来接 ["38", 0] 的 ModelSamplingSD3 改接 ["1001", 0]',
  }),
  '```',
  '',
  '**下载**：',
  '',
)
scripts('comfyui', 'video')

// ─── 自动下载 ─────────────────────────────────────────────────
w(
  '## 四、一键 / 自动下载（本机与远程）',
  '',
  '不想手动敲命令时，在 **设置 → AI 服务 → 编辑 ComfyUI / SD WebUI / Fooocus 配置 → 一键下载模型** 里完成：',
  '',
  '1. **工作方式**：',
  '   - **本机**：运行 UU889-Drama 的这台电脑（Windows / macOS / Linux）。下载由 UU889-Drama 后台完成，关掉设置窗口 / 浏览器页面也会继续；程序重启后自动接着下。',
  '   - **远程（SSH）**：填主机、端口、用户名，选 **账号密码登录** 或 **证书登录（私钥）**。支持 Windows（需安装「OpenSSH 服务器」，Windows 10 1803+ 自带 curl.exe）、macOS（「系统设置 → 通用 → 共享 → 远程登录」）、Linux（openssh-server）；macOS 与 Linux 两种登录方式都支持（密码登录兼容只开 keyboard-interactive 的 macOS 默认配置）。证书登录可粘贴或「选择私钥文件…」，支持 OpenSSH（id_ed25519 / id_rsa / id_ecdsa）、PEM（云服务器下发的 .pem / .key）、PKCS#8、PuTTY .ppk（v2 / v3，有密码的 v3 需先导出 OpenSSH 格式），有密码的私钥填「私钥密码」；对应公钥需在远程用户的 `~/.ssh/authorized_keys` 里。测试连接会显示主机指纹（SHA256）供核对。暂不支持 CA 签发的 OpenSSH 证书（-cert.pub）。UU889-Drama 把下载脚本放到远程机器后台运行（macOS / Linux 用 nohup + curl，Windows 用 WMI 启动 PowerShell + curl.exe），**关掉 UU889-Drama、断网也会在远程继续下完**，再打开时自动接上进度。',
  '2. **安装根目录**：点「自动识别」——先问正在运行的服务（ComfyUI `/internal/folder_paths`、SD WebUI `/sdapi/v1/cmd-flags`），再在常见位置按特征文件扫描（ComfyUI 的 main.py + comfy/、ComfyUI Desktop 的 models + custom_nodes + user、SD WebUI / Forge 的 webui.py + modules/、Fooocus-API 的 fooocusapi/、Fooocus 的 entry_with_update.py）；找不到就点「选择目录…」（桌面版本机用系统对话框，其余用目录浏览）。',
  '3. **风格**：默认选中项目正在用的视觉风格，也可以全选。点「检查缺少的模型」列出每个文件的目标位置、来源顺序和状态（已有 / 缺少 / 下了一半 / 文件不完整），并检查磁盘剩余空间。',
  '4. **下载**：只下缺少的文件，显示总进度条和每个文件的进度、速度、剩余时间、当前来源；可暂停 / 继续 / 取消。',
  '5. **生成时自动下载**（可选）：开启后，生成图片 / 视频前先检查当前项目风格需要的模型，缺了就自动下载（任务进度里显示「正在下载风格模型 xx%」），下完自动开始生成。',
  '',
  '**下载来源与顺序**（每个来源重试 3 次，失败换下一个；所有来源内容相同，换来源时接着已下载的部分续传）：',
  '',
  '1. Hugging Face 原站 `https://huggingface.co/<仓库>/resolve/main/<文件>`',
  '2. Hugging Face 镜像 `https://hf-mirror.com/<仓库>/resolve/main/<文件>`（勾选「优先使用国内镜像」时排在第 1）',
  '3. Civitai `https://civitai.com/api/download/models/<版本 ID>`（**Civitai 现在下载任何模型都需要 API Key**，用 `Authorization: Bearer` 发送，不会发给镜像）',
  '4. Civitai 镜像 CivArchive `https://civarchive.com/api/download/models/<版本 ID>`（跳转到它收录的同哈希镜像）',
  '',
  'Civitai 上的模型如果在 Hugging Face 有 **SHA256 完全相同** 的副本（如 Animagine XL 4.0、SDXL 官方底模、ProtoVision XL、LineAniRedmond、Manhwa Artstyle、儿童绘本 LoRA、Samaritan 3D），会先从 Hugging Face / hf-mirror 下载，不需要 Civitai Key。',
  '',
  '**校验**：先下载到 `<文件>.uu889part`，用 HTTP Range 断点续传（90 秒没数据自动重连），下完核对字节数和 SHA256，一致才改名为正式文件；不一致删除后换下一个来源。已存在且大小正确的文件直接跳过。下载完成后自动让 SD WebUI / Fooocus 刷新模型列表（ComfyUI 会自动重新扫描）。',
  '',
  '**安全**：远程登录信息和 Token 只保存在本机数据目录（配置表 + `model-downloads/jobs.json`），不会发给任何下载站。服务器部署时如不希望网页操作服务器本机文件，设环境变量 `MODEL_INSTALLER_LOCAL=0`（只保留远程模式）。',
  '',
)

writeFileSync(resolve(import.meta.dirname, '../../docs/style-models.md'), out.join('\n'))
console.log('docs/style-models.md written')
