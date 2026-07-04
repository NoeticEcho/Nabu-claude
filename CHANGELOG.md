# Changelog

All notable changes to Nabu are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
