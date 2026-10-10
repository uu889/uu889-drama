# 🎬 UU889-Drama - AI 숏드라마 제작 플랫폼

<div align="center">

<img src="docs/images/logo.png" alt="UU889-Drama" width="128" />

**TypeScript 풀스택 기반 AI 숏드라마 자동 제작 플랫폼**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | **한국어**

<h3>🔑 <a href="https://aiask.me">aiask.me API Key 받기</a></h3>

**텍스트 · 이미지 · 영상(Grok)을 키 하나로** — 「설정 → aiask.me 빠른 설정」에 붙여넣으면 추천 설정 3종을 한 번에 등록

</div>

> UU889-Drama는 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)(화바오 숏드라마)의 포크입니다. 동일한 [CC BY-NC-SA 4.0](LICENSE) 라이선스로 브랜드를 변경하고 aiask.me 텍스트 / 이미지 / 영상 프로바이더, aiask.me Grok 영상, 로컬 ComfyUI 영상 생성을 추가했습니다.

## 📖 개요

소설 → 대본 리라이트 → 캐릭터 / 장면 / 소품 추출 → 이미지 생성 → 스토리보드 분할 → 영상 생성 → FFmpeg 내보내기까지 한 번에 처리합니다. Electron 데스크톱(macOS / Windows), 서버, Docker에서 실행됩니다.

### 🔌 지원 프로바이더

| 유형 | 프로바이더 |
|---|---|
| **텍스트** | **aiask.me**, OpenAI(호환), Gemini, Volcengine |
| **이미지** | **aiask.me**(gpt-image / grok-imagine-image / gemini-image), OpenAI, Gemini, Volcengine, **로컬 ComfyUI / Stable Diffusion WebUI(`/sdapi/v1/txt2img`) / Fooocus(Fooocus-API)** |
| **영상** | **aiask.me Grok 영상**(grok-imagine-video-1.5), **Grok 영상(xAI 네이티브 API: `/v1/videos/generations`)**, **로컬 ComfyUI**, Seedance 2.0, MiniMax H3, Wan 3.0 |

## 🚀 빠른 시작

Node.js 20+ / npm 9+만 있으면 됩니다(SQLite와 FFmpeg 내장).

```bash
git clone https://github.com/uu889/uu889-drama.git
cd uu889-drama
cd backend && npm install && npm run dev      # API: http://localhost:5679/api/v1
cd frontend && npm install && npm run dev     # UI:  http://localhost:3013
```

처음에는 「설정」을 열어 aiask.me 빠른 설정에 API Key를 붙여넣거나, 수동 템플릿으로 프로바이더를 추가하세요.

## 🔑 aiask.me 연동

Base URL은 `https://aiask.me`(`/v1` 포함도 가능).

| 유형 | 엔드포인트 | 기본 모델 |
|---|---|---|
| 텍스트 | `POST /v1/chat/completions` | `gpt-6-astra`, `gpt-5.5` 등 |
| 이미지 | `POST /v1/images/generations`(참조 이미지가 있으면 `/v1/images/edits`) | `gpt-image-2`, `grok-imagine-image`, `gemini-3-pro-image` |
| 영상 | `POST /v1/videos` → `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content` | `grok-imagine-video-1.5` |

Grok 영상 파라미터: `duration_seconds`(1–15초), `ratio`(`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`), `video_resolution`(`480p` / `720p` / `1080p`). 참조 이미지가 없으면 `text_to_video`, 첫 프레임은 `image_to_video`, 첫/끝 프레임은 `first_last_frames`, 샷에 연결된 참조 이미지는 `multimodal_reference`(최대 7장)를 자동 선택합니다. 1080p는 텍스트/이미지 기반 생성에서만 쓰이고 나머지는 720p로 조정됩니다.

## 🖥️ 로컬 ComfyUI 영상

1. ComfyUI 실행(기본 `http://127.0.0.1:8188`, Docker에서는 `http://host.docker.internal:8188`)
2. 「설정 → 영상 → 추가」에서 「本地 ComfyUI」 템플릿 선택(API Key는 비워도 됨)
3. ComfyUI의 "내보내기 (API)"로 저장한 JSON을 붙여넣기. 비워 두면 내장 Wan 2.2 TI2V 5B 템플릿 사용

처리 흐름: `POST /upload/image` → `POST /prompt` → `GET /history/{prompt_id}` → `GET /view`. 워크플로에서 `{{prompt}}` `{{negative_prompt}}` `{{seed}}` `{{width}}` `{{height}}` `{{duration}}` `{{fps}}` `{{frames}}` `{{aspect_ratio}}` `{{resolution}}` `{{model}}` `{{image}}` `{{first_frame}}` `{{last_frame}}` `{{reference_image_1..9}}`를 사용할 수 있습니다. 소재가 없는 이미지 플레이스홀더는 `LoadImage` 노드째 제거되므로 `start_image`가 선택 사항인 워크플로는 텍스트/이미지 기반 생성을 모두 지원합니다.

## 📦 배포

- **데스크톱**: `npm run build:frontend` 후 `cd desktop && npm install && npm run dist`(macOS) / `npm run dist:win`(Windows)
- **서버**: `cd frontend && npm run generate && cp -r .output/public dist`, `cd backend && npm start`
- **Docker**: `cp .env.example .env` 후 `UU889_VERSION=1.0.0 docker compose up -d --build`(데이터는 볼륨 `uu889-data`)

자세한 내용은 [简体中文 README](README.zh-CN.md) / [English README](README.md)를 참고하세요.

## 📄 라이선스 및 크레딧

이 프로젝트는 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)를 기반으로 하며 원저작자가 저작권을 보유합니다(업스트림 커밋 기록 유지). 업스트림과 동일하게 **[CC BY-NC-SA 4.0](LICENSE)**으로 공개되며, **원저작자의 서면 허가 없는 상업적 이용은 금지**됩니다.
