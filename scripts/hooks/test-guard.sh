#!/usr/bin/env bash
# Тест-таблица для guard-destructive.sh: «команда → ожидание (block|allow)».
# Кейсы block покрывают обходы из AUDIT.md §3.4; кейсы allow — легитимные команды
# (защита от ложных срабатываний). Запуск: bash scripts/hooks/test-guard.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/guard-destructive.sh"

pass=0; fail=0

check() {
  local expect="$1" cmd="$2"
  local input out
  input=$(jq -n --arg c "$cmd" '{tool_input:{command:$c}}')
  out=$(printf '%s' "$input" | bash "$GUARD" 2>/dev/null)
  local got="allow"
  printf '%s' "$out" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"' && got="block"
  if [[ "$got" == "$expect" ]]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    printf '  FAIL [expect %-5s got %-5s] %s\n' "$expect" "$got" "$cmd"
  fi
}

# ── Должны блокироваться (block) ──
# rm -rf вариации / обходы
check block 'rm -rf /etc'
check block 'rm -rf "/etc"'
check block "rm -rf '/'"
check block '/bin/rm -rf /etc'
check block '\rm -rf /'
check block 'env rm -rf /usr'
check block 'rm --recursive --force /etc'
check block 'rm -fr /boot'
check block 'rm -r -f /var'
check block 'rm -rf $HOME'
check block 'rm -rf ${HOME}'
check block 'rm -rf ~'
check block 'rm -rf ~/'
check block 'rm -rf /'
check block 'rm --no-preserve-root -rf /'
check block 'find / -delete'
check block 'find . -name "*.ts" -exec rm -rf {} +'
# альтернативные инструменты массового удаления
check block 'shred -u /etc/passwd'
check block 'truncate -s 0 important.db'
check block 'rsync -a --delete src/ /'
# git-деструктив
check block 'git push --force origin main'
check block 'git push -f'
check block 'git branch -D main'
check block 'git reset --hard HEAD~5'
check block 'git clean -fd'
check block 'git reflog expire --expire=now --all'
check block 'git filter-branch --tree-filter x HEAD'
# SQL-деструктив (мимо MCP, но через Bash-клиент)
check block 'psql "$DATABASE_URL" -c "DROP TABLE users"'
check block 'psql -c "drop database nabu_dev"'
check block 'psql -c "TRUNCATE episodic_memory"'
check block 'mysql -e "DELETE FROM tasks"'
# R7: обход DELETE-без-WHERE через комментарий / имя таблицы
check block 'psql -c "DELETE FROM users; -- keep where clause"'
check block 'psql -c "DELETE FROM audit_log_where"'
check block 'psql -c "DELETE /* where */ FROM users"'
check block 'psql -c "UPDATE users SET admin = true"'
# R7: обход массового удаления через xargs/parallel
check block 'find . -name "*.tmp" | xargs rm -rf'
check block 'find ~/Nabu -type f | xargs rm -f'
check block 'ls | xargs -I{} rm {}'
check block 'find . | xargs -0 shred'
# системное
check block 'mkfs.ext4 /dev/sda1'
check block 'dd if=/dev/zero of=/dev/sda'
check block ':(){ :|:& };:'
check block 'shutdown -h now'

# ── Должны проходить (allow) — защита от ложных срабатываний ──
check allow 'ls -la'
check allow 'rm -rf ./build'
check allow 'rm -rf node_modules'
check allow 'rm -f /tmp/nabu-scratch/file.txt'
check allow 'npm run build'
check allow 'git commit -m "fix"'
check allow 'git push origin refactor/audit-2026-07'
check allow 'grep -r "DROP TABLE" docs/'
check allow 'psql -c "SELECT * FROM tasks WHERE id = 1"'
check allow 'psql -c "DELETE FROM tasks WHERE id = 1"'
check allow 'psql -c "UPDATE tasks SET status = '"'"'done'"'"' WHERE id = 1"'
check allow 'find . -name "*.tmp" | xargs cat'
check allow 'echo hello | xargs echo'
check allow 'find . -name "*.md"'
check allow 'echo done'

# ── r4: docker-тома и nabu-деструктив ──
check block "docker volume rm nabu_nabu-pgdata"
check block "docker volume prune -f"
check block "docker compose -f docker-compose.yml down -v"
check block "docker compose down --volumes"
check allow "docker compose down"
check allow "docker volume ls"
check block "node cli/nabu.mjs uninstall --purge-workspace --yes"
check block "nabu reset --yes"
check block "nabu reset --hard --yes"
check allow "nabu reset --dry-run"
check block "nabu restore /backups --yes"
check allow "nabu status"

echo ""
echo "guard tests: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
