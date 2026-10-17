/**
 * 后台下载脚本：放到远程机器（或本机）后在后台独立运行（UU889-Drama 关掉、断网也会继续下完）。
 *
 * - macOS / Linux：POSIX sh + curl（没有 curl 用 wget），远程 nohup（+ setsid）后台运行，本机用独立会话的进程
 * - Windows：PowerShell + curl.exe（Windows 10 1803+ 自带），用 WMI 创建进程，SSH 断开后不会被结束
 *
 * 每个文件：已存在且大小正确 → 跳过；否则下载到 <文件>.uu889part，按来源顺序尝试（每个来源重试 3 次，
 * 续传 curl -C -），下完核对大小与 SHA256（不知道精确大小的文件至少要 1 MB），再改名为正式文件。
 * 进度写在 status.log，后端轮询读取；全部结束后删掉脚本本身（里面可能有下载 Token）。
 * 所有进程的命令行都带 uu889dl-<任务 ID>，暂停 / 取消时按它结束进程。
 */
import { psQuote, shQuote, type TargetOs } from './target'

export interface ScriptItem {
  dest: string
  bytes?: number
  sha256?: string
  sources: Array<{ label: string; url: string; headers?: Record<string, string> }>
}

export function jobTag(jobId: string): string {
  return `uu889dl-${jobId}`
}

export function buildPosixScript(jobId: string, jobDir: string, items: ScriptItem[]): string {
  const tag = jobTag(jobId)
  const lines = [
    '#!/bin/sh',
    `# UU889-Drama 模型下载任务 ${jobId}（自动生成）`,
    `JOB_DIR=${shQuote(jobDir)}`,
    'LOG="$JOB_DIR/status.log"',
    'echo $$ > "$JOB_DIR/pid"',
    'log() { echo "$*" >> "$LOG"; }',
    'fsize() { if [ -f "$1" ]; then wc -c < "$1" | tr -d \' \'; else echo 0; fi; }',
    'sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d\' \' -f1; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d\' \' -f1; else echo -; fi; }',
    // fetch url out [curl 额外参数]
    'fetch() {',
    '  url="$1"; out="$2"; shift 2',
    '  if command -v curl >/dev/null 2>&1; then',
    `    curl -L --fail --silent --show-error -C - --connect-timeout 20 --speed-limit 1024 --speed-time 120 -A ${shQuote(tag)} "$@" -o "$out" "$url"; rc=$?`,
    '    if [ $rc -eq 33 ] || [ $rc -eq 36 ]; then rm -f "$out"; fi',
    '    return $rc',
    '  fi',
    `  wget -q -c -T 60 -t 2 -U ${shQuote(tag)} -O "$out" "$url"; return $?`,
    '}',
    // dl 序号 目标 字节数(0=未知) sha256(-=未知) 然后若干组：标签 URL 头参数
    'dl() {',
    '  i=$1; dest=$2; bytes=$3; want=$4; shift 4',
    '  if [ -f "$dest" ] && { { [ "$bytes" = 0 ] && [ "$(fsize "$dest")" -ge 1048576 ]; } || [ "$(fsize "$dest")" = "$bytes" ]; }; then log "SKIP $i"; return 0; fi',
    '  mkdir -p "$(dirname "$dest")"; part="$dest.uu889part"; log "BEGIN $i"',
    '  while [ $# -ge 3 ]; do',
    '    label=$1; url=$2; hdr=$3; shift 3; ok=0; n=0',
    '    while [ $n -lt 3 ]; do',
    '      if [ "$bytes" != 0 ] && [ "$(fsize "$part")" = "$bytes" ]; then ok=1; break; fi',
    '      log "SOURCE $i $label"',
    '      if [ -n "$hdr" ]; then fetch "$url" "$part" -H "$hdr" && { ok=1; break; }; else fetch "$url" "$part" && { ok=1; break; }; fi',
    '      n=$((n+1)); log "RETRY $i $n"; sleep 5',
    '    done',
    '    [ $ok = 1 ] || continue',
    '    size=$(fsize "$part")',
    '    if [ "$bytes" != 0 ] && [ "$size" != "$bytes" ]; then log "BADSIZE $i $size"; rm -f "$part"; continue; fi',
    '    if [ "$bytes" = 0 ] && [ "$size" -lt 1048576 ]; then log "BADSIZE $i $size"; rm -f "$part"; continue; fi',
    '    if [ "$want" != - ]; then log "VERIFY $i"; got=$(sha "$part"); if [ "$got" != - ] && [ "$got" != "$want" ]; then log "BADHASH $i"; rm -f "$part"; continue; fi; fi',
    '    mv -f "$part" "$dest" && { log "DONE $i"; return 0; }',
    '  done',
    '  log "FAIL $i"; return 1',
    '}',
  ]
  items.forEach((it, i) => {
    const srcArgs = it.sources.map((s) => {
      const hdr = Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`)[0] || ''
      return `${shQuote(s.label)} ${shQuote(s.url)} ${shQuote(hdr)}`
    }).join(' ')
    lines.push(`dl ${i} ${shQuote(it.dest)} ${it.bytes || 0} ${shQuote(it.sha256 || '-')} ${srcArgs}`)
  })
  lines.push('log FINISHED', 'rm -f "$JOB_DIR/pid" "$JOB_DIR/run.sh"', '')
  return lines.join('\n')
}

export function buildPowerShellScript(jobId: string, jobDir: string, items: ScriptItem[]): string {
  const tag = jobTag(jobId)
  const lines = [
    `# UU889-Drama 模型下载任务 ${jobId}（自动生成）`,
    "$ErrorActionPreference = 'Continue'",
    `$JobDir = ${psQuote(jobDir)}`,
    "$Log = Join-Path $JobDir 'status.log'",
    "Set-Content -LiteralPath (Join-Path $JobDir 'pid') -Value $PID",
    'function Log($m) { Add-Content -LiteralPath $Log -Value $m -Encoding UTF8 }',
    'function FSize($p) { if (Test-Path -LiteralPath $p) { (Get-Item -LiteralPath $p).Length } else { 0 } }',
    '$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source',
    'function Fetch($url, $out, $hdr) {',
    '  if ($curl) {',
    `    $a = @('-L', '--fail', '--silent', '--show-error', '-C', '-', '--connect-timeout', '20', '--speed-limit', '1024', '--speed-time', '120', '-A', ${psQuote(tag)})`,
    "    if ($hdr) { $a += @('-H', $hdr) }",
    "    $a += @('-o', $out, $url)",
    '    & $curl @a 2>$null; $rc = $LASTEXITCODE',
    '    if ($rc -eq 33 -or $rc -eq 36) { Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue }',
    '    return $rc',
    '  }',
    `  try { $h = @{}; if ($hdr) { $kv = $hdr -split ': ', 2; $h[$kv[0]] = $kv[1] }; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -UserAgent ${psQuote(tag)} -Headers $h; return 0 } catch { return 1 }`,
    '}',
    'function Dl($i, $dest, [long]$bytes, $want, $src) {',
    '  if ((Test-Path -LiteralPath $dest) -and (($bytes -eq 0 -and (FSize $dest) -ge 1048576) -or (FSize $dest) -eq $bytes)) { Log "SKIP $i"; return }',
    '  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null',
    '  $part = "$dest.uu889part"; Log "BEGIN $i"',
    '  for ($k = 0; $k -lt $src.Count; $k += 3) {',
    '    $label = $src[$k]; $url = $src[$k + 1]; $hdr = $src[$k + 2]; $ok = $false',
    '    for ($n = 0; $n -lt 3; $n++) {',
    '      if ($bytes -ne 0 -and (FSize $part) -eq $bytes) { $ok = $true; break }',
    '      Log "SOURCE $i $label"',
    '      $rc = Fetch $url $part $hdr',
    '      if ($rc -eq 0) { $ok = $true; break }',
    '      Log "RETRY $i $($n + 1)"; Start-Sleep -Seconds 5',
    '    }',
    '    if (-not $ok) { continue }',
    '    $size = FSize $part',
    '    if ($bytes -ne 0 -and $size -ne $bytes) { Log "BADSIZE $i $size"; Remove-Item -LiteralPath $part -Force; continue }',
    '    if ($bytes -eq 0 -and $size -lt 1048576) { Log "BADSIZE $i $size"; Remove-Item -LiteralPath $part -Force; continue }',
    "    if ($want -ne '-') { Log \"VERIFY $i\"; $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $part).Hash.ToLower(); if ($got -ne $want) { Log \"BADHASH $i\"; Remove-Item -LiteralPath $part -Force; continue } }",
    '    Move-Item -LiteralPath $part -Destination $dest -Force; Log "DONE $i"; return',
    '  }',
    '  Log "FAIL $i"',
    '}',
  ]
  items.forEach((it, i) => {
    const src = it.sources.flatMap((s) => [s.label, s.url, Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`)[0] || '']).map(psQuote).join(', ')
    lines.push(`Dl ${i} ${psQuote(it.dest)} ${it.bytes || 0} ${psQuote(it.sha256 || '-')} @(${src})`)
  })
  lines.push("Log 'FINISHED'", "Remove-Item -LiteralPath (Join-Path $JobDir 'pid'), (Join-Path $JobDir 'run.ps1') -Force -ErrorAction SilentlyContinue", '')
  // PowerShell 5 读无 BOM 的脚本按系统 ANSI 编码，中文路径会乱码：加 UTF-8 BOM
  return `﻿${lines.join('\r\n')}`
}

export function scriptFileName(targetOs: TargetOs): string {
  return targetOs === 'windows' ? 'run.ps1' : 'run.sh'
}

/** status.log 解析结果：每个文件的状态 */
export interface RemoteItemState {
  status: 'pending' | 'downloading' | 'verifying' | 'done' | 'skipped' | 'failed'
  sourceLabel?: string
  retries: number
  error?: string
}

export function parseStatusLog(text: string, count: number): { items: RemoteItemState[]; finished: boolean; current: number | null } {
  const items: RemoteItemState[] = Array.from({ length: count }, () => ({ status: 'pending', retries: 0 }))
  let finished = false
  let current: number | null = null
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim()
    if (!line) continue
    if (line === 'FINISHED') { finished = true; current = null; continue }
    const [cmd, idxStr, ...rest] = line.split(' ')
    const i = Number(idxStr)
    if (!Number.isInteger(i) || !items[i]) continue
    const it = items[i]
    switch (cmd) {
      case 'BEGIN': it.status = 'downloading'; current = i; break
      case 'SOURCE': it.status = 'downloading'; it.sourceLabel = rest[0]; current = i; break
      case 'RETRY': it.retries++; break
      case 'VERIFY': it.status = 'verifying'; break
      case 'BADSIZE': it.error = `下载的文件大小不对（${rest[0]} 字节），换下一个来源`; break
      case 'BADHASH': it.error = 'SHA256 校验不一致，换下一个来源'; break
      case 'DONE': it.status = 'done'; it.error = undefined; if (current === i) current = null; break
      case 'SKIP': it.status = 'skipped'; if (current === i) current = null; break
      case 'FAIL': it.status = 'failed'; it.error = it.error || '所有下载来源都失败了'; if (current === i) current = null; break
    }
  }
  return { items, finished, current }
}
