# 🎬 UU889-Drama - AI Short Drama Studio

<div align="center">

<img src="docs/images/logo.png" alt="UU889-Drama" width="128" />

**A full-stack TypeScript platform that automates AI short-drama production**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

[Features](#-features) • [Quick Start](#-quick-start) • [aiask.me](#-aiaskme-integration) • [Local image generation](#-local-image-generation-comfyui--stable-diffusion-webui--fooocus) • [Local ComfyUI video](#-local-comfyui-video) • [Deployment](#-deployment)

<h3>🔑 <a href="https://aiask.me">Get an aiask.me API Key</a></h3>

**Text · image · video (Grok) with a single key** — paste it into "Settings → aiask.me Quick Config" to write three recommended configs at once

</div>

> UU889-Drama is a fork of [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) (Huobao Drama) under the same [CC BY-NC-SA 4.0](LICENSE) license. On top of a rebrand it adds aiask.me text / image / video providers, aiask.me Grok video and local ComfyUI video generation.

---

## 📖 Overview

UU889-Drama turns a novel into a finished short drama: script rewriting → character / scene / prop extraction → image generation → storyboard breakdown → video generation → FFmpeg export. It runs as an Electron desktop app (macOS / Windows), on a server, or in Docker.

```
frontend/   — Nuxt 3 + Vue 3 + TypeScript (plain CSS, no UI framework)
backend/    — Hono + Drizzle ORM + Mastra AI Agents + better-sqlite3
backend/workspace/skills/ — Agent skills (SKILL.md, editable in the UI)
desktop/    — Electron shell (main process + esbuild bundle + electron-builder dmg/exe)
data/       — Generated media and the SQLite database
```

---

## ✨ Features

- 🎭 **Characters / scenes / props**: AI extraction and de-duplication, batch reference-image generation
- 🎬 **Storyboards**: script → shot list with generated video prompts (`@name` maps to reference images)
- 🎥 **Video**: batch generation per shot with one-click retry of failures; FFmpeg episode export
- 🤖 **4 Mastra agents**: `script_rewriter` / `extractor` / `storyboard_breaker` / `prompt_generator`, with prompts and skills editable in Settings
- 🌐 **Languages**: UI and generated content in Chinese / English / Japanese / Korean / Vietnamese / German / French / Spanish / Portuguese (prompts and skills without a dedicated translation fall back to English)

### 🔌 Providers

| Type | Providers |
|---|---|
| **Text** | **aiask.me**, OpenAI (compatible), Gemini, Volcengine, **DeepSeek**, **Qwen**, **Claude**, **Grok (xAI)** |
| **Image** | **aiask.me** (gpt-image / grok-imagine-image / gemini-image), **Grok image (xAI)**, OpenAI, Gemini, Volcengine, **local ComfyUI / Stable Diffusion WebUI / Fooocus** |
| **Video** | **aiask.me Grok video** (grok-imagine-video-1.5), **Grok video (xAI native)**, **Google Veo**, **Runway**, **local ComfyUI**, Volcengine Seedance 2.0, MiniMax H3, Alibaba Cloud Wan 3.0 |

---

## 🚀 Quick Start

Requirements: **Node.js 20+** and **npm 9+**. SQLite and FFmpeg are bundled — nothing else to install.

```bash
git clone https://github.com/uu889/uu889-drama.git
cd uu889-drama

cd backend && npm install && npm run dev      # terminal 1: API at http://localhost:5679/api/v1
cd frontend && npm install && npm run dev     # terminal 2: UI at http://localhost:3013
```

Single-service mode:

```bash
cd frontend && npm run generate && cp -r .output/public dist   # the backend serves frontend/dist
cd ../backend && npm start                                      # open http://localhost:5679
```

### ⚙️ Environment variables

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `<repo>/data/uu889.sqlite3` | SQLite database file |
| `PORT` | `5679` | Backend port |
| `STORAGE_PATH` | `<repo>/data/static` | Generated media directory |
| `UU889_DATA_DIR` | — | Data root injected by the desktop app |
| `WORKSPACE_PATH` | `backend/workspace` | Agent skills / prompts directory |
| `FRONTEND_DIST` | `frontend/dist` | Frontend build directory |
| `FFMPEG_BIN` / `FFPROBE_BIN` | bundled binaries | Custom ffmpeg / ffprobe paths |
| `PUBLIC_BASE_URL` | — | Public URL needed when Seedance references local video/audio |
| `UU889_UPDATE_FEED` | GitHub Releases `latest.json` | Custom update feed |

API keys, base URLs and models are configured in **Settings** and stored in the database.

### 🔑 First run

1. Open **Settings**
2. Paste an aiask.me API key into **aiask.me Quick Config** ([get one at aiask.me](https://aiask.me)) to write text, image and video configs at once
3. Or add providers one by one with **Manual templates** (including local ComfyUI) and test connectivity

---

## 🔑 aiask.me Integration

aiask.me is an OpenAI-compatible AI API gateway. Use `https://aiask.me` as the base URL (`https://aiask.me/v1` also works; `/v1` is never doubled).

| Type | Endpoint | Default models |
|---|---|---|
| Text | `POST /v1/chat/completions` | `gpt-6-astra`, `gpt-5.5`, `deepseek-v4-pro` |
| Image | `POST /v1/images/generations` (`/v1/images/edits` with references) | `gpt-image-2`, `grok-imagine-image`, `gemini-3-pro-image` |
| Video | `POST /v1/videos` → `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content` | `grok-imagine-video-1.5` |

Text requests only carry parameters each model family accepts: OpenAI reasoning models (`o*` / `gpt-5*` / `gpt-6*` / `codex*`) get no `temperature` and use `max_completion_tokens`; DeepSeek / GLM etc. get thinking disabled. Configure Gemini with the native **Gemini** provider.

### Grok video (video task API)

- **Create** `POST /v1/videos` with `model`, `prompt`, `mode`, `duration_seconds` (1–15), `ratio` (`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`; other ratios snap to the closest) and `video_resolution` (`480p` / `720p` / `1080p`)
- **Mode** is chosen automatically:
  - no images → `text_to_video` (JSON)
  - first frame → `image_to_video` (multipart `image`)
  - first + last frame → `first_last_frames` (`first_frame` / `last_frame`)
  - shot reference images (characters / scenes / props) → `multimodal_reference` (repeated `image[]` files, up to 7); `*-lite` models fall back to `image_to_video` with the first image
  - `1080p` is only used for text/image-to-video; other modes are capped at `720p`
- **Poll** `GET /v1/videos/{id}`: `in_progress` (with `queue.position` while queued) → `completed` / `failed` / `cancelled`
- **Download** `content_url` (`/v1/videos/{id}/content`) with the same API key; the MP4 is saved under `data/static/videos/`

### Grok video (xAI native API)

**Settings → Video → Add** and pick the **Grok 视频（xAI 原生）** template: use `https://api.x.ai` with an xAI API key, or `https://aiask.me` with an aiask.me key from a **Grok group**.

- **Create** `POST /v1/videos/generations` with `model`, `prompt`, `duration` (1–15 s), `aspect_ratio` (`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3` `21:9` `5:2`) and `resolution` (`480p` / `720p` / `1080p`)
- **Images**: a first frame becomes `image: {url}` (xAI has no last-frame field; a lone last frame is used as the image); shot reference images become `reference_images: [{url}]` (up to 14 on grok-imagine-video-1.5, 7 otherwise; max 720p; non-1.5 models max 10 s), and `@图片1name` in the prompt is rewritten to xAI's `<IMAGE_0>name`
- **Poll** `GET /v1/videos/{request_id}`: `pending` → `done` / `failed` / `expired`
- **Download** `video.url` (xAI's temporary URL is fetched without the key; a gateway-rewritten `/v1/videos/{id}/content` gets the key)

---

## 🧩 More Official Providers

Pick the template under **Settings → Text / Image / Video → Add**, paste the provider's own API key and use **Test** to check it.

| Provider | Template base URL | Notes |
|---|---|---|
| **DeepSeek** (text) | `https://api.deepseek.com` | `deepseek-v4-pro` / `deepseek-v4-flash`; thinking mode is switched off (`thinking: {type: "disabled"}`) so agent tool calls work |
| **Qwen** (text) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Alibaba Cloud Model Studio OpenAI-compatible mode; `enable_thinking: false` |
| **Claude** (text) | `https://api.anthropic.com` | Native Messages API (`x-api-key`); `temperature` / `top_p` are dropped for models that reject them (Opus 5.5, Sonnet 5.5, …) |
| **Grok** (text) | `https://api.x.ai` | `grok-4.7` / `grok-4.6` / `grok-4.5` |
| **Grok image** | `https://api.x.ai` | `grok-imagine-image-2.0`; `/v1/images/generations` with `aspect_ratio`, `/v1/images/edits` when the shot has a reference image |
| **Google Veo** (video) | `https://generativelanguage.googleapis.com` | Gemini API key; `:predictLongRunning` → operation polling → download with the key. 4 / 6 / 8 s, 16:9 or 9:16, 720p / 1080p; 1080p or reference images (up to 3; Lite models take the first one as the start frame) force 8 s |
| **Runway** (video) | `https://api.dev.runwayml.com` | `X-Runway-Version: 2024-11-06`; `gen4.5` (2–10 s, text or image), `gen4_turbo` (image only, 5 / 10 s), `veo3.1` / `veo3.1_fast` (4 / 6 / 8 s, first + last frame). The aspect ratio snaps to the closest supported pixel ratio; images over 5 MB are recompressed |

---

## 🎨 Local Image Generation (ComfyUI / Stable Diffusion WebUI / Fooocus)

**Settings → Image → Add** and pick the template; the API key is usually empty. **Test** lists the models the service has — put those names in the model list.

| Service | Default URL | API | Model name | Reference images |
|---|---|---|---|---|
| **ComfyUI** | `http://127.0.0.1:8188` | `/prompt` → `/history/{id}` → `/view` (same queue / cancel / lost-task handling as video) | checkpoint file name (the built-in template's `ckpt_name` is `{{model}}`) | uploaded when a custom workflow references `{{image}}` / `{{reference_image_N}}` |
| **Stable Diffusion WebUI** (A1111 / Forge …) | `http://127.0.0.1:7860` | `POST /sdapi/v1/txt2img` (start with `--api`) | checkpoint name; `default` keeps the loaded model | not used |
| **Fooocus** ([Fooocus-API](https://github.com/mrhan1993/Fooocus-API)) | `http://127.0.0.1:8888` | `/v1/generation/text-to-image`, or `/v2/generation/text-to-image-with-ip` with references → `query-job` polling | checkpoint file name; `default` keeps the default | sent as Image Prompts (IP-Adapter, up to 4) |

- **Size**: the project size keeps its aspect ratio at about base-size² pixels, aligned to 64 (base 1024 for SDXL: 1920×1080 → 1344×768; 512 for SD1.5); Fooocus snaps to its closest built-in SDXL ratio
- **Parameters**: negative prompt (generic default), steps (25), CFG (7), SD WebUI sampler, Fooocus performance (Speed / Quality / Extreme Speed / Lightning / Hyper-SD) and styles
- **ComfyUI image placeholders**: `{{prompt}}` `{{negative_prompt}}` `{{seed}}` `{{width}}` `{{height}}` `{{steps}}` `{{cfg}}` `{{model}}` `{{aspect_ratio}}` `{{image}}` `{{reference_image_1..6}}`; the built-in template is Checkpoint + KSampler + SaveImage (SDXL / SD1.5)
- **Auth**: SD WebUI with `--api-auth` → API key `user:password`; Fooocus-API with `--apikey` → the same key
- **Built-in ComfyUI templates**: SDXL (default), SD 1.5, FLUX.1 dev fp8, FLUX.1 schnell fp8 — the settings page lists the model files, folders and download links, and can copy a template into the editor
- **Auto-bind (ComfyUI)**: a workflow straight from **Export (API)** needs no placeholders; prompt / negative prompt, LoadImage references, seed, size and checkpoint are wired by node structure. **Check workflow** shows every binding and missing model files
- **Prompt template**: e.g. `masterpiece, best quality, {{prompt}}` for all three services, plus SD WebUI / Fooocus parameter and style presets
- **Prompt translation**: SD / SDXL / FLUX only understand English, so local image prompts in Chinese / Japanese / Korean are translated with the active text model first (can be turned off; falls back to the original)
- **Read local models**: list ComfyUI checkpoints / diffusion models / LoRAs, SD WebUI models and samplers, Fooocus models and styles, and click to fill
- **Live progress**: queue position, sampling step, ETA and download progress in the Tasks drawer and asset cards

---

## 🖥️ Local ComfyUI Video

UU889-Drama talks to ComfyUI's native HTTP API:

1. Start ComfyUI (default `http://127.0.0.1:8188`; from Docker use `http://host.docker.internal:8188` and run ComfyUI with `--listen 0.0.0.0`)
2. **Settings → Video → Add** and pick the **本地 ComfyUI** (local ComfyUI) template; the API key is optional (only for authenticating reverse proxies)
3. **Workflow source**:
   - **Built-in template**: Wan 2.2 TI2V 5B (text + image, default), Wan 2.2 I2V 14B (two-stage high / low noise), Wan 2.2 first-last frame 14B, Wan 2.2 T2V 14B — with model files, folders and download links; a template ID in Models (e.g. `wan2.2-i2v-14b`) selects it
   - **Custom workflow**: paste the JSON from ComfyUI **Export (API)**. **No placeholders needed** — with Auto-bind on (default) the prompt / negative prompt, first / last frame / references (LoadImage), seed, width / height, frames, FPS and diffusion model are wired automatically; hand-written placeholders win for their category
4. **Models**: a template ID, or model file names that replace the UNETLoader / CheckpointLoaderSimple values (`high-noise-file|low-noise-file` for the 14B pair)
5. Optional: FPS (empty = template / workflow value), steps / CFG (empty = keep the workflow; set = override every sampler, two-stage split rescaled), negative prompt, prompt template
6. **Check workflow** lists every node field → parameter binding and missing model files

**Live progress**: the backend subscribes to ComfyUI's WebSocket (`/ws?clientId=`, the same `client_id` is sent with `/prompt`); the video panel, shot list and Tasks drawer show reference upload → queue position → current node → sampler stage and step → ETA → decode / encode → download bytes, with an activity log. Without WebSocket it falls back to queue position and elapsed time.

Flow: `POST /upload/image` (reference images used by the workflow) → `POST /prompt` → poll `GET /history/{prompt_id}` → download via `GET /view?filename=…`.

Placeholders replaced before submitting (a field that is exactly one placeholder gets a typed value, e.g. `"{{seed}}"` becomes a number):

| Placeholder | Meaning |
|---|---|
| `{{prompt}}` / `{{negative_prompt}}` | Shot video prompt / negative prompt |
| `{{seed}}` | Random seed (different every run) |
| `{{width}}` / `{{height}}` | From aspect ratio and resolution tier, aligned to 32 (720p 16:9 = 1248×704) |
| `{{duration}}` / `{{fps}}` / `{{frames}}` | Seconds / frame rate / frame count aligned to 4n+1 (5 s at 24 fps = 121) |
| `{{aspect_ratio}}` / `{{resolution}}` / `{{model}}` | Aspect ratio / resolution tier / selected model name |
| `{{image}}` | First frame, or the first reference image when there is none |
| `{{first_frame}}` / `{{last_frame}}` | Explicit first / last frame |
| `{{reference_image_1}}` … `{{reference_image_9}}` | Shot reference images |

When an image placeholder has no media, the node using it (e.g. `LoadImage`), any node that only depends on it, and links pointing at them are removed — so a workflow with an optional `start_image` (like Wan 2.2 TI2V) handles both text-to-video and image-to-video. The workflow must save a video (`SaveVideo`, `VHS_VideoCombine`, …).

---

## 📦 Deployment

### 🖥️ Desktop app

**Download**: [GitHub Releases](https://github.com/uu889/uu889-drama/releases/latest) (Windows `.exe`, macOS Apple Silicon / Intel `.dmg`)

**Publishing a release**: bump `version` in `desktop/package.json` and `backend/package.json`, commit, then push an annotated tag — GitHub Actions builds Windows + both macOS architectures and uploads the installers and the `latest.json` update feed:

```bash
git tag -a v1.0.1 -m "Release notes"
git push origin v1.0.1
```

Build locally:

```bash
npm run build:frontend   # repo root
cd desktop && npm install
npm run dist        # macOS dmg (arm64 + Intel) + updater zip
npm run dist:win    # Windows NSIS installer (win-x64)
```

- User data: macOS `~/Library/Application Support/UU889Drama/`, Windows `%APPDATA%\UU889Drama\`
- Unsigned macOS builds reported as "damaged": run the bundled `如提示已损坏请双击我.command` or `sudo xattr -cr /Applications/UU889Drama.app`
- In-app updates: installed apps read `latest.json` from the latest GitHub Release and offer the upgrade
- After changing the logo, run `node desktop/scripts/make-brand-icons.mjs` to regenerate every icon from `docs/images/logo.svg`

### 🏭 Server

```bash
cd frontend && npm run generate && cp -r .output/public dist && cd ..
cd backend && npm start
```

Put Nginx in front and serve `/static/` straight from `data/static/` for best performance.

### 🐳 Docker

```bash
cp .env.example .env                              # set WATCHTOWER_TOKEN
UU889_VERSION=1.0.0 docker compose up -d --build  # open http://localhost:5679
```

- Data lives in the `uu889-data` volume mounted at `/app/data`
- Updating a source build: `git pull && UU889_VERSION=<new version> docker compose up -d --build`
- One-click updates (optional): the bundled Watchtower sidecar can only pull an image that exists in a registry. Publish the image (command below) and point `image` in `docker-compose.yml` at it to make "Settings → About → Update now" work; remove the app's `UU889_WATCHTOWER_*` variables to keep only the new-version notice
- Multi-arch image: `docker buildx build --platform linux/amd64,linux/arm64 --build-arg UU889_VERSION=x.y.z -t <your-registry>/uu889-drama:x.y.z --push .`

---

## 📝 FAQ

**aiask.me video stays "generating"?** Grok video is an asynchronous job; the backend polls every 10 seconds. `failed` / `cancelled` results show the upstream error immediately.

**ComfyUI says the workflow is in UI format?** You pasted a regular save (with `nodes` / `links`). Use **Export (API)** instead.

**ComfyUI reports `UNETLoader … not found`?** Download the models used by the built-in template or paste your own workflow.

**ComfyUI fails with `CLIPLoader … incomplete metadata, file not fully covered`?** The model file is truncated or corrupt, usually from an interrupted download; the error names the file and its folder. For the built-in template it is the text encoder: delete `ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`, download it again from Hugging Face `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (`split_files/text_encoders`, 6,735,906,897 bytes) and restart ComfyUI.

---

## 🎨 Tech Stack

- **Backend**: Node.js 20+, Hono, Drizzle ORM + better-sqlite3 (WAL), Mastra + AI SDK, FFmpeg, Sharp
- **Frontend**: Nuxt 3 (SPA), Vue 3 + TypeScript, plain CSS, Lucide, vue-i18n
- **Desktop**: Electron (backend in a utilityProcess), esbuild, electron-builder

```bash
cd backend && npm run typecheck && node --import tsx --test "tests/*.test.ts"
cd ../frontend && npm run generate
```

---

## 📄 License & Credits

UU889-Drama is derived from [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) (Huobao Drama); the original authors retain copyright in their work and the full upstream commit history is preserved in this repository.

As required by the upstream license, this project is also released under **[CC BY-NC-SA 4.0](LICENSE)** (Attribution-NonCommercial-ShareAlike 4.0 International):

- ✅ Free for personal, research and non-commercial use
- ✅ Modification and redistribution allowed with attribution under the same license
- ❌ **No commercial use** without written permission from the original authors
