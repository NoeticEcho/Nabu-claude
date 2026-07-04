# Changelog

All notable changes to Nabu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] — 2026-07-05
### Added
- **Синхронизация web↔Telegram**: разговоры с адъютантом и министрами общие между веб-чатом и
  Telegram (единая claude-сессия + история) — начал на компьютере, продолжил в телефоне.
- **Дашборд**: кликабельные плашки (drill-down в память/граф/дела/Совет) + вкладка «Обо мне» —
  дайджест того, что Nabu знает о пользователе.
- **RPG/XP-система** (`docs/RPG.md`): детерминированные начисления за реальные действия (закрытые
  задачи/привычки/цели), формулы уровней, мягкие штрафы (без давления), защита от накрутки.
### Fixed
- Деплой: `install-service` пробрасывает NABU_ENV_PATH и PATH (systemd находит claude/.env);
  `chat_message.thread_id` uuid→text (миграция 014) для канонических id разговоров.

## [1.6.0] — 2026-07-04
### Added (закрытие принятого компромисса аудита r5 + регресс-контракт новых поверхностей)
- **Структурный веб-privacy гейт**: PreToolUse-хук `guard-web-privacy.sh` ЖЁСТКО блокирует
  WebSearch/WebFetch с email/телефоном/картой/счётом/vault-шифртекстом и WebFetch на внутренние
  хосты (SSRF). Раньше защита была только промпт-уровневой. 16-кейсовая регрессия в `test:hooks`.
- **Eval-набор `web`**: 3 кейса (веб-поиск работает / приватное обезличивается / без гарантий
  дохода), fixtures записаны — регресс-защита веб-поверхности.

## [1.5.0] — 2026-07-04
### Fixed (аудит-раунд 5: harness-швы + приватность расширенной поверхности)
- **Daemon-возможности выровнены**: адъютант получил `Write` (md-артефакты Совета/дайджестов
  снова пишутся в веб/TG), но НЕ Bash/Edit — тяжёлый build остаётся в интерактивном `/nabu-build`
  (SKILL честно направляет туда). Раньше SKILL обещал write/build, а allowlist их не пускал.
- **connect: path-traversal закрыт** (`/v1/x/../../admin` больше не обходит allowlist).
- **restore**: не оставляет расшифрованный плейнтекст; psql с ON_ERROR_STOP (частичное
  восстановление больше не рапортует успехом).
- **offline**: честное сообщение вместо зависшего спиннера, когда локальные модели недоступны;
  recall-фолбэк уважает профиль треда.
- **models**: ошибка загрузки Ollama больше не даёт ложный «установлена» и не травит `.env`.
- local-brain: denylist vault/webhook/approval даже при override; hook-токен constant-time;
  GPU без известной VRAM не помечается «быстро».

## [1.4.0] — 2026-07-04
### Fixed
- **Веб-исследование включено**: агенты (адъютант, research-assistant, web-harvester, scout)
  теперь реально пользуются нативными `WebSearch`/`WebFetch` Claude Code — без API-ключей и
  платных API. Раньше инструменты были прописаны в определениях агентов и документации, но
  отсутствовали в рантайм-allowlist всех трёх путей диспатча → веб был недоступен. Добавлены
  приватностные ограждения: в веб-запрос не уходит private/vault/персональное — только
  обезличенный внешний вопрос; результаты помечаются как внешние, со ссылками на источники.

## [1.3.0] — 2026-07-04
### Added
- **`nabu models`** — инвентаризация железа (RAM/ядра/GPU) + курируемый каталог локальных моделей
  Ollama с пометкой «влезает» и честной оценкой скорости под ваш CPU; выбор и установка одной
  командой, запись в `.env` по роли (chat/vision/embed). `nabu init` печатает инвентаризацию и
  рекомендацию. Каталог включает `gemma3:270m-it-qat` как быстрый smoke-тест для слабых машин.

## [1.2.0] — 2026-07-04
### Added
- **Локальный мозг T1** (`cli/local-brain.mjs`): при недоступном Claude чат ведёт агентный цикл
  ЛОКАЛЬНОЙ модели с реальными MCP-инструментами (память/задачи/календарь/знания; высокорисковое
  недоступно осознанно) — апгрейд offline-режима. Доказано вживую: модель вызвала list_tasks
  через MCP и ответила фактом из БД.
- **Гейт «локального мозга» замерен**: `evals/runner --brain local` прогоняет evals Совета против
  локальной модели. Первый замер (qwen3.5:0.8b, CPU): паритета с Советом НЕТ (1/7 + таймауты) —
  T2 (локальный Совет) остаётся гейтированным до модели, проходящей evals (крупнее + GPU).

## [1.1.0] — 2026-07-04
### Removed
- **Наследие SaaS-эры вычищено**: docs/01–28 (SRS/SAD/ADR/бэклог/спеки), docs/_reference
  (12 стратегических доков), BUILD_PROMPT — 30 файлов; wellbeing-протокол (быв. docs/28)
  вобран в SAFETY.md без потери политики; 84 живых файла свипнуты от ссылок.
### Added
- **Evals активны**: fixtures записаны живым прогоном (14 кейсов council/consult/vault/connect),
  матчеры negation-устойчивые, baseline зафиксирован — регресс-контракт работает в default-режиме.
- **Commons вживую**: первый tally-прогон на GitHub — COMMUNITY_PRIORITIES.md публикуется
  workflow'ом (реестр workflows переиндексирован после force-push).

## [1.0.2] — 2026-07-04
### Added
- **`nabu restore <каталог>`** — корректное восстановление одной командой (pg+typedb+workspace,
  авторасшифровка .enc, подтверждение). Ручная заливка дампа в живую БД теряла данные.
### Fixed (аудит-раунд 4: journey-прогоны + аудит r3-фиксов)
- EXDATE у Z-серий не зависел от TZ сервера; guard блокирует docker volume rm / compose down -v /
  nabu-деструктив с --yes из модели (59 кейсов); адъютант умеет писать домен (add_task/award_xp);
  мультивалютные партии импорта не смешиваются; провал update — exit 1; новые джобы доезжают
  после update; версии манифестов 1.0.x; атомарный посев конфигов; и др.

## [1.0.1] — 2026-07-04
### Fixed (аудит-раунд 3: 4 critical, 13 major, ~20 minor — все находки воспроизводились живьём)
- **Свежая установка** снова работает (init пропускал bootstrap без .env); **веб-чат** чинен
  (TDZ ломал каждый обмен); **профили** fail-closed + `nabu profiles add` (утечка задач/финансов
  между профилями закрыта); **28 агентов** переведены с удалённого Supabase MCP на nabu-domain.
- `nabu update` больше не ломается пользовательскими настройками (живые конфиги —
  в `~/nabu/.nabu/config/`); бэкап не фризит демон; сбой шифрования не оставляет плейнтекст;
  «два кофе» не дедуплицируются; approvals вебхуков одноразовые с expiry; SSRF-redirect закрыт;
  валюты не смешиваются; EXDATE date-форм работает; + клиентские и полировочные фиксы.

## [1.0.0] — 2026-07-04
### Changed
- **Standalone-only**: shared-режим (подключение к внешней/общей БД) удалён целиком —
  один режим, локальный docker-стек. Упрощение продукта и поверхности поддержки.
- Мульти-девайс: телефон → Telegram/PWA к домашнему демону; перенос — `backup`/restore.

## [0.20.0] — 2026-07-04
### Added
- **Task management, полный цикл**: `add_task` MCP-tool (срок/приоритет/проект/сферы),
  `list_tasks` с `open`/`dueWithinDays` (просроченные первыми), `/nabu-tasks` (обзор дня/недели,
  добавление, закрытие), **быстрый ввод из Telegram** — `!текст [@завтра|@YYYY-MM-DD]`
  мгновенно и без Claude-квоты.
- **Мульти-профиль v2**: селектор профиля в веб-чате; тред фиксирует профиль при создании;
  обмен и MCP-серверы работают в пространстве профиля; статистика per-profile;
  `buildDeps({namespace, userId})`.
- `scripts/release-prep.sh noeticecho` — вся механика плейсхолдеров релиза одной командой.

## [0.19.0] — 2026-07-04
### Added
- Обучаемая проактивность: кнопки 👍/🔇 под push'ами, авто-backoff интервалов (cap ×4).
- Ритуалы масштаба: quarterly-/yearly-review пишут главы автобиографии.
- Мульти-профиль v1 (profiles.json + `--profile`), паки nabu-product/nabu-sales.
- Commons tally v2 (вес evidence по signals, бонус версий, авто-triage) + 11 самотестов.
- Шифрованный бэкап: `backup --encrypt` (AES-256-GCM, NBK1) + `backup-decrypt`.
- EN-доки: docs/en/{QUICKSTART,PHILOSOPHY}.md.

## [0.18.0] — 2026-07-04
### Added
- Джоба life-narrative (глава автобиографии месяца), голос-на-голос TTS, фото→память
  (vision/tesseract локально), first-run онбординг в чате, i18n-хром RU/EN (99 ключей),
  +14 eval-кейсов (council/consult/vault/connect).

## [0.17.0] — 2026-07-03
### Added
- PDF/OCR-индексация; `import-finance` (банковские CSV, категоризация, дедуп);
  гигиена памяти (vault-иммунитет); джобы reminders/hygiene/healthcheck/weekly-review;
  `doctor --deep`; offline-режим (локальная LLM по памяти).

## [0.16.0] — 2026-07-03
### Added
- Утренний брифинг (детерминированный, push); ICS-календарь без OAuth; `import-health`
  (Apple/Google Fit/CSV); локальный TTS (piper); `/nabu-onboard`.

## [0.15.0] — 2026-07-03
### Added
- Nabu Commons: федеративное самоулучшение (propose/vote/contribute/review-pr,
  детерминированный tally, human-merge-only).

## [0.14.0] — 2026-07-03
### Added
- Consult-протокол (кросс-доменные консультации любых агентов); nabu-connect (коннекторы
  по allowlist, вебхуки in/out c HMAC и approval по БД); каталог 34 API; 5 специалистов;
  эталонный доменный пак nabu-marketing.

## [0.13.0] - 2026-07-03

Roadmap P1 + P2 features. P0 and P1 are fully closed; P2 is closed except for
consciously deferred items.

### Added
- **Vault end-to-end encryption.** `visibility: vault` content is encrypted with
  AES-256-GCM before it is written to Postgres, using a machine-local key
  (`NABU_VAULT_KEY`). Vault entries get no embeddings; reads are explicit only.
- **Local LLM for private extraction.** `NABU_LOCAL_LLM` (default `qwen3:4b`)
  extracts entities/facts from `private`/`vault` content locally, so the text
  never enters Claude's context (`nabu-pipeline.extract_entities_local`).
- **Out-of-model approvals.** High-risk `request_approval` requests are now
  confirmed by a human via buttons — in the web chat ("🔐 Подтверждения") and in
  Telegram (`/approvals` inline buttons). Decisions are audited as
  `user:web` / `user:telegram`. The model can no longer approve itself.
- **Server-side chat history.** Threads persist in Postgres (namespace-scoped)
  instead of only browser localStorage, so history survives across devices and
  browser clears (`schema/postgres/009_chat_history.sql`).
- **Dashboard drill-down and trends.** Clickable stat cards drill into recent
  episodes / open tasks, and metric trends (`nabu-analytics.forecast`) render
  directly in the stats panel.
- **Telegram live streaming.** Bot messages are edited as the answer generates
  (`editMessageText`), instead of waiting for the full response.

## [0.12.0] - 2026-07-03

Roadmap P0 — everyday-use features that close the "capture on phone → Nabu files
and remembers it" loop.

### Added
- **Inbox triage.** New `notes` tools and a `/nabu-triage` command; a scheduled
  `triage` job classifies incoming notes (Telegram + `00-inbox` files) into
  entities / facts / graph and moves them into the workspace structure.
- **Telegram voice transcription.** Voice/audio/video-note messages are
  transcribed locally (`scripts/transcribe.py`, faster-whisper) and routed as
  text in their topic.
- **Proactive Telegram push.** Scheduled-job results (digest, follow-ups) are
  pushed to Telegram/web chat instead of only sitting in logs.
- **`nabu backup`.** One command dumps Postgres (`pg_dump` → gzip), the TypeDB
  volume (tar), and the workspace (tar) to `~/nabu/.backups` (retention 7); also
  available as a scheduled internal job.
- **PWA-lite** manifest + service worker for an installable mobile web shell,
  and a first-run onboarding starter flow.

### Fixed
- TypeDB data volume mapping so data persists correctly across restarts.

## [0.11.0] - 2026-07-02

### Added
- **Cross-platform support** for Windows and macOS (in addition to Linux).
- **Optional Telegram bot client** with forum topics (Входящие / Адъютант / the
  9 ministers), single-user binding.
- `ROADMAP.md`.

### Changed
- **Dark theme locked** as the only theme (`color-scheme: dark`).

### Fixed
- Applied code-review findings across the stack.

## [0.10.0] - 2026-07-02

Full local mode, statistics, and logging.

### Added
- **Full docs/07 ontology** plus notes/research tables for standalone mode, so
  `nabu-domain` / `nabu-analytics` and the research agents work with no cloud.
- **Statistics dashboard** in the web chat, `GET /api/stats`, and a `nabu stats`
  terminal overview with a 14-day sparkline.
- **JSONL chat logs** (`chat.jsonl`) recording metadata only — no message text.

### Fixed
- Headless sessions now pass an explicit `--mcp-config` (plugin MCP servers do
  not start on their own in `-p` mode) — critical for local operation.

## [0.9.0] - 2026-07-02

Zero-config: clone and run.

### Added
- **Docker stack** — pgvector (pg17) + TypeDB 3.4 + optional Ollama, all bound to
  `127.0.0.1`.
- **Standalone schemas** applied idempotently, plus a one-line installer
  (`scripts/install.sh`).
- **`nabu` CLI** — `init`, daemon (`start`/`stop`/`status`/`logs`), scheduler,
  web chat, `update`, `doctor`.
- **Web chat** at `http://127.0.0.1:4517` — zero-dependency vanilla UI where each
  reply is a headless Claude Code session (SSE streaming, context resume).
- `docs/ZERO_CONFIG.md` and quick-start paths in README / INSTALL.

## [0.8.0] - 2026-07-02

Initial public baseline — the pre-zero-config foundation.

### Added
- **Council as an Agent Team** — relevant ministers spawn as teammates, discuss
  cross-domain conflicts directly, and are synthesized with trade-offs by
  `council`; `decision-maker` / `critic` check the result.
- **68 subagents** (44 pipeline agents + 9 domain ministers + functional +
  memory + builders) and the `nabu-orchestrator` skill (adjutant / dispatcher).
- **7 MCP servers** — `nabu-memory`, `nabu-pipeline`, `nabu-council`,
  `nabu-voice`, `nabu-analytics`, `nabu-domain`, `nabu-improve` — all using the
  shared `ok`/`degraded`/`fail` result contract.
- **Personality engine** — numeric traits (`agents/*.json`) rendered to
  directives (`lib/src/personality.ts`).
- **Guard hooks** (destructive-command protection), atomic multi-write
  transactions, and an eval harness.

[Unreleased]: https://github.com/noeticecho/nabu-claude/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/noeticecho/nabu-claude/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/noeticecho/nabu-claude/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/noeticecho/nabu-claude/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/noeticecho/nabu-claude/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/noeticecho/nabu-claude/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/noeticecho/nabu-claude/releases/tag/v0.8.0
