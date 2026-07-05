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
# URL WebFetch тоже уходит наружу — path/query могут нести PII/vault (аудит R6, C2).
# Декодируем %XX, чтобы поймать email/карту, закодированные в query-строке.
url_decoded=""
if [ -n "$url" ] && command -v python3 >/dev/null 2>&1; then
  url_decoded=$(printf '%s' "$url" | python3 -c 'import sys,urllib.parse; print(urllib.parse.unquote(urllib.parse.unquote(sys.stdin.read())))' 2>/dev/null)
fi
# Всё, что уходит наружу как текст (query WebSearch + prompt WebFetch + сам URL WebFetch):
outbound="${query}
${fprompt}
${url}
${url_decoded}"

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
# Карта/счёт: ≥13 цифр подряд ИЛИ 4×4 ИЛИ Amex-группировка (4-6-5). Телефон: токен с
# разделителями/«+», в котором 10–12 цифр всего — БЕЗ обязательного «+» (RU 8-916-…). Годы/
# короткие числа не триггерят (порог ≥10). 13+ цифр — уже карта/счёт, не телефон.
if command -v python3 >/dev/null 2>&1; then
  leak=$(printf '%s' "$outbound" | python3 -c '
import sys, re
t = sys.stdin.read()
# карта группами 4-4-4-4
if re.search(r"(?<!\d)(\d{4}[ \-]){3}\d{4}(?!\d)", t): print("card"); sys.exit()
# Amex 4-6-5 (15 цифр группами)
if re.search(r"(?<!\d)\d{4}[ \-]\d{6}[ \-]\d{5}(?!\d)", t): print("card"); sys.exit()
# длинный сплошной номер (13+ цифр) — счёт/карта
if re.search(r"(?<!\d)\d{13,}(?!\d)", t): print("account"); sys.exit()
# телефон: токен из цифр и разделителей (+()-. пробел), 10–12 цифр всего, БЕЗ обязательного «+»
for m in re.finditer(r"(?<![\w])\+?[\d][\d()\-.\s]{8,}\d(?![\w])", t):
    d = len(re.sub(r"\D", "", m.group()))
    if 10 <= d <= 12: print("phone"); sys.exit()
' 2>/dev/null)
  if [ -n "$leak" ]; then
    deny "Заблокировано (приватность): в веб-запросе персональный номер ($leak — телефон/карта/счёт). Реквизиты и контакты наружу не отправляются — обобщи вопрос."
  fi
fi

# ── 5. WebFetch на внутренний/приватный хост (SSRF-предохранитель) ──
# Ловим не только dotted-decimal RFC1918/loopback, но и числовые кодировки IPv4 (decimal
# 2130706433, octal, hex 0x7f..) и IPv6-классы (::1, fc00::/7 ULA, fe80::/10 link-local,
# IPv4-mapped ::ffff:a.b.c.d). Нормализацию делает python `ipaddress` (аудит R6, M9).
if [ -n "$url" ]; then
  host=$(printf '%s' "$url" | sed -E 's~^[a-zA-Z]+://~~; s~[/?#].*$~~; s~^[^@]*@~~')
  # снять скобки IPv6 и хвостовой :port (для не-IPv6 хостов)
  hostname=$(printf '%s' "$host" | sed -E 's~^\[([^]]*)\].*$~\1~; t; s~:[0-9]+$~~')
  # быстрый текстовый гейт (домены .local/.internal, явные приватные префиксы)
  if printf '%s' "$hostname" | grep -qiE '^(localhost|0\.0\.0\.0|0)$|^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)|\.(local|internal|localhost)$'; then
    deny "Заблокировано (SSRF): WebFetch на внутренний/приватный хост ('$hostname'). Разрешён только внешний веб."
  fi
  # числовые/IPv6-кодировки через ipaddress
  if command -v python3 >/dev/null 2>&1; then
    verdict=$(printf '%s' "$hostname" | python3 -c '
import sys, ipaddress
h = sys.stdin.read().strip().lower()
def as_ip(s):
    # dotted/IPv6 напрямую
    try: return ipaddress.ip_address(s)
    except ValueError: pass
    # decimal (2130706433), hex (0x7f000001), octal (017700000001) целочисленный IPv4
    try:
        n = int(s, 0) if s.startswith(("0x","0o","0")) and s not in ("0",) else int(s)
        if 0 <= n <= 0xffffffff: return ipaddress.ip_address(n)
    except (ValueError, TypeError): pass
    return None
ip = as_ip(h)
if ip is not None:
    m = ip.ipv4_mapped if getattr(ip, "ipv4_mapped", None) else ip
    if m.is_private or m.is_loopback or m.is_link_local or m.is_reserved or m.is_unspecified:
        print("block")
' 2>/dev/null)
    if [ "$verdict" = "block" ]; then
      deny "Заблокировано (SSRF): WebFetch на внутренний/приватный адрес ('$hostname', числовая/IPv6-кодировка). Разрешён только внешний веб."
    fi
  fi
fi

# Чисто — пропускаем (не печатаем ничего = continue).
exit 0
