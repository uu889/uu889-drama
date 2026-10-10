# 🎬 UU889-Drama - AI 短剧生成平台

<div align="center">

<img src="docs/images/logo.png" alt="UU889-Drama" width="128" />

**基于 TypeScript 全栈的 AI 短剧自动化生产平台**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

[English](README.md) | **简体中文** | [日本語](README.ja.md) | [한국어](README.ko.md)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [aiask.me 接入](#-aiaskme-接入) • [本地 ComfyUI](#-本地-comfyui-视频) • [部署指南](#-部署指南)

<h3>🔑 <a href="https://aiask.me">获取 aiask.me API Key</a></h3>

**文本 · 图片 · 视频（Grok）一个 Key 全部开通** —— 部署后在「设置 → aiask.me 快捷配置」粘贴 Key，一键写入三条推荐配置

</div>

> UU889-Drama 复刻自 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)（火宝短剧），沿用其 [CC BY-NC-SA 4.0](LICENSE) 许可证，在此基础上更换品牌并新增 aiask.me 文本/图片/视频接口、aiask.me Grok 视频与本地 ComfyUI 视频接入。

---

## 📖 项目简介

UU889-Drama 是一个基于 AI 的短剧自动化生产平台：小说 → 剧本改写 → 角色/场景/道具提取 → 生图 → 分镜拆解 → 生视频 → FFmpeg 拼接导出，全流程一站式完成。支持 Electron 桌面版（macOS / Windows）、服务器与 Docker 部署。

```
frontend/   — Nuxt 3 + Vue 3 + TypeScript（纯 CSS，无 UI 框架）
backend/    — Hono + Drizzle ORM + Mastra AI Agents + better-sqlite3
backend/workspace/skills/ — Agent 技能定义（SKILL.md，支持界面在线编辑）
desktop/    — Electron 桌面版（主进程 + esbuild 打包 + electron-builder 出 dmg/exe）
data/       — 生成资源文件与 SQLite 数据库
```

---

## ✨ 功能特性

- 🎭 **角色 / 场景 / 道具**：AI 提取与去重，批量生成一致性参考图
- 🎬 **分镜**：剧本 → 分镜序列拆解，自动生成视频提示词（`@角色名` 映射参考图）
- 🎥 **视频**：按分镜批量生成，失败一键重试；FFmpeg 整集拼接导出
- 🤖 **4 个 Mastra Agent**：`script_rewriter` / `extractor` / `storyboard_breaker` / `prompt_generator`，提示词与 Skill 可在设置页在线编辑
- 🌐 **多语言**：界面与 AI 生成内容支持 中文 / English / 日本語 / 한국어

### 🔌 多厂商适配

| 类型 | 支持厂商 |
|---|---|
| **文本** | **aiask.me**、OpenAI（兼容接口）、Gemini、火山引擎 |
| **图片** | **aiask.me**（gpt-image / grok-imagine-image / gemini-image）、OpenAI、Gemini、火山引擎 |
| **视频** | **aiask.me Grok 视频**（grok-imagine-video-1.5）、**本地 ComfyUI**、火山引擎 Seedance 2.0、MiniMax H3、阿里云百炼 Wan 3.0 |

---

## 🚀 快速开始

### 📋 环境要求

| 软件 | 版本要求 | 说明 |
|---|---|---|
| **Node.js** | 20+ | 前后端运行环境 |
| **npm** | 9+ | 包管理工具 |

> **数据库零安装**：内置 SQLite（单文件）。**FFmpeg 无需安装**：通过 `ffmpeg-static` / `ffprobe-static` 内置二进制。

### 📥 安装与启动（开发模式）

```bash
git clone https://github.com/uu889/uu889-drama.git
cd uu889-drama

cd backend && npm install && npm run dev      # 终端 1：后端 http://localhost:5679/api/v1
cd frontend && npm install && npm run dev     # 终端 2：前端 http://localhost:3013
```

前端自动代理 `/api` 和 `/static` 到后端。

### 单服务模式

```bash
cd frontend && npm run generate && cp -r .output/public dist   # generate 产物在 .output/public，后端只读取 frontend/dist
cd ../backend && npm start                                      # 访问 http://localhost:5679
```

### ⚙️ 环境变量

均有默认值，本地开发可零配置启动：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SQLITE_PATH` | `<仓库根>/data/uu889.sqlite3` | SQLite 数据库文件位置 |
| `PORT` | `5679` | 后端服务端口 |
| `STORAGE_PATH` | `<仓库根>/data/static` | 生成文件存储目录 |
| `UU889_DATA_DIR` | — | 桌面版由 Electron 主进程注入（userData 数据根） |
| `WORKSPACE_PATH` | `backend/workspace` | Agent 技能/提示词目录 |
| `FRONTEND_DIST` | `frontend/dist` | 前端静态产物目录 |
| `FFMPEG_BIN` / `FFPROBE_BIN` | npm 内置二进制 | 自定义 ffmpeg/ffprobe 路径 |
| `PUBLIC_BASE_URL` | — | Seedance 引用本地参考视频/音频时所需的公网地址 |
| `UU889_UPDATE_FEED` | GitHub Releases 的 `latest.json` | 自定义更新清单地址 |

> AI 服务的 API Key、Base URL 与模型全部在「设置」页配置并入库，不在配置文件中维护。

### 🔑 首次使用：配置 AI 服务

1. 打开「设置」页
2. 在「aiask.me 快捷配置」粘贴 API Key（[前往 aiask.me 获取](https://aiask.me)），一键写入文本、图片、视频三条推荐配置
3. 或在「手动模板」按厂商逐个添加（含本地 ComfyUI），支持连通性测试

---

## 🔑 aiask.me 接入

aiask.me 是 OpenAI 兼容的 AI API 网关，一个 Key 覆盖文本、图片、视频，Base URL 填 `https://aiask.me`（填 `https://aiask.me/v1` 也可以，不会重复拼接）。

| 类型 | 端点 | 默认模型 |
|---|---|---|
| 文本 | `POST /v1/chat/completions` | `gpt-5.5`、`gemini-3.1-pro-preview`、`deepseek-v4-pro` |
| 图片 | `POST /v1/images/generations`（有参考图时 `/v1/images/edits`） | `gpt-image-2`、`grok-imagine-image`、`gemini-3-pro-image` |
| 视频 | `POST /v1/videos` → `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content` | `grok-imagine-video-1.5` |

模型列表只是预设，可在配置里增删任意 aiask.me 支持的模型名。

### Grok 视频（通用视频任务接口）

- **创建**：`POST /v1/videos`，参数 `model`、`prompt`、`mode`、`duration_seconds`（1–15 秒）、`ratio`（`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`，其它比例自动取最接近的）、`video_resolution`（`480p` / `720p` / `1080p`）
- **模式**自动选择：
  - 无参考图 → `text_to_video`（JSON）
  - 有首帧 → `image_to_video`（multipart 字段 `image`）
  - 有首帧 + 尾帧 → `first_last_frames`（`first_frame` / `last_frame`）
  - 分镜绑定的角色/场景/道具图 → `multimodal_reference`（`reference_images`，最多 7 张）；`*-lite` 模型不支持多参考，退化为取第一张图做 `image_to_video`
  - `1080p` 仅文生/图生可用，其余模式自动降到 `720p`
- **轮询**：`GET /v1/videos/{id}`，`in_progress`（排队时带 `queue.position`）→ `completed` / `failed` / `cancelled`
- **取回**：完成后带同一个 API Key 请求 `content_url`（`/v1/videos/{id}/content`），成片下载到本地 `data/static/videos/`

---

## 🖥️ 本地 ComfyUI 视频

通过 ComfyUI 原生 HTTP API 接入本机（或局域网）的 ComfyUI：

1. 启动 ComfyUI（默认 `http://127.0.0.1:8188`；Docker 部署时容器内访问宿主机请用 `http://host.docker.internal:8188`，ComfyUI 需加 `--listen 0.0.0.0`）
2. 「设置 → 视频服务 → 添加」选择「本地 ComfyUI」模板，API Key 可留空（仅在反向代理鉴权时填写）
3. **工作流**：在 ComfyUI 中用「导出 (API)」/ Export (API) 得到 JSON 粘贴进来；留空则使用内置 **Wan 2.2 TI2V 5B** 模板（需要 `wan2.2_ti2v_5B_fp16.safetensors`、`umt5_xxl_fp8_e4m3fn_scaled.safetensors`、`wan2.2_vae.safetensors`）
4. 可设置 FPS（默认 24）与负向提示词（默认 Wan 官方负向词）

调用流程：`POST /upload/image`（上传工作流用到的参考图）→ `POST /prompt` → 轮询 `GET /history/{prompt_id}` → `GET /view?filename=…` 下载成片。

工作流中可使用以下占位符，提交前自动替换（字段值恰好是一个占位符时按类型替换，如 `"{{seed}}"` 会写成数字）：

| 占位符 | 含义 |
|---|---|
| `{{prompt}}` / `{{negative_prompt}}` | 分镜视频提示词 / 负向提示词 |
| `{{seed}}` | 随机种子（每次生成不同） |
| `{{width}}` / `{{height}}` | 按画面比例与分辨率档位计算，对齐到 32（720p 16:9 = 1248×704） |
| `{{duration}}` / `{{fps}}` / `{{frames}}` | 时长（秒）/ 帧率 / 帧数（对齐到 4n+1，5 秒 24fps = 121） |
| `{{aspect_ratio}}` / `{{resolution}}` / `{{model}}` | 画面比例 / 分辨率档位 / 所选模型名 |
| `{{image}}` | 首帧；没有首帧时取第一张参考图 |
| `{{first_frame}}` / `{{last_frame}}` | 显式首帧 / 尾帧 |
| `{{reference_image_1}}` … `{{reference_image_9}}` | 分镜绑定的参考图 |

图片占位符没有对应素材时，引用它的节点（如 `LoadImage`）连同只依赖它的下游节点会被移除，其它节点里指向它们的连线也会删掉——因此像 Wan 2.2 TI2V 这样 `start_image` 可选的工作流，同一份 JSON 既能文生视频也能图生视频。成片需要由 `SaveVideo`、`VHS_VideoCombine` 等保存视频的节点输出（mp4 / webm / gif 等）。

---

## 📖 图文教程

从小说到成片的完整流程（截图为上游界面，操作一致）：

1. **创建项目**：填写剧名，选择画面比例（16:9 / 9:16，创建后不可改）与画面风格
2. **配置 AI 服务**：见上文
3. **剧本阶段**：粘贴小说原文，「AI 改写」生成拍摄剧本
4. **资产制作**：「提取」角色 / 场景 / 道具，批量「生成形象」得到参考图
5. **分镜与视频**：「拆分分镜」后在顶栏选择视频模型（aiask Grok / ComfyUI / Seedance / Wan / MiniMax），分辨率档位随模型联动，「批量生成视频」
6. **拼接导出**：勾选镜头「开始拼接」，FFmpeg 合成整集，可在线播放与下载

<p align="center">
  <img src="docs/screenshots/07-storyboard.png" alt="分镜拆分" width="800">
</p>

---

## 📦 部署指南

### 🖥️ 桌面应用

**下载安装包**：[GitHub Releases](https://github.com/uu889/uu889-drama/releases/latest)（Windows `.exe`、macOS Apple Silicon / Intel `.dmg`）

**发布新版本**（GitHub Actions 自动构建 Windows + macOS 双架构，并上传安装包与更新清单 `latest.json`）：

```bash
# 1. 改 desktop/package.json 的 version（如 1.0.1）并提交
# 2. 打附注标签并推送，说明文字即 Release 说明与应用内更新说明
git tag -a v1.0.1 -m "更新说明"
git push origin v1.0.1
```

本地打包：

```bash
npm run build:frontend   # 根目录：前端静态产物
cd desktop && npm install
npm run dist        # macOS dmg（arm64 + Intel）+ 更新用 zip
npm run dist:win    # Windows NSIS 安装器（win-x64）

# 产物
# desktop/release/UU889Drama-<版本>-arm64.dmg   (Apple Silicon)
# desktop/release/UU889Drama-<版本>.dmg         (Intel)
# desktop/release/UU889Drama Setup <版本>.exe   (Windows)
```

- 用户数据目录：macOS `~/Library/Application Support/UU889Drama/`，Windows `%APPDATA%\UU889Drama\`（数据库、生成媒体、技能副本），卸载应用不影响数据
- macOS 未签名包首次打开若提示「已损坏」：双击 dmg 内「如提示已损坏请双击我.command」，或执行 `sudo xattr -cr /Applications/UU889Drama.app`
- Windows 未签名包 SmartScreen 会提示「更多信息 → 仍要运行」
- 应用内更新：已安装的客户端读取最新 Release 的 `latest.json` 自动提示升级；需要国内镜像时可用 `cd desktop && npm run publish`（配置 `COS_BASE_URL` 等）
- 修改 logo 后执行 `node desktop/scripts/make-brand-icons.mjs`，由 `docs/images/logo.svg` 重新生成全部图标

### 🏭 服务器部署

```bash
cd frontend && npm run generate && cp -r .output/public dist && cd ..
cd backend && npm start
```

Nginx 反向代理示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 100m;

    location /static/ {
        alias /path/to/uu889-drama/data/static/;
        sendfile on;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://localhost:5679;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 🐳 Docker 部署（含应用内更新）

根目录提供一体化 `Dockerfile` 与 `docker-compose.yml`（应用 + Watchtower）：

```bash
cp .env.example .env                              # 修改 WATCHTOWER_TOKEN
UU889_VERSION=1.0.0 docker compose up -d --build  # 访问 http://localhost:5679
```

- 数据持久化：命名卷 `uu889-data` 挂载 `/app/data`
- 应用内更新：compose 自带 Watchtower，「设置 → 关于更新」可一键拉新镜像重建容器；删除 app 的 `UU889_WATCHTOWER_*` 环境变量即退化为手动 `docker compose pull && docker compose up -d`
- 发布多架构镜像：`docker buildx build --platform linux/amd64,linux/arm64 --build-arg UU889_VERSION=x.y.z -t <你的仓库>/uu889-drama:x.y.z --push .`，并把 `docker-compose.yml` 的 `image` 改成你的仓库

---

## 📝 常见问题

**Q: aiask.me 视频一直「生成中」？** Grok 视频是异步任务，排队时会持续轮询（每 10 秒一次）。可在任务列表查看状态；上游返回 `failed` / `cancelled` 会立即显示错误信息。

**Q: ComfyUI 提示「界面格式的工作流」？** 粘贴的是 `Save` 得到的界面 JSON（含 `nodes` / `links`），请改用「导出 (API)」。

**Q: ComfyUI 报 `UNETLoader … not found`？** 内置模板需要的模型文件未下载，或请粘贴你自己的工作流。

**Q: 桌面版数据存在哪里？** `~/Library/Application Support/UU889Drama/data/`（Windows 为 `%APPDATA%\UU889Drama\data\`），开发模式使用仓库 `data/`。

**Q: 页面顶部提示「尚未配置模型」？** 前往「设置」用 aiask.me 快捷配置一键写入，或通过「手动模板」添加；文本、图片、视频三类都有启用的配置后横幅自动消失。

---

## 🎨 技术栈

- **后端**：Node.js 20+、Hono、Drizzle ORM + better-sqlite3（WAL）、Mastra + AI SDK、FFmpeg、Sharp
- **前端**：Nuxt 3（SPA）、Vue 3 + TypeScript、纯 CSS、Lucide、vue-i18n
- **桌面端**：Electron（utilityProcess 承载后端）、esbuild、electron-builder

常用检查命令：

```bash
cd backend && npm run typecheck && node --import tsx --test "tests/*.test.ts"
cd ../frontend && npm run generate
```

---

## 📄 许可证与致谢

本项目基于 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)（火宝短剧）二次开发，原作者保留其作品版权，完整提交历史保留在本仓库中。

依照原项目许可证，本项目同样采用 **[CC BY-NC-SA 4.0](LICENSE)**（署名-非商业性使用-相同方式共享 4.0 国际）：

- ✅ 个人使用、学习研究、非商业项目可自由使用
- ✅ 允许修改与再分发，但须署名并以相同许可证共享
- ❌ **禁止商用**——未经原作者书面许可，不得将本项目整体或部分用于任何商业目的
