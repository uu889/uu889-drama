# 视觉风格 → 本地模型对应表

> 本文由 `backend/scripts/gen-style-models-doc.ts` 根据 `backend/src/services/adapters/style-model-catalog.ts` 生成，请勿手改。

项目「视觉风格」（新建项目 / 项目设置里的下拉框）决定整部剧的画风。使用本地服务（Stable Diffusion WebUI、ComfyUI、Fooocus）时，
打开 **设置 → AI 服务 → 编辑本地服务配置 → 视觉风格 → 模型 → 按项目视觉风格自动切换模型**，生成时会按项目风格自动换成下表对应的
Checkpoint、风格 LoRA、触发词和推荐参数。设置页里可以逐个风格覆盖文件名 / 权重 / 触发词，「检查本机是否已下载」会对照本机模型列表标出缺失文件，
每个风格都有可直接复制的下载命令。

| 风格值 | 名称 |
| --- | --- |
| `3d` | 3D 漫剧 |
| `anime` | 日漫赛璐璐 |
| `ghibli` | 吉卜力手绘 |
| `watercolor` | 水彩绘本 |
| `comic` | 美式漫画 |
| `guofeng` | 国风 2.5D |
| `webtoon` | 韩系网漫 |
| `noir` | 黑白漫画 |

**规则**

- 默认关闭：没下载模型前开启会导致服务报「找不到模型」。
- 你在配置里明确填写的步数、CFG、采样器、基准尺寸、负向提示词、Fooocus 风格优先于推荐值；没填才用推荐值。
- 触发词自动加在提示词最前面（已包含就不重复）。
- LoRA 填 `none` 表示该风格不用 LoRA；覆盖里的文件名必须与服务模型目录里的文件名一致（ComfyUI 子目录写成 `子目录/文件名`）。
- **许可**：默认推荐只用 ✅ 可商用 或 ⚠️ 有条件可用的模型（条件写在每张表下面，最常见的是「可以卖图，但不能把模型做成收费生图服务」）；⛔ 非商用 / 需作者授权的模型（如 GuoFeng4、Juggernaut、Jhyd）只放在「可选替代」，不在下载命令里。许可按 2026-10 的模型页面核对，作者可能修改条款，商用前请以模型页为准，本文不构成法律意见。
- 所有生图底模都是 SDXL 1.0 生态（显存 8GB 起，推荐 12GB）。风格 LoRA 都是按 SDXL 1.0 训练的，换别的 SDXL 底模也能用，但效果需要自己试。

## 一、Stable Diffusion WebUI（模型来自 Civitai）

适用 AUTOMATIC1111 / Forge（启动参数加 `--api`）。Checkpoint 放 `models/Stable-diffusion/`，LoRA 放 `models/Lora/`。

| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | [ProtoVision XL（v6.6.0 BakedVAE）](https://civitai.com/models/125703?modelVersionId=265938)<br>`ProtoVisionXL_0.6.6.0.fp16.safetensors` | [Samaritan 3D Cartoon SDXL](https://civitai.com/models/121932?modelVersionId=132727)<br>`samaritan_3d_cartoon_sdxl.safetensors` | 0.8 | 3d cartoon | DPM++ 2M Karras，30 步，CFG 6 | ⚠️ 注意许可 |
| 日漫赛璐璐 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | 不需要 | — | masterpiece, high score, great score, absurdres | Euler a，28 步，CFG 5 | ✅ 可商用 |
| 吉卜力手绘 | [SD XL 1.0（VAE fix，官方底模）](https://civitai.com/models/101055?modelVersionId=128078)<br>`sd_xl_base_1.0_0.9vae.safetensors` | [Studio Ghibli （Art Style Capture） LoRA XL（v2）](https://civitai.com/models/187938?modelVersionId=216231)<br>`studio_ghibli_xl_v2.safetensors` | 0.8 | Studio Ghibli | DPM++ 2M Karras，30 步，CFG 6 | ✅ 可商用 |
| 水彩绘本 | [SD XL 1.0（VAE fix，官方底模）](https://civitai.com/models/101055?modelVersionId=128078)<br>`sd_xl_base_1.0_0.9vae.safetensors` | [Picture-Story Book For Children XL 儿童绘本](https://civitai.com/models/119288?modelVersionId=129548)<br>`picbookXLloraV1.safetensors` | 0.8 | watercolor, picture book, paper texture | DPM++ 2M Karras，30 步，CFG 6，Clip skip 2 | ⚠️ 注意许可 |
| 美式漫画 | [SD XL 1.0（VAE fix，官方底模）](https://civitai.com/models/101055?modelVersionId=128078)<br>`sd_xl_base_1.0_0.9vae.safetensors` | [Comic realism（SDXL）](https://civitai.com/models/219089?modelVersionId=247021)<br>`Comic_realism.safetensors` | 0.5 | a comic book illustration of | DPM++ 2M Karras，30 步，CFG 6 | ✅ 可商用 |
| 国风 2.5D | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | [Chinese style illustration design（ChineseMyth）](https://civitai.com/models/526483?modelVersionId=584967)<br>`Chinese_myth_animagineXLV31.safetensors` | 0.85 | ChineseMyth, chinese style, hanfu, xianxia | DPM++ 2M Karras，22 步，CFG 5 | ✅ 可商用 |
| 韩系网漫 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | [Manhwa Artstyle / Webtoon（SDXL v1.0）](https://civitai.com/models/257995?modelVersionId=290917)<br>`manhwa-artstyle-000018.safetensors` | 0.6 | manhwa-artstyle | DPM++ 2M Karras，28 步，CFG 7 | ⚠️ 注意许可 |
| 黑白漫画 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | [LineAniRedmond 线稿漫画（v2.0 SDXL）](https://civitai.com/models/127018?modelVersionId=177544)<br>`LineAniRedmondV2-Lineart-LineAniAF.safetensors` | 0.8 | lineart, LineAniAF, monochrome, greyscale, manga, screentone | Euler a，28 步，CFG 5 | ✅ 可商用 |

**许可**（以「用生成的图 / 视频做商业短剧」为准；✅ 可商用无需授权，⚠️ 可以用但有条件或来源不清，⛔ 非商用或需作者授权）：

| 模型 | 许可 | 等级 | 说明 |
| --- | --- | --- | --- |
| [ProtoVision XL（v6.6.0 BakedVAE）](https://civitai.com/models/125703?modelVersionId=265938) | CreativeML Open RAIL++-M | ⚠️ 注意许可 | 允许出售生成的图片；但不允许把模型部署成收费的生图服务（对外按次 / 按量收费），本地自用做短剧不受影响 |
| [Samaritan 3D Cartoon SDXL](https://civitai.com/models/121932?modelVersionId=132727) | CreativeML Open RAIL++-M | ⚠️ 注意许可 | 允许出售生成的图片；但不允许把模型部署成收费的生图服务（对外按次 / 按量收费），本地自用做短剧不受影响 |
| [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658) | Animagine XL 4.0 License（CreativeML Open RAIL++-M，明确允许商用） | ✅ 可商用 | — |
| [SD XL 1.0（VAE fix，官方底模）](https://civitai.com/models/101055?modelVersionId=128078) | CreativeML Open RAIL++-M | ✅ 可商用 | — |
| [Studio Ghibli （Art Style Capture） LoRA XL（v2）](https://civitai.com/models/187938?modelVersionId=216231) | CreativeML Open RAIL++-M | ✅ 可商用 | — |
| [Picture-Story Book For Children XL 儿童绘本](https://civitai.com/models/119288?modelVersionId=129548) | CreativeML Open RAIL++-M | ⚠️ 注意许可 | 允许出售生成的图片；但不允许把模型部署成收费的生图服务（对外按次 / 按量收费），本地自用做短剧不受影响 |
| [Comic realism（SDXL）](https://civitai.com/models/219089?modelVersionId=247021) | CreativeML Open RAIL++-M | ✅ 可商用 | — |
| [Chinese style illustration design（ChineseMyth）](https://civitai.com/models/526483?modelVersionId=584967) | CreativeML Open RAIL++-M | ✅ 可商用 | — |
| [Manhwa Artstyle / Webtoon（SDXL v1.0）](https://civitai.com/models/257995?modelVersionId=290917) | CreativeML Open RAIL++-M | ⚠️ 注意许可 | 允许出售生成的图片；但不允许把模型部署成收费的生图服务（对外按次 / 按量收费），本地自用做短剧不受影响 |
| [LineAniRedmond 线稿漫画（v2.0 SDXL）](https://civitai.com/models/127018?modelVersionId=177544) | CreativeML Open RAIL++-M | ✅ 可商用 | — |

**可选替代**（不在默认推荐和下载命令里；需要时在设置页「覆盖」里填文件名，⚠️ / ⛔ 的请先确认授权）：

| 风格 | 模型 | 许可等级 | 说明 |
| --- | --- | --- | --- |
| 吉卜力手绘 | [AlbedoBase XL（v3.1 Large）](https://civitai.com/models/140737?modelVersionId=1041855)<br>`albedobaseXL_v31Large.safetensors` | ⚠️ 注意许可 | 可出售图片、可做付费服务，但要求署名（注明使用 AlbedoBase XL 并附许可链接） |
| 美式漫画 | [GraphicNovel_LineArt（SDXL）](https://civitai.com/models/1111750?modelVersionId=1249232)<br>`GraphicNovel_LineArt.safetensors` | ✅ 可商用 | 更强调漫画 / 图像小说的描线，无触发词 |
| 美式漫画 | [Comic style SDXL - Jhyd](https://civitai.com/models/134144?modelVersionId=147719)<br>`jhyd-step00001000.smaller.safetensors` | ⛔ 需授权 / 非商用 | 禁止出售生成的图片、禁止做付费服务，并要求署名 CowKing；商用需联系作者授权 |
| 国风 2.5D | [Starlight XL 星光 Animated（v3，2.5D）](https://civitai.com/models/143043?modelVersionId=182077)<br>`starlightXLAnimated_v3.safetensors` | ⚠️ 注意许可 | 可出售图片、可做付费服务，但要求署名 chillpixel，且不允许分享融合模型 |
| 国风 2.5D | [国风4 GuoFeng4 XL（v1.2 fp16）](https://civitai.com/models/118009?modelVersionId=199325)<br>`GuoFeng4.2Fp16.safetensors` | ⛔ 需授权 / 非商用 | 附加条款禁止出售或授权生成的图片（含游戏、书籍等），也禁止付费服务；商用需联系作者授权 |


**接口调用**（UU889-Drama 实际发送的请求，以「韩系网漫」为例）：

```http
POST http://127.0.0.1:7860/sdapi/v1/txt2img
Content-Type: application/json

{
  "prompt": "manhwa-artstyle, a boy standing in the rain, night street <lora:manhwa-artstyle-000018:0.6>",
  "negative_prompt": "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry",
  "width": 1344,
  "height": 768,
  "steps": 28,
  "cfg_scale": 7,
  "seed": -1,
  "sampler_name": "DPM++ 2M",
  "scheduler": "Karras",
  "override_settings": {
    "sd_model_checkpoint": "animagine-xl-4.0-opt.safetensors"
  }
}
```

- `override_settings.sd_model_checkpoint`：切换底模（WebUI 会先加载模型，第一次较慢）。
- `<lora:文件名(不含扩展名):权重>`：写在提示词里挂 LoRA；Clip skip 写 `override_settings.CLIP_stopAtLastLayers`。
- 旧版 WebUI 没有 `scheduler` 字段时，采样器写成 `DPM++ 2M Karras` 这种合并名称。

**下载**（Civitai 直链 `https://civitai.com/api/download/models/<模型版本 ID>`，需要登录的模型带 `?token=<API Key>`）：

<details><summary>macOS / Linux（bash）</summary>

```bash
# 安装目录（按实际路径修改）
export SD_DIR=~/stable-diffusion-webui
# Civitai API Key（civitai.com → 头像 → Account settings → API Keys）：Civitai 现在下载任何模型都要 Key
export CIVITAI_TOKEN=
# 国内网络可改用镜像：export HF_ENDPOINT=https://hf-mirror.com
export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}
mkdir -p "$SD_DIR/models/Stable-diffusion" "$SD_DIR/models/Lora"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/ProtoVisionXL_0.6.6.0.fp16.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/JoshuaChak/SD-WebUI-Safetensors/resolve/main/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors"
curl -L -C - -o "$SD_DIR/models/Lora/samaritan_3d_cartoon_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/openartai/model_hub_loras/resolve/main/Samaritan%203d%20Cartoon%20SDXL.safetensors"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/animagine-xl-4.0-opt.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/sd_xl_base_1.0_0.9vae.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors"
curl -L -C - -H "Authorization: Bearer $CIVITAI_TOKEN" -o "$SD_DIR/models/Lora/studio_ghibli_xl_v2.safetensors" "https://civitai.com/api/download/models/216231"
curl -L -C - -o "$SD_DIR/models/Lora/picbookXLloraV1.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/picture-story-book-for-children-xl-xl/resolve/main/picture-story-book-for-children-xl-xl.safetensors"
curl -L -C - -H "Authorization: Bearer $CIVITAI_TOKEN" -o "$SD_DIR/models/Lora/Comic_realism.safetensors" "https://civitai.com/api/download/models/247021"
curl -L -C - -H "Authorization: Bearer $CIVITAI_TOKEN" -o "$SD_DIR/models/Lora/Chinese_myth_animagineXLV31.safetensors" "https://civitai.com/api/download/models/584967"
curl -L -C - -o "$SD_DIR/models/Lora/manhwa-artstyle-000018.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
curl -L -C - -o "$SD_DIR/models/Lora/LineAniRedmondV2-Lineart-LineAniAF.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2/resolve/main/LineAniRedmondV2-Lineart-LineAniAF.safetensors"
```

</details>

<details><summary>Windows（PowerShell）</summary>

```powershell
# 安装目录（按实际路径修改）
$env:SD_DIR = "D:\stable-diffusion-webui"
# Civitai API Key：Civitai 现在下载任何模型都要 Key
$env:CIVITAI_TOKEN = ""
# 国内网络可改用镜像："https://hf-mirror.com"
$hf = if ($env:HF_ENDPOINT) { $env:HF_ENDPOINT } else { "https://huggingface.co" }
New-Item -ItemType Directory -Force -Path "$env:SD_DIR\models\Stable-diffusion" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:SD_DIR\models\Lora" | Out-Null
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\ProtoVisionXL_0.6.6.0.fp16.safetensors" "$hf/JoshuaChak/SD-WebUI-Safetensors/resolve/main/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\samaritan_3d_cartoon_sdxl.safetensors" "$hf/openartai/model_hub_loras/resolve/main/Samaritan%203d%20Cartoon%20SDXL.safetensors"
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\animagine-xl-4.0-opt.safetensors" "$hf/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\sd_xl_base_1.0_0.9vae.safetensors" "$hf/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0_0.9vae.safetensors"
curl.exe -L -C - -H "Authorization: Bearer $env:CIVITAI_TOKEN" -o "$env:SD_DIR\models\Lora\studio_ghibli_xl_v2.safetensors" "https://civitai.com/api/download/models/216231"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\picbookXLloraV1.safetensors" "$hf/Muapi/picture-story-book-for-children-xl-xl/resolve/main/picture-story-book-for-children-xl-xl.safetensors"
curl.exe -L -C - -H "Authorization: Bearer $env:CIVITAI_TOKEN" -o "$env:SD_DIR\models\Lora\Comic_realism.safetensors" "https://civitai.com/api/download/models/247021"
curl.exe -L -C - -H "Authorization: Bearer $env:CIVITAI_TOKEN" -o "$env:SD_DIR\models\Lora\Chinese_myth_animagineXLV31.safetensors" "https://civitai.com/api/download/models/584967"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\manhwa-artstyle-000018.safetensors" "$hf/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\LineAniRedmondV2-Lineart-LineAniAF.safetensors" "$hf/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2/resolve/main/LineAniRedmondV2-Lineart-LineAniAF.safetensors"
```

</details>

## 二、ComfyUI 生图 / Fooocus（模型来自 Hugging Face）

ComfyUI：Checkpoint 放 `models/checkpoints/`，LoRA 放 `models/loras/`。
Fooocus-API：Checkpoint 放 `repositories/Fooocus/models/checkpoints/`，LoRA 放 `repositories/Fooocus/models/loras/`（单独安装的 Fooocus 是 `models/checkpoints` 与 `models/loras`）。

| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 / Fooocus 风格 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [3D Render Style XL](https://huggingface.co/goofyai/3d_render_style_xl)<br>`3d_render_style_xl.safetensors` | 0.8 | 3d style, 3d render | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 + SAI 3D Model | ✅ 可商用 |
| 日漫赛璐璐 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | 不需要 | — | masterpiece, high score, great score, absurdres | Euler a，28 步，CFG 5，风格 Fooocus V2 + SAI Anime | ✅ 可商用 |
| 吉卜力手绘 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Anime Ghibli Soft](https://huggingface.co/strkyyy/anime-ghibli-soft)<br>`anime-ghibli-soft.safetensors` | 0.85 | gh1bl1st, hand-drawn anime film, soft watercolor background | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 | ✅ 可商用 |
| 水彩绘本 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Watercolor Style LoRA SDXL（ostris）](https://huggingface.co/ostris/watercolor_style_lora_sdxl)<br>`watercolor_v1_sdxl.safetensors` | 1 | watercolor, picture book illustration | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 + Artstyle Watercolor | ✅ 可商用 |
| 美式漫画 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Comic Ink Halftone](https://huggingface.co/strkyyy/comic-ink-halftone)<br>`comic-ink-halftone.safetensors` | 0.85 | c0m1cink, comic book, bold ink outlines, halftone | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 + SAI Comic Book | ✅ 可商用 |
| 国风 2.5D | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | [Chinese Ink Painting LoRA SDXL](https://huggingface.co/ming-yang/sdxl_chinese_ink_lora)<br>`Chinese_Ink_Painting_Lora_SDXL.safetensors` | 0.6 | Chinese Ink, chinese style, hanfu, xianxia | Euler a，28 步，CFG 5，风格 Fooocus V2 | ✅ 可商用 |
| 韩系网漫 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | 不需要 | — | korean webtoon, manhwa, semi-realistic, soft cel shading, clean lineart | Euler a，28 步，CFG 6，风格 Fooocus V2 + SAI Anime | ✅ 可商用 |
| 黑白漫画 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | [Manga Ink Screentone](https://huggingface.co/strkyyy/manga-ink-screentone)<br>`manga-ink-screentone.safetensors` | 0.85 | m4ng41nk, monochrome, greyscale, manga, screentone | Euler a，28 步，CFG 5，风格 Fooocus V2 + MRE Manga | ✅ 可商用 |

**许可**（以「用生成的图 / 视频做商业短剧」为准；✅ 可商用无需授权，⚠️ 可以用但有条件或来源不清，⛔ 非商用或需作者授权）：

| 模型 | 许可 | 等级 | 说明 |
| --- | --- | --- | --- |
| [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) | openrail++ | ✅ 可商用 | — |
| [3D Render Style XL](https://huggingface.co/goofyai/3d_render_style_xl) | apache-2.0 | ✅ 可商用 | — |
| [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0) | openrail++（明确允许商用） | ✅ 可商用 | — |
| [Anime Ghibli Soft](https://huggingface.co/strkyyy/anime-ghibli-soft) | openrail++ | ✅ 可商用 | — |
| [Watercolor Style LoRA SDXL（ostris）](https://huggingface.co/ostris/watercolor_style_lora_sdxl) | apache-2.0 | ✅ 可商用 | — |
| [Comic Ink Halftone](https://huggingface.co/strkyyy/comic-ink-halftone) | openrail++ | ✅ 可商用 | — |
| [Chinese Ink Painting LoRA SDXL](https://huggingface.co/ming-yang/sdxl_chinese_ink_lora) | creativeml-openrail-m | ✅ 可商用 | — |
| [Manga Ink Screentone](https://huggingface.co/strkyyy/manga-ink-screentone) | openrail++ | ✅ 可商用 | — |

**可选替代**（不在默认推荐和下载命令里；需要时在设置页「覆盖」里填文件名，⚠️ / ⛔ 的请先确认授权）：

| 风格 | 模型 | 许可等级 | 说明 |
| --- | --- | --- | --- |
| 3D 漫剧 | [Juggernaut XL v9](https://huggingface.co/RunDiffusion/Juggernaut-XL-v9)<br>`Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors` | ⛔ 需授权 / 非商用 | 作者声明：部署成付费 API / 收费生成服务需要 RunDiffusion 单独授权（juggernaut@rundiffusion.com） |
| 吉卜力手绘 | [Studio Ghibli Style（KappaNeuro）](https://huggingface.co/KappaNeuro/studio-ghibli-style)<br>`studio_ghibli_style_sdxl.safetensors` | ⛔ 需授权 / 非商用 | 许可写的是 other 但没有任何条款，转自 Civitai 106712；商用前需联系作者确认 |
| 美式漫画 | [Graphic Novel Illustration](https://huggingface.co/blink7630/graphic-novel-illustration)<br>`Graphic_Novel_Illustration-000007.safetensors` | ⛔ 需授权 / 非商用 | 许可写的是 other 但没有任何条款，商用前需联系作者确认 |
| 国风 2.5D | [国风4 GuoFeng4.1 2.5D XL](https://huggingface.co/xiaolxl/GuoFeng4_XL)<br>`GuoFeng4.1_2.5D.safetensors` | ⛔ 需授权 / 非商用 | 非商用许可（CC BY-NC-SA 4.0）：生成的图不能用于商业用途，商用需联系作者授权；其他网站标成 openrail 的转载版本同样不能当作可商用 |
| 韩系网漫 | [Anime Cel Shaded](https://huggingface.co/strkyyy/anime-cel-shaded)<br>`anime-cel-shaded.safetensors` | ✅ 可商用 | 赛璐璐上色，接近网漫但不是韩漫专用。作者卡片未说明训练数据，效果请先出几张图确认 |
| 韩系网漫 | [Manhwa Artstyle Webtoon LoRA（Muapi 转载）](https://huggingface.co/Muapi/manhwa-artstyle-webtoon-lora)<br>`manhwa-artstyle-webtoon-lora.safetensors` | ⛔ 需授权 / 非商用 | 转载账号，未注明原作者和原许可，无法确认是否允许商用 |


**ComfyUI 接口调用**：用内置 SDXL 模板（开启后固定用 SDXL 模板；自定义工作流也可以，风格 Checkpoint 会写进 `CheckpointLoaderSimple`），
在 Checkpoint 后插入 `LoraLoader`，原来接 Checkpoint 的 MODEL / CLIP 连线改接 LoRA：

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["1001", 0],
      "steps": 30,
      "cfg": 6,
      "…": "…"
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "sd_xl_base_1.0.safetensors"
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "gh1bl1st, hand-drawn anime film, soft watercolor background, a forest spirit beside a girl",
      "clip": ["1001", 1]
    }
  },
  "1001": {
    "class_type": "LoraLoader",
    "inputs": {
      "lora_name": "anime-ghibli-soft.safetensors",
      "strength_model": 0.85,
      "strength_clip": 0.85,
      "model": ["4", 0],
      "clip": ["4", 1]
    },
    "_meta": {
      "title": "风格 LoRA"
    }
  }
}
```

提交：`POST http://127.0.0.1:8188/prompt`，body `{ "prompt": <上面的工作流>, "client_id": "…" }`，结果在 `/history/{prompt_id}`，图片用 `/view` 下载。

**Fooocus-API 接口调用**（以「黑白漫画」为例）：

```http
POST http://127.0.0.1:8888/v1/generation/text-to-image
Content-Type: application/json

{
  "prompt": "m4ng41nk, monochrome, greyscale, manga, screentone, a detective in a rainy alley",
  "negative_prompt": "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, color",
  "style_selections": [
    "Fooocus V2",
    "MRE Manga"
  ],
  "performance_selection": "Speed",
  "aspect_ratios_selection": "1344*768",
  "base_model_name": "animagine-xl-4.0-opt.safetensors",
  "loras": [
    {
      "enabled": true,
      "model_name": "manga-ink-screentone.safetensors",
      "weight": 0.85
    }
  ],
  "guidance_scale": 5,
  "async_process": true
}
```

- `loras` 会替换 Fooocus 默认 LoRA（不需要 LoRA 的风格传空列表，避免默认的写实增强 LoRA 拉偏画风）。
- 有参考图时改用 `/v2/generation/text-to-image-with-ip`，参数相同。

**下载**（Hugging Face 直链 `https://huggingface.co/<仓库>/resolve/main/<文件>`；国内把域名换成 `https://hf-mirror.com`，或 `export HF_ENDPOINT=https://hf-mirror.com`）：

### ComfyUI

<details><summary>macOS / Linux（bash）</summary>

```bash
# 安装目录（按实际路径修改）
export COMFY_DIR=~/ComfyUI
# 国内网络可改用镜像：export HF_ENDPOINT=https://hf-mirror.com
export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}
mkdir -p "$COMFY_DIR/models/checkpoints" "$COMFY_DIR/models/loras"
curl -L -C - -o "$COMFY_DIR/models/checkpoints/sd_xl_base_1.0.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/3d_render_style_xl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl -L -C - -o "$COMFY_DIR/models/checkpoints/animagine-xl-4.0-opt.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/anime-ghibli-soft.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/anime-ghibli-soft/resolve/main/anime-ghibli-soft.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/watercolor_v1_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/comic-ink-halftone.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/comic-ink-halftone/resolve/main/comic-ink-halftone.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/Chinese_Ink_Painting_Lora_SDXL.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ming-yang/sdxl_chinese_ink_lora/resolve/main/Chinese_Ink_Painting_Lora_SDXL.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/manga-ink-screentone.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/manga-ink-screentone/resolve/main/manga-ink-screentone.safetensors"
```

</details>

<details><summary>Windows（PowerShell）</summary>

```powershell
# 安装目录（按实际路径修改）
$env:COMFY_DIR = "D:\ComfyUI"
# 国内网络可改用镜像："https://hf-mirror.com"
$hf = if ($env:HF_ENDPOINT) { $env:HF_ENDPOINT } else { "https://huggingface.co" }
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\checkpoints" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\loras" | Out-Null
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\sd_xl_base_1.0.safetensors" "$hf/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\3d_render_style_xl.safetensors" "$hf/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\animagine-xl-4.0-opt.safetensors" "$hf/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\anime-ghibli-soft.safetensors" "$hf/strkyyy/anime-ghibli-soft/resolve/main/anime-ghibli-soft.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\watercolor_v1_sdxl.safetensors" "$hf/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\comic-ink-halftone.safetensors" "$hf/strkyyy/comic-ink-halftone/resolve/main/comic-ink-halftone.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\Chinese_Ink_Painting_Lora_SDXL.safetensors" "$hf/ming-yang/sdxl_chinese_ink_lora/resolve/main/Chinese_Ink_Painting_Lora_SDXL.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\manga-ink-screentone.safetensors" "$hf/strkyyy/manga-ink-screentone/resolve/main/manga-ink-screentone.safetensors"
```

</details>

### Fooocus-API

<details><summary>macOS / Linux（bash）</summary>

```bash
# 安装目录（按实际路径修改）
export FOOOCUS_DIR=~/Fooocus-API
# 国内网络可改用镜像：export HF_ENDPOINT=https://hf-mirror.com
export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}
mkdir -p "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints" "$FOOOCUS_DIR/repositories/Fooocus/models/loras"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/sd_xl_base_1.0.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/3d_render_style_xl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/animagine-xl-4.0-opt.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/anime-ghibli-soft.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/anime-ghibli-soft/resolve/main/anime-ghibli-soft.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/watercolor_v1_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/comic-ink-halftone.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/comic-ink-halftone/resolve/main/comic-ink-halftone.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/Chinese_Ink_Painting_Lora_SDXL.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ming-yang/sdxl_chinese_ink_lora/resolve/main/Chinese_Ink_Painting_Lora_SDXL.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/manga-ink-screentone.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/strkyyy/manga-ink-screentone/resolve/main/manga-ink-screentone.safetensors"
```

</details>

<details><summary>Windows（PowerShell）</summary>

```powershell
# 安装目录（按实际路径修改）
$env:FOOOCUS_DIR = "D:\Fooocus-API"
# 国内网络可改用镜像："https://hf-mirror.com"
$hf = if ($env:HF_ENDPOINT) { $env:HF_ENDPOINT } else { "https://huggingface.co" }
New-Item -ItemType Directory -Force -Path "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras" | Out-Null
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\sd_xl_base_1.0.safetensors" "$hf/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\3d_render_style_xl.safetensors" "$hf/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\animagine-xl-4.0-opt.safetensors" "$hf/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\anime-ghibli-soft.safetensors" "$hf/strkyyy/anime-ghibli-soft/resolve/main/anime-ghibli-soft.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\watercolor_v1_sdxl.safetensors" "$hf/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\comic-ink-halftone.safetensors" "$hf/strkyyy/comic-ink-halftone/resolve/main/comic-ink-halftone.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\Chinese_Ink_Painting_Lora_SDXL.safetensors" "$hf/ming-yang/sdxl_chinese_ink_lora/resolve/main/Chinese_Ink_Painting_Lora_SDXL.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\manga-ink-screentone.safetensors" "$hf/strkyyy/manga-ink-screentone/resolve/main/manga-ink-screentone.safetensors"
```

</details>

也可以用 Hugging Face 官方命令行（会保留仓库里的原文件名，文件名带空格的需要自己改名）：

```bash
pip install -U "huggingface_hub[cli]"
huggingface-cli download cagliostrolab/animagine-xl-4.0 animagine-xl-4.0-opt.safetensors --local-dir "$COMFY_DIR/models/checkpoints"
```

## 三、ComfyUI 生视频（Wan 2.2 + 风格 LoRA，来自 Hugging Face）

画风主要由**首帧**决定：先用上面的风格生图模型出分镜图，再用 Wan 2.2 图生视频；风格 LoRA 挂在 14B **低噪声**模型上稳住画风。
Wan 2.1 14B 的 LoRA 与 Wan 2.2 14B 结构相同，可直接挂在 2.2 的低噪声模型上（高噪声模型不挂，避免影响构图和动作）；
Wan 2.2 TI2V 5B 与 MiniMax H3 结构不同，不能挂这些 LoRA，选这些模板时会自动跳过 LoRA，只靠首帧保持画风。

模板选择：风格覆盖里填的模板 > 配置里选的模板 > 「模型」指向的模板 > 下表推荐模板。

| 风格 | 推荐模板 | 风格 LoRA（挂低噪声模型） | 权重 | 触发词（自动加） | 说明 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | `wan2.2-i2v-14b` | [3D 动画电影风（Remade-AI）](https://huggingface.co/Remade-AI/Pixar)<br>`pixar_10_epochs.safetensors` | 0.8 | p1x4r_5ty13 Pixar animation style | 作者推荐权重 1.0（Wan 2.1 上），挂在 2.2 低噪声模型上 0.8 起调；触发词里的 Pixar 是商标，只作触发用，不要写进片名 / 宣传文案 | ✅ 可商用 |
| 日漫赛璐璐 | `wan2.2-i2v-14b` | [Flat Color 赛璐璐平涂 v2（motimalu）](https://huggingface.co/motimalu/wan-flat-color-v2)<br>`wan_flat_color_v2.safetensors` | 0.8 | flat color, no lineart | 平涂动画质感 | ⚠️ 注意许可 |
| 吉卜力手绘 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有原作者发布、许可清楚的吉卜力风 Wan LoRA | ✅ 可商用 |
| 水彩绘本 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有合适的水彩绘本 Wan LoRA | ✅ 可商用 |
| 美式漫画 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有原作者发布、许可清楚且适配文生 / 图生 14B 的美漫 Wan LoRA | ✅ 可商用 |
| 国风 2.5D | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有国风 2.5D 动画的 Wan LoRA | ✅ 可商用 |
| 韩系网漫 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有韩漫 / 网漫的 Wan LoRA | ✅ 可商用 |
| 黑白漫画 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有黑白漫画线稿的 Wan LoRA | ✅ 可商用 |

Wan 2.2 / 2.1 基础模型（Comfy-Org 重打包）为 apache-2.0，✅ 可商用。

**许可**（以「用生成的图 / 视频做商业短剧」为准；✅ 可商用无需授权，⚠️ 可以用但有条件或来源不清，⛔ 非商用或需作者授权）：

| 模型 | 许可 | 等级 | 说明 |
| --- | --- | --- | --- |
| [3D 动画电影风（Remade-AI）](https://huggingface.co/Remade-AI/Pixar) | apache-2.0 | ✅ 可商用 | — |
| [Flat Color 赛璐璐平涂 v2（motimalu）](https://huggingface.co/motimalu/wan-flat-color-v2) | apache-2.0 | ⚠️ 注意许可 | 标注 apache-2.0（可商用），但卡片写明「应请求转载自 Civitai」，无法核实上传者就是原作者 |

**可选替代**（不在默认推荐和下载命令里；需要时在设置页「覆盖」里填文件名，⚠️ / ⛔ 的请先确认授权）：

| 风格 | 模型 | 许可等级 | 说明 |
| --- | --- | --- | --- |
| 吉卜力手绘 | [90s Anime M8T（mushroomfleet）](https://huggingface.co/mushroomfleet/wanmagic-M8T-90s-anime)<br>`wan-m8t-style-img-v0p.safetensors` | ⚠️ 注意许可 | 许可可商用，但作者没说明挂高噪声还是低噪声模型、推荐权重，需自己试 |
| 吉卜力手绘 | [Studio Ghibli Wan2.1（Muapi 转载）](https://huggingface.co/Muapi/studio-ghibli-wan2.1-t2v-14b)<br>`studio-ghibli-wan2.1-t2v-14b.safetensors` | ⛔ 需授权 / 非商用 | 转载账号，未注明原作者和原许可，无法确认是否允许商用 |
| 水彩绘本 | [Old Book Illustrations（AdamLucek）](https://huggingface.co/AdamLucek/Wan2.1-T2V-14B-OldBookIllustrations)<br>`oldbookillustrations_adapter.safetensors` | ✅ 可商用 | 复古书籍插画风，不是水彩，但同属绘本质感 |
| 美式漫画 | [Realistic Comicbook Style（maDcaDDie，I2V 480p）](https://huggingface.co/maDcaDDie/realistic_comicbook_style_wan_2_2_i2v_480p-lora)<br>`realistic_comicbook_style_wan_2_2_i2v_480p.safetensors` | ⚠️ 注意许可 | 许可可商用，但按 480p 图生视频训练、没给权重和触发词，挂在 2.2 低噪声模型上的效果未经验证 |
| 美式漫画 | [Comic Book Wan2.1（Muapi 转载）](https://huggingface.co/Muapi/comicbook-wan2.1-t2v-14b)<br>`comicbook-wan2.1-t2v-14b.safetensors` | ⛔ 需授权 / 非商用 | 转载账号，未注明原作者和原许可，无法确认是否允许商用 |
| 国风 2.5D | [Traditional Chinese Paintings（Muapi 转载）](https://huggingface.co/Muapi/wan2.1-traditional-chinese-paintings-style)<br>`wan2.1-traditional-chinese-paintings-style.safetensors` | ⛔ 需授权 / 非商用 | 转载账号，未注明原作者和原许可，无法确认是否允许商用 |
| 黑白漫画 | [Film Noir（Remade-AI）](https://huggingface.co/Remade-AI/Film-Noir)<br>`film_noir_10_epochs.safetensors` | ✅ 可商用 | 真人电影式黑白，不是漫画线稿；想要黑白电影感时可用 |


**Wan 2.2 I2V 14B（图生视频，高质量）** 需要的基础模型（所有风格共用）：

| 文件 | 目录 |
| --- | --- |
| [wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors) | `models/diffusion_models` |
| [wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors) | `models/diffusion_models` |
| [umt5_xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors) | `models/text_encoders` |
| [wan_2.1_vae.safetensors](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors) | `models/vae` |

**加速（可选）**：Wan 2.2 Lightning 4 步 LoRA（Comfy-Org 重打包，`split_files/loras/`）—— `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` / `wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`，
分别挂高 / 低噪声模型、强度 1.0，两段采样共 4 步、CFG 1。需要用自定义工作流接入（风格 LoRA 会自动接在已有 LoRA 之后）。

**接口调用**：内置模板的低噪声模型后插入 `LoraLoaderModelOnly`：

```json
{
  "38": {
    "class_type": "UNETLoader",
    "inputs": {
      "unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
      "weight_dtype": "default"
    }
  },
  "1001": {
    "class_type": "LoraLoaderModelOnly",
    "inputs": {
      "lora_name": "pixar_10_epochs.safetensors",
      "strength_model": 0.8,
      "model": ["38", 0]
    },
    "_meta": {
      "title": "风格 LoRA"
    }
  },
  "…": "原来接 [\"38\", 0] 的 ModelSamplingSD3 改接 [\"1001\", 0]"
}
```

**下载**：

<details><summary>macOS / Linux（bash）</summary>

```bash
# 安装目录（按实际路径修改）
export COMFY_DIR=~/ComfyUI
# 国内网络可改用镜像：export HF_ENDPOINT=https://hf-mirror.com
export HF_ENDPOINT=${HF_ENDPOINT:-https://huggingface.co}
mkdir -p "$COMFY_DIR/models/diffusion_models" "$COMFY_DIR/models/text_encoders" "$COMFY_DIR/models/vae" "$COMFY_DIR/models/loras"
curl -L -C - -o "$COMFY_DIR/models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
curl -L -C - -o "$COMFY_DIR/models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
curl -L -C - -o "$COMFY_DIR/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
curl -L -C - -o "$COMFY_DIR/models/vae/wan_2.1_vae.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/pixar_10_epochs.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Remade-AI/Pixar/resolve/main/pixar_10_epochs.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/wan_flat_color_v2.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/motimalu/wan-flat-color-v2/resolve/main/wan_flat_color_v2.safetensors"
```

</details>

<details><summary>Windows（PowerShell）</summary>

```powershell
# 安装目录（按实际路径修改）
$env:COMFY_DIR = "D:\ComfyUI"
# 国内网络可改用镜像："https://hf-mirror.com"
$hf = if ($env:HF_ENDPOINT) { $env:HF_ENDPOINT } else { "https://huggingface.co" }
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\diffusion_models" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\text_encoders" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\vae" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:COMFY_DIR\models\loras" | Out-Null
curl.exe -L -C - -o "$env:COMFY_DIR\models\diffusion_models\wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors" "$hf/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\diffusion_models\wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors" "$hf/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors" "$hf/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\vae\wan_2.1_vae.safetensors" "$hf/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\pixar_10_epochs.safetensors" "$hf/Remade-AI/Pixar/resolve/main/pixar_10_epochs.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\wan_flat_color_v2.safetensors" "$hf/motimalu/wan-flat-color-v2/resolve/main/wan_flat_color_v2.safetensors"
```

</details>

## 四、一键 / 自动下载（本机与远程）

不想手动敲命令时，在 **设置 → AI 服务 → 编辑 ComfyUI / SD WebUI / Fooocus 配置 → 一键下载模型** 里完成：

1. **工作方式**：
   - **本机**：运行 UU889-Drama 的这台电脑（Windows / macOS / Linux）。下载由 UU889-Drama 后台完成，关掉设置窗口 / 浏览器页面也会继续；程序重启后自动接着下。
   - **远程（SSH）**：填主机、端口、用户名和密码或私钥。支持 Windows（需安装「OpenSSH 服务器」，Windows 10 1803+ 自带 curl.exe）、macOS（「系统设置 → 通用 → 共享 → 远程登录」）、Linux（openssh-server）。UU889-Drama 把下载脚本放到远程机器后台运行（macOS / Linux 用 nohup + curl，Windows 用 WMI 启动 PowerShell + curl.exe），**关掉 UU889-Drama、断网也会在远程继续下完**，再打开时自动接上进度。
2. **安装根目录**：点「自动识别」——先问正在运行的服务（ComfyUI `/internal/folder_paths`、SD WebUI `/sdapi/v1/cmd-flags`），再在常见位置按特征文件扫描（ComfyUI 的 main.py + comfy/、ComfyUI Desktop 的 models + custom_nodes + user、SD WebUI / Forge 的 webui.py + modules/、Fooocus-API 的 fooocusapi/、Fooocus 的 entry_with_update.py）；找不到就点「选择目录…」（桌面版本机用系统对话框，其余用目录浏览）。
3. **风格**：默认选中项目正在用的视觉风格，也可以全选。点「检查缺少的模型」列出每个文件的目标位置、来源顺序和状态（已有 / 缺少 / 下了一半 / 文件不完整），并检查磁盘剩余空间。
4. **下载**：只下缺少的文件，显示总进度条和每个文件的进度、速度、剩余时间、当前来源；可暂停 / 继续 / 取消。
5. **生成时自动下载**（可选）：开启后，生成图片 / 视频前先检查当前项目风格需要的模型，缺了就自动下载（任务进度里显示「正在下载风格模型 xx%」），下完自动开始生成。

**下载来源与顺序**（每个来源重试 3 次，失败换下一个；所有来源内容相同，换来源时接着已下载的部分续传）：

1. Hugging Face 原站 `https://huggingface.co/<仓库>/resolve/main/<文件>`
2. Hugging Face 镜像 `https://hf-mirror.com/<仓库>/resolve/main/<文件>`（勾选「优先使用国内镜像」时排在第 1）
3. Civitai `https://civitai.com/api/download/models/<版本 ID>`（**Civitai 现在下载任何模型都需要 API Key**，用 `Authorization: Bearer` 发送，不会发给镜像）
4. Civitai 镜像 CivArchive `https://civarchive.com/api/download/models/<版本 ID>`（跳转到它收录的同哈希镜像）

Civitai 上的模型如果在 Hugging Face 有 **SHA256 完全相同** 的副本（如 Animagine XL 4.0、SDXL 官方底模、ProtoVision XL、LineAniRedmond、Manhwa Artstyle、儿童绘本 LoRA、Samaritan 3D），会先从 Hugging Face / hf-mirror 下载，不需要 Civitai Key。

**校验**：先下载到 `<文件>.uu889part`，用 HTTP Range 断点续传（90 秒没数据自动重连），下完核对字节数和 SHA256，一致才改名为正式文件；不一致删除后换下一个来源。已存在且大小正确的文件直接跳过。下载完成后自动让 SD WebUI / Fooocus 刷新模型列表（ComfyUI 会自动重新扫描）。

**安全**：远程登录信息和 Token 只保存在本机数据目录（配置表 + `model-downloads/jobs.json`），不会发给任何下载站。服务器部署时如不希望网页操作服务器本机文件，设环境变量 `MODEL_INSTALLER_LOCAL=0`（只保留远程模式）。
