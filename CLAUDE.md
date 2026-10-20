# CLAUDE.md

## Project Overview

UU889-Drama — AI 短剧/漫剧一站式制作工具（复刻自 chatfire-AI/huobao-drama，CC BY-NC-SA 4.0）。全 TypeScript 栈：小说 → 剧本改写 → 资产提取 → 生图 → 分镜拆解 → 生视频 → FFmpeg 拼接导出。支持 Electron 桌面版（macOS dmg）与服务器部署。

## Structure

```
backend/   — Hono + Drizzle ORM (better-sqlite3) + Mastra (AI agents)
backend/workspace/ — Agent 工作目录（Mastra Workspace jail 根）
backend/workspace/skills/ — Agent SKILL.md definitions（设置页可在线编辑）
frontend/  — Nuxt 3 + Vue 3 + TypeScript，ssr:false（纯 CSS，无 UI 框架）
desktop/   — Electron 桌面版：主进程 + esbuild 打包脚本 + electron-builder 配置
data/      — SQLite 数据库（uu889.sqlite3）+ 生成的静态文件（static/）
configs/   — 遗留死配置，代码零引用
```

## Commands

### Backend (`backend/`)
- `npm run dev` — tsx watch 开发服务（端口 5679）
- `npm start` — tsx 生产启动
- `npm run typecheck` — TypeScript 类型检查
- `npm run backfill-artwork` — 存量图片/视频补缩略图与海报帧

### Frontend (`frontend/`)
- `npm run dev` — Vite 开发服务（端口 3013，代理 /api 与 /static 到 5679）
- `npm run generate` — 产出含 index.html 的静态站点（`.output/public`；`nuxt build` 不产 index.html，不能用于静态托管）

### Desktop (`desktop/`，根目录 `npm run dist` 串联全流程)
- `npm run dev` — 打包后端 bundle + Electron 窗口运行
- `npm run build:backend` — esbuild 打包 backend/src → build/backend.mjs（ESM；externals: sharp/better-sqlite3/ffmpeg-static/ffprobe-static）
- `npm run build:main` — 打包主进程 → dist/main.js
- `npm run rebuild:native` — better-sqlite3 按 Electron ABI 重编（原生模块 ABI 变化后必须执行；postinstall 已自动做）
- `npm run dist` — prepare-resources + electron-builder 出 arm64/x64 dmg → release/
- `npm run dist:win` — 交叉打包 Windows NSIS 安装器（win-x64）；win 版 ffmpeg.exe 缓存在 build/win-bin/（缺失时脚本提示下载地址）

## Architecture

### Backend
- **HTTP**: Hono（入口 `src/index.ts`），路由挂 `/api/v1`，`/static` 服务 DATA_ROOT，生产托管前端静态目录
- **Database**: SQLite（better-sqlite3 + WAL），`SQLITE_PATH` 覆盖库文件位置；DDL 在 `src/db/sqlite-schema.ts`，启动时幂等重放；Drizzle 表定义 `src/db/schema.ts`（sqlite-core）
- **路径锚点**: `src/utils/paths.ts` 统一解析 DATA_ROOT/STORAGE_ROOT；桌面版由 Electron 主进程注入 env（`UU889_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`），dev 走仓库相对路径默认值
- **AI Agents**: Mastra，4 个 agent（script_rewriter / extractor / storyboard_breaker / prompt_generator），instructions 从 `workspace/prompts/*.md` + skills 动态拼接，模型按请求解析（文本服务商 aiask/openai/gemini/volcengine/deepseek/qwen/claude/xai，claude 走 `@ai-sdk/anthropic` 原生接口）；fetch 补丁链适配国内中转站（关思考/温度/max_tokens）
- **媒体生成**: `services/generation.ts` 统一任务生命周期（sys_task 表），适配器模式：图片 aiask/openai/gemini/volcengine/xai/comfyui/sdwebui/fooocus（本地生图，见 adapters/local-image.ts），视频 aiask/xai/veo/runway/comfyui/volcengine/minimax/aliyun（veo = Gemini API `:predictLongRunning`；runway = `X-Runway-Version` 任务接口；xai = Grok 原生 `/v1/videos/generations`，参考图 `reference_images` + 提示词 `<IMAGE_n>`）。适配器 `buildGenerateRequest` 可返回 Promise（先上传素材），`resolveDownload` 给出成片下载方式（鉴权头 / 相对地址补全）
- **aiask.me**: OpenAI 兼容网关，文本走 `/v1/chat/completions`；图片 `adapters/aiask-image.ts`（grok-imagine 用 aspect_ratio + JSON edits）；Grok 视频 `adapters/aiask-video.ts`：`POST /v1/videos` → `GET /v1/videos/{id}` → 带 Key 取 `/content`
- **ComfyUI**: `adapters/comfyui-common.ts`（生图 `comfyui-image.ts` / 生视频 `comfyui-video.ts` 共用），工作流存 `ai_service_configs.settings.comfyui_workflow`（API 格式 JSON，空则按 `comfyui_template` / 模型选 `comfyui-templates.ts` 内置模板；`COMFY_VRAM_TEMPLATES` 按显存 12G~288G 的 Wan 2.2 I2V 14B 档位 `wan2.2-i2v-14b-<n>g`，`recommended.maxShortEdge` 限分辨率，12G/16G 用 GGUF `UnetLoaderGGUF`，≤24G 挂 lightx2v 4 步 LoRA；`COMFY_H3_VRAM_TEMPLATES` 为 MiniMax H3 同样九档 `minimax-h3-<n>g` + `minimax-h3-r2v`，用 Ref2VA `MiniMaxH3ReferenceToVideo`：参考图 {{reference_image_1..9}} → `ref_images.ref_image_0..8`，提示词 `@图片N` 经 `toMiniMaxH3PictureTags` 换成 `<Picture N>`，首 / 尾帧用 `MiniMaxH3AddGuide`（frame_idx 0 / -1），缺图时 `renderComfyWorkflow` 按 `BYPASS_WITHOUT_MEDIA` 短路引导节点；≤24G 用 Abiray 剪枝版 GGUF，≤32G 挂 ref2v 4 步 Turbo LoRA，`vramFamily` 决定设置页分组；原 FL2VA 三个 H3 模板只认首尾帧、不引用角色图），`comfyui-bind.ts` 自动绑定没写占位符的工作流（提示词 / 图片 / 种子 / 宽高帧数 / FPS / 模型文件），`{{占位符}}` 替换 + 缺图节点裁剪；`/upload/image` → `/prompt` → `/history/{id}` → `/view`；`comfyui-progress.ts` 订阅 `/ws` 推送节点 / 采样进度；执行报显存不足（OOM）时 `prepareRetry` 先对同一台机器上所有启用的 ComfyUI `POST /free`（卸载模型 + 清缓存，等 `/system_stats` 显存回升）再由 `generation.ts` 原样重新提交（`COMFY_OOM_RETRIES` 次），错误文案 `describeComfyOutOfMemory` 先给结论和办法、原文放最后
- **本地显卡排队**: `services/gpu-queue.ts`——ComfyUI / SD WebUI / Fooocus 按主机排队（127.0.0.1 / localhost 同一台），`generation.ts enterGpuLane` 在提交前 `acquireGpuLane`，前一个任务结束（`pollTask` finally / `processTask` 未交给轮询时）`releaseGpuLane` 才提交下一个，等待时进度显示排队位置；同时数 `settings.max_concurrent`（默认 1）；ComfyUI 提交前 `waitComfyAlive`（最多 15 分钟），视频任务按 `shouldFreeVramBetween`（`settings.free_vram_between`，不设时 ≤16G 内置模板自动）在两个视频之间 `/free`；`ComfyUIClient.fetchPollResult` 连续 `COMFY_DOWN_GRACE_MS` 连不上即当作任务丢失，`prepareRetry` 等 ComfyUI 重启后原样重新提交（`COMFY_RESTART_RETRIES`）
- **视频高清化**: `services/video-upscale.ts`——`POST /storyboards/:id/upscale`、`POST /episodes/:id/upscale`（批量，低于目标分辨率才处理）、`GET /storyboards/upscale-info`；engine `ai`（ComfyUI 放大模型，`/object_info/UpscaleModelLoader` 选 2x 优先，FFmpeg 切 2 秒一段逐段 LoadVideo → ImageUpscaleWithModel → ImageScale → CreateVideo → SaveVideo，拼回并配原声，走本地显卡排队）/ `fast`（FFmpeg Lanczos + unsharp）/ `auto`（AI 不可用或失败退回 fast，原因写在 error_msg）；结果是 provider = upscale 的 sys_task（`<名>_1080p.mp4`），设为当前视频，原视频留在历史；拼接时 `ffmpeg-merge.ts planConcat` 对尺寸 / 帧率 / 有无音轨不一致的镜头改用 concat 滤镜统一
- **生成进度**: `services/task-progress.ts` 内存态进度（阶段 / 百分比 / 排队 / 采样步数 / 下载字节 / 过程记录），随 `/tasks`、`/episodes/:id/generation-tasks` 返回 `progress`；适配器钩子 `onSubmitted` / `describeProgress` / `trackSyncProgress`（SD WebUI）；前端 `components/TaskProgress.vue`
- **本地生图提示词**: `settings.prompt_template`（`{{prompt}}` 插入位置）、`settings.prompt_translate`（`services/prompt-translate.ts` 用文字模型译成英文，本地生图默认开）
- **镜头导演 / 接戏**: `services/shot-direction.ts` 解析分镜 description 的台词估算时长（拆分镜时 `save_storyboards` 自动校正、返回 `timing_warnings`），生成视频时按请求 `direction` 附加【台词控制】【人物外观锁定】【场景一致】【画风一致】【人物站位】【接上一镜】；分镜 `blocking` 字段记录开场站位 / 结尾状态；成片完成后抽结尾帧 `x_last.jpg`（`utils/video-poster.ts`），同场景下一镜用作首帧或第 1 张参考图
- **视觉风格 → 本地模型**: `adapters/style-model-catalog.ts`（推荐清单：SD WebUI 用 Civitai，ComfyUI / Fooocus 生图用 Hugging Face SDXL，ComfyUI 视频用 Wan 2.2 I2V 14B + Wan 14B 风格 LoRA）、`style-models.ts`（`resolveStyleModels`，`settings.style_models_enabled` 开启，`settings.style_models` 逐风格覆盖）、`comfyui-lora.ts`（`injectStyleLora` 插 LoraLoader / LoraLoaderModelOnly，14B LoRA 只挂 14B 模型）、`style-model-guide.ts`（`GET /ai-configs/style-models` 说明与下载命令）；生成时 `record.style` = 项目 `drama.style`。每个文件必须标 `licenseStatus`（ok / attention / restricted，非 ok 写 `licenseNote`），默认推荐不得用 restricted，受限模型放 `alternatives`（测试强制）。改清单后 `cd backend && npx tsx scripts/gen-style-models-doc.ts` 重新生成 `docs/style-models.md`
- **模型一键 / 自动下载**: `services/model-installer/`——`target.ts`（本机 fs / 远程 ssh2 SSH+SFTP，识别 Windows / macOS / Linux；密码登录含 keyboard-interactive，证书登录前 `checkPrivateKey` 校验，`ssh-keys.ts` 把 PKCS#8 / ppk v3 转成 ssh2 支持的格式）、`detect.ts`（服务接口 + 特征文件扫描识别安装根目录，各程序模型目录）、`plan.ts`（按风格算需要的文件与状态）、`sources.ts`（来源顺序 HF → hf-mirror → Civitai → CivArchive，`FILE_META` 精确字节数 / SHA256 / HF 同哈希副本）、`jobs.ts`（任务持久化 `DATA_ROOT/model-downloads/jobs.json`；远程与本机都用 `remote-script.ts` 生成的 sh / PowerShell 脚本在独立后台进程里下载（本机 POSIX `spawn detached`，Windows / 远程 Windows 用 WMI `Win32_Process.Create`，远程 POSIX `nohup setsid`），退出 UU889-Drama 不中断，轮询 status.log；启动时 `resumeJobsOnStartup` 接上进度，进程没了自动重启续传（`MAX_RELAUNCH`）；本机没有 curl / wget 或 `MODEL_INSTALLER_DETACHED=0` 时退回进程内 Node 下载：Range 续传 / 换源 / 校验）、`index.ts`（`ensureStyleModelsForTask`：要用的文件正在下载就一律等它下完；开启 `style_models_auto_download` 时再检查并补齐缺的）；路由 `/api/v1/model-installer`；前端 `components/ModelInstallerPanel.vue`；`MODEL_INSTALLER_LOCAL=0` 关闭本机模式。所有下载先写 `<文件>.uu889part`，校验后才改名，手动下载命令（`style-model-guide.ts`）也一样
- **字幕**: `services/subtitles.ts`——生成视频时 `subtitle: { enabled, style, size, position, speaker }`（前端视频面板「加字幕」，存 localStorage `uu889:video-subtitle`），成片下载后 `generation.ts maybeBurnSubtitles` 用 `parseShotDialogue` 取分镜台词 → `buildSubtitleCues`（按语速排开，放不下时压缩且每句 ≥1.1 秒）→ FFmpeg drawtext（只要 freetype，`findSubtitleFont` 找系统中文字体 / `SUBTITLE_FONT`）烧成 `<名>_sub.mp4` + `_sub.srt`（存 `storyboards.subtitle_url`）；原视频保留，`_sub` 的封面 / 结尾帧复制自原视频（接戏不带字幕）；失败只提示不让任务失败
- **视频拼接**: `services/ffmpeg-merge.ts`，FFmpeg 二进制内置（ffmpeg-static），可用 `FFMPEG_BIN`/`FFPROBE_BIN` 覆盖；背景音乐 `services/bgm.ts`（曲库 `static/bgm`，`/merge/bgm` 上传 / 列表 / 删除；拼接请求带 `bgm: { path, volume, duck, fade }` 时先拼到临时文件再混音：音乐循环到成片长度、淡入淡出、`sidechaincompress` 说话时压低、成片无音轨时直接用音乐；视频流复制；混音失败保留无音乐成片并在 `error_msg` 说明）
- **系统音（系统流）**: `services/system-voice.ts`，项目级设置存 `dramas.metadata.system_voice`（`GET/PUT /dramas/:id/system-voice`）；开启后 `agents/index.ts buildInstructions` 给四个 Agent 追加 `systemVoiceAgentDirective`（系统台词统一写成 `系统：「…」`、不提取为角色、提示词写明提示音与声音质感），`shot-direction.ts parseShotDialogue(…, { systemNames })` 把系统台词（引号 / 【系统：…】 / 【叮！…】 / 不带引号的「系统播报：…」）标成 `kind: 'system'`，生成视频时【台词控制】标为画外电子音并附加【系统音】，字幕里系统台词加【】、青蓝色；前端角色表里名叫系统的不计入出图

### Frontend
- Nuxt 3 SPA，动态路由在 `nuxt.config.ts` 的 `pages:extend` 手动注册（views/drama/）
- `app/composables/useApi.ts` 统一 fetch 客户端（全相对路径，生产与后端同源）
- 核心工作台 `app/views/drama/episode.vue`（剧本→制作→导出流水线）

### Desktop
- 更改存储位置：`migrate.ts`（流程 / IPC）+ `migrate-core.ts`（不依赖 Electron 的文件操作，`backend/tests/desktop-migrate-core.test.ts` 覆盖）：选了有内容的文件夹自动用其中 `UU889Drama-Data` 子目录，`stat().dev` 判同盘，rename 遇占用重试 / 改复制，中途失败回滚，旧目录删不掉不算失败
- 主进程 `desktop/src/main.ts`：单实例锁 → 空闲端口 → userData 准备（workspace 模板 copy-once + `.template-version` 版本标记）→ `utilityProcess.fork` 后端 → 轮询 health → BrowserWindow
- userData：打包版 `~/Library/Application Support/UU889Drama/`，dev 版 `UU889Drama-Dev/`（互不干扰）
- 后端 bundle 在 asar 内（externals 经 asar node_modules 解析，.node 自动重定向 unpacked）

## Database
SQLite 单文件（默认 `data/uu889.sqlite3`，桌面版在 userData）。启动时 `initSqliteSchema` 幂等建表 + 风格预设种子。MySQL→SQLite 一次性迁移：`cd backend && npx tsx scripts/import-mysql-to-sqlite.ts [--force]`（逐表行数校验、写前备份）。

## Key Config
- AI 服务配置存 DB（`ai_service_configs` 表），设置页维护，不在配置文件
- 环境变量全集见 README「环境变量」；`configs/config.yaml` 是死配置（勿参考）
- `PUBLIC_BASE_URL`：Seedance 引用本地参考资源需公网地址，桌面版无此能力（有中文报错）
