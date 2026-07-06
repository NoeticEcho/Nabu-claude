#!/usr/bin/env bash
# init-workspace.sh — идемпотентная инициализация рабочей директории Nabu (фича 7).
# Создаёт $NABU_HOME (по умолчанию ~/nabu): git-репо + структура «горнило → обработка → выход».
# Безопасно запускать многократно (--ensure); ничего не перезаписывает.
#
# Использование:
#   init-workspace.sh            # создать/дополнить workspace, вывести путь
#   init-workspace.sh --ensure   # тихо гарантировать существование (для SessionStart-hook)
#   NABU_HOME=/path init-workspace.sh
set -euo pipefail

NABU_HOME="${NABU_HOME:-$HOME/nabu}"
NAMESPACE="${NABU_NAMESPACE:-default}"
# Версия — из манифеста плагина, не хардкод (иначе дрейфует при релизах).
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NABU_VERSION=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null | head -1)
[[ -z "$NABU_VERSION" ]] && NABU_VERSION="unknown"
QUIET=0
[[ "${1:-}" == "--ensure" ]] && QUIET=1

log() { [[ "$QUIET" -eq 0 ]] && echo "$@" || true; }

created=0
if [[ ! -d "$NABU_HOME" ]]; then
  mkdir -p "$NABU_HOME"
  created=1
fi

# ── Структура: числовые префиксы = поток обработки (горнило → знание → выход) ──
DIRS=(
  ".nabu"                 # метаданные Nabu (конфиг, состояние) — не для пользователя
  ".nabu/state"           # рантайм-состояние (очередь фидбэка, курсоры, кэш)
  "00-inbox"              # ГОРНИЛО: сюда скидывается всё необработанное (любой формат)
  "00-inbox/voice"        # голосовые записи на транскрипцию
  "10-knowledge"          # обработанные знания (md) по жизненному циклу
  "10-knowledge/fleeting"     # мимолётные заметки
  "10-knowledge/literature"   # проработанные из источников
  "10-knowledge/evergreen"    # устойчивые «вечнозелёные»
  "20-domains"            # выход по сферам жизни (md)
  "30-council"            # совещания и решения Совета (md)
  "40-projects"           # паспорта проектов, спеки (document-synthesizer)
  "50-digests"            # дайджесты день/неделя/месяц + автобиографические нарративы
  "60-metrics"            # логи метрик, корреляции, записи обратной связи
  "90-system"             # само-улучшение: предложения ресерчера, отчёты eval, changelog
  "90-system/proposals"
  "90-system/evals"
)
for d in "${DIRS[@]}"; do mkdir -p "$NABU_HOME/$d"; done

# ── Доменные поддиректории (9 министров) ──
for dom in health mind finance work learning relationships growth lifestyle admin; do
  mkdir -p "$NABU_HOME/20-domains/$dom"
done

# ── README в горнило и корень (единожды) ──
if [[ ! -f "$NABU_HOME/00-inbox/README.md" ]]; then
  cat > "$NABU_HOME/00-inbox/README.md" <<'EOF'
# Горнило (Inbox)

Скидывай сюда всё необработанное: заметки, вырезки, голос (в `voice/`), файлы, ссылки.
Nabu разбирает горнило (`/nabu-index`, конвейер приёма→понимания→связывания), извлекает
сущности/факты в память (общая БД), а структурированный результат кладёт в `10-knowledge/`,
`20-domains/`, `30-council/` и т.д. Приватное обрабатывается локально и не уходит в облако.
EOF
fi

if [[ ! -f "$NABU_HOME/README.md" ]]; then
  cat > "$NABU_HOME/README.md" <<'EOF'
# Nabu — рабочая директория

Личное пространство знаний и решений, управляемое Nabu-claude. Git-репозиторий: история
изменений ведётся автоматически (коммит после значимых правок).

## Поток
`00-inbox/` (горнило) → обработка Советом/конвейером → структурированный md-выход:
- `10-knowledge/` — знания по жизненному циклу (fleeting → literature → evergreen)
- `20-domains/` — по сферам жизни (health, mind, finance, work, learning, relationships, growth, lifestyle, admin)
- `30-council/` — совещания и коллегиальные решения
- `40-projects/` — паспорта проектов и спецификации
- `50-digests/` — сводки и автобиографические нарративы
- `60-metrics/` — метрики жизни, корреляции, обратная связь
- `90-system/` — само-улучшение Nabu (предложения, оценки, changelog)

`.nabu/` — служебные метаданные (не редактировать вручную).
EOF
fi

# ── Конфиг workspace (единожды) ──
if [[ ! -f "$NABU_HOME/.nabu/config.json" ]]; then
  cat > "$NABU_HOME/.nabu/config.json" <<EOF
{
  "namespace": "$NAMESPACE",
  "version": "$NABU_VERSION",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "inbox": "00-inbox",
  "mode": "standalone"
}
EOF
fi

# ── .gitignore (приватное состояние не коммитим) ──
if [[ ! -f "$NABU_HOME/.gitignore" ]]; then
  cat > "$NABU_HOME/.gitignore" <<'EOF'
.nabu/state/
*.tmp
.DS_Store
EOF
fi

# ── git init + первый коммит ──
if [[ ! -d "$NABU_HOME/.git" ]]; then
  git -C "$NABU_HOME" init -q
  git -C "$NABU_HOME" add -A
  git -C "$NABU_HOME" -c user.name="Nabu" -c user.email="nabu@local" commit -q -m "init: Nabu workspace" || true
  log "git: инициализирован репозиторий $NABU_HOME"
fi

if [[ "$created" -eq 1 ]]; then
  log "Nabu workspace создан: $NABU_HOME"
else
  log "Nabu workspace готов: $NABU_HOME"
fi
echo "$NABU_HOME"
