# REFACTOR_PLAN.md — план рефакторинга по итогам Round 6 (2026-07-05)

Порядок: **critical → major(приватность) → major(робастность) → major(поддерживаемость) → minor**.
Каждый шаг атомарен и оставляет проект рабочим; после каждого — `npm run build && npm test && npm run test:hooks`
и точечная проверка. Публичные контракты не меняем без явной пометки. Коммит на шаг.
Прошлый план (round 3) — в `REFACTOR_PLAN.prev.bak` и git.

Легенда: ✅ безопасный автофикс · ⚠️ требует твоего решения (см. «Вопросы») · 🔒 приватность/безопасность.

---

## P0 — CRITICAL

### Шаг 1 🔒✅ — Закрыть self-approval loop (C1, +M4)
- **Что:** убрать `resolve_approval` из тулсета модели — резолв только через UI (`POST /api/approvals/:id` → `governance.resolveApproval` напрямую, уже так). Аналогично `improve.update_proposal` (M4): убрать из модели ИЛИ гейтить на статус `proposed` + пометить accept/implement как внешнее.
- **Файлы:** `mcp/memory-server/src/index.ts`, `mcp/improve-server/src/index.ts`, при нужде `lib/src/repositories/improvement.ts:150`.
- **Проверка:** `grep -r resolve_approval` — агенты/скиллы не зовут; UI-approval работает; build+tests.

### Шаг 2 🔒✅ — Утечка через WebFetch URL + SSRF/телефон (C2, M9, M10)
- **Что:** в `guard-web-privacy.sh` сканировать `url` (path+query) проверками email/phone/card/vault; расширить SSRF-матчер (IPv6 ULA/link-local, decimal/octal/hex IPv4, `http://0/`, IPv4-mapped); телефон — RU без `+` (≥10 цифр). Кейсы в `test-web-privacy.sh`.
- **Файлы:** `scripts/hooks/guard-web-privacy.sh`, `scripts/hooks/test-web-privacy.sh`.
- **Проверка:** крафт-кейсы (URL с email/картой → deny; `[fd00::1]`, `2130706433`, `8 916 …` → deny) + `test:hooks`.

### Шаг 3 ✅ — Дорегистрировать команды/скиллы (C3)
- **Что:** в `.claude-plugin/plugin.json` добавить 6 команд (`nabu-contribute/onboard/propose/review-pr/tasks/vote`) и 3 скилла (`nabu-marketing/product/sales`); комментарий → «26 commands, 8 mcpServers».
- **Файлы:** `.claude-plugin/plugin.json`.
- **Проверка:** JSON валиден; 26 команд/4 скилла.

---

## P1 — MAJOR: приватность 🔒

### Шаг 4 🔒✅ — Честный vault в knowledge + гигиена эпизодов (M1, M2, M3)
- **Что:** (a) knowledge-tools — **ОТКАЗ** `visibility:"vault"` (knowledge = публично-семантический слой); (b) `extract_entities_local` — assert loopback/private для `OLLAMA_BASE_URL` перед vault-plaintext; (c) `listRecentEpisodes` — исключать `visibility='vault'` (как `recall`).
- **Файлы:** `lib/src/repositories/knowledge.ts`, `mcp/pipeline-server/src/index.ts`, `lib/src/repositories/memory.ts`, тесты.
- **Проверка:** vault в knowledge → отказ; `listRecentEpisodes` без vault; loopback-assert на non-local URL; build+tests.

### Шаг 5 🔒✅ — CHECK-констрейнты на visibility (M8)
- **Что:** аддитивная миграция `016_visibility_check.sql` — `check (visibility in ('default','private','vault'))` NOT VALID на 6 таблицах.
- **Файлы:** `schema/postgres/016_visibility_check.sql` + применить на живой БД.
- **Проверка:** идемпотентно; `'Vault'` отклоняется; existing строки целы.

### Шаг 6 ✅ — CI privacy-guard + инсталлятор-URL (M11, M12)
- **Что:** `test-web-privacy.sh` в `ci.yml`; свести инсталляторы на `noeticecho`, убрать `nabu-ai`; `release-prep.sh` грепает оба.
- **Файлы:** `.github/workflows/ci.yml`, `scripts/install.sh`, `scripts/release-prep.sh`.
- **Проверка:** CI зовёт privacy-тест; `grep -r nabu-ai scripts/` пусто.

---

## P1 — MAJOR: робастность

### Шаг 7 ✅ — Атомарные записи JSON-состояния (M13)
- **Что:** уникальный tmp (`${pid}.${uuid}.tmp`) в `writeJson`(nabu) и `writeState`(TG); сериализовать записи (промис-лок на путь).
- **Файлы:** `cli/nabu.mjs`, `cli/telegram-bot.mjs`.
- **Проверка:** стресс 50 параллельных записей не бьёт JSON; build+tests.

### Шаг 8 🔒✅ — Origin-гейт на мутирующие эндпоинты + документ (M5)
- **Что:** на `POST /api/approvals/:id` (и мутирующих) проверять `Origin`/`Sec-Fetch-Site` same-origin или локальный секрет; задокументировать localhost-модель доверия.
- **Файлы:** `cli/chat-server.mjs`, `README.md`/`docs/ZERO_CONFIG.md`.
- **Проверка:** curl без Origin → отказ; UI работает.

### Шаг 9 ✅ — Лимит одновременных Claude-детей (M14)
- **Что:** семафор (N=2–3 из hardware-бюджета) в `handleChat`; превышение → 429/сообщение.
- **Файлы:** `cli/chat-server.mjs`.
- **Проверка:** 5 параллельных `/api/chat` → ≤N процессов.

### Шаг 10 🔒✅ — Ограничить 4 агента (M7)
- **Что:** `disallowedTools: Write, Edit, Bash` в `capability-scout/effectiveness-evaluator/import-agent/research-assistant`.
- **Файлы:** 4 `agents/*.md`.
- **Проверка:** `grep -L disallowedTools agents/*.md` = только build/web.

---

## P2 — MAJOR: поддерживаемость

### Шаг 11 ⚠️✅ — Единый `ALLOWED_TOOLS` + общий claude-мост (M15, M16)
- **Что:** `ALLOWED_TOOLS`+изоляция-флаги в `cli/claude-run.mjs`; общий core стрим-json моста, поверх тонкие адаптеры web(SSE)/TG.
- **Файлы:** новый `cli/claude-run.mjs`, `chat-server.mjs`, `telegram-bot.mjs`, `nabu.mjs`.
- **Проверка:** оба пути отвечают вживую; флаги из одного места; build+tests. **Риск средний** — при поломке >2–3 попыток откат + blocked.

### Шаг 12 ✅ — ARCHITECTURE.md + registry.json (M18, M19)
- **Что:** переписать data-layer ARCHITECTURE.md (standalone/8 серверов/26 команд/без Supabase); `registry.json` → 1.9.0 + `connect`; убрать остаточные «Supabase» (`CLAUDE.md:56`, комменты lib).
- **Файлы:** `ARCHITECTURE.md`, `agents/registry.json`, `CLAUDE.md`, комменты lib.
- **Проверка:** `grep -ri supabase` только историческое; счётчики сходятся.

---

## P3 — MINOR (батч, 1–2 коммита)

### Шаг 13 ✅ — Мёртвый код/конфиг
`LEGACY_FULL_ALLOWLIST`, пустая `undefined/`, недостижимый `catch`, смещённые JSDoc; мёртвые `config.embedding.*`/`_visibility` — удалить или задействовать.

### Шаг 14 ✅ — Дедуп/консистентность
`dashboard.ts` импорт `XP_ATTRS`; общий `user()`-хелпер; общий эпизод-write/file-capture; `reg()` в `@nabu/lib`; `analytics-server` на `wrap()`.

### Шаг 15 ✅ — Мелочи схемы/скриптов/доков
unique-констрейнты `habit_logs`/`metric_values` (+дедуп); backup/restore try/finally; `/api/file` backslash; `.env` inline-комменты; `npm ci`; docstring `transcribe.py`; «47→59»; таксономия классов риска.

---

## ⚠️ Вопросы к тебе (решение до P1/P2)

1. **M17 — доменные write-tools не проходят approval.** «Узкие personal-write» (низкий риск), но формально расходятся с классами риска. (A) оставить автономными + задокументировать как класс «narrow personal write» (+`write` в governance только для лога); (B) гейтить через approval (трение UX на каждое «добавь задачу»). **Рекомендую A.**

2. **M6 — `cwd=REPO_ROOT` + `Write` у демона.** Прямой `cwd=NABU_HOME` уже пробовал — плагин не грузится (пустой ответ). (A) оставить cwd=repo, но защитить трекаемые файлы (git-revert перезаписей / запись только в out-папку); (B) доверить `~/Nabu` через trust и перенести cwd; (C) убрать `Write` из планировщика (unattended), оставить в интерактиве. **Рекомендую C + A.**

3. **M-kindness — инвариант #5 не представлен в коде.** (A) `min_kindness` во все профили + кламп в `personality.ts`; (B) смягчить формулировку инварианта до реально обеспечиваемого. **Рекомендую A.**

---

## Оценка
P0: 3 шага (низкий риск) · P1: 7 шагов (приватность+робастность) · P2: 2 (Шаг 11 средний риск) · P3: 3 батча.
~15 атомарных шагов. После P0+P1 продукт заметно безопаснее; P2/P3 — чистота/поддерживаемость.
