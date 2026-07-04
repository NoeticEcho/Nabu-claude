#!/usr/bin/env bash
# PreToolUse(WebSearch|WebFetch) hook — структурный предохранитель приватности (инвариант #2).
# Промпт-уровневое «обезличивание» в скилле/агентах — мягкое; этот хук — ЖЁСТКИЙ код-гейт на
# МЕХАНИЧЕСКИ детектируемые утечки в веб-запрос: vault-шифртекст, email/телефоны/карты/длинные
# номера счетов, а для WebFetch — внутренние/приватные хосты (SSRF). Имя человека в запросе
# детектировать нельзя — это остаётся на инструкции; но контакты/финансы/vault/SSRF ловим здесь.
# Fail-safe: при любой ошибке разбора — continue (не ломаем работу), логируя предупреждение.
set -uo pipefail

stdin=$(cat)

# ── Извлечь релевантные поля (WebSearch: query; WebFetch: url + prompt) ──
extract() {
  local field="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$stdin" | jq -r ".tool_input.${field} // empty" 2>/dev/null && return
  fi
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$stdin" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('${field}',''))" 2>/dev/null && return
  fi
  printf '%s' "$stdin" | sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\(\([^\"\\]\|\\.\)*\)\".*/\1/p" | head -1
}

query=$(extract query)
url=$(extract url)
fprompt=$(extract prompt)
# Всё, что уходит наружу как текст запроса (query WebSearch + prompt WebFetch):
outbound="${query}
${fprompt}"

deny() {
  local msg="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg c "$msg" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",additionalContext:$c}}'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys;print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','additionalContext':sys.argv[1]},ensure_ascii=False))" "$msg" 2>/dev/null \
      || python3 -c "import json,sys;print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','additionalContext':sys.argv[1]}}))" "$msg"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","additionalContext":"%s"}}' "$msg"
  fi
  exit 0
}

has() { printf '%s' "$1" | grep -qE "$2"; }

# ── 1. Vault-шифртекст в запросе — грубейшая утечка ──
if has "$outbound" 'enc:v1:'; then
  deny "Заблокировано (приватность): в веб-запрос попал vault-шифртекст (enc:v1:). Vault наружу не отправляется — переформулируй обезличенно."
fi

# ── 2. Email-адрес ──
if has "$outbound" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'; then
  deny "Заблокировано (приватность): в веб-запросе email-адрес. Не отправляй личные контакты в поиск — обобщи вопрос (напр. «как проверить репутацию домена», без самого адреса)."
fi

# ── 3+4. Телефон / карта / длинный номер счёта — через python (надёжный подсчёт цифр) ──
# Телефон: '+' и ≥10 цифр всего в токене с разделителями. Счёт/карта: ≥13 цифр подряд
# ИЛИ 4 группы по 4. Годы/короткие числа не триггерят.
if command -v python3 >/dev/null 2>&1; then
  leak=$(printf '%s' "$outbound" | python3 -c '
import sys, re
t = sys.stdin.read()
# карта группами 4-4-4-4
if re.search(r"(?<!\d)(\d{4}[ \-]){3}\d{4}(?!\d)", t): print("card"); sys.exit()
# длинный сплошной номер (13+ цифр) — счёт/карта
if re.search(r"(?<!\d)\d{13,}(?!\d)", t): print("account"); sys.exit()
# телефон: токен с + и ≥10 цифр
for m in re.finditer(r"\+[\d()\-\s]{9,}", t):
    if len(re.sub(r"\D", "", m.group())) >= 10: print("phone"); sys.exit()
' 2>/dev/null)
  if [ -n "$leak" ]; then
    deny "Заблокировано (приватность): в веб-запросе персональный номер ($leak — телефон/карта/счёт). Реквизиты и контакты наружу не отправляются — обобщи вопрос."
  fi
fi

# ── 5. WebFetch на внутренний/приватный хост (SSRF-предохранитель) ──
if [ -n "$url" ]; then
  host=$(printf '%s' "$url" | sed -E 's~^[a-zA-Z]+://~~; s~[/?#].*$~~; s~^[^@]*@~~; s~:[0-9]+$~~')
  if printf '%s' "$host" | grep -qiE '^(localhost|0\.0\.0\.0|\[::1\])$|^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)|\.(local|internal)$|169\.254\.169\.254'; then
    deny "Заблокировано (SSRF): WebFetch на внутренний/приватный хост ('$host'). Разрешён только внешний веб."
  fi
fi

# Чисто — пропускаем (не печатаем ничего = continue).
exit 0
