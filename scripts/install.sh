#!/usr/bin/env bash
# scripts/install.sh — одностро́чный установщик Nabu-claude.
#
#   curl -fsSL https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.sh | bash
#
# Идемпотентно: повторный запуск обновляет существующую установку (git pull --ff-only),
# переустанавливает зависимости и пересобирает. Ничего не удаляет.
#
# Режимы:
#   - INFRA=1 (по умолчанию, если есть docker): полный zero-config — .env, docker-стек,
#     применение схем, локальная embedding-модель (через `nabu init`).
#   - INFRA=0 (docker нет): ставит только CLI/зависимости; печатает, что доделать вручную.
#     Docker обязателен: Nabu — standalone (локальный стек БД).
#
# Переменные-оверрайды:
#   NABU_INSTALL_DIR  куда ставить            (по умолчанию $HOME/.nabu-claude)
#   NABU_REPO         git-URL репозитория     (см. плейсхолдер ниже)
#   NABU_BRANCH       ветка                   (по умолчанию master)
set -euo pipefail

# ── Конфиг (оверрайдится через env) ─────────────────────────────────────────
# ПЛЕЙСХОЛДЕР: замените на реальный публичный URL репозитория при релизе.
NABU_REPO="${NABU_REPO:-https://github.com/noeticecho/nabu-claude.git}"
NABU_BRANCH="${NABU_BRANCH:-master}"
NABU_INSTALL_DIR="${NABU_INSTALL_DIR:-$HOME/.nabu-claude}"

INFRA=1

# ── Вывод ────────────────────────────────────────────────────────────────────
c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_red=$'\033[31m'; c_yellow=$'\033[33m'; c_green=$'\033[32m'
info()  { echo "${c_bold}▸${c_reset} $*"; }
ok()    { echo "${c_green}✓${c_reset} $*"; }
warn()  { echo "${c_yellow}⚠${c_reset}  $*" >&2; }
die()   { echo "${c_red}✗ $*${c_reset}" >&2; exit "${2:-1}"; }

# ── Проверка предзависимостей ────────────────────────────────────────────────
info "Проверка предзависимостей…"

command -v git >/dev/null 2>&1 || die "Не найден git. Установите git и повторите." 2

command -v node >/dev/null 2>&1 || die "Не найден node (нужен Node.js >= 22). См. https://nodejs.org/" 3
node_major="$(node -v | sed -nE 's/^v([0-9]+)\..*/\1/p')"
[[ -z "$node_major" ]] && die "Не удалось определить версию node ($(node -v))." 3
(( node_major >= 22 )) || die "Требуется Node.js >= 22, а установлен $(node -v). Обновите node." 3

command -v npm >/dev/null 2>&1 || die "Не найден npm (обычно ставится вместе с Node.js)." 4

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    ok "docker + docker compose (v2) на месте"
  else
    warn "docker есть, но нет плагина 'docker compose' (v2). Zero-config стек не запустится."
    warn "Установите Compose v2: https://docs.docker.com/compose/install/"
    INFRA=0
  fi
else
  warn "docker не найден — пропускаю локальный стек (INFRA=0)."
  warn "Для zero-config установите Docker: https://docs.docker.com/engine/install/"
  warn "Без Docker Nabu работать не будет — установите его и повторите."
  INFRA=0
fi

command -v claude >/dev/null 2>&1 && ok "claude CLI найден" \
  || warn "claude CLI не найден — плагин Claude Code не обязателен для установки, но нужен для работы. https://docs.claude.com/claude-code"

# ── Определяем: запуск ИЗ чекаута или через curl | bash ──────────────────────
# Если скрипт лежит внутри дерева, где есть .claude-plugin/plugin.json — используем это дерево
# как каталог установки и НЕ клонируем.
self_src="${BASH_SOURCE[0]:-$0}"
from_checkout=0
if [[ -f "$self_src" ]]; then
  script_dir="$(cd "$(dirname "$self_src")" && pwd)"
  repo_root="$(cd "$script_dir/.." && pwd)"
  if [[ -f "$repo_root/.claude-plugin/plugin.json" ]]; then
    NABU_INSTALL_DIR="$repo_root"
    from_checkout=1
  fi
fi

# ── Получаем/обновляем исходники ─────────────────────────────────────────────
if [[ "$from_checkout" -eq 1 ]]; then
  info "Запуск из чекаута — использую $NABU_INSTALL_DIR (clone пропущен)"
elif [[ -d "$NABU_INSTALL_DIR/.git" ]]; then
  info "Обновляю существующую установку: $NABU_INSTALL_DIR"
  git -C "$NABU_INSTALL_DIR" pull --ff-only
else
  info "Клонирую $NABU_REPO ($NABU_BRANCH) → $NABU_INSTALL_DIR"
  git clone --branch "$NABU_BRANCH" "$NABU_REPO" "$NABU_INSTALL_DIR"
fi

cd "$NABU_INSTALL_DIR"

# ── Зависимости и сборка ─────────────────────────────────────────────────────
info "npm install…"
npm install
info "npm run build…"
npm run build

# ── Линкуем CLI в ~/.local/bin ───────────────────────────────────────────────
bin_dir="$HOME/.local/bin"
mkdir -p "$bin_dir"
chmod +x cli/nabu.mjs 2>/dev/null || true
ln -sf "$PWD/cli/nabu.mjs" "$bin_dir/nabu"
ok "CLI слинкован: $bin_dir/nabu → $PWD/cli/nabu.mjs"

case ":$PATH:" in
  *":$bin_dir:"*) : ;;
  *) warn "$bin_dir не в PATH. Добавьте в ~/.profile или ~/.zshrc строку:"
     echo "    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

nabu_cmd="$bin_dir/nabu"

# ── Инициализация инфраструктуры (zero-config) ───────────────────────────────
if [[ "$INFRA" -eq 1 ]]; then
  info "Инициализация: .env, docker-стек, схемы, embedding-модель…"
  node cli/nabu.mjs init
  ok "Инфраструктура готова"
else
  warn "INFRA=0 — автоинициализация пропущена. Дальше вручную:"
  echo "    1) Установите Docker + Compose v2 и повторите этот скрипт, ЛИБО"
  echo "    2) повторите установку: bash scripts/install.sh"
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo
ok "${c_bold}Nabu-claude установлен.${c_reset}"
echo "Каталог: $NABU_INSTALL_DIR"
echo
echo "Команды:"
echo "    ${c_bold}nabu start${c_reset}    — поднять локальный стек"
echo "    ${c_bold}nabu chat${c_reset}     — открыть чат с адъютантом"
echo "    ${c_bold}nabu status${c_reset}   — проверить состояние"
echo "    ${c_bold}nabu update${c_reset}   — обновить установку"
echo
[[ "$nabu_cmd" != "nabu" ]] && echo "(если ${c_bold}nabu${c_reset} не находится — используйте полный путь $nabu_cmd или добавьте ~/.local/bin в PATH)"
