# AUDIT.md — Полный аудит кодовой базы (Round 6, 2026-07-05)

Метод: эталон из документации (Этап 1) → 5 параллельных аудит-агентов по зонам
(`lib/`, `cli/`, `mcp/`, инфраструктура, агенты/доки) → верификация ключевых находок чтением кода
и запуском guard'ов на крафт-входах. Раунды 1–5 — в истории git (v0.13.1…v1.0.2) и `AUDIT_round3-5.md.bak`.

Severity: **critical** (ломает заявленную функциональность/приватность) · **major** · **minor**.

## Эталон (что приложение ДОЛЖНО делать)
1. Zero-config локальный запуск (docker-стек, идемпотентный `nabu init`, аддитивные схемы).
2. Мозг — Claude Code; тяжёлое (эмбеддинги/транскрипция/vision) — локально, без внешних API-ключей.
3. Адъютант + Совет (триаж → министры → синтез с trade-off'ами → critic; решение за пользователем).
4. 7 типов памяти + личность; вся память оркеструется самим Nabu.
5. Приватность архитектурой: visibility `default/private/vault`; vault E2E-шифр, без эмбеддингов, не в облако/логи/модель; эмбеддинги только локально; 127.0.0.1-only.
6. Harness-дисциплина: узкие типизированные tools; approval вне модели для write/external/financial/destructive; бюджеты циклов.
7. Границы компетенции + wellbeing.
8. Дашборд, планировщик, бэкапы, самообновление.
9. Импорт health/finance локально; коннекторы (GET-only, allowlist) + вебхуки (HMAC); веб-поиск с де-идентификацией.
10. Nabu Commons (opt-in, off by default; merge только человеком).

---

## 1. Несоответствие задаче (spec-mismatch)

### CRITICAL
- **C1. Модель может одобрить собственное высокорисковое действие (self-approval loop).**
  `mcp/memory-server/src/index.ts:326` `resolve_approval` — обычный MCP-tool в тулсете модели, рядом с `request_approval` (:286). `decided_by='user'` (`lib/src/repositories/governance.ts:90`) — метка, не enforcement. Модель может: `request_approval` → `resolve_approval({decision:"approved"})` → `connect.trigger_webhook`. Весь гейт external/financial/destructive (инвариант #7) схлопывается. UI-путь `POST /api/approvals/:id` резолвит через репозиторий напрямую — MCP-tool избыточен и опасен.
- **C3. `.claude-plugin/plugin.json` регистрирует 20/26 команд и 1/4 скилла.**
  Явный список путей. Не грузятся: `nabu-contribute`, `nabu-onboard`, `nabu-propose`, `nabu-review-pr`, `nabu-tasks`, `nabu-vote` (вся Commons-ветка + `/nabu-tasks`, `/nabu-onboard`) и скилл-паки `nabu-marketing/product/sales` (их вызывает `SKILL.md:141-144`). Объясняет прежний «Unknown command: /nabu-tasks».

### MAJOR
- **M17. Доменные write-tools не проходят approval; класса `write` нет в governance.** `mcp/domain-server/src/index.ts` (`update_task_status:48`, `award_xp:117`, `log_metric:102`, `add_task:33` …) пишут автономно. `GovernanceRepository.RiskClass` (`governance.ts:8`) не содержит `write`/`draft`. Защитимо как «узкий personal-write», но буквальное расхождение с таблицей классов риска — нужно решение + документирование.
- **M18. ARCHITECTURE.md устарел (описывает удалённый shared-режим).** `:3,11,12,113` «та же БД Supabase», «ещё один клиент»; `:81,91` «1 skill, 19 commands, 7 mcpServers» (нет `connect`). Реальность: standalone, 8 серверов, 26 команд.
- **M19. `agents/registry.json` устарел:** `version:"0.8.0"` (везде 1.9.0), `_notes.servers` «7 MCP-серверов» без `connect`.

### MINOR
- `lib/src/config.ts:128` `sharedDbWithMainNabu ?? true` — дефолт против standalone (поле не читается).
- Остаточные «Supabase»: `CLAUDE.md:56`, комментарии `lib/src/db/postgres.ts:1-2,17,25`, `index.ts:173`, `domain.ts:2`; `.claude-plugin/plugin.json:81`.

---

## 2. Ошибки (bugs)

### MAJOR
- **M13. `writeJson`/`writeState` не потокобезопасны в одном процессе (PID-only tmp).** `nabu.mjs:162` `${p}.${process.pid}.tmp` — `job-results.json` пишется гонкой из 3 путей (`:528`,`:656`,`:675-678`); `proactivity.json`(:790), `schedule-state.json`(:516). `telegram-bot.mjs:135` `writeState`/`persist()` из параллельных топик-цепочек (`:1296-1304`) → битый `telegram-state.json`/потерянный `offset`. Образец — `chat-server.mjs:266` (UUID-суффикс).
- **M13b. Общий mutable `state` в telegram-bot** читается-мутируется из параллельных цепочек без лока (`telegram-bot.mjs:330`).

### MINOR
- `domain.ts:207-220` `logHabit` — `insert into habit_logs` безусловный, нет unique-констрейнта → дубли, портят стрик.
- `health-import.ts:323-333` дедуп метрик без unique-констрейнта → конкурентный импорт задвоит.
- `typedb.ts:107-109` `close()` не сбрасывает `_available` → геттер врёт (само-лечится).
- `connect-server:107` — двойное кодирование traversal (`%252e`) минует regex.
- `nabu.mjs:1199-1201,1391-1394` backup/restore `docker stop typedb` без try/finally → контейнер остаётся off при падении.
- `chat-server.mjs:643-663` конкурентные чаты могут неверно атрибутировать пойманные файлы.

---

## 3. Gaps (edge cases / валидация / права)

### CRITICAL
- **C2. `guard-web-privacy.sh` не сканирует `url` WebFetch на PII/vault — только SSRF-хост.** `:24-29,77-82`. Проверено: `WebFetch url=…/collect?email=…&card=4276160012345678` → exit 0. Email/карта/vault в URL — прямой канал утечки (инвариант #2).

### MAJOR
- **M1. База знаний игнорирует vault.** `knowledge.ts:55` `indexDocument` принимает `vault` (через `pipeline-server:207,266`), НЕ шифрует, ВСЕГДА эмбеддит (`:61`); `search:79` без visibility-фильтра → vault-чанк plaintext возвращается модели. Ложная защита.
- **M2. `extract_entities_local` может отправить vault-plaintext с машины.** `pipeline-server:329,350` дешифрует vault-заметку и POST'ит plaintext на `OLLAMA_BASE_URL` без проверки loopback.
- **M3. `listRecentEpisodes` возвращает vault сырым шифртекстом без фильтра.** `memory.ts:209-233` — footgun на дисциплине вызывающего.
- **M4. `improve.update_proposal` — само-accept.** `improve-server:64` `decidedBy='user'` дефолт, model-callable; `improvement.ts:150` не гейтит статус `proposed`.
- **M5. Нет auth на HTTP-эндпоинтах; approvals резолвит любой localhost.** `chat-server.mjs:1123-1142` `POST /api/approvals/:id` одобряет как `user:web`; `/api/about`(:1060), `/api/stats/details`(:940) отдают non-vault факты без auth. Нужен Origin-гейт + документировать localhost-модель.
- **M6. Headless Claude `cwd=REPO_ROOT` + `Write`** (`chat-server.mjs:418`, `telegram-bot.mjs:237`) может перезаписать любой файл репо; захват ловит только НОВЫЕ top-level файлы. В планировщике (`nabu.mjs:638`) — без надзора.
- **M8. У колонок `visibility` нет CHECK-констрейнта.** `episodic_memory:38`, `semantic_facts:56`, `knowledge_chunk`, `notes`, `sources`, `claims`. Опечатка `'Vault'` → трактуется non-vault → утечка. Дёшево: `check … in ('default','private','vault')` (NOT VALID).
- **M9. SSRF-матчер хоста пропускает классы адресов.** `guard-web-privacy.sh:79`. allowed: `[fd00::1]`, `2130706433` (decimal 127.0.0.1), `fe80::`, IPv4-mapped, octal/hex, `http://0/`.
- **M10. Телефон требует литерал `+`.** `:59-74`. allowed: `8 916 123 45 67` (RU) — частый случай, продукт RU-first.
- **M14. Нет лимита одновременных Claude-детей.** `chat-server.mjs:587` — по ребёнку на запрос (до 10 мин); любой localhost → истощение ресурсов + траты.

### MINOR
- `chat-server.mjs:1050` `/api/file` traversal-гард не ловит backslash.
- `guard-web-privacy.sh:64` карта только 4-4-4-4 (Amex 4-6-5 проходит).
- `guard-destructive.sh` непокрыто: `chmod -R 000 /`, `> ~/.bashrc`, `mv /etc …`, `git push --mirror`, base64/indirection.
- `voice-server:66` нет sandbox на `audioPath`; `connect-server` нет private-IP denylist на `base_url`.
- `consult.ts` нет `open→expired`; `config.ts:63-74` не срезает inline-комменты `.env`; `stats.ts` `NaN`→`null`.
- `000_standalone_bootstrap.sql:165-172` seed char_sheet безусловен → FK-ошибка на непустой users.

---

## 4. Недоделки (unfinished / hardcoded)

### MAJOR
- **M12. Плейсхолдер-URL в инсталляторах — блокер релиза.** `install.sh:22-23` → `nabu-ai/…`, `install.ps1:12-13` → `noeticecho`. Разные орги; `release-prep.sh:36` грепает только `noeticecho`.
- **M11. `test-web-privacy.sh` не в CI.** `ci.yml:30-31` гоняет только `test-guard.sh` → privacy-guard без регрессионной сети.

### MINOR
- `nabu.mjs:1590` хардкод docker-тегов; `nabu.mjs:59,60` + дубли моделей (`qwen3:4b`); `commands/nabu-propose.md:10`, `docs/LANDING.md`, `docs/LAUNCH.md:97` плейсхолдеры; `007_indexes.sql:9-13` dedup-TODO.

---

## 5. Пустые/мёртвые функции

### MINOR
- `embeddings.ts:31` `_visibility` не используется; `config.embedding.{provider,model,privateOnly}` (`config.ts:129-134`) не читаются → мёртвая конфиг-поверхность (privacy-флаги no-op).
- `local-brain.mjs:31-38` `LEGACY_FULL_ALLOWLIST` не используется.
- `vault-crypto.ts:20-24` недостижимый `catch`; `index.ts:167-170`,`chat-server.mjs:1044-1046` смещённые JSDoc.
- пустая директория `undefined/tg-conc/` в корне (артефакт литерала `"undefined"`).
- MCP: `const result = ok;` дублируется в 4 серверах.

---

## 6. Качество (дублирование / архитектура / паттерны)

### MAJOR
- **M15. `ALLOWED_TOOLS` строится трижды** (`nabu.mjs:62`, `chat-server.mjs:21-37`, `telegram-bot.mjs:55-71`) — нет единого источника для security-постуры.
- **M16. Мост `claude -p` переписан дважды** (`chat-server.mjs:401-581`, `telegram-bot.mjs:224-313`) — изоляция-флаги (`:414`/`:233`) синхронизируются вручную.
- **M7. 4 не-build агента без `disallowedTools`** → наследуют Bash/Write/Edit: `capability-scout.md`, `effectiveness-evaluator.md`, `import-agent.md`, `research-assistant.md`. Против `SKILL.md:65` и инварианта #7.
- **M-mcp. Три контракта ошибок в MCP.** `memory/connect/council/pipeline` — `reg()`+`wrap()`; `domain/improve` — inline `wrap()`; `analytics` — hand-rolled. `reg()`-каст дублируется в 4 файлах → в `@nabu/lib`.

### MINOR
- Эпизод-запись/file-capture копипаст между `chat-server`/`telegram-bot`; `dashboard.ts:35` копия `XP_ATTRS`; `user()` копипаст в 6 местах (privacy-critical); таксономия классов риска не совпадает (governance vs ARCHITECTURE); `personality.ts:59-61` нет kindness-floor (`min_kindness` нет; `min_honesty` в 6/24; `agent-creator.json` kindness=5); дубли spawn-обёрток; `npm install` вместо `npm ci`; docstring `transcribe.py` дрейф; ярлык «47 cases» (реально 59).

---

## Верифицированно-OK (не находки)
vault не эмбеддится (`memory.ts:89,118` `embedding=null`; `recall` фильтрует + дефолт `["default","private"]`); SQL параметризован; транзакции оборачивают мульти-write; `trigger_webhook` — атомарное single-use; pipeline path-sandbox крепкий; graceful shutdown; fail-closed мульти-профиль; SKILL.md протокол = ARCHITECTURE §4 + 9 инвариантов; 73/73 slug реестра → файлы; все tool-ссылки резолвятся.

---
_Итог по исправлениям — в конце файла после Этапа 4._

---

# Итог исправлений (Этап 4–5, 2026-07-05)

**Исправлено и развёрнуто на живой инстанс (16 атомарных коммитов, тесты 84 unit + 59+28 hooks зелёные):**

| # | Что | Коммит-тема |
|---|---|---|
| C1 | self-approval loop закрыт (`resolve_approval` убран из модели) | fix(C1/M4) |
| C2 | web-privacy сканирует URL WebFetch + numeric/IPv6 SSRF + RU-телефон | fix(C2/M9/M10) |
| C3 | все 26 команд + 4 скилла в plugin.json | fix(C3) |
| M1/M2/M3 | честный vault: knowledge отказ, loopback-assert, эпизоды без vault | fix(M1/M2/M3) |
| M4 | improve.update_proposal гейт на `proposed` | (в C1) |
| M5 | CSRF same-origin гейт + документирование localhost-модели | fix(M5) |
| M7 | 4 агента ограничены (no Write/Edit/Bash) | fix(M7) |
| M8 | CHECK-констрейнты на visibility (миграция 015) | fix(M8) |
| M11/M12 | CI гоняет privacy-guard; инсталлятор-URL сведены | fix(M11/M12) |
| M13 | атомарные записи JSON-состояния (pid+uuid) | fix(M13) |
| M14 | лимит одновременных Claude-детей (429) | fix(M14) |
| M15 | единый источник ALLOWED_TOOLS+изоляция | refactor(M15) |
| M17 | доменные write задокументированы как «narrow personal-write» | fix(kindness/M17) |
| M18/M19 | ARCHITECTURE.md + registry.json → standalone/8/26 | docs(M18/M19) |
| kindness | пол honesty≥8/kindness≥6 в personality.ts | fix(kindness/M17) |
| P3-minor | dead LEGACY_ALLOWLIST, /api/file backslash, XP_ATTRS импорт, transcribe docstring, backup try/finally, habit_logs идемпотентность (миграция 016) | chore/fix(P3) |

**Заблокировано (по правилу отката):**
- **M6 (вариант B — перенести cwd в ~/Nabu).** Эмпирически: `--plugin-dir` грузит Nabu при cwd=~/Nabu, НО `--resume` существующей сессии (созданной при cwd=repoRoot) под новым cwd даёт пустой ответ — **несовместимость resume со сменой cwd** ломает все текущие разговоры. Откачено. Остаточный риск (перезапись трекаемых файлов репо адъютантом) НАРОЧНО узкий: захват НОВЫХ файлов уносит их в workspace, репо не засоряется; перезапись существующего требует явного пути. **Рекомендация:** вариант C (убрать `Write` из unattended-планировщика) как безопасная альтернатива — скажи, сделаю.

**Отложено осознанно:**
- **M16** (полное объединение двух `claude -p` мостов) — web-SSE и TG-editMessageText реально разные; рефакторинг горячего пути на ЖИВОМ демоне рискованнее выигрыша. M15 (единый ALLOWED_TOOLS) снял главную security-часть.

**Оставшийся long-tail minor (низкий приоритет, по запросу):** дедуп `user()`-хелпера (6 мест), `reg()` в `@nabu/lib`, `analytics-server` на `wrap()`, общий эпизод-write между клиентами, unique-констрейнт `metric_values`, срезание inline-комментов в `.env`, `npm ci` в инсталляторах, сверка таксономии классов риска, авто-expiry консультов, недостижимый `catch` в vault-crypto, мёртвые config-флаги `private_only`/`_visibility`.

**Риски, требующие твоего решения:** M6 — выбрать вариант C (безопасно) или принять узкий остаточный риск.
