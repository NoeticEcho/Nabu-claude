#!/usr/bin/env bash
# SessionStart hook — гарантирует workspace Nabu и впрыскивает контекст сессии.
# Идемпотентно и безопасно. Вывод — JSON с additionalContext (доп. контекст для модели).
set -uo pipefail

NABU_HOME="${NABU_HOME:-$HOME/nabu}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Инициализировать workspace, если ещё нет (если не отключено).
if [[ "${NABU_NO_AUTOINIT:-0}" != "1" ]]; then
  bash "$PLUGIN_ROOT/scripts/init-workspace.sh" --ensure >/dev/null 2>&1 || true
fi

# Собрать краткий статус (без чтения приватного контента).
inbox_count=0
# Только верхний уровень горнила (не считаем 00-inbox/voice/ и прочие подпапки).
[[ -d "$NABU_HOME/00-inbox" ]] && inbox_count=$(find "$NABU_HOME/00-inbox" -maxdepth 1 -type f ! -name "README.md" 2>/dev/null | wc -l | tr -d ' ')

ctx="Nabu workspace: $NABU_HOME (горнило 00-inbox → md-выход). Необработанных файлов в горниле: $inbox_count."
ctx="$ctx Все агенты — субагенты (agents/*.md); оркестратор — skill nabu-orchestrator. Коллегиальное решение — через Совет (team-режим/deliberation-буфер). Приватное — только локально."
if [[ "$inbox_count" -gt 0 ]]; then
  ctx="$ctx Есть необработанные файлы в горниле — можно предложить /nabu-index 00-inbox."
fi

# Экранировать для JSON: jq → python3 → безопасный fallback (без python3 больше не теряем контекст).
if command -v jq >/dev/null 2>&1; then
  jq -n --arg c "$ctx" '{continue:true,hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$ctx" <<'PY' 2>/dev/null || printf '{"continue":true}'
import json,sys
print(json.dumps({
  "continue": True,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": sys.argv[1]
  }
}, ensure_ascii=False))
PY
else
  printf '{"continue":true}'
fi
exit 0
