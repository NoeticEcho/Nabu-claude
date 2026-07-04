#!/usr/bin/env bash
# PreToolUse(Bash) hook — предохранитель против заведомо разрушительных команд.
# НЕ заменяет approval-механизм. Извлекает command через jq → python3 → sed.
# При катастрофичных паттернах — deny; иначе — continue. Fail-safe: не крашится.
#
# ГРАНИЦА ПОКРЫТИЯ (важно): этот хук видит только инструмент Bash. Деструктив по БД,
# идущий через MCP-tools (supabase/typedb `query`, `database_delete`), сюда НЕ попадает —
# он контролируется approval-механизмом (governance) и правами MCP-серверов. См. SAFETY.md.
set -uo pipefail

stdin=$(cat)

# ── Извлечь tool_input.command (jq → python3 → sed) ──
extract_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$stdin" | jq -r '.tool_input.command // empty' 2>/dev/null && return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$stdin" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null && return
  fi
  printf '%s' "$stdin" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(\([^"\\]\|\\.\)*\)".*/\1/p' | head -1
}
cmd=$(extract_command)

deny() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg c "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",additionalContext:$c}}'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys;print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','additionalContext':sys.argv[1]}},ensure_ascii=False))" "$1"
  else
    esc=$(printf '%s' "$1" | sed 's/"/\\"/g')
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","additionalContext":"%s"}}' "$esc"
  fi
  exit 0
}

# Непустой stdin, но команда не извлеклась — не блокируем всё подряд, честно предупреждаем.
if [[ -n "$stdin" && -z "$cmd" ]]; then
  echo "[nabu-guard] предупреждение: не удалось разобрать команду для проверки безопасности" >&2
  printf '{"continue":true}'
  exit 0
fi

# ── Нормализация: снимаем известные маскировки перед матчингом ──
# Убираем кавычки (') (") и обратные слэши: rm -rf "/etc" и \rm → rm -rf /etc / rm.
# ${VAR} → $VAR: rm -rf ${HOME} → rm -rf $HOME.
n=$(printf '%s' "$cmd" | tr -d '\42\47\134')
n=$(printf '%s' "$n" | sed -E 's/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/$\1/g')

# `--` останавливает разбор опций grep: паттерны, начинающиеся с "-" (напр. -s, --delete, -f),
# иначе трактуются как флаги grep, а не как регэксп.
has() { printf '%s' "$n" | grep -qE -- "$1"; }
hasi() { printf '%s' "$n" | grep -qiE -- "$1"; }

# Границы: команда в начале, после пробела/;/&/|/( ИЛИ с префиксом пути (/bin/rm, env rm — через пробел).
CMD_B='(^|[[:space:];&|(/])'
# Опасные цели (домашние/системные/корневые/глоб у корня). $HOME/${HOME}/~ учтены после нормализации.
DANGER_TGT='(~($|/)|\$HOME($|/)|(^|[[:space:]])/($|[[:space:]]|\*)|(^|[[:space:]])/(etc|usr|bin|sbin|boot|var|lib|lib64|sys|dev|proc|opt|root|home|System|Library|Applications)($|/|[[:space:]]))'

# ── 1. rm с рекурсией+force ──
is_rm_rf=0
if has "${CMD_B}rm([[:space:]]|$)" \
   && has '([[:space:]]-[a-zA-Z]*r|--recursive)' \
   && has '([[:space:]]-[a-zA-Z]*f|--force)'; then
  is_rm_rf=1
fi

# --no-preserve-root — почти всегда катастрофа.
has 'no-preserve-root' && deny "Заблокировано: --no-preserve-root. Используйте approval с точным путём."

# rm -rf по опасным целям.
if [[ "$is_rm_rf" -eq 1 ]] && has "$DANGER_TGT"; then
  deny "Заблокировано: рекурсивное удаление домашних/системных/корневых путей. Уточните путь или используйте approval."
fi

# ── 2. Альтернативные инструменты массового удаления/усечения ──
# find … -delete  и  find … -exec rm …
if has 'find[[:space:]].+-delete([[:space:]]|$)'; then
  deny "Заблокировано: find -delete (массовое удаление). Нужен явный approval."
fi
if has 'find[[:space:]].*-exec[[:space:]]+rm' && has '(-[a-zA-Z]*[rf]|--force|--recursive)'; then
  deny "Заблокировано: find -exec rm (массовое удаление). Нужен явный approval."
fi
# shred (уничтожение файла)
has "${CMD_B}shred([[:space:]]|$)" && deny "Заблокировано: shred (безвозвратное уничтожение файла). Нужен approval."
# truncate -s 0 (обнуление файла)
if has "${CMD_B}truncate([[:space:]]|$)" && has '-s[[:space:]]*['\''"]?[+]?0'; then
  deny "Заблокировано: truncate -s 0 (обнуление файла). Нужен approval."
fi
# rsync --delete по опасной цели
if has "${CMD_B}rsync([[:space:]]|$)" && has '--delete' && has "$DANGER_TGT"; then
  deny "Заблокировано: rsync --delete по системной/корневой цели. Нужен approval."
fi

# ── 2.9 Docker-тома и nabu-деструктив (r4): данные пользователя ──
if has 'docker[[:space:]]'; then
  has 'volume[[:space:]]+rm'                        && deny "Заблокировано: docker volume rm (тома с данными пользователя). Нужен approval."
  has 'volume[[:space:]]+prune'                     && deny "Заблокировано: docker volume prune. Нужен approval."
  if has 'compose' && has 'down' && { has '[[:space:]]-v([[:space:]]|$)' || has '--volumes'; }; then
    deny "Заблокировано: docker compose down -v (уничтожает тома памяти Nabu). Нужен approval."
  fi
fi
# nabu reset/uninstall с флагами, подавляющими подтверждение, — только руками пользователя.
if has 'nabu([[:space:]]|\.mjs[[:space:]])' || has 'nabu\.mjs'; then
  if has '(reset|uninstall|restore)([[:space:]]|$)'; then
    { has '--yes' || has '--purge-workspace' || has '--hard'; } && deny "Заблокировано: nabu reset/uninstall/restore с --yes/--purge-workspace/--hard из модели. Подтверждение — только у пользователя."
  fi
fi

# ── 3. Разрушительные git-операции ──
if has 'git[[:space:]]'; then
  has 'reset[[:space:]]+--hard'                    && deny "Заблокировано: git reset --hard. Нужен approval."
  if has 'push([[:space:]]|$)' && { has '[[:space:]]-f([[:space:]]|$)' || has '--force'; }; then
    deny "Заблокировано: git push --force. Нужен approval."
  fi
  has 'push[[:space:]].*[[:space:]]\+[^[:space:]]+:' && deny "Заблокировано: git push с force-refspec (+). Нужен approval."
  has 'clean[[:space:]]+-[a-zA-Z]*f'               && deny "Заблокировано: git clean -f. Нужен approval."
  has 'branch[[:space:]]+-[a-zA-Z]*D'              && deny "Заблокировано: git branch -D (принудительное удаление ветки). Нужен approval."
  has 'reflog[[:space:]]+expire'                   && deny "Заблокировано: git reflog expire. Нужен approval."
  has 'filter-branch'                              && deny "Заблокировано: git filter-branch (переписывание истории). Нужен approval."
  has 'stash[[:space:]]+clear'                     && deny "Заблокировано: git stash clear. Нужен approval."
fi

# ── 4. Деструктивный SQL через Bash-клиент (psql/mysql/…). Только при наличии SQL-клиента,
#       чтобы не блокировать grep/echo с текстом "DROP TABLE". ──
if hasi "${CMD_B}(psql|mysql|mariadb|sqlite3|mongosh|mongo|cockroach|usql)([[:space:]]|$)" \
   || hasi 'supabase[[:space:]]+db'; then
  hasi 'drop[[:space:]]+(table|database|schema)' && deny "Заблокировано: DROP TABLE/DATABASE/SCHEMA через SQL-клиент. Нужен approval."
  hasi 'truncate[[:space:]]+(table[[:space:]]+)?[a-z_]'  && deny "Заблокировано: TRUNCATE через SQL-клиент. Нужен approval."
  if hasi 'delete[[:space:]]+from' && ! hasi 'where'; then
    deny "Заблокировано: DELETE FROM без WHERE через SQL-клиент. Нужен approval."
  fi
fi

# ── 5. Перезапись диска/устройств, форк-бомба, выключение ──
if has "${CMD_B}mkfs" \
   || has 'dd[[:space:]].*of=/dev/' \
   || has '>[[:space:]]*/dev/(sd|nvme|disk|hd)' \
   || has ':\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|' \
   || has '[a-zA-Z_][a-zA-Z0-9_]*\(\)[[:space:]]*\{[^}]*\|[^}]*&' \
   || has "${CMD_B}(shutdown|reboot|halt|poweroff)([[:space:]]|$)"; then
  deny "Заблокировано: разрушительная системная команда (mkfs/dd/форк-бомба/выключение). Нужен approval."
fi

printf '{"continue":true}'
exit 0
