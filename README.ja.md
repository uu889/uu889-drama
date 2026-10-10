# 🎬 UU889-Drama - AI ショートドラマ制作プラットフォーム

<div align="center">

<img src="docs/images/logo.png" alt="UU889-Drama" width="128" />

**TypeScript フルスタックの AI ショートドラマ自動制作プラットフォーム**

[![Node Version](https://img.shields.io/badge/Node.js-20+-339933?style=flat&logo=node.js)](https://nodejs.org)
[![Vue Version](https://img.shields.io/badge/Vue-3.x-4FC08D?style=flat&logo=vue.js)](https://vuejs.org)
[![License](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語** | [한국어](README.ko.md)

<h3>🔑 <a href="https://aiask.me">aiask.me API Key を取得</a></h3>

**テキスト・画像・動画（Grok）を 1 つのキーで** —「設定 → aiask.me クイック設定」に貼り付けるだけで推奨 3 設定を一括登録

</div>

> UU889-Drama は [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama)（火宝短劇）のフォークです。同じ [CC BY-NC-SA 4.0](LICENSE) ライセンスのもと、ブランドを変更し、aiask.me のテキスト / 画像 / 動画プロバイダー、aiask.me Grok 動画、ローカル ComfyUI 動画生成を追加しました。

## 📖 概要

小説 → 脚本リライト → キャラクター / シーン / 小道具の抽出 → 画像生成 → 絵コンテ分割 → 動画生成 → FFmpeg 書き出しまでを一括で行います。Electron デスクトップ版（macOS / Windows）、サーバー、Docker で動作します。

### 🔌 対応プロバイダー

| 種類 | プロバイダー |
|---|---|
| **テキスト** | **aiask.me**、OpenAI（互換）、Gemini、Volcengine |
| **画像** | **aiask.me**（gpt-image / grok-imagine-image / gemini-image）、OpenAI、Gemini、Volcengine、**ローカル ComfyUI / Stable Diffusion WebUI（`/sdapi/v1/txt2img`）/ Fooocus（Fooocus-API）** |
| **動画** | **aiask.me Grok 動画**（grok-imagine-video-1.5）、**Grok 動画（xAI ネイティブ API：`/v1/videos/generations`）**、**ローカル ComfyUI**、Seedance 2.0、MiniMax H3、Wan 3.0 |

## 🚀 クイックスタート

Node.js 20+ / npm 9+ のみ必要です（SQLite と FFmpeg は同梱）。

```bash
git clone https://github.com/uu889/uu889-drama.git
cd uu889-drama
cd backend && npm install && npm run dev      # API: http://localhost:5679/api/v1
cd frontend && npm install && npm run dev     # UI:  http://localhost:3013
```

初回は「設定」を開き、aiask.me クイック設定に API Key を貼り付けるか、手動テンプレートからプロバイダーを追加してください。

## 🔑 aiask.me 連携

Base URL は `https://aiask.me`（`/v1` 付きでも可）。

| 種類 | エンドポイント | 既定モデル |
|---|---|---|
| テキスト | `POST /v1/chat/completions` | `gpt-6-astra`、`gpt-5.5` ほか |
| 画像 | `POST /v1/images/generations`（参照画像ありは `/v1/images/edits`） | `gpt-image-2`、`grok-imagine-image`、`gemini-3-pro-image` |
| 動画 | `POST /v1/videos` → `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content` | `grok-imagine-video-1.5` |

Grok 動画のパラメーター：`duration_seconds`（1–15 秒）、`ratio`（`1:1` `16:9` `9:16` `4:3` `3:4` `3:2` `2:3`）、`video_resolution`（`480p` / `720p` / `1080p`）。参照画像なしは `text_to_video`、首フレームは `image_to_video`、首尾フレームは `first_last_frames`、ショットに紐づく参照画像は `multimodal_reference`（最大 7 枚）を自動選択します。1080p はテキスト/画像からの生成のみで、それ以外は 720p に調整されます。

## 🖥️ ローカル ComfyUI 動画

1. ComfyUI を起動（既定 `http://127.0.0.1:8188`、Docker からは `http://host.docker.internal:8188`）
2. 「設定 → 動画 → 追加」で「本地 ComfyUI」テンプレートを選択（API Key は空欄可）
3. ComfyUI の「エクスポート (API)」で出力した JSON を貼り付け。空欄なら内蔵の Wan 2.2 TI2V 5B テンプレートを使用

処理の流れ：`POST /upload/image` → `POST /prompt` → `GET /history/{prompt_id}` → `GET /view`。ワークフローでは `{{prompt}}` `{{negative_prompt}}` `{{seed}}` `{{width}}` `{{height}}` `{{duration}}` `{{fps}}` `{{frames}}` `{{aspect_ratio}}` `{{resolution}}` `{{model}}` `{{image}}` `{{first_frame}}` `{{last_frame}}` `{{reference_image_1..9}}` が使えます。素材のない画像プレースホルダーは `LoadImage` ノードごと除去されるため、`start_image` が任意のワークフローならテキスト / 画像どちらからでも生成できます。

## 📦 デプロイ

- **デスクトップ**：`npm run build:frontend` の後 `cd desktop && npm install && npm run dist`（macOS）/ `npm run dist:win`（Windows）
- **サーバー**：`cd frontend && npm run generate && cp -r .output/public dist`、`cd backend && npm start`
- **Docker**：`cp .env.example .env` の後 `UU889_VERSION=1.0.0 docker compose up -d --build`（データはボリューム `uu889-data`）

詳細は [简体中文 README](README.zh-CN.md) / [English README](README.md) を参照してください。

## 📄 ライセンスとクレジット

本プロジェクトは [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) を元にしており、原作者が著作権を保持します（上流のコミット履歴を保持）。上流と同じく **[CC BY-NC-SA 4.0](LICENSE)** で公開しており、**商用利用は原作者の書面による許可なく禁止**です。
