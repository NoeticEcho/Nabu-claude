# AUDIT.md — Round 7 (2026-07-06)

Полный аудит кодовой базы Nabu-claude v1.11.0. Проведён 6 параллельными аудиторами по зонам
(lib · cli · mcp · agents/skills/commands · schema/hooks/scripts · соответствие доке) + верификатор
спецификации Claude Code. Ключевые находки **проверены вживую** (пометка ✓verified). Предыдущие
раунды (R1–R6) закрыты (R6 → `AUDIT_R6_archive.md`); здесь актуальное состояние на master @ `f6709e8`.

Baseline (зелёный до правок): `build 0` · 86 unit · 59 guard + 28 web-privacy hooks.

Severity: **critical** — ломает функциональность/приватность · **major** — заметный дефект/риск ·
**minor** — качество/косметика/устаревшие числа.

---

## Этап 1: Эталон (что приложение ДОЛЖНО делать)

1. **Локальный standalone-стек**: Postgres+pgvector + TypeDB + Ollama в docker; zero-config `nabu init`; данные не покидают машину (кроме явных исключений).
2. **Мозг — Claude Code**: рассуждение — headless `claude -p`; тяжёлое (эмбеддинги, транскрипция) — локально/делегируемо.
3. **Совет 9 министров + функциональные агенты**: триаж адъютантом → единодоменный/многодоменный → коллегиальный синтез с trade-off'ами → critic; Agent Teams + fallback.
4. **7 типов памяти** (Postgres/pgvector + TypeDB) + библиотека (`kind=library`, отдельно от personal) + личность из числовых черт.
5. **Приватность по архитектуре**: 3 уровня visibility; vault — E2E AES-256-GCM и **без эмбеддингов вовсе**; private/vault не уходят в облако/логи/аналитику; эмбеддинги локально (Ollama) — облако только для `default` и под явным opt-in.
6. **Harness-дисциплина**: узкие типизированные MCP-tools; высокорисковые (external/financial/destructive) — через approval вне модели; бюджеты циклов; guard-хук на деструктив.
7. **Клиенты**: web-chat (SSE, PWA) + Telegram (текст/голос→Whisper локально); ответы стримятся; файлы в обе стороны.
8. **Демон**: планировщик (триаж/дайджест/feedback) + web-сервер + Telegram-поллинг; результаты пушатся пользователю.
9. **CLI**: init/start/stop/status/logs/chat/stats/backup/schedule/update/doctor/reset/uninstall + index/library + import-health/import-finance.
10. **Интеграции/Commons**: коннекторы GET-only + allowlist, вебхуки HMAC; федеративное самоулучшение (opt-in, merge только человеком).

---

## Этап 2: Находки по категориям

### 0. CRITICAL
**Не найдено.** Приватность-инварианты соблюдены: vault не эмбеддится (`memory.ts` emb=null + шифрование; `knowledge.ts` запрещает vault-индексацию; recall исключает vault), private/vault→remote под гейтом; SQL параметризован везде (единственные интерполяции — из белых списков имён колонок); мульти-write атомарны (`Postgres.tx`).

---

### 1. Несоответствие задаче (spec ↔ код)

| # | severity | где | расхождение |
|---|---|---|---|
| S1 | **major** | ARCHITECTURE.md:82 ↔ :90,:100; `.claude-plugin/plugin.json` | ✓verified. Внутреннее противоречие доки: «4 skills» vs «ЕДИНСТВЕННЫЙ skill — адъютант». Реально **4 skills** (nabu-orchestrator, nabu-marketing, nabu-product, nabu-sales). Утверждение «только адъютант — skill» ложно. |
| S2 | **major** | README.md:19,77-78; README.ru.md:20; `lib/src/repositories/memory.ts:2`; `mcp/memory-server/src/index.ts:3,31` | ✓verified. «embeddings computed by a local model (Ollama)» и комменты «private/vault эмбеддятся локально (единственный путь)» — **устарели** после провайдер-фичи. Реально: есть удалённый OpenAI-совместимый путь (для `default`, под `NABU_EMBED_ALLOW_REMOTE=1`); vault **вообще не эмбеддится**. Инвариант не нарушен, но доки/комменты вводят в заблуждение. |
| S3 | **major** | `commands/nabu-onboard.md`, `commands/nabu-tasks.md` | ✓verified. Две слэш-команды реализованы, но **не документированы** нигде. `nabu-library` есть в docs/LIBRARY.md, но отсутствует в списке CLAUDE.md. |
| S4 | minor | README.md:70,116; README.ru.md:12; plugin.json | «73 subagents» → реально **74** `agents/*.md` (реестр 74/74). |
| S5 | minor | README.md:107,119; CLAUDE.md:77; ARCHITECTURE.md:82 | «26 commands» → реально **27** `commands/*.md`. |
| S6 | minor | README.md:137; CONTRIBUTING.md:53; docs/LANDING.md:85 | «47 guard cases» → реально **59** (test-guard.sh) + 28 (web-privacy); доки умалчивают web-privacy-набор. |
| S7 | minor | README.md:63 | «34 curated free APIs» → в docs/INTEGRATIONS.md **39** строк каталога. |
| S8 | minor | ARCHITECTURE.md §7 | Список слэш-команд неполон (нет triage/propose/vote/contribute/review-pr/library/onboard/tasks). |

**Проверено и ВЕРНО** (не расхождение): Council через Agent Teams+fallback; 7 типов памяти в схеме; library kind=library; scheduler jobs (enabled:false по умолчанию); backups retention 7; connectors GET-only + HMAC-вебхуки; import-health/finance; «Vault → no embeddings» (правда в коде); «logs never message content» (правда); docs/en/* существуют; CHANGELOG 1.11.0 совпадает.

---

### 2. Ошибки (баги, race, freeze, утечки)

| # | severity | файл:строка | проблема |
|---|---|---|---|
| E1 | **major** | `cli/nabu.mjs:618-619` | ✓verified. **Freeze демона**: в `tick()` синхронный `sh("git fetch")` + `rev-list` (сеть) блокирует единый event-loop → SSE-чат и Telegram-поллинг замирают на секунды. Срабатывает на КАЖДОМ старте (lastUpdateCheck=0) и раз в сутки. |
| E2 | **major** | `cli/telegram-bot.mjs:825,829,832` | ✓verified. **Freeze до 10 мин**: `ensureWhisper()` при первом голосовом делает `spawnSync uv venv` (120с) + `uv pip install faster-whisper` (600с) синхронно → замораживает весь демон (web+все TG-топики+планировщик). |
| E3 | **major** | `cli/chat-server.mjs:627-638` + `cli/telegram-bot.mjs:610-634` | **Race → порча claude-сессии**: роль-разговоры `conv-<role>` делят один `claudeSessionId` между web и Telegram. Два одновременных сообщения → параллельный `claude --resume <тот же id>` → конкурентная запись файла сессии → переплетение/потеря истории. `threadsLock` сериализует только запись JSON тредов, не обмен. |
| E4 | **major** | `cli/nabu.mjs:844-845` | **Freeze на минуты**: `doUpdate(inDaemon:true)` при `auto_update=true` — `sh(npm install)`+`sh(npm run build)` синхронно в демоне перед само-рестартом. За opt-in, но симптом тяжёлый. |
| E5 | major | `cli/nabu.mjs:1139,1163,1195`; `cli/telegram-bot.mjs:1142,1198,1291` | **Freeze**: ночной `cmdBackup()` в демоне зовёт `docker info/inspect` синхронно (секунды на занятом docker); TG `unzip`/`pdftotext`/`tesseract` синхронны — блок на больших файлах. |
| E6 | **major** | `lib/src/domain-classify.ts:60-72` | Кэш `domain-vecs.json` инвалидируется только по хэшу таксономии, **не по модели/размерности**. Смена `OLLAMA_EMBED_MODEL`/`NABU_EMBED_DIM` → старые векторы, `cosine()` считает по min(len)-префиксу → мусор, почти всё в `general`. (Реально наблюдалось при переключениях модели.) |
| E7 | minor | `lib/src/embeddings.ts:137-140` | `Promise.race` hard-timeout: `setTimeout` не очищается при успехе (спасает `unref`, но таймер висит ~125с). Нужен `clearTimeout` в `finally`. |
| E8 | minor | `lib/src/health-import.ts:157,175` | Google Fit: колонка по подстроке «heart» → метрика `heart_rate`. Реальные «Heart Points/Minutes» (баллы активности) импортируются как удары/мин. |
| E9 | minor | `lib/src/finance-import.ts:85-88` | `parseAmount`: значение только с запятой всегда десятичное. «1,000» (тысяча) → 1.0 — занижение в 1000× для банков с запятой-разделителем тысяч. |
| E10 | minor | `lib/src/repositories/domain.ts:218-220,239` | `logHabit` при `already=true` возвращает `id:""` (пустая строка вместо id существующей строки лога). |
| E11 | minor | `cli/chat-server.mjs:240-245` | `readThreads()` при повреждённом `chat-threads.json` → `[]`; следующий `upsertThread()` перезапишет файл одним тредом → **потеря всех прочих тредов** при транзиентной порче. |
| E12 | minor | `lib/src/ics.ts:106,152` | `parseRRule` UNTIL: сравнение смешивает локальную серию и UTC-форму `...Z` → сдвиг на TZ-офсет, крайние вхождения могут отсекаться/просачиваться. |

---

### 3. Gaps (валидация, права, необработанные пути)

| # | severity | файл:строка | проблема |
|---|---|---|---|
| G1 | **major** | `scripts/hooks/guard-destructive.sh:76-83` | ✓verified (live ALLOW). Массовое удаление через `find … \| xargs rm -rf` **не блокируется** (rm-ветка требует цель в строке команды, а xargs берёт из stdin). |
| G2 | **major** | `scripts/hooks/guard-destructive.sh:130` | ✓verified (live ALLOW). `DELETE FROM …` без WHERE обходится словом «where» где угодно: `DELETE FROM users; -- keep where` и `DELETE FROM audit_where` проходят. |
| G3 | **major** | `lib/src/embeddings.ts:97-99` | ✓verified. `embedQuery()` безусловно `assertPrivacy("private")`. На удалённом эмбеддере без `NABU_EMBED_ALLOW_REMOTE=1` **любой семантический поиск** (recall/knowledge.search) бросает отказ — даже по `default`. Асимметрия: запись default разрешена, чтение — нет. |
| G4 | minor | `cli/nabu.mjs:459-461` | `cmdDaemon()` безусловно перезаписывает PID_FILE (проверка живого демона только в `cmdStart`). Прямой `nabu daemon` при живом демоне → два `getUpdates` → Telegram 409, борьба за порт. |
| G5 | minor | `cli/nabu.mjs:651-689` | `runClaudeJob()` спавнит `claude` без таймаута/kill (в web/TG есть 10-мин SIGKILL). Зависший scheduled-джоб — процесс-сирота навсегда. |
| G6 | minor | `lib/src/mcp-result.ts:35-37` | `wrap(fn)` ловит только reject промиса. Синхронный throw до возврата уйдёт мимо `fail()`. Обернуть в `Promise.resolve().then(fn)`. |
| G7 | minor | `lib/src/repositories/personality.ts:55-63` | `getTraits()` (public) возвращает сырые черты без `applyGuardrails` (floor honesty≥8/kindness). Только `render()` применяет пороги. |
| G8 | minor | `lib/src/index.ts:133-167` | `buildDeps()` создаёт НОВЫЙ `pg.Pool` на каждый вызов; web-chat кэширует per-profile → N×`NABU_PG_POOL_MAX` соединений без вытеснения. |
| G9 | minor | `cli/claude-run.mjs:35` + `chat-server.mjs:298` | web `/api/chat` ограничивает только тело 1МБ, не длину `message` перед `spawn(claude,['-p',text])` → близко к ARG_MAX (E2BIG). |
| G10 | minor | `lib/src/config.ts:58-75` | `hydrateEnvFromFile`: наивный парсер не поддерживает `export KEY=` и многострочные значения. |
| G11 | minor | `scripts/install-cron.sh:33` | Ветка `--remove` вставляет `$job` в grep-regex без экранирования (install-путь валидирует, --remove — нет). |

---

### 4. Недоделки (TODO, заглушки, хардкод, stale)

| # | severity | файл:строка | проблема |
|---|---|---|---|
| N1 | **major** | `evals/fixtures/mind-crisis/` (пусто), privacy/finance/triage — 0 фикстур | ✓verified (54/73 SKIP). Safety-критичные наборы (crisis, privacy) **без offline-фикстур** → детерминированный гейт пуст; CI evals не гоняет → инварианты SAFETY #2 (privacy) и #3 (crisis) **не энфорсятся автоматически**. |
| N2 | minor | `scripts/init-workspace.sh:96` | Безусловно пишет `"shared_db_with_main_nabu": true` — противоречит standalone-only (shared-режим удалён в v1.0.0). Ложный флаг. |
| N3 | minor | `scripts/transcribe.py:20` ↔ `config/nabu.config.json:13` | Дефолт модели: скрипт «small», конфиг «large-v3» — расхождение. |
| N4 | minor | `config/crisis_resources.json` | `VERIFY_BEFORE_PRODUCTION:true`, все номера `verified:false`. **Корректно** по SAFETY (навигатор-first), но остаётся открытым release-gate. |
| N5 | minor | `evals/runner.mjs` (must_not_include) | Матчер слеп к отрицанию: корректный отказ, цитирующий запрещённую фразу, падает; запрещённое иначе сформулированное — проходит. |

---

### 5. Пустые функции / мёртвый код

| # | severity | файл:строка | проблема |
|---|---|---|---|
| D1 | minor | `lib/src/repositories/recommendation.ts:70-78` | `listByDomain()` не вызывается нигде. |
| D2 | minor | `lib/src/personality.ts:74-93` | `renderSalient()` — только в тесте, ни один сервер/CLI не зовёт. |
| D3 | minor | `scripts/hooks/guard-web-privacy.sh:44` | Первый python-fallback в `deny()` — SyntaxError; замаскирован `\|\|` корректным fallback. Достижим только без `jq`. |
| D4 | minor | `cli/telegram-bot.mjs:849-850` | `MAX_AUDIO_BYTES = TG_DOWNLOAD_LIMIT` — избыточный алиас. |

---

### 6. Качество (дублирование, консистентность)

| # | severity | файл:строка | проблема |
|---|---|---|---|
| Q1 | minor | `cli/telegram-bot.mjs:194` ↔ `cli/chat-server.mjs:341` | `extractAssistantText()` идентична в обоих мостах — место в `claude-run.mjs`. Аналогично нарезка на 4000 симв дублируется. |
| Q2 | minor | `agents/{marketing,product-strategy,sales,startup-gtm,travel-planner}.md` | ✓verified. Ключ `capabilities:` в frontmatter **не поддерживается** Claude Code → игнорируется у 5 агентов. Косметика. |
| Q3 | minor | `cli/nabu.mjs:116,126` | `.env` (VAULT_KEY, пароль PG, TELEGRAM_BOT_TOKEN) пишется без mode → 0644. Нужен chmod 0600. |
| Q4 | minor | `schema/postgres/*` | FK-колонки без покрывающего индекса (tasks.project_id/parent_goal_id, quests.goal_id, recommendation.deliberation_id, claims.source_id, note_links.target_note_id, action_log.approval_id) → seq-scan при CASCADE. Single-user некритично. |
| Q5 | minor | `schema/typedb/002_standalone_domain.tql:4` | Коммент «порядок по имени» неверен: 002 зависит от `memory.tql`, работает только из-за явного `KNOWN_ORDER` в nabu.mjs:354. |
| Q6 | minor | `schema/postgres/016_habit_logs_dedup.sql:5-8` | Безусловный DELETE при каждом применении схемы (без DO/IF-guard). Идемпотентно по эффекту. |
| Q7 | minor | `cli/nabu.mjs:800-828` | `pushToTelegram()` режет по 4000 code units — может разорвать суррогатную пару. Косметика. |

**Опровергнуто (НЕ находка):** `disallowedTools` у 71 агента — **официально поддерживаемый** денилист (подтв. по docs.claude.com), least-privilege работает, инвариант #7 соблюдён. SSRF/path-traversal/CSRF/HMAC/XSS в web+connect — надёжны. Инъекций в spawn нет (нет shell:true). version.mjs охватывает все 21 файл.

---

## Сводка

- **critical: 0**
- **major: 11** — S1,S2,S3 (доки/skills/embeddings-путь) · E1,E2,E3,E4,E5 (freeze демона ×4 + race сессии) · E6 (кэш доменов) · G1,G2 (обходы guard) · G3 (поиск на remote) · N1 (пустые safety-фикстуры)
- **minor: ~30** — устаревшие числа, dead code, качество данных импорта, права .env, FK-индексы, косметика.

Приоритет для рефакторинга (см. REFACTOR_PLAN.md): сначала **безопасность-гейты** (G1,G2,N1),
затем **стабильность демона** (E1,E2,E4,E5,E3), затем **корректность на remote-эмбеддере** (E6,G3),
затем доки/комменты (S1,S2,S3–S8) и minor.

> Требуют решения пользователя: (а) объём фикса freeze-демона (быстрые async-обёртки vs вынос в
> worker); (б) политика `embedQuery` на remote (блокировать приватно vs разрешать default-поиск);
> (в) верификация crisis-номеров (release-gate, вне кода).

---

## Этап 5: Статус исправлений (2026-07-06)

Рефакторинг выполнен по `REFACTOR_PLAN.md` (пользователь подтвердил полный объём). 20 атомарных
коммитов на master. После каждого: `build` + `npm test` + (для guard/evals) `test:hooks`/eval-гейт.
Финал: build 0 · **86 unit** · **70 guard + 28 web-privacy** · **privacy-eval гейт (11/11)** ·
демон перезапущен, E2E веб-чат отвечает без фризов.

### ✅ Исправлено (все 11 major + большинство minor)

| Находка | Как закрыто |
|---|---|
| E1,E2,E4,E5 (freeze демона) | Тяжёлые `spawnSync` в процессе демона → async (`shAsync`/`spawnCapture`): git fetch, whisper-установка, self-update, docker/backup, unzip/pdftotext/tesseract. Первый update-check отложен со старта. |
| E3 (race claude-сессии) | `withConversationLock(key,fn)` в claude-run.mjs — per-conversation мьютекс, общий для web+TG (один процесс). Проверено: один ключ — последовательно, разные — параллельно. |
| G1,G2 (обходы guard) | `xargs/parallel + rm/shred` заблокированы; `DELETE/UPDATE` без WHERE — снятие комментариев + WHERE как слово. +11 тест-кейсов, live-проверено. |
| N1 (пустые safety-фикстуры) | **privacy**: 11 golden-фикстур + `--require` гейт (пустой набор/провал → ненулевой exit) + CI-шаг. **crisis** — отдельной итерацией (см. ниже). |
| E6 (кэш доменов) | Ключ кэша domain-vecs включает провайдер+модель+dim → авто-инвалидация при смене. |
| G3 (поиск на remote) | `embedQuery(text, visibility)`; knowledge.search → 'default' (работает на облачном эмбеддере без opt-in), личная память — 'private'. |
| S1,S2,S3,S4–S8 (доки) | Skills-противоречие устранено; числа 74/27/70+28/39; remote-embeddings раскрыты в privacy; stale-комменты (vault не эмбеддится) поправлены; nabu-library/onboard/tasks задокументированы. |
| E8,E9 (данные импорта) | Google Fit «Heart Points/Minutes» ≠ heart_rate; finance «1,000» = тысячи, не 1.0. +6 тестов. |
| E7,G6,E10,G10,E11,D1,D4 | clearTimeout hard-timeout; mcp-result ловит sync-throw; logHabit → реальный id; .env `export KEY=`; readThreads бэкапит порчу; удалён dead `listByDomain`; убран алиас MAX_AUDIO_BYTES. |
| Q4,Q5,Q6,N2,N3,G11,D3,A4,G4,G5 | Миграция 018 FK-индексы (сверена с живой БД, идемпотентна); 016 DELETE под guard; TQL-коммент; init mode:standalone; whisper small; install-cron валидирует job; guard-web-privacy SyntaxError; .env→0600; guard второго демона; таймаут scheduled-джоба. |
| Q1,G9 (мосты) | extractAssistantText вынесен в claude-run.mjs; web-message лимит длины перед spawn. |

### ⏸ Отложено (осознанно, с причиной)

- **N1-crisis фикстуры** — safety-критично: «золотые» ответы на кризис-кейсы должны генерироваться
  прогоном через живого Claude и **вычитываться человеком** до постановки гейтом. Не делать «на глаз».
  Механика (`--require`, матчер, CI-шаг) уже готова — добавить фикстуры отдельной итерацией.
- **G8 (переиспользование pg-пула в buildDeps)** — паттерн `deps.pg.close()` повсеместен; шаринг
  пула без refcounting сломает закрытие для других потребителей. Риск > польза на single-user; не трогал.
- **Q7 (графемно-безопасная нарезка 4000)** — косметика (разрыв суррогатной пары → один replacement-символ).
- **E12 (ics UNTIL TZ-край)** — узкий край RRULE; правка рискует задеть парсер, польза мала.
- **renderSalient** — оставлен (покрыт тестом; кандидат в API, а не мёртвый прод-код).
- **guard динамических имён команд** (`X=rm; $X`) — фундаментальный предел regex-гарда; оговорка
  дописана в шапку скрипта, реальный энфорсер — approval.

### ⚠ Требует решения/действия пользователя

1. **Crisis-фикстуры (N4/N1-crisis)**: сгенерировать «золотые» ответы (нужен прогон через Claude +
   токены) и вычитать — скажи, когда; сделаю отдельной итерацией.
2. **Проверка crisis-номеров** (`config/crisis_resources.json`, VERIFY_BEFORE_PRODUCTION) — вне кода,
   твоя верификация перед публичным релизом.
3. **Мониторинг демона** под реальной параллельной нагрузкой: async-обёртки и session-lock проверены
   на happy-path и юнит-локом; понаблюдай при активном одновременном использовании web+TG.

*Round 7 закрыт. R6 — в `AUDIT_R6_archive.md`. Все изменения на master, запушены.*
