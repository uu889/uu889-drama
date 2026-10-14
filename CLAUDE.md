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
- **ComfyUI**: `adapters/comfyui-common.ts`（生图 `comfyui-image.ts` / 生视频 `comfyui-video.ts` 共用），工作流存 `ai_service_configs.settings.comfyui_workflow`（API 格式 JSON，空则按 `comfyui_template` / 模型选 `comfyui-templates.ts` 内置模板），`comfyui-bind.ts` 自动绑定没写占位符的工作流（提示词 / 图片 / 种子 / 宽高帧数 / FPS / 模型文件），`{{占位符}}` 替换 + 缺图节点裁剪；`/upload/image` → `/prompt` → `/history/{id}` → `/view`；`comfyui-progress.ts` 订阅 `/ws` 推送节点 / 采样进度
- **生成进度**: `services/task-progress.ts` 内存态进度（阶段 / 百分比 / 排队 / 采样步数 / 下载字节 / 过程记录），随 `/tasks`、`/episodes/:id/generation-tasks` 返回 `progress`；适配器钩子 `onSubmitted` / `describeProgress` / `trackSyncProgress`（SD WebUI）；前端 `components/TaskProgress.vue`
- **本地生图提示词**: `settings.prompt_template`（`{{prompt}}` 插入位置）、`settings.prompt_translate`（`services/prompt-translate.ts` 用文字模型译成英文，本地生图默认开）
- **镜头导演 / 接戏**: `services/shot-direction.ts` 解析分镜 description 的台词估算时长（拆分镜时 `save_storyboards` 自动校正、返回 `timing_warnings`），生成视频时按请求 `direction` 附加【台词控制】【人物外观锁定】【场景一致】【画风一致】【人物站位】【接上一镜】；分镜 `blocking` 字段记录开场站位 / 结尾状态；成片完成后抽结尾帧 `x_last.jpg`（`utils/video-poster.ts`），同场景下一镜用作首帧或第 1 张参考图
- **视频拼接**: `services/ffmpeg-merge.ts`，FFmpeg 二进制内置（ffmpeg-static），可用 `FFMPEG_BIN`/`FFPROBE_BIN` 覆盖

### Frontend
- Nuxt 3 SPA，动态路由在 `nuxt.config.ts` 的 `pages:extend` 手动注册（views/drama/）
- `app/composables/useApi.ts` 统一 fetch 客户端（全相对路径，生产与后端同源）
- 核心工作台 `app/views/drama/episode.vue`（剧本→制作→导出流水线）

### Desktop
- 主进程 `desktop/src/main.ts`：单实例锁 → 空闲端口 → userData 准备（workspace 模板 copy-once + `.template-version` 版本标记）→ `utilityProcess.fork` 后端 → 轮询 health → BrowserWindow
- userData：打包版 `~/Library/Application Support/UU889Drama/`，dev 版 `UU889Drama-Dev/`（互不干扰）
- 后端 bundle 在 asar 内（externals 经 asar node_modules 解析，.node 自动重定向 unpacked）

## Database
SQLite 单文件（默认 `data/uu889.sqlite3`，桌面版在 userData）。启动时 `initSqliteSchema` 幂等建表 + 风格预设种子。MySQL→SQLite 一次性迁移：`cd backend && npx tsx scripts/import-mysql-to-sqlite.ts [--force]`（逐表行数校验、写前备份）。

## Key Config
- AI 服务配置存 DB（`ai_service_configs` 表），设置页维护，不在配置文件
- 环境变量全集见 README「环境变量」；`configs/config.yaml` 是死配置（勿参考）
- `PUBLIC_BASE_URL`：Seedance 引用本地参考资源需公网地址，桌面版无此能力（有中文报错）
