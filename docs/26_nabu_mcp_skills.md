# NABU TOOLING

*MCP Servers и Skills для разработки*  
*Инструментарий для AI-driven разработки через Claude Code и Aperant*  
*Tier-based приоритизация, конфигурации, custom servers для построения*  
*Версия 1.0*  

---

# 1. Назначение

Документ — практическое руководство по подключению MCP-серверов и skills к AI-development окружениям (Claude Code, Aperant) для эффективной разработки Nabu. Покрытие: какие MCP-серверы критически нужны, какие — high-value, какие custom servers нужно построить для Nabu specifically, какие skills существуют и какие нужно создать, конкретные конфигурации, workflow patterns.

Документ — нормативный для setup development environment. AI-команда разработки (Claude Code, Aperant) должна иметь все Tier 1 серверы подключёнными до начала Phase 0 разработки (документ 17 §6.1).

# 2. Категории инструментов

Три различные категории инструментов, которые часто путают:

| **Категория** | **Что это и роль** |
| --- | --- |
| MCP-серверы (Model Context Protocol) | Внешние процессы, которые предоставляют tools, resources, prompts для AI-агента. Запускаются параллельно AI-окружению. Стандартизованы через MCP-спецификацию. Примеры: filesystem, github, postgres. |
| Skills (Anthropic Skills) | Knowledge artifacts с инструкциями "как делать что-то". Текстовые SKILL.md файлы + supporting код. AI-агент читает их когда задача релевантна. Примеры: docx-skill для создания Word-документов, pptx для презентаций. |
| Built-in tools | Встроенные инструменты development environment: bash execution, file editing, code execution sandbox. Различаются между Claude Code и Aperant. |

Эффективная разработка Nabu требует **всех трёх** категорий. MCP-серверы дают доступ к external systems (БД, GitHub, web). Skills дают знание Nabu-специфических conventions. Built-in tools — выполнение действий.

# 3. MCP-серверы Tier 1 (критически необходимые)

Без этих серверов AI-driven разработка Nabu практически невозможна. Они должны быть подключены до начала разработки.

## 3.1. filesystem

1. **Назначение**: чтение, запись, навигация по файловой системе проекта
1. **Источник**: official Anthropic — `@modelcontextprotocol/server-filesystem`
1. **Без этого**: AI не может работать с кодом локально
1. **Особенности для Nabu**: настроить allowed paths на `/path/to/nabu/repo` и `/path/to/nabu/docs`
Конфигурация (claude_desktop_config.json):

## 3.2. github

1. **Назначение**: создание/чтение issues, PRs, branches, code review, repository management
1. **Источник**: official — `@modelcontextprotocol/server-github`
1. **Без этого**: AI не может работать с code review workflow, PRs, issues
1. **Требует**: GitHub Personal Access Token с правами repo, workflow, write
1. **Особенности для Nabu**: создать отдельный GitHub App для AI-команды, ограничить scope только nabu-репозиториями
Конфигурация:

## 3.3. git

1. **Назначение**: git operations (commits, branches, diffs, log) без выхода в bash
1. **Источник**: official — `@modelcontextprotocol/server-git`
1. **Альтернатива**: можно использовать bash + git напрямую, но MCP даёт structured tools

## 3.4. context7 (документация)

1. **Назначение**: real-time fetch актуальной документации для библиотек/фреймворков
1. **Источник**: Upstash Context7 — `@upstash/context7-mcp`
1. **Почему критично для Nabu**: стек содержит много libraries с быстро меняющимися API: Mastra (новая), Next.js 14 App Router, NestJS 10+, Drizzle, Tauri 2.x. AI-агент без актуальной документации часто пишет код для устаревших API
1. **Уникально**: единственный MCP, который даёт version-specific documentation для thousands of libraries
Конфигурация:

Workflow: AI-агент resolve-library-id для нужной библиотеки → query-docs с конкретным вопросом. Получает актуальную документацию для конкретной версии.

## 3.5. postgres

1. **Назначение**: read/write на Postgres-базе, schema inspection, query execution
1. **Источник**: official — `@modelcontextprotocol/server-postgres`
1. **Без этого**: AI не может проверить schema, выполнить migrations, тестировать queries
1. **Особенности для Nabu**: connection к local dev database, не к production. Read-only mode для production logs
Конфигурация (dev database):

## 3.6. fetch / web (HTTP requests)

1. **Назначение**: HTTP запросы к internal и external services
1. **Источник**: official — `@modelcontextprotocol/server-fetch` или встроенный web_fetch
1. **Use cases**: тестирование локальных API endpoints, fetch external documentation, integration testing

## 3.7. brave-search или web_search

1. **Назначение**: web search для research, поиск решений, документации
1. **Источник**: `@modelcontextprotocol/server-brave-search` или встроенный web_search
1. **Без этого**: AI не может research новые библиотеки, искать решения issues
1. **Альтернатива**: built-in web_search в Claude Code (если доступен)

# 4. MCP-серверы Tier 2 (high-value)

Эти серверы значительно повышают эффективность, но не блокируют разработку при их отсутствии. Подключаются по мере выхода в соответствующие фазы.

## 4.1. supabase

1. **Назначение**: Supabase-specific operations (Auth, Storage, Realtime, Edge Functions)
1. **Источник**: `@supabase-community/supabase-mcp` (community)
1. **Когда подключать**: с Phase 0 (документ 17), сразу как используется Supabase
1. **Возможности**: project management, branch DB management, migrations, edge function deployment

## 4.2. playwright

1. **Назначение**: E2E test automation, browser interaction
1. **Источник**: `@playwright/mcp` (official Microsoft)
1. **Когда подключать**: с Phase 1 (когда есть UI для тестирования)
1. **Use case для Nabu**: написание и запуск E2E-тестов (документ 10 §6)

## 4.3. stripe

1. **Назначение**: Stripe API operations для разработки billing flow
1. **Источник**: official Stripe — `@stripe/mcp`
1. **Когда подключать**: Phase 3 (public beta, начало монетизации — документ 16)
1. **Use case**: создание test products, subscriptions, webhooks тестирование, customer management

## 4.4. sentry

1. **Назначение**: error tracking, issue management
1. **Источник**: official — `@sentry/mcp-server`
1. **Когда подключать**: Phase 1-2 (когда есть production errors для investigation)
1. **Use case**: debugging production issues, error analytics, release tracking

## 4.5. linear или github-issues (project management)

1. **Назначение**: issue tracking, sprint planning, backlog management
1. **Источник**: Linear MCP (official) или использовать github MCP для issues
1. **Когда подключать**: Phase 0
1. **Особенности для Nabu**: backlog (документ 04) — 568 SP × 12 sprints × 12 epics. Нужно где-то tracking
1. **Рекомендация**: начать с GitHub Issues (уже доступно через github MCP), мигрировать на Linear если команда вырастет

## 4.6. vercel / deployment

1. **Назначение**: deployment management, preview environments
1. **Источник**: Vercel MCP (community) или Cloudflare MCP
1. **Когда подключать**: Phase 0 (для preview deployments)

## 4.7. anthropic-api (для LLM testing)

1. **Назначение**: прямой доступ к Anthropic API для тестирования агентов
1. **Источник**: можно использовать встроенный или custom wrapper
1. **Use case для Nabu**: тестирование промптов агентов, prompt iteration, eval runs
1. **Альтернатива**: использовать Mastra runtime в локальном dev сервере

## 4.8. memory (persistent across sessions)

1. **Назначение**: knowledge graph memory across conversations
1. **Источник**: official — `@modelcontextprotocol/server-memory`
1. **Use case**: AI-агент помнит decisions, architectural choices, текущее state across sessions
1. **Особенно полезно для**: длительных workflows, multi-session feature development

# 5. MCP-серверы Tier 3 (полезные, опциональные)

## 5.1. docker

1. **Назначение**: container management, Docker Compose operations
1. **Когда нужен**: если используется containerized dev environment (Postgres, TypeDB, Redis в Docker)
1. **Альтернатива**: bash + docker commands

## 5.2. redis

1. **Назначение**: Redis cache inspection, key management
1. **Когда нужен**: если Nabu использует Redis (для rate limiting, caching) — спорно, основной cache в Postgres

## 5.3. sequential-thinking

1. **Назначение**: structured multi-step reasoning
1. **Источник**: official — `@modelcontextprotocol/server-sequential-thinking`
1. **Use case**: complex architectural decisions, debugging hard issues
1. **Замечание**: Claude Code Opus уже хорошо работает с complex reasoning без этого

## 5.4. figma

1. **Назначение**: чтение Figma designs для frontend implementation
1. **Когда нужен**: если используется Figma для UI design
1. **Источник**: `@figma/mcp` (official Figma)

## 5.5. google-drive

1. **Назначение**: доступ к Google Drive документам
1. **Use case для Nabu**: если 25+ документов спецификации копируются в Drive для shared access

## 5.6. slack или discord

1. **Назначение**: integration с team communication
1. **Use case для Nabu**: discord MCP для community management (Phase 1-3)

## 5.7. prometheus / grafana

1. **Назначение**: metrics query, dashboard management
1. **Когда нужен**: Phase 2+ (production monitoring)

## 5.8. opensearch / elasticsearch

1. **Назначение**: search infrastructure (если будет full-text поиск через Elasticsearch)
1. **Решение Nabu**: используем pgvector + Postgres full-text. Elasticsearch не нужен в текущей архитектуре

## 5.9. shadcn-ui-mcp

1. **Назначение**: помощь с shadcn/ui components (используется в Nabu Next.js)
1. **Источник**: community
1. **Use case**: быстрый доступ к component snippets, updates

# 6. Custom MCP-серверы для построения

Nabu имеет specific требования, которые не покрыты existing MCP-серверами. Эти custom серверы потребуется построить — оценочно 2-5 рабочих дней каждый.

## 6.1. typedb-mcp (критически важен)

Существующие MCP не имеют TypeDB поддержки. Нужно построить.

1. **Назначение**: TypeQL query execution, schema inspection, transaction management
1. **Реализация**: TypeScript MCP server, использующий TypeDB JS driver
1. **Tools to expose**:
- `typedb_query` — execute read query (returns ConceptMaps)
- `typedb_insert` — execute insert query
- `typedb_schema_describe` — describe schema
- `typedb_schema_define` — apply schema definitions
- `typedb_databases_list` — list databases
- `typedb_match_aggregate` — aggregations
1. **Время разработки**: 2-3 дня
1. **Альтернатива**: использовать fetch MCP + TypeDB HTTP API — рабочее, но менее ergonomic
Псевдо-конфигурация после построения:

## 6.2. mastra-mcp

Mastra — новая framework, документация не покрывает все edge cases. Custom MCP облегчает работу с агентами.

1. **Назначение**: Mastra-specific operations — создание агентов, workflows, tool definitions
1. **Tools to expose**:
- `mastra_agent_create` — scaffold нового агента по шаблону Nabu (см. Option Д контракты)
- `mastra_agent_test` — run агент с test input
- `mastra_workflow_define` — определить workflow
- `mastra_eval_run` — запустить eval-набор на агенте
- `mastra_traces_query` — query traces из observability layer
1. **Время разработки**: 3-5 дней
1. **Альтернатива**: filesystem MCP + bash + Mastra CLI. Работает, но больше manual steps

## 6.3. nabu-contracts-mcp (Option Д enforcement)

Документ 15 определяет Option Д контракты. Compliance с ними должна быть автоматизирована.

1. **Назначение**: проверка compliance с Option Д контрактами при каждом изменении кода
1. **Tools to expose**:
- `contracts_check_agent_isolation` — verify agent logic.ts не imports forbidden modules (см. документ 15 §3.6)
- `contracts_check_api_versioning` — verify OpenAPI spec sync с code, нет breaking changes в /v1/
- `contracts_check_repository_pattern` — verify no direct Drizzle imports в business logic
- `contracts_check_event_typing` — verify все published events — typed DomainEvent
- `contracts_check_dependency_graph` — verify package dependency graph compliance
- `contracts_generate_report` — generate compliance report для PR review
1. **Время разработки**: 4-7 дней (включает написание checks)
1. **Альтернатива**: ESLint rules + Madge + custom scripts. Менее ergonomic для AI

## 6.4. nabu-eval-mcp

Каждый агент имеет golden dataset (eval.jsonl). Запуск evals должен быть встроен в workflow.

1. **Назначение**: eval runs для агентов, regression detection
1. **Tools to expose**:
- `eval_run_agent` — запустить eval-набор на конкретном агенте
- `eval_run_all` — запустить все agent evals (для regression suite)
- `eval_compare_versions` — сравнить eval results между prompt versions
- `eval_add_case` — добавить новый case в golden dataset
- `eval_report_generate` — generate eval report
1. **Время разработки**: 3-4 дня

## 6.5. nabu-doc-sync-mcp

25 документов спецификации. Они должны жить вместе с кодом. Нужен механизм синхронизации.

1. **Назначение**: автоматическая синхронизация документации и кода
1. **Tools to expose**:
- `doc_check_drift` — проверка, не разошлась ли документация с реализацией (ADR vs actual code)
- `doc_update_from_code` — обновление документации по изменениям кода (например, agent list, API endpoints)
- `doc_generate_changelog` — генерация changelog из git history с привязкой к документам
- `doc_search` — semantic search через все 25+ документов
1. **Время разработки**: 5-7 дней
1. **Высокая ценность**: AI-команда часто "забывает" обновить документы при изменении кода. Этот MCP предотвращает rot.

## 6.6. nabu-i18n-mcp

Nabu — bilingual продукт (русский основной + английский для documentation/UI). Translation должна быть automated.

1. **Назначение**: translation management, i18n key sync
1. **Tools to expose**:
- `i18n_extract_keys` — извлечение i18n keys из кода
- `i18n_check_completeness` — проверка, есть ли translations для всех keys
- `i18n_propose_translation` — AI-translation для missing keys
1. **Время разработки**: 2-3 дня
1. **Альтернатива**: использовать одну из существующих i18n libraries с CLI

# 7. Skills — Anthropic Skills System

Skills — это knowledge artifacts с инструкциями для специфических задач. Хранятся как SKILL.md + supporting файлы. AI-агент читает их когда задача релевантна.

## 7.1. Существующие public skills (доступны в Claude Code из коробки)

| **Skill** | **Назначение, релевантность для Nabu** |
| --- | --- |
| docx | Создание и редактирование Word документов. **Релевантно**: документы спецификации Nabu в DOCX (как наши 26 документов). |
| pdf | Работа с PDF. **Релевантно для**: создание/обработка PDF документов в Nabu features (FR-7004 — import PDF). |
| pptx | Создание PowerPoint презентаций. **Релевантно для**: investor decks, internal presentations. |
| xlsx | Spreadsheets. **Релевантно**: финансовые модели (документ 16), unit economics calcs, eval reports. |
| frontend-design | Создание distinctive frontend interfaces. **Высоко релевантно**: Nabu Next.js UI, Tauri desktop UI. |
| product-self-knowledge | Anthropic product info (Claude Code, API). **Релевантно**: при настройке Claude API в Nabu. |
| file-reading | Чтение файлов разных форматов. **Релевантно**: обработка user uploads в Nabu features. |
| pdf-reading | Чтение PDF файлов. **Релевантно**: implement PDF parsing pipeline в Nabu. |
| skill-creator | Создание новых skills. **Критически релевантно**: для построения Nabu-specific skills (см. §7.3). |

## 7.2. Использование public skills для Nabu разработки

Public skills уже доступны без дополнительной настройки. Используются автоматически когда задача релевантна. Несколько примеров:

- Создаём новый ADR document → `docx-skill` автоматически invokes
- Дизайнируем React component → `frontend-design-skill` загружается
- Создаём investor deck → `pptx-skill`
- Анализируем PDF от пользователя → `pdf-reading-skill`

## 7.3. Custom skills для Nabu (нужно создать)

Skills, специфичные для Nabu, которые AI-команда должна создать в первые недели разработки. Каждый skill ~ 1-2 дня работы.

### 7.3.1. nabu-agent-patterns

1. **Назначение**: как писать нового Mastra-агента в Nabu, соблюдая Option Д контракты
1. **Структура SKILL.md**:
- Когда применять: всегда при создании/изменении агента в `packages/agents/`
- Структура агента: logic.ts (pure logic, no Mastra) + agent.ts (thin Mastra wrapper, ≤50 lines)
- AgentPorts pattern: все зависимости через ports interface
- Запрещённые импорты в logic.ts (Mastra, NestJS, Drizzle, Supabase, fs)
- Eval requirements: ≥200 cases в eval.jsonl
- Schema requirements: Zod input/output schemas
1. **Supporting файлы**: template files для нового агента

### 7.3.2. nabu-api-patterns

1. **Назначение**: NestJS controllers + services + OpenAPI sync patterns
1. **Структура SKILL.md**:
- Когда применять: при создании/изменении API endpoint
- Controller pattern: thin, validation через Zod, vызывает services
- Service pattern: business logic с явными зависимостями
- Response mapping: snake_case в API, camelCase в TS
- OpenAPI sync: автоматически после каждого изменения через ts-rest или nestjs/swagger
- Versioning: /v1/* breaking changes запрещены

### 7.3.3. nabu-test-patterns

1. **Назначение**: Vitest unit, integration, contract test patterns
1. **Структура**: примеры test files, mock patterns, fixture organization, contract test patterns для repositories

### 7.3.4. nabu-typedb-patterns

1. **Назначение**: TypeQL query patterns, schema management
1. **Структура**: schema definition style, query optimization patterns, rule examples, transaction patterns

### 7.3.5. nabu-privacy-routing

1. **Назначение**: правильная route logic для private/vault categories
1. **Структура SKILL.md**:
- Когда применять: при любой работе с user content
- Правила маршрутизации: default → cloud LLM, private → local Ollama only, vault → E2E encrypted, never leaves device
- Запрещённые антипаттерны: forwarding private content в cloud, logging private content в analytics
- Required checks: на каждом content access — проверка visibility flag

### 7.3.6. nabu-eval-patterns

1. **Назначение**: написание golden datasets, eval runners, metrics по типу агента

### 7.3.7. nabu-rls-patterns (Postgres Row Level Security)

1. **Назначение**: правильное использование RLS в Supabase для multi-tenant isolation
1. **Структура**: RLS policy templates, common patterns, security pitfalls

### 7.3.8. nabu-docx-spec

1. **Назначение**: соглашения по созданию/обновлению Nabu specification documents (наши 26 документов)
1. **Структура**: docx_helpers usage, document numbering, version conventions, sections format

# 8. Setup recommendations для Claude Code

## 8.1. Установка

Claude Code — CLI tool от Anthropic. Установка через npm:

## 8.2. Konfiguracija MCP servers

Claude Code использует `~/.config/claude-code/mcp_settings.json` для MCP конфигурации. Полная конфигурация для Nabu Tier 1:

## 8.3. Skills directory

Claude Code читает skills из проекта. Структура:

## 8.4. CLAUDE.md в корне проекта

Создать `CLAUDE.md` в корне проекта — это документ, который Claude Code читает в каждой сессии. Должен содержать:

1. Stack overview (TypeScript, NestJS, Next.js, Tauri, Mastra, Supabase, TypeDB)
1. Critical Option Д контракты (key reminders)
1. Локальный dev setup commands
1. Where to find documentation (`/docs` directory, 25+ specification documents)
1. Conventions для commit messages, branch naming
1. Ссылки на skills в `.claude/skills/`
Пример минимального CLAUDE.md:

# 9. Setup recommendations для Aperant

## 9.1. MCP-compatibility check

Перед setup проверить:

1. Поддерживает ли Aperant MCP-протокол стандартно?
1. Где конфигурация MCP servers (config file, UI, environment variables)?
1. Поддерживает ли Aperant Skills (или собственный equivalent)?
1. Доступ к environment variables для credentials?

## 9.2. Если Aperant поддерживает MCP стандарт

Использовать ту же configuration что Claude Code (§8.2).

## 9.3. Если Aperant использует свой формат

1. Адаптировать MCP server invocations к format Aperant
1. Skills могут потребовать конвертации в Aperant's knowledge artifact format
1. CLAUDE.md → equivalent project-context file в Aperant (читай documentation)

## 9.4. Multi-environment coordination

Если используется и Claude Code, и Aperant (например, Claude Code для backend, Aperant для frontend):

1. Shared `.claude/skills/` директория — оба environment'а могут читать
1. Shared `CLAUDE.md` в корне
1. Different MCP server sets — каждый environment может иметь свой
1. Single source of truth для documentation (`/docs`)

# 10. Workflow patterns

## 10.1. Создание нового агента

Optimal workflow для AI-команды при создании нового агента (например, добавление 45-го агента):

1. **Запрос разработчика**: «Добавь Noetic Echo Synthesizer агент для KNS surface»
1. **AI-агент**:
- Читает `nabu-agent-patterns` skill (если ещё не в context)
- Создаёт скелет в `packages/agents/kns/noetic-echo-synthesizer/`
- Генерирует `logic.ts`, `agent.ts`, `schema.ts`, `prompt.md`, `eval.jsonl`, `README.md`
- Через context7 проверяет actual Mastra 1.0 syntax (если есть updates)
- Через `nabu-contracts` MCP — verifies isolation (no forbidden imports)
- Через `mastra-mcp` — testing prompts на sample inputs
- Через `nabu-eval-mcp` — initial eval baseline
- Через `github` MCP — создаёт branch + PR
- Updates документы 09 (Agent Catalog) через `nabu-doc-sync-mcp` если требуется

## 10.2. Изменение API endpoint

1. Запрос: «Добавь endpoint для создания Карты Эмоций»
1. AI-агент:
- Читает `nabu-api-patterns` skill
- Создаёт controller, service, DTO, response mapper
- Updates OpenAPI spec через `nabu-doc-sync-mcp`
- Generates client TypeScript types
- `nabu-contracts-mcp` verifies версионирование compliance
- Создаёт integration tests через `nabu-test-patterns`

## 10.3. Database schema change

1. Запрос: «Добавь таблицу для noetic_cards»
1. AI-агент:
- Читает `nabu-rls-patterns` skill (важно для multi-tenant security)
- Создаёт Drizzle migration
- Через `postgres` MCP — verifies migration runs cleanly на dev DB
- Создаёт RLS policy с правильным pattern
- Updates document 07 (Data Model) через `nabu-doc-sync-mcp`
- Создаёт contract tests для нового repository

## 10.4. Debugging production issue

1. Trigger: пользователь жалуется на ошибку
1. AI-агент:
- Через `sentry` MCP — query error details
- Через `github` MCP — поиск relevant issues и PRs
- Через `git` MCP — analysis recent commits в affected files
- Через `postgres` MCP — query состояние production DB (read-only)
- Reproduces locally, fixes, создаёт PR

## 10.5. Documentation update workflow

1. Trigger: ADR changes, или major architectural decision
1. AI-агент:
- Читает `nabu-docx-spec` skill
- Updates relevant document (например, document 06 ADR Pack)
- Через `nabu-doc-sync-mcp` — verifies code references actual decisions
- Updates CLAUDE.md если changes affect dev workflow
- Создаёт PR с ссылками на изменения

# 11. Maintenance и evolution

## 11.1. Регулярные операции

1. **Weekly**: проверка обновлений MCP servers (`npx npm-check-updates`), обновление если no breaking changes
1. **Monthly**: review custom MCP servers — relevance, completeness, used features
1. **Quarterly**: skills audit — какие используются, какие нет, что не хватает
1. **Quarterly**: documentation drift check через `nabu-doc-sync-mcp`

## 11.2. Когда нужны новые MCP-серверы

Признаки что нужен новый MCP server:

- AI-команда повторяет одни и те же manual steps > 5 раз/неделю
- Specific системе нужна интеграция, отсутствующая в available MCPs
- Команда повторно копирует context из external systems в conversations

## 11.3. Когда нужны новые skills

Признаки:

- AI делает однотипные ошибки в specific области (например, забывает RLS)
- New code patterns эстаблируются, но не документированы
- Onboarding новых dev agents требует много manual explanation

## 11.4. Sunsetting

Когда удалять MCP server / skill:

- Не использовался ≥ 3 месяца
- Replaced more modern alternative
- Underlying system retired
- Causes более problems чем solves (rare, но happens)

# 12. Sequence implementation

Когда что setupить. Priority-ordered timeline.

## 12.1. Week 0-1 (before development starts)

1. Setup всех Tier 1 MCP-серверов (filesystem, github, git, context7, postgres, fetch, web_search)
1. Создать CLAUDE.md в корне проекта
1. Setup skills directory `.claude/skills/`
1. Установить `skill-creator` skill — для создания custom skills

## 12.2. Week 1-2 (during initial setup)

1. Создать nabu-agent-patterns skill
1. Создать nabu-api-patterns skill
1. Создать nabu-test-patterns skill
1. Создать nabu-privacy-routing skill (critical)
1. Construct typedb-mcp (3-5 days work)

## 12.3. Week 2-4 (during agent layer development)

1. Construct mastra-mcp (3-5 days)
1. Construct nabu-eval-mcp (3-4 days)
1. Создать nabu-eval-patterns skill
1. Создать nabu-typedb-patterns skill

## 12.4. Month 2-3 (during full stack development)

1. Construct nabu-contracts-mcp (4-7 days)
1. Construct nabu-doc-sync-mcp (5-7 days)
1. Подключить supabase MCP
1. Подключить linear или enhanced github issues setup
1. Создать nabu-rls-patterns skill

## 12.5. Phase 1 (beta release)

1. Подключить playwright MCP
1. Подключить sentry MCP
1. Подключить vercel/cloudflare MCP

## 12.6. Phase 3 (public beta + monetization)

1. Подключить stripe MCP
1. Подключить discord MCP (community management)
1. Подключить prometheus/grafana MCP (production monitoring)

## 12.7. Total investment в инструментарий

| **Item** | **Time** | **Source** |
| --- | --- | --- |
| Tier 1 MCPs setup | 0.5 day | Existing packages |
| CLAUDE.md + skills directory | 1 day | Manual creation |
| nabu-agent-patterns skill | 1-2 days | Custom creation |
| nabu-api-patterns skill | 1-2 days | Custom |
| nabu-test-patterns skill | 1-2 days | Custom |
| nabu-privacy-routing skill | 1-2 days | Custom |
| nabu-eval-patterns skill | 1-2 days | Custom |
| nabu-typedb-patterns skill | 1-2 days | Custom |
| nabu-rls-patterns skill | 1-2 days | Custom |
| nabu-docx-spec skill | 0.5 day | Custom |
| typedb-mcp construction | 3-5 days | Custom MCP server |
| mastra-mcp construction | 3-5 days | Custom MCP server |
| nabu-eval-mcp construction | 3-4 days | Custom MCP server |
| nabu-contracts-mcp construction | 4-7 days | Custom MCP server (most complex) |
| nabu-doc-sync-mcp construction | 5-7 days | Custom MCP server |
| **Total investment в tooling** | **~30-50 days** | Большая часть — Months 1-3 |

Это значительный investment, но он окупается **многократно** через:

- Меньше ошибок при разработке (skills предотвращают)
- Автоматическая проверка Option Д контрактов (документ 14, 15)
- Faster onboarding новых AI-agents и human developers
- Documentation остаётся синхронизированной с кодом
- Снижение technical debt длительный horizon

# 13. Best practices использования

## 13.1. AI agent prompt patterns

Когда инструктируете AI-agent (Claude Code, Aperant) на задачу, рассмотрите эти patterns:

### 13.1.1. Reference skills explicitly если не очевидно

Bad: «Добавь endpoint для emotions»

Better: «Добавь endpoint для emotions. Используй nabu-api-patterns skill для structure. Обнови OpenAPI spec.»

### 13.1.2. Reference documents

Bad: «Сделай privacy для нового feature»

Better: «Сделай privacy для нового feature. См. документ 11 (Security Architecture) §4 для visibility rules. Использовать nabu-privacy-routing skill.»

### 13.1.3. Require contract checks

Bad: «Создай нового агента»

Better: «Создай нового агента. После создания запусти nabu-contracts MCP для verify compliance с Option Д.»

### 13.1.4. Defer to context7 для библиотек

Bad: «Используй последний Mastra API»

Better: «Через context7 проверь актуальный Mastra agent API, потом implement.»

## 13.2. Avoiding common pitfalls

1. **Не overload MCP servers**: подключение 30+ MCPs замедляет startup AI-agent и увеличивает confusion. Tier 1 + relevant Tier 2 — оптимум.
1. **Не использовать дорогие MCPs без нужды**: brave-search costs money per query. Использовать selectively.
1. **Не commit secrets**: GitHub PAT, Stripe keys, etc. — в environment variables, не в .json config commited в repo.
1. **Не игнорировать contract checks**: если nabu-contracts MCP flag'и failure — fix immediately. Не накапливать debt.

## 13.3. Security considerations

1. **MCP server credentials** — отдельные tokens с minimal scope для AI agent (не shared с personal tokens)
1. **Database access** — AI agent должен иметь read-only access к production, write access только к dev DB
1. **Audit logging** — все MCP calls логируются на dev machine для debugging и review
1. **Sandbox bash** — bash commands от AI agent должны иметь restricted scope (cannot rm -rf /)

# 14. Резюме и actionable next steps

## 14.1. Минимальный setup для начала работы

Минимум, который должен быть готов в первый день разработки:

1. Claude Code установлен и настроен с Tier 1 MCPs (filesystem, github, git, context7, postgres, fetch, web_search)
1. CLAUDE.md в корне проекта с stack overview и Option Д контрактами
1. Skills directory `.claude/skills/` создана
1. Минимум 2 skills: nabu-agent-patterns + nabu-privacy-routing

## 14.2. Что отложить

Не нужно с первого дня:

1. All Tier 3 MCPs — добавляются по мере needed
1. Custom MCP servers — построение займёт недели. Начать без них, добавлять по очереди
1. Stripe, Sentry, Vercel MCPs — Phase 1+

## 14.3. Главные риски

1. **Tool overload**: подключение слишком многих MCPs замедляет AI и create confusion. Дисциплина в minimal viable set
1. **Skills drift**: skills становятся outdated если их не maintain. Quarterly audit обязателен
1. **Over-engineering custom MCPs**: построение perfect custom MCP может занять месяцы. Build minimum viable, iterate
1. **Security gaps**: AI agent с broad permissions может cause damage. Тщательно ограничивать scopes

## 14.4. Конкретные actions для следующих 2 недель

1. **Day 1**: Setup Tier 1 MCPs (filesystem, github, git, context7, postgres-dev). 0.5 day work.
1. **Day 1**: Создать CLAUDE.md с stack и contracts. 1 hour.
1. **Day 2-3**: Написать nabu-agent-patterns skill. Это самый часто используемый.
1. **Day 4-5**: Написать nabu-privacy-routing skill. Critical для security.
1. **Day 6-7**: Написать nabu-api-patterns + nabu-test-patterns skills.
1. **Week 2**: Start construction typedb-mcp (parallel с initial development).
1. **Week 2**: Написать nabu-docx-spec skill (для updates документации).
Документ работает в связке с:

- **Документ 13 (Engineering Standards)** — соглашения, которые skills enforce
- **Документ 15 (Option Д Contracts)** — что nabu-contracts-mcp проверяет
- **Документ 09 (Agent Catalog)** — как создавать new agents через nabu-agent-patterns skill
- **Документ 10 (Test Strategy)** — как nabu-test-patterns structures tests
- **Документ 11 (Security Architecture)** — что nabu-privacy-routing skill enforces
