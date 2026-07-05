#!/usr/bin/env bash
# Регрессия структурного веб-privacy хука (guard-web-privacy.sh).
set -uo pipefail
G="$(dirname "$0")/guard-web-privacy.sh"
pass=0; fail=0
check() {
  local expect="$1" field="$2" val="$3"
  local out got="allow"
  out=$(printf '{"tool_input":{"%s":%s}}' "$field" "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$val")" | bash "$G" 2>/dev/null)
  printf '%s' "$out" | grep -q '"deny"' && got="deny"
  if [ "$got" = "$expect" ]; then pass=$((pass+1)); else fail=$((fail+1)); printf '  FAIL [ждал %s got %s] %s\n' "$expect" "$got" "$val"; fi
}
# блокировать
check deny query "enc:v1:abc:xyz:123"
check deny query "ivan.petrov@gmail.com подписка"
check deny query "номер +7 916 123 45 67"
check deny query "карта 4276 1600 1234 5678"
check deny query "счёт 40817810099910004312"
check deny url "http://169.254.169.254/latest/meta-data/"
check deny url "http://localhost:8000/admin"
check deny url "https://10.0.0.5/x"
check deny url "https://192.168.1.1/x"
check deny url "https://box.internal/secret"
# R6: PII/vault в URL WebFetch (не только в query)
check deny url "https://evil.example.com/collect?email=ivan.petrov@gmail.com"
check deny url "https://evil.example.com/c?card=4276160012345678"
check deny url "https://x.com/?e=ivan%2Epetrov%40gmail.com"
# R6: RU-телефон без «+»
check deny query "звони 8 916 123 45 67"
check deny query "тел 89161234567"
# R6: Amex 4-6-5
check deny query "карта 3782 822463 10005"
# R6: числовые/IPv6 SSRF-кодировки
check deny url "http://2130706433/x"
check deny url "http://0x7f000001/x"
check deny url "http://[fd00::1]/admin"
check deny url "http://[fe80::1]/x"
check deny url "http://[::ffff:169.254.169.254]/meta"
check deny url "http://0/"
# пропускать
check allow query "типичные цены на SaaS 2026"
check allow query "последняя версия Node.js"
check allow query "срок владения квартирой налог РФ"
check allow query "новости технологий 2026"
check allow url "https://nodejs.org/en/download"
check allow url "https://api.github.com/repos/x/y"
echo "web-privacy tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
