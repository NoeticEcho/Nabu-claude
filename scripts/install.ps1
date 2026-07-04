# scripts/install.ps1 — установщик Nabu-claude для Windows (PowerShell 5.1+/7+).
#
#   irm https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.ps1 | iex
#
# Идемпотентно: повторный запуск обновляет установку (git pull --ff-only) и пересобирает.
# Переменные-оверрайды (задать до запуска): $env:NABU_INSTALL_DIR, $env:NABU_REPO, $env:NABU_BRANCH.
# Требуется: git, Node >=22, npm, Docker Desktop (обязателен: Nabu — standalone, локальный стек БД).

$ErrorActionPreference = "Stop"

# ── Конфиг ───────────────────────────────────────────────────────────────────
# ПЛЕЙСХОЛДЕР: замените на реальный публичный URL репозитория при релизе.
$Repo   = if ($env:NABU_REPO)        { $env:NABU_REPO }        else { "https://github.com/noeticecho/nabu-claude.git" }
$Branch = if ($env:NABU_BRANCH)      { $env:NABU_BRANCH }      else { "master" }
$Dir    = if ($env:NABU_INSTALL_DIR) { $env:NABU_INSTALL_DIR } else { Join-Path $HOME ".nabu-claude" }

function Ok($m)   { Write-Host "[OK] $m"   -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m"   -ForegroundColor Yellow }
function Fail($m, $code = 1) { Write-Host "[X]  $m" -ForegroundColor Red; exit $code }

# ── Предусловия ──────────────────────────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "git не найден. Установите: https://git-scm.com/download/win" 2 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js не найден. Установите Node >=22: https://nodejs.org" 3 }
$nodeMajor = [int]((node -v) -replace "^v(\d+).*", '$1')
if ($nodeMajor -lt 22) { Fail "Нужен Node >=22 (сейчас $(node -v))" 3 }
Ok "Node $(node -v)"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm не найден" 4 }

$Infra = $true
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Warn "Docker не найден — Nabu работать не будет. Установите Docker Desktop и повторите."
  Warn "Docker Desktop: https://docs.docker.com/desktop/install/windows-install/"
  $Infra = $false
} else {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Warn "Docker установлен, но не запущен — запустите Docker Desktop."; $Infra = $false }
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Warn "claude CLI не найден — чат и расписание не заработают без него (https://claude.com/claude-code)."
}

# ── Клонирование/обновление ─────────────────────────────────────────────────
# Если запущено из checkout — использовать его.
$fromCheckout = $false
if ($PSScriptRoot -and (Test-Path (Join-Path (Split-Path $PSScriptRoot -Parent) ".claude-plugin\plugin.json"))) {
  $Dir = Split-Path $PSScriptRoot -Parent
  $fromCheckout = $true
  Ok "Установка из checkout: $Dir"
} elseif (Test-Path (Join-Path $Dir ".git")) {
  git -C $Dir pull --ff-only
  Ok "Обновлено: $Dir"
} else {
  git clone --branch $Branch $Repo $Dir
  Ok "Клонировано: $Dir"
}

# ── Сборка ──────────────────────────────────────────────────────────────────
Push-Location $Dir
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install завершился с ошибкой ($LASTEXITCODE)" 5 }
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "npm run build завершился с ошибкой ($LASTEXITCODE)" 6 }
  Ok "Сборка завершена"

  # ── Обёртка nabu.cmd в %LOCALAPPDATA%\nabu ────────────────────────────────
  $binDir = Join-Path $env:LOCALAPPDATA "nabu"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $cliPath = Join-Path $Dir "cli\nabu.mjs"
  Set-Content -Path (Join-Path $binDir "nabu.cmd") -Value "@echo off`r`nnode `"$cliPath`" %*" -Encoding ascii
  # добавить в PATH пользователя, если ещё нет
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
    Warn "Каталог $binDir добавлен в PATH — перезапустите терминал."
  }
  Ok "Команда nabu доступна (nabu.cmd → node cli\nabu.mjs)"

  # ── Инициализация ───────────────────────────────────────────────────────
  if ($Infra) {
    node $cliPath init
    if ($LASTEXITCODE -ne 0) { Warn "nabu init завершился с ошибкой — выполните вручную: nabu doctor" }
  } else {
    Warn "Пропускаю nabu init (нет Docker). Установите Docker Desktop и запустите: nabu init"
  }
} finally { Pop-Location }

Write-Host ""
Ok "Готово. Команды: nabu start · nabu chat · nabu status · nabu stats · nabu update"
