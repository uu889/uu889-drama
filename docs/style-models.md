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
- 所有生图底模都是 SDXL 1.0 生态（显存 8GB 起，推荐 12GB）。风格 LoRA 都是按 SDXL 1.0 训练的，换别的 SDXL 底模也能用，但效果需要自己试。

## 一、Stable Diffusion WebUI（模型来自 Civitai）

适用 AUTOMATIC1111 / Forge（启动参数加 `--api`）。Checkpoint 放 `models/Stable-diffusion/`，LoRA 放 `models/Lora/`。

| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 |
| --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | [ProtoVision XL（v6.6.0 BakedVAE）](https://civitai.com/models/125703?modelVersionId=265938)<br>`ProtoVisionXL_0.6.6.0.fp16.safetensors` | [Samaritan 3D Cartoon SDXL](https://civitai.com/models/121932?modelVersionId=132727)<br>`samaritan_3d_cartoon_sdxl.safetensors` | 0.8 | 3d cartoon | DPM++ 2M Karras，30 步，CFG 6 |
| 日漫赛璐璐 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | 不需要 | — | masterpiece, high score, great score, absurdres | Euler a，28 步，CFG 5 |
| 吉卜力手绘 | [AlbedoBase XL（v3.1 Large）](https://civitai.com/models/140737?modelVersionId=1041855)<br>`albedobaseXL_v31Large.safetensors` | [Studio Ghibli （Art Style Capture） LoRA XL（v2）](https://civitai.com/models/187938?modelVersionId=216231)<br>`studio_ghibli_xl_v2.safetensors` | 0.8 | Studio Ghibli | DPM++ 2M Karras，30 步，CFG 6 |
| 水彩绘本 | [AlbedoBase XL（v3.1 Large）](https://civitai.com/models/140737?modelVersionId=1041855)<br>`albedobaseXL_v31Large.safetensors` | [Picture-Story Book For Children XL 儿童绘本](https://civitai.com/models/119288?modelVersionId=129548)<br>`picbookXLloraV1.safetensors` | 0.8 | watercolor, picture book, paper texture | DPM++ 2M Karras，30 步，CFG 6，Clip skip 2 |
| 美式漫画 | [AlbedoBase XL（v3.1 Large）](https://civitai.com/models/140737?modelVersionId=1041855)<br>`albedobaseXL_v31Large.safetensors` | [Comic style SDXL - Jhyd（BF16 精简版）](https://civitai.com/models/134144?modelVersionId=147719)<br>`jhyd-step00001000.smaller.safetensors` | 0.8 | jhyd style, comic book, bold ink outlines, high saturation | DPM++ 2M Karras，30 步，CFG 6 |
| 国风 2.5D | [国风4 GuoFeng4 XL（v1.2 fp16）](https://civitai.com/models/118009?modelVersionId=199325)<br>`GuoFeng4.2Fp16.safetensors` | 不需要 | — | — | DPM++ 2M SDE Karras，30 步，CFG 8，Clip skip 2 |
| 韩系网漫 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | [Manhwa Artstyle / Webtoon（SDXL v1.0）](https://civitai.com/models/257995?modelVersionId=290917)<br>`manhwa-artstyle-000018.safetensors` | 0.6 | manhwa-artstyle | DPM++ 2M Karras，28 步，CFG 7 |
| 黑白漫画 | [Animagine XL 4.0（v4 Opt）](https://civitai.com/models/1188071?modelVersionId=1408658)<br>`animagine-xl-4.0-opt.safetensors` | [LineAniRedmond 线稿漫画（v2.0 SDXL）](https://civitai.com/models/127018?modelVersionId=177544)<br>`LineAniRedmondV2-Lineart-LineAniAF.safetensors` | 0.8 | lineart, LineAniAF, monochrome, greyscale, manga, screentone | Euler a，28 步，CFG 5 |

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
# Civitai API Key（civitai.com → 头像 → Account settings → API Keys）；需要登录的模型必须填
export CIVITAI_TOKEN=
mkdir -p "$SD_DIR/models/Stable-diffusion" "$SD_DIR/models/Lora"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/ProtoVisionXL_0.6.6.0.fp16.safetensors" "https://civitai.com/api/download/models/265938${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/samaritan_3d_cartoon_sdxl.safetensors" "https://civitai.com/api/download/models/132727${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/animagine-xl-4.0-opt.safetensors" "https://civitai.com/api/download/models/1408658${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/albedobaseXL_v31Large.safetensors" "https://civitai.com/api/download/models/1041855${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/studio_ghibli_xl_v2.safetensors" "https://civitai.com/api/download/models/216231${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/picbookXLloraV1.safetensors" "https://civitai.com/api/download/models/129548${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/jhyd-step00001000.smaller.safetensors" "https://civitai.com/api/download/models/147719${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Stable-diffusion/GuoFeng4.2Fp16.safetensors" "https://civitai.com/api/download/models/199325${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/manhwa-artstyle-000018.safetensors" "https://civitai.com/api/download/models/290917${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
curl -L -C - -o "$SD_DIR/models/Lora/LineAniRedmondV2-Lineart-LineAniAF.safetensors" "https://civitai.com/api/download/models/177544${CIVITAI_TOKEN:+?token=$CIVITAI_TOKEN}"
```

</details>

<details><summary>Windows（PowerShell）</summary>

```powershell
# 安装目录（按实际路径修改）
$env:SD_DIR = "D:\stable-diffusion-webui"
# Civitai API Key；需要登录的模型必须填
$env:CIVITAI_TOKEN = ""
$tk = if ($env:CIVITAI_TOKEN) { "?token=$env:CIVITAI_TOKEN" } else { "" }
New-Item -ItemType Directory -Force -Path "$env:SD_DIR\models\Stable-diffusion" | Out-Null
New-Item -ItemType Directory -Force -Path "$env:SD_DIR\models\Lora" | Out-Null
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\ProtoVisionXL_0.6.6.0.fp16.safetensors" "https://civitai.com/api/download/models/265938$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\samaritan_3d_cartoon_sdxl.safetensors" "https://civitai.com/api/download/models/132727$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\animagine-xl-4.0-opt.safetensors" "https://civitai.com/api/download/models/1408658$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\albedobaseXL_v31Large.safetensors" "https://civitai.com/api/download/models/1041855$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\studio_ghibli_xl_v2.safetensors" "https://civitai.com/api/download/models/216231$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\picbookXLloraV1.safetensors" "https://civitai.com/api/download/models/129548$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\jhyd-step00001000.smaller.safetensors" "https://civitai.com/api/download/models/147719$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Stable-diffusion\GuoFeng4.2Fp16.safetensors" "https://civitai.com/api/download/models/199325$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\manhwa-artstyle-000018.safetensors" "https://civitai.com/api/download/models/290917$tk"
curl.exe -L -C - -o "$env:SD_DIR\models\Lora\LineAniRedmondV2-Lineart-LineAniAF.safetensors" "https://civitai.com/api/download/models/177544$tk"
```

</details>

## 二、ComfyUI 生图 / Fooocus（模型来自 Hugging Face）

ComfyUI：Checkpoint 放 `models/checkpoints/`，LoRA 放 `models/loras/`。
Fooocus-API：Checkpoint 放 `repositories/Fooocus/models/checkpoints/`，LoRA 放 `repositories/Fooocus/models/loras/`（单独安装的 Fooocus 是 `models/checkpoints` 与 `models/loras`）。

| 风格 | Checkpoint（底模） | 风格 LoRA | 权重 | 触发词（自动加） | 推荐参数 / Fooocus 风格 |
| --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | [Juggernaut XL v9](https://huggingface.co/RunDiffusion/Juggernaut-XL-v9)<br>`Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors` | [3D Render Style XL](https://huggingface.co/goofyai/3d_render_style_xl)<br>`3d_render_style_xl.safetensors` | 0.8 | 3d style, 3d render | DPM++ 2M Karras，30 步，CFG 5，风格 Fooocus V2 + SAI 3D Model |
| 日漫赛璐璐 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | 不需要 | — | masterpiece, high score, great score, absurdres | Euler a，28 步，CFG 5，风格 Fooocus V2 + SAI Anime |
| 吉卜力手绘 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Studio Ghibli Style（KappaNeuro）](https://huggingface.co/KappaNeuro/studio-ghibli-style)<br>`studio_ghibli_style_sdxl.safetensors` | 0.9 | Studio Ghibli Style | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 |
| 水彩绘本 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Watercolor Style LoRA SDXL（ostris）](https://huggingface.co/ostris/watercolor_style_lora_sdxl)<br>`watercolor_v1_sdxl.safetensors` | 1 | watercolor, picture book illustration | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 + Artstyle Watercolor |
| 美式漫画 | [Stable Diffusion XL Base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)<br>`sd_xl_base_1.0.safetensors` | [Graphic Novel Illustration](https://huggingface.co/blink7630/graphic-novel-illustration)<br>`Graphic_Novel_Illustration-000007.safetensors` | 0.9 | graphic novel illustration, comic book | DPM++ 2M Karras，30 步，CFG 6，风格 Fooocus V2 + SAI Comic Book |
| 国风 2.5D | [国风4 GuoFeng4.1 2.5D XL](https://huggingface.co/xiaolxl/GuoFeng4_XL)<br>`GuoFeng4.1_2.5D.safetensors` | 不需要 | — | — | DPM++ 2M SDE Karras，30 步，CFG 8，风格 Fooocus V2 |
| 韩系网漫 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | [Manhwa Artstyle Webtoon LoRA](https://huggingface.co/Muapi/manhwa-artstyle-webtoon-lora)<br>`manhwa-artstyle-webtoon-lora.safetensors` | 0.7 | manhwa-artstyle, korean webtoon | Euler a，28 步，CFG 6，风格 Fooocus V2 + SAI Anime |
| 黑白漫画 | [Animagine XL 4.0 Opt](https://huggingface.co/cagliostrolab/animagine-xl-4.0)<br>`animagine-xl-4.0-opt.safetensors` | [Manga Ink Screentone](https://huggingface.co/strkyyy/manga-ink-screentone)<br>`manga-ink-screentone.safetensors` | 0.85 | m4ng41nk, monochrome, greyscale, manga, screentone | Euler a，28 步，CFG 5，风格 Fooocus V2 + MRE Manga |

**许可**：

- Juggernaut XL v9：creativeml-openrail-m（作者声明：做付费 API 服务需 RunDiffusion 授权）
- 3D Render Style XL：apache-2.0
- Animagine XL 4.0 Opt：openrail++
- Stable Diffusion XL Base 1.0：openrail++
- Studio Ghibli Style（KappaNeuro）：other（作者未写明条款）
- Watercolor Style LoRA SDXL（ostris）：apache-2.0
- Graphic Novel Illustration：other（作者未写明条款）
- 国风4 GuoFeng4.1 2.5D XL：cc-by-nc-sa-4.0（非商用）
- Manhwa Artstyle Webtoon LoRA：openrail++
- Manga Ink Screentone：openrail++

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
      "text": "Studio Ghibli Style, a forest spirit beside a girl",
      "clip": ["1001", 1]
    }
  },
  "1001": {
    "class_type": "LoraLoader",
    "inputs": {
      "lora_name": "studio_ghibli_style_sdxl.safetensors",
      "strength_model": 0.9,
      "strength_clip": 0.9,
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
curl -L -C - -o "$COMFY_DIR/models/checkpoints/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/3d_render_style_xl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl -L -C - -o "$COMFY_DIR/models/checkpoints/animagine-xl-4.0-opt.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl -L -C - -o "$COMFY_DIR/models/checkpoints/sd_xl_base_1.0.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/studio_ghibli_style_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/KappaNeuro/studio-ghibli-style/resolve/main/Studio%20Ghibli%20Style.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/watercolor_v1_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/Graphic_Novel_Illustration-000007.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/blink7630/graphic-novel-illustration/resolve/main/Graphic_Novel_Illustration-000007.safetensors"
curl -L -C - -o "$COMFY_DIR/models/checkpoints/GuoFeng4.1_2.5D.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/xiaolxl/GuoFeng4_XL/resolve/main/GuoFeng4.1_2.5D.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/manhwa-artstyle-webtoon-lora.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
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
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors" "$hf/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\3d_render_style_xl.safetensors" "$hf/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\animagine-xl-4.0-opt.safetensors" "$hf/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\sd_xl_base_1.0.safetensors" "$hf/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\studio_ghibli_style_sdxl.safetensors" "$hf/KappaNeuro/studio-ghibli-style/resolve/main/Studio%20Ghibli%20Style.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\watercolor_v1_sdxl.safetensors" "$hf/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\Graphic_Novel_Illustration-000007.safetensors" "$hf/blink7630/graphic-novel-illustration/resolve/main/Graphic_Novel_Illustration-000007.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\checkpoints\GuoFeng4.1_2.5D.safetensors" "$hf/xiaolxl/GuoFeng4_XL/resolve/main/GuoFeng4.1_2.5D.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\manhwa-artstyle-webtoon-lora.safetensors" "$hf/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
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
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/3d_render_style_xl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/animagine-xl-4.0-opt.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/sd_xl_base_1.0.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/studio_ghibli_style_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/KappaNeuro/studio-ghibli-style/resolve/main/Studio%20Ghibli%20Style.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/watercolor_v1_sdxl.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/Graphic_Novel_Illustration-000007.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/blink7630/graphic-novel-illustration/resolve/main/Graphic_Novel_Illustration-000007.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/checkpoints/GuoFeng4.1_2.5D.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/xiaolxl/GuoFeng4_XL/resolve/main/GuoFeng4.1_2.5D.safetensors"
curl -L -C - -o "$FOOOCUS_DIR/repositories/Fooocus/models/loras/manhwa-artstyle-webtoon-lora.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
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
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors" "$hf/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\3d_render_style_xl.safetensors" "$hf/goofyai/3d_render_style_xl/resolve/main/3d_render_style_xl.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\animagine-xl-4.0-opt.safetensors" "$hf/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\sd_xl_base_1.0.safetensors" "$hf/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\studio_ghibli_style_sdxl.safetensors" "$hf/KappaNeuro/studio-ghibli-style/resolve/main/Studio%20Ghibli%20Style.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\watercolor_v1_sdxl.safetensors" "$hf/ostris/watercolor_style_lora_sdxl/resolve/main/watercolor_v1_sdxl.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\Graphic_Novel_Illustration-000007.safetensors" "$hf/blink7630/graphic-novel-illustration/resolve/main/Graphic_Novel_Illustration-000007.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\checkpoints\GuoFeng4.1_2.5D.safetensors" "$hf/xiaolxl/GuoFeng4_XL/resolve/main/GuoFeng4.1_2.5D.safetensors"
curl.exe -L -C - -o "$env:FOOOCUS_DIR\repositories\Fooocus\models\loras\manhwa-artstyle-webtoon-lora.safetensors" "$hf/Muapi/manhwa-artstyle-webtoon-lora/resolve/main/manhwa-artstyle-webtoon-lora.safetensors"
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

| 风格 | 推荐模板 | 风格 LoRA（挂低噪声模型） | 权重 | 触发词（自动加） | 说明 |
| --- | --- | --- | --- | --- | --- |
| 3D 漫剧 | `wan2.2-i2v-14b` | [Pixar 动画风（Remade-AI）](https://huggingface.co/Remade-AI/Pixar)<br>`pixar_10_epochs.safetensors` | 0.8 | p1x4r_5ty13 Pixar animation style | 作者推荐权重 1.0（Wan 2.1 上）；挂在 2.2 低噪声模型上 0.8 起调，触发词放在提示词最前 |
| 日漫赛璐璐 | `wan2.2-i2v-14b` | [Flat Color 赛璐璐平涂 v2（motimalu）](https://huggingface.co/motimalu/wan-flat-color-v2)<br>`wan_flat_color_v2.safetensors` | 0.8 | flat color, no lineart | 平涂动画质感；想要新海诚式背景可换 Cseti/wan-14b-shinkai-anime-style-lora-v1（触发词 sh1nka1 style） |
| 吉卜力手绘 | `wan2.2-i2v-14b` | [Studio Ghibli Wan2.1（Muapi）](https://huggingface.co/Muapi/studio-ghibli-wan2.1-t2v-14b)<br>`studio-ghibli-wan2.1-t2v-14b.safetensors` | 0.8 | Studio Ghibli style |  |
| 水彩绘本 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | Hugging Face 上没有合适的水彩绘本 Wan LoRA |
| 美式漫画 | `wan2.2-i2v-14b` | [Comic Book Wan2.1（Muapi）](https://huggingface.co/Muapi/comicbook-wan2.1-t2v-14b)<br>`comicbook-wan2.1-t2v-14b.safetensors` | 0.8 | comic style |  |
| 国风 2.5D | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有国风 2.5D 动画的 Wan LoRA |
| 韩系网漫 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有韩漫 / 网漫的 Wan LoRA |
| 黑白漫画 | `wan2.2-i2v-14b` | 无合适 LoRA | — | — | 没有黑白漫画线稿的 Wan LoRA |

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
      "lora_name": "studio-ghibli-wan2.1-t2v-14b.safetensors",
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
curl -L -C - -o "$COMFY_DIR/models/loras/studio-ghibli-wan2.1-t2v-14b.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/studio-ghibli-wan2.1-t2v-14b/resolve/main/studio-ghibli-wan2.1-t2v-14b.safetensors"
curl -L -C - -o "$COMFY_DIR/models/loras/comicbook-wan2.1-t2v-14b.safetensors" "${HF_ENDPOINT:-https://huggingface.co}/Muapi/comicbook-wan2.1-t2v-14b/resolve/main/comicbook-wan2.1-t2v-14b.safetensors"
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
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\studio-ghibli-wan2.1-t2v-14b.safetensors" "$hf/Muapi/studio-ghibli-wan2.1-t2v-14b/resolve/main/studio-ghibli-wan2.1-t2v-14b.safetensors"
curl.exe -L -C - -o "$env:COMFY_DIR\models\loras\comicbook-wan2.1-t2v-14b.safetensors" "$hf/Muapi/comicbook-wan2.1-t2v-14b/resolve/main/comicbook-wan2.1-t2v-14b.safetensors"
```

</details>
