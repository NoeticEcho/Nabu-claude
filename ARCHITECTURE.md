# Nabu-claude — Архитектура

Nabu-claude — **standalone-продукт** (решение v1.0.0): работает на Claude Code с собственным
локальным стеком (Postgres+pgvector, TypeDB, Ollama в docker). Shared-режим к БД основного
приложения Nabu УДАЛЁН. Схема — наследие основного Nabu: расширяется только аддитивно.

Этот документ дополняет `LIFE_DOMAINS_RESEARCH.md` (состав агентов), `SAFETY.md` (границы компетенции). Дизайн harness следует принципам agents-best-practices.

---

## 1. Локальный стек (standalone)

- **Собственная БД**: локальный Postgres + pgvector и TypeDB в docker (не Supabase, не общая с основным Nabu). Nabu-claude — самодостаточный.
- **Схема — наследие основного Nabu**: не дублировать и не «переизобретать» таблицы. Дополнительные таблицы (память агентов, личность, реестр агентов, журнал совещаний) — добавлять аддитивно, не ломая.
- **Приватность**: типы visibility (`default/private/vault`), namespace пользователя. Vault E2E-шифр, эмбеддинги только локально (Ollama). Privacy-routing — см. `SAFETY.md`, инвариант #2.
- **Мозг — Claude Code (Max)**: рассуждение выполняет Claude Code, не отдельные API-вызовы. Тяжёлое (эмбеддинги, транскрипция) — локальные модели.

## 2. Harness-дисциплина (из agents-best-practices)

Ключевой принцип: **harness действует, модель предлагает**. Применяется так:

- Агенты предлагают действия; **исполнение и проверки — в коде/командах**, не «на доверии к модели».
- **Классы риска** инструментов: read (автономно, если узко) · draft (автономно, если помечено) · write/external/financial/destructive (через **approval-запись**, вне модели).
- **Никаких broad-инструментов** (`execute_anything`, `send_message`, `write_db`). Каждое действие — узкий типизированный tool со структурированным результатом и детерминированной проверкой прав.
- **Бюджеты циклов**: шаги, время, токены, стоимость — ограничены; у каждого цикла есть причина остановки.
- **Каждый tool-call даёт результат** (включая отказ/таймаут — это тоже наблюдение).
- **Контекст строится, не сваливается**: достаём ровно нужное из памяти, помечаем границы доверия, сохраняем активное состояние при компактизации.
- **Сначала single-agent MVP**; Совет, agent-creator, автономия — это расширения, обоснованные реальной потребностью, а не стартовая сложность.

## 3. Состав агентов

См. `LIFE_DOMAINS_RESEARCH.md`. Кратко:
- **Совет министров** (9 доменных): health, mind, finance, work, learning, relationships, growth, lifestyle, admin.
- **Функциональные**: adjutant (orchestrator), council (facilitator/arbiter), decision-maker, agent-creator, critic, конвейер памяти (librarian/entity-extractor/retriever/memory-keeper/reflector), voice-transcriber (опц.).
- Узкие специалисты — порождаются agent-creator'ом по требованию.

## 4. Протокол коллегиального решения

```
Запрос
  │
  ▼
[adjutant] триаж: простой / единодоменный / многодоменный?
  ├── простой факт ───────────────► ответ напрямую (+ память)
  ├── один домен ─────────────────► один министр ► ответ
  └── многодоменный / с компромиссами
        │
        ▼
   [council] созыв релевантных министров
        │  каждый даёт структурированную позицию:
        │  { recommendation, rationale, risks, confidence, depends_on[] }
        ▼
   выявление конфликтов между позициями
        │
        ▼
   синтез интегрированной рекомендации (trade-off'ы наружу)
        │
        ├── если это настоящий выбор ► [decision-maker] формализует (критерии, веса, MCDA)
        ▼
   [critic] проверка: границы компетенции, приватность, wellbeing, точность
        │
        ▼
   ответ пользователю + запись решения в эпизодическую память
```

Реализовано как **Agent Team** (`docs/TEAMS.md`, флаг `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`):
адъютант-lead спавнит релевантных министров + `council` + `critic` тиммейтами; министры обсуждают
кросс-доменные зависимости напрямую (SendMessage) и координируются общим task-list, фиксируя позиции
в durable-буфер `deliberation`. Без флага — тот же протокол через параллельный Task-диспатч + буфер
(fallback). Это **оркестрированная коллегиальность**, не рой автономных агентов.

## 5. Память и личность

- **Память**: 7 типов на 3 хранилищах (рабочая, эпизодическая, семантическая, процедурная, ассоциативная, проспективная, автобиографическая). Схемы — `schema/`. Локальная БД (standalone).
- **Личность**: числовые черты на агента (`agents/*.json`) → директивы по `PERSONALITY_RENDERING.md`. Стилизация, не сознание.
- Все агенты Совета имеют доступ к общей памяти пользователя → общий контекст для коллегиального рассуждения.

## 6. Структура плагина

```
nabu-claude/
├── .claude-plugin/plugin.json          # 4 skills (адъютант + 3 доменных пака), 27 commands, 9 mcpServers
├── CLAUDE.md, ARCHITECTURE.md, AGENT_INTEGRATION.md, LIFE_DOMAINS_RESEARCH.md,
│   SAFETY.md, PERSONALITY_RENDERING.md, INSTALL.md, README.md
├── agents/
│   ├── registry.json          # реестр всех агентов (поле impl → agents/<slug>.md)
│   ├── <68>.md                # ВСЕ агенты — субагенты Claude Code (министры, функциональные,
│   │                          #   память, конвейер agents/registry.json, созидатели); frontmatter name/model/tools
│   └── <slug>.json            # профили личности (числовые черты + guardrails)
├── skills/nabu-orchestrator/  # адъютант-оркестратор (работает в основном контексте)
│   skills/{nabu-marketing,nabu-product,nabu-sales}/  # + 3 доменных skill-пака
├── commands/                  # 27 слэш-команд (см. §7)
├── mcp/                       # 9 серверов: memory, pipeline, council, voice, analytics, domain, improve, connect, olimpos
├── lib/                       # порты, репозитории, типы, stats, personality, Postgres+tx (Option Д)
├── hooks/hooks.json           # SessionStart / PreToolUse(guard) / PostToolUse(autocommit)
├── scripts/                   # init-workspace, hooks/*, install-cron, transcribe.py
├── evals/                     # runner.mjs + фикстуры (fixture-replay / live judge)
├── schema/                    # postgres/001–007 + typedb/memory.tql (аддитивно)
└── config/nabu.config.json
```
> Skill'ов четыре: адъютант-оркестратор (основной контекст) + доменные паки marketing/product/sales.
> Все агенты (`agents/*.md`) — субагенты; диспатч через Task/Agent Teams.
> Профили `agents/*.json` — не субагенты, а числовые черты личности.

## 7. Команды Claude Code (26)

Ядро: `/nabu-init` (workspace) · `/nabu-index <папка>` (папка→база знаний) · `/nabu-ask` (адъютант с
памятью) · `/nabu-council` (Совет командой) · `/nabu-decide` (decision-maker) · `/nabu-new-agent`
(agent-creator) · `/nabu-recall` (поиск памяти) · `/nabu-consolidate` (консолидация + нарратив) ·
`/nabu-voice` (транскрипция) · `/nabu-agents` (реестр) · `/nabu-review` (critic-аудит).
Созидание/само-улучшение/расписание: `/nabu-build` · `/nabu-digest` · `/nabu-cron` · `/nabu-research` ·
`/nabu-scout` · `/nabu-evaluate` · `/nabu-feedback` · `/nabu-metrics`.

## 8. MCP-серверы (9, реализованы)

- **nabu-memory**: 7 типов памяти (Postgres+pgvector+TypeDB) + личность (`render_personality`) +
  governance (`request_approval`/`log_action`) + `system_task` + `purge_expired_working`.
- **nabu-pipeline**: индексация папок в базу знаний (sandbox путей, локальные эмбеддинги).
- **nabu-council**: `deliberation`-буфер (позиции/синтез) — durable-запись совещания.
- **nabu-voice**: Whisper-транскрипция (опц., неблокирующая, локально).
- **nabu-analytics**: прогноз/корреляция/аномалии/агрегаты — **TypeScript** (`lib/stats`), не python.
- **nabu-domain**: узкий доступ к доменным таблицам основного Nabu (проекты/задачи/цели/привычки/
  квесты/RPG/метрики), scope по `NABU_USER_ID`, мульти-write атомарны (`Postgres.tx`).
- **nabu-improve**: эффективность агентов + предложения улучшений + трекинг советов↔исходов.
- **nabu-connect**: коннекторы (GET-only, allowlist путей) + вебхуки (HMAC, replay-protected); внешние вызовы — через approval.
- **nabu-olimpos**: платформа OlimpOS (P3-P7) — agile (эпики/спринты/доска/velocity), реестр/рынок агентов, публикация spaces (сайтов), изолированные docker-песочницы + git. Скоуп per-tenant из env.

Все — узкие типизированные tools, единый контракт результата (`lib/mcp-result`), обёртка ошибок,
graceful shutdown; высокорисковые действия — через approval (best-practices).

## 9. Границы и честность

- Nabu-claude поддерживает, не заменяет: врача, юриста, финсоветника, терапевта, живые связи (`SAFETY.md`).
- «Память» и «личность» — инженерные конструкции, не сознание.
- Коллегиальное решение — обоснованная рекомендация; финальный выбор за пользователем.
- Расширение состава агентов — по реальной потребности, не впрок.
