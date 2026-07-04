#!/usr/bin/env bash
# PostToolUse(Write|Edit) hook — авто-коммит изменений ВНУТРИ workspace Nabu (фича 7).
# Срабатывает только если правится файл под $NABU_HOME; иначе тихо выходит (не трогает
# исходники плагина и чужие проекты). Никогда не блокирует.
#
# Коммитит ТОЛЬКО изменённый файл (pathspec), не `git add -A` — чтобы параллельные правки
# не попадали под чужое сообщение. Гонку на .git/index.lock переживаем retry-петлёй.
set -uo pipefail

NABU_HOME="${NABU_HOME:-$HOME/nabu}"
stdin=$(cat)

# Прочитать file_path из stdin (jq → python3 → sed).
extract_fp() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$stdin" | jq -r '.tool_input.file_path // empty' 2>/dev/null && return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$stdin" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null && return
  fi
  printf '%s' "$stdin" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}
fp=$(extract_fp)

nabu_abs=$(cd "$NABU_HOME" 2>/dev/null && pwd || echo "$NABU_HOME")

# Повтор git-операции при занятом index.lock (параллельные Write/Edit).
git_retry() {
  local i
  for i in 1 2 3 4 5; do
    if git -C "$nabu_abs" "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

case "$fp" in
  "$nabu_abs"/*)
    rel="${fp#"$nabu_abs"/}"
    git_retry add -- "$rel" || exit 0
    # Только если у ЭТОГО файла есть застейдженные изменения.
    if ! git -C "$nabu_abs" diff --cached --quiet -- "$rel" 2>/dev/null; then
      git_retry -c user.name="Nabu" -c user.email="nabu@local" \
        commit -q -m "nabu: обновление $rel" -- "$rel" || true
    fi
    ;;
esac
exit 0
