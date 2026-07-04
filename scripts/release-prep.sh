#!/usr/bin/env bash
# release-prep.sh — финальная подготовка к публикации (docs/LAUNCH.md).
# Использование: bash scripts/release-prep.sh <github-owner> [repo-name]
# Делает ВСЮ механику плейсхолдеров; git-операции печатает, но не выполняет (решение — за вами).
set -euo pipefail

OWNER="${1:-}"
REPO="${2:-nabu-claude}"
[ -n "$OWNER" ] || { echo "Использование: bash scripts/release-prep.sh <github-owner> [repo-name]"; exit 1; }
cd "$(dirname "$0")/.."

echo "== 1. Замена noeticecho → $OWNER во всех файлах =="
FILES=$(grep -rl "noeticecho" --include="*.md" --include="*.sh" --include="*.ps1" --include="*.json" . | grep -v node_modules | grep -v "^\./\.claude/" | grep -v "release-prep.sh" || true)
for f in $FILES; do
  sed -i "s|noeticecho|$OWNER|g" "$f"
  echo "  ✓ $f"
done

echo "== 2. NABU_REPO в инсталлерах =="
sed -i "s|NABU_REPO:-https://github.com/[^\"}]*|NABU_REPO:-https://github.com/$OWNER/$REPO.git|" scripts/install.sh || true
sed -i "s|https://github.com/nabu-ai/nabu-claude.git|https://github.com/$OWNER/$REPO.git|" scripts/install.ps1 scripts/install.sh 2>/dev/null || true
grep -n "github.com/$OWNER/$REPO" scripts/install.sh scripts/install.ps1 | head -2

echo "== 3. commons.repo в config/nabu.config.json =="
python3 - "$OWNER" "$REPO" <<'PY'
import json, sys
p = "config/nabu.config.json"
d = json.load(open(p))
d.setdefault("commons", {})["repo"] = f"{sys.argv[1]}/{sys.argv[2]}"
json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
open(p, "a").write("\n")
print(f"  ✓ commons.repo = {sys.argv[1]}/{sys.argv[2]}")
PY

echo "== 4. Проверка чистоты =="
LEFT=$(grep -rl "noeticecho" --include="*.md" --include="*.sh" --include="*.ps1" --include="*.json" . | grep -v node_modules | grep -v "^\./\.claude/" | grep -v "release-prep.sh" || true)
if [ -n "$LEFT" ]; then echo "  ⚠ Остались плейсхолдеры:"; echo "$LEFT"; else echo "  ✓ noeticecho нигде не остался"; fi
npm run test >/dev/null 2>&1 && echo "  ✓ тесты зелёные" || echo "  ✗ ТЕСТЫ УПАЛИ — не публиковать"

echo ""
echo "== Дальше (руками, по docs/LAUNCH.md) =="
echo "  git add -A && git commit -m 'release: v1.0.0 — set owner $OWNER'"
echo "  git remote add origin git@github.com:$OWNER/$REPO.git   # если ещё нет"
echo "  git push -u origin master"
echo "  git tag v1.0.0 && git push --tags"
echo "  GitHub Release из CHANGELOG.md · включить Discussions · метки community-proposal/ready-for-dev"
echo "  Локально (shared-режим): вернуть реальный project_ref в .mcp.json (в git его нет — норм)"
