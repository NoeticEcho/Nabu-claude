#!/usr/bin/env bash
# install-cron.sh — опциональная регистрация проактивной задачи Nabu в системный crontab
# (headless-запуск claude без открытой сессии). Требует установленный `claude` CLI.
# Работает независимо от Claude Code UI; для облачного варианта используйте /schedule.
#
# Использование:
#   install-cron.sh <job> "<cron-expr>"   # напр.: install-cron.sh digest "0 9 * * *"
#   install-cron.sh --list
#   install-cron.sh --remove <job>
set -euo pipefail

NABU_HOME="${NABU_HOME:-$HOME/nabu}"
TAG="# nabu-cron"

declare -A PROMPTS=(
  [consolidate]="/nabu-consolidate"
  [digest]="/nabu-digest неделя"
  [research]="/nabu-research"
  [scout]="/nabu-scout"
  [feedback]="/nabu-feedback"
  [metrics]="/nabu-metrics"
)

cmd="${1:-}"

if [[ "$cmd" == "--list" ]]; then
  crontab -l 2>/dev/null | grep "$TAG" || echo "нет задач Nabu в crontab"
  exit 0
fi

if [[ "$cmd" == "--remove" ]]; then
  job="${2:?укажите job}"
  # R7-G11: валидируем job по известным задачам (как install-путь) — иначе regex-метасимволы в $job
  # могли бы задеть лишние строки crontab. Совпадение — как фиксированную строку (grep -F).
  [[ -n "${PROMPTS[$job]:-}" ]] || { echo "неизвестная задача: $job. Доступно: ${!PROMPTS[*]}"; exit 1; }
  crontab -l 2>/dev/null | grep -vF "$TAG $job" | crontab - || true
  echo "удалено: $job"
  exit 0
fi

job="$cmd"
cronexpr="${2:?укажите cron-выражение, напр. \"0 9 * * *\"}"
prompt="${PROMPTS[$job]:-}"
[[ -z "$prompt" ]] && { echo "неизвестная задача: $job. Доступно: ${!PROMPTS[*]}"; exit 1; }

CLAUDE_BIN=$(command -v claude || true)
if [[ -z "$CLAUDE_BIN" ]]; then
  echo "ОШИБКА: не найден CLI 'claude'. Установите Claude Code CLI или используйте /schedule (облако)."
  exit 1
fi

# cron: минимальный PATH → нужен АБСОЛЮТНЫЙ путь к claude. '%' в crontab = перевод строки → экранируем.
# Вывод в лог-файл (не /dev/null), чтобы падения были диагностируемы.
prompt_escaped="${prompt//%/\\%}"
logfile="$NABU_HOME/.nabu-cron.log"
line="$cronexpr cd \"$NABU_HOME\" && \"$CLAUDE_BIN\" -p \"$prompt_escaped\" >> \"$logfile\" 2>&1 $TAG $job"
# заменить существующую строку этой задачи, если есть
(crontab -l 2>/dev/null | grep -v "$TAG $job\$"; echo "$line") | crontab -
echo "установлено: [$job] $cronexpr → claude -p \"$prompt\" (cwd $NABU_HOME)"
echo "проверить: crontab -l | grep nabu-cron"
