# NABU

*SAD · описание архитектуры*  
*Software Architecture Description*  
*по ISO/IEC/IEEE 42010:2022*  
*Версия 1.0*  

---

# 1. Введение

## 1.1. Назначение документа

Документ описывает архитектуру Nabu — мультиагентной среды личной работы со знаниями. Структура следует ISO/IEC/IEEE 42010:2022 (architecture description). SAD отвечает на вопрос «как устроена система», тогда как SRS отвечал на «какие требования к ней предъявляются», а backlog — на «как мы будем её разрабатывать».

Документ предназначен для команды разработки (включая автономных AI-coding агентов через Aperant), для команды эксплуатации, для архитекторов смежных продуктов и для аудита.

## 1.2. Соглашения

- Архитектура описывается через стейкхолдеров, их интересы (concerns), viewpoint'ы и views.
- Каждая существенная архитектурная диаграмма (логическая, процессная, развёртывания и т. д.) — отдельная view.
- Конкретные технологические решения зафиксированы в ADR (см. документ «Nabu · ADR Pack»). Здесь они только используются.
- Терминология совпадает с SRS и концепцией v2.

# 2. Стейкхолдеры и архитектурные интересы

| **Стейкхолдер** | **Ключевые архитектурные интересы (concerns)** |
| --- | --- |
| Личный пользователь | Скорость отклика, надёжность сохранения, контроль над собственными данными, прозрачность ИИ-обработки, оффлайн-работа, выживание корпуса при смене сервиса. |
| Терапевт-самостоятельный (subset) | Гарантия, что чувствительные записи не уходят на внешние API. Защита от компрометации серверного инстанса. Понятная семантика категорий видимости. |
| Исследователь (subset) | Связность графа знаний, надёжная трассировка от тезиса к источнику, экспортируемость в форматы научных публикаций. |
| Администратор self-host инстанса | Простота развёртывания, предсказуемые ресурсы, бэкап/восстановление, обновления без потери данных, наблюдаемость. |
| AI-команда разработки (Aperant) | Чёткая модульность, явные контракты между сервисами, отсутствие неявного состояния, тестируемость, версионирование промптов. |
| Команда эксплуатации | Метрики качества и стоимости агентов, алертинг, runbook'и, RPO/RTO. |
| Аудитор (security/privacy) | Соответствие GDPR, ISO 27001-подобным практикам, OWASP ASVS Level 2, наличие audit log и DPIA. |

# 3. Viewpoint'ы

Архитектура Nabu описывается через шесть viewpoint'ов, каждый раскрывается отдельной view:

| **Viewpoint** | **Что показывает** |
| --- | --- |
| Logical | Декомпозиция функциональности на модули и сервисы; интерфейсы между ними |
| Process | Поведение во время выполнения: процессы, очереди, потоки, обработка одной заметки от ввода до индексации |
| Information | Структура данных: где живёт что; границы хранилищ; жизненный цикл записи |
| Deployment | Физическое размещение компонентов: контейнеры, машины, сети, балансировщики |
| Security | Архитектура аутентификации, авторизации, шифрования, маршрутизации по приватности |
| Development | Структура кода в репозитории, зависимости, конвенции, CI/CD |

# 4. Logical view

Logical view показывает функциональную декомпозицию Nabu в момент времени. Это не runtime-картина и не deployment-картина — это структура ответственности.

## 4.1. Верхнеуровневые подсистемы

| **Подсистема** | **Ответственность** |
| --- | --- |
| Identity & Access | Аутентификация, сессии, JWT, RLS, авторизация запросов, управление аккаунтом |
| Note Storage Service | CRUD заметок, версии, frontmatter, теги, бэклинки, импорт/экспорт |
| Multi-Agent Pipeline | Все 44 ИИ-агента и их оркестрация; ingestion, understanding, linking, memory, synthesis, therapy, life management, research, gamification, integration |
| Knowledge Graph | TypeDB-схема и работа с онтологией; правила вывода; полиморфизм типов |
| Vector Index | Эмбеддинги в pgvector; семантический поиск; гибридный ранкинг (vector + BM25) |
| Job Queue | pgmq как асинхронный конвейер задач; ретраи; идемпотентность; visibility timeout |
| Realtime Channel | Supabase Realtime: уведомления, presence устройств, опциональная коллаборативная синхронизация |
| Storage Service | S3 (MinIO): canonical .md, медиа, версии, бэкап |
| Sync Engine | Outbox/inbox, разрешение конфликтов (LWW → 3-way → CRDT), file watcher для desktop, сжатие батчей |
| Local LLM Connector | Обнаружение Ollama, маршрутизация запросов категорий private/vault, fallback |
| External Integrations Hub | MCP-серверы и веб-хуки для интеграций с внешними сервисами |
| Audit & Observability | audit_log, метрики LLM, трейсы, dashboards |
| Web Client | Next.js UI; обычная работа в браузере |
| Desktop Client | Tauri 2.x обёртка вокруг той же SPA + нативные плагины (file watcher, system tray, hotkeys, Stronghold) |
| Mobile Client | Tauri 2.x mobile с урезанным набором функций + нативные плагины (share-extension, push, биометрия, native STT) |

## 4.2. Многоагентный конвейер: внутренняя декомпозиция

Multi-Agent Pipeline разделён на 12 слоёв (см. v1 концепции, общий реестр из 44 агентов сохранён). На уровне SAD важно показать интерфейсы между слоями:

| **Слой** | **Ответственность; интерфейс к соседям** |
| --- | --- |
| 1. Orchestration | Conductor, UI Composer, Critic. Принимает входящие события из Queue и пользовательские запросы; вызывает остальные слои; собирает результат для UI |
| 2. Ingestion | Scribe, Triage, Transcriber, Web Harvester. Нормализует ввод; форматирует в стандартизированную «raw record» |
| 3. Understanding | Entity Extractor, Domain Classifier, Affect Analyzer, Intent Detector. Превращает raw record в «structured record» с типизированными метаданными |
| 4. Linking | Linker, Ontology Maintainer, Taxonomy Curator, Deduplicator. Связывает structured record с существующим корпусом и онтологией |
| 5. Memory | Librarian, Context Retriever. Управляет жизненным циклом заметки (fleeting → literature → evergreen) и контекстом для других агентов |
| 6. Synthesis | Insight, Hypothesis, Socratic, Digest, Document Synthesizer, Correlation Finder. Формирует производные артефакты |
| 7. Therapy | CBT, Gestalt, DBT/ACT, IFS, Coach. Работа со специализированными протоколами |
| 8. Habits | Habit Architect, Streak Keeper. Поведенческие изменения |
| 9. Projects | Project Manager, Quest Master, PARA Agent. Управление проектами и квестами |
| 10. Metrics | Metrics Tracker, Forecaster, Anomaly Detector. Временные ряды и прогнозы |
| 11. Research | Research Assistant, Claim Tracker, Argument Mapper. Исследовательский режим |
| 12. Gamification & Integration | RPG Game Master, Achievement Designer, Loot & Reward, Import Agent, MCP Bridge. RPG-слой и внешние интеграции |

## 4.3. Контракт между слоями

Слои общаются через события (event-driven), не через прямые вызовы. Это даёт горизонтальную масштабируемость и читаемость трассировок.

- Тип события: note.created, note.updated, note.normalized, note.classified, note.linked, note.promoted, insight.generated, metric.recorded, quest.completed и т. д.
- Каждое событие — JSON с trace_id, user_id, version_id, payload.
- Подписчиками являются NestJS-сервисы внутри соответствующего слоя; внутри сервиса вызываются Mastra-агенты как обычные методы.
- Идемпотентность: каждое событие имеет event_id; обработчик проверяет audit_log на повторы перед выполнением.

# 5. Process view

Process view описывает runtime-поведение: какие процессы существуют, как они взаимодействуют, как масштабируются.

## 5.1. Процессы серверной части

| **Процесс** | **Описание** |
| --- | --- |
| nabu-api (NestJS) | Stateless HTTP/WS-сервер. Принимает запросы от клиентов, валидирует JWT, делегирует в сервисы. Масштабируется горизонтально (N инстансов за балансировщиком) |
| nabu-worker (NestJS) | Stateless воркер pgmq. Подписан на очереди; забирает сообщения, выполняет агентский конвейер через Mastra. Масштабируется горизонтально |
| postgres (Supabase) | Stateful. Основная БД, RLS, pgvector, pgmq, pg_cron |
| typedb (Community) | Stateful. Граф знаний |
| minio | Stateful. S3-совместимое хранилище .md и медиа |
| gotrue, postgrest, realtime, kong, storage, edge_runtime | Supabase-сервисы. Stateless кроме gotrue (хранит сессии в postgres) |
| nabu-cron | pg_cron внутри Postgres + опционально отдельный nabu-scheduler (NestJS) для специальных задач (ежедневный дайджест, переиндексация) |
| ollama (опционально, в self-host) | Stateful (модели на диске). Используется как локальный LLM |

## 5.2. Сквозной поток обработки заметки

Семь этапов от пользовательского ввода до видимости результата на других устройствах.

1. Клиент отправляет PUT /api/notes/{id} с .md контентом.
1. nabu-api записывает .md в S3, пишет строку в notes/note_versions в Postgres (в одной транзакции через идемпотентный паттерн с outbox), публикует сообщение в pgmq.note_ingest. Ответ клиенту ≤ 200 мс.
1. nabu-worker забирает сообщение pgmq.read. Conductor составляет план: какие агенты вызвать в какой последовательности.
1. Параллельно (внутри одного worker-процесса через Promise.all) выполняются Scribe → Triage → [Entity Extractor, Domain Classifier, Affect Analyzer, Intent Detector] (4 параллельно). Каждый агент — отдельный Mastra-call через @mastra/nestjs.
1. Результаты от слоя Understanding передаются в Linker. Linker делает pgvector top-k и TypeDB graph query для нахождения связанных заметок.
1. Critic проверяет совокупный выход. При нарушении политик или противоречиях ставит alert в audit_log и не отдаёт результат клиенту до ручного просмотра. В обычном случае — пропускает.
1. Результаты записываются в Postgres (метаданные, embeddings), TypeDB (граф). Через Supabase Realtime отправляется событие note.processed на канал пользователя — все его устройства подписаны и обновляют локальное состояние.

## 5.3. Идемпотентность и устойчивость

- Каждое сообщение в pgmq имеет event_id. Перед обработкой воркер проверяет, нет ли в audit_log записи с тем же event_id и status=completed.
- При падении воркера в середине обработки visibility timeout (60 секунд) автоматически возвращает сообщение в очередь. Следующий воркер берёт; счётчик попыток инкрементируется.
- После 3 неудачных попыток сообщение архивируется в pgmq.a_{queue} с пометкой error и trigger создаёт алерт.
- Side-effects (внешние API, S3-записи) совершаются ТОЛЬКО после явной фиксации в Postgres. Outbox-паттерн: «запись в БД сначала, событие — потом».

## 5.4. Параллелизм и масштабирование

- nabu-api: stateless, масштабируется горизонтально; сессии хранятся в Postgres.
- nabu-worker: stateless, масштабируется горизонтально. pgmq exactly-once в пределах visibility window гарантирует, что один и тот же event не обрабатывается двумя воркерами одновременно.
- postgres: вертикальное масштабирование на первом этапе; read replicas — отдельный ADR, при росте.
- typedb: вертикальное масштабирование; cluster-режим TypeDB — отдельное решение, на старте не нужно.
- Внутри одного worker-вызова — параллельный fan-out агентов, ограниченный конфигом max_concurrent_agents (по умолчанию 4 для одной заметки).

# 6. Information view

Information view — границы хранилищ и потоки данных. Детальные схемы — в документе «Nabu · Data Model & Ontology Reference».

## 6.1. Канонические хранилища

| **Сущность данных** | **Канонический источник** | **Производные представления** |
| --- | --- | --- |
| Содержимое заметки | S3 (.md + frontmatter) | Postgres (метаданные для индексации), pgvector (embeddings), TypeDB (сущности и связи), локальный SQLite на desktop |
| Версии заметок | S3 (Object Versioning) + Postgres note_versions | — |
| Граф знаний | TypeDB | Postgres (snapshot для UI graph view) |
| Эмбеддинги | pgvector в Postgres | Локальный SQLite (подмножество для оффлайн-поиска) |
| Пользовательские данные (профиль, настройки) | Postgres | Локальный Store (кэш на клиенте) |
| Привычки, задачи, проекты, квесты, метрики | Postgres | — |
| Аудит-лог | Postgres (партиционированная таблица) | — |
| Ключи vault-шифрования | Только локально на устройстве пользователя (Tauri Stronghold) | (ключ никогда не покидает устройство) |
| Бэкапы | Внешний S3 (или резервный диск) — pg_dump, S3-snapshot, TypeDB export | — |

## 6.2. Жизненный цикл заметки

1. Created: новая запись в notes, новая версия в note_versions и S3, событие note.created в pgmq.
1. Normalized: после Scribe — обновление content_normalized в notes.
1. Classified: после слоя Understanding — обновление структурных полей (type, domain, affect, intent, entities).
1. Linked: после Linker — записи в links таблице, обновления в TypeDB.
1. Promoted: Librarian меняет status: fleeting → literature → evergreen.
1. Archived: пользователь явно архивирует или Taxonomy Curator перемещает в archive.
1. Soft-deleted: запись помечена deleted_at; не показывается в библиотеке, но восстановима 30 дней.
1. Purged: после 30 дней soft-delete или явного «удалить безвозвратно» — физическое удаление из всех хранилищ + бэкапов в течение 90 дней.

## 6.3. Управление PII (Personally Identifiable Information)

- Сами заметки рассматриваются как PII по умолчанию. Поэтому к ним применяется самая строгая модель прав.
- Сущности из графа (например, имя «Иван») — это упоминания. Они могут быть PII, если позволяют идентифицировать конкретного человека. Считаются PII по умолчанию.
- Audit log не содержит контента заметок — только метаданные. Это требование NFR-9007.
- Логи nabu-api/nabu-worker структурированы (JSON) и НЕ содержат payload содержимого заметок. Только trace_id, user_id (или anonymized hash при определённом уровне логирования), agent_name, latency.

# 7. Deployment view

Архитектура развёртывания. Два сценария: self-host (single VPS) и managed cloud (опционально, при ускоренном росте).

## 7.1. Сценарий self-host: один VPS

Минимальная рабочая конфигурация для индивидуального пользователя на собственном сервере.

| **Слой** | **Контейнеры на одной машине** |
| --- | --- |
| Reverse proxy | Caddy (с Let's Encrypt) или Nginx |
| API gateway | Kong (входит в Supabase docker-compose) |
| Application | nabu-api, nabu-worker, nabu-scheduler |
| Supabase сервисы | postgres, gotrue, postgrest, realtime, storage, edge_runtime, kong, studio |
| Графовая БД | typedb (отдельный контейнер) |
| Объектное хранилище | minio |
| Опционально | ollama (если на сервере есть GPU); prometheus + grafana для наблюдаемости |

Минимальные ресурсы: 4 vCore, 8 ГБ ОЗУ, 100 ГБ SSD. С Ollama и моделями 7B+: 8 vCore, 16 ГБ ОЗУ, 200 ГБ SSD, GPU 8 ГБ VRAM. Все сервисы — в общей docker-сети bridge; наружу экспонируется только Caddy.

## 7.2. Сценарий self-host: split (database / application / objects)

Для более серьёзных нагрузок и резильентности — разделение на три машины.

- Machine A (Application): nabu-api, nabu-worker, gotrue, postgrest, realtime, edge_runtime, kong. Может быть несколько таких машин за балансировщиком.
- Machine B (Database): postgres (с pgvector, pgmq, pg_cron), typedb. Отдельная машина с быстрым диском и достаточной памятью.
- Machine C (Objects): minio с большим диском. Опционально внешний S3 (AWS S3, Backblaze, Yandex Object Storage).
- Опционально Machine D (LLM): отдельная GPU-машина с ollama, если локальный LLM нужен серверной части (для serverless private обработки).

## 7.3. Сценарий managed cloud

Multi-tenant вариант. На старте Nabu не оптимизирован под него (single-tenant — основной сценарий). В случае необходимости — отдельный ADR с архитектурой namespace-разделения.

## 7.4. CI/CD-пайплайн

1. Push/PR → GitHub Actions: lint, type-check, unit, integration, eval-suite агентов (выборочно для затронутых).
1. Merge в main → Docker images собираются и пушатся в GHCR с тегами {commit-sha} и main-latest.
1. Staging: deploy main-latest на staging автоматически. Smoke-тесты.
1. Production: tag v*.*.* + manual approval → deploy конкретного образа на production.
1. Tauri-сборки: отдельный workflow на push в release/desktop и release/mobile. Артефакты с подписями (signtool для Win, notarization для macOS).
1. Откат: kubectl rollout undo или docker compose pull предыдущего тега + restart.

# 8. Security view

Сводная архитектура безопасности. Детальное моделирование угроз — в документе «Nabu · Threat Model & Security Architecture».

## 8.1. Слои защиты

| **Слой** | **Механизмы** |
| --- | --- |
| Транспорт | TLS 1.3 для всего внешнего трафика; mTLS для внутренних коммуникаций при split-deployment |
| Аутентификация | GoTrue: email+пароль (Argon2id), magic-link, OAuth (Google/Apple); опционально TOTP MFA |
| Сессии | JWT (Ed25519 или RS256), refresh-token; ротация ключей каждые 90 дней; revocation через таблицу revoked_tokens |
| Авторизация (горизонтальная) | RLS-политики Postgres на основе auth.uid() |
| Авторизация (вертикальная) | NestJS AuthGuard, проверяет роль и scope в JWT |
| Защита от типовых атак | OWASP ASVS 4.0 Level 2: SQLi (параметризованные запросы), XSS (CSP + sanitization), CSRF (SameSite cookies + tokens), брутфорс (rate limit) |
| Шифрование в покое | Postgres: pgcrypto для отдельных полей; диск — LUKS/BitLocker/FileVault; S3 (MinIO): SSE-S3 |
| Vault (E2E) | Содержимое заметок visibility=vault шифруется на клиенте AES-256-GCM с ключом, дериверованным из пароля через Argon2id; envelope encryption (master + data keys); сервер хранит только шифротекст |
| LLM-маршрутизация | Visibility-based router: default → внешние API (Anthropic); private → только локальный Ollama; vault → только локальный Ollama + только из desktop |
| Audit | Все мутации, все обращения к LLM, все попытки доступа к private/vault логируются в audit_log с RLS |
| Зависимости | npm audit / trivy на каждом CI-прогоне; weekly automated dependency updates через Dependabot/Renovate |

## 8.2. Auth flow (упрощённо)

1. Клиент → /auth/v1/token (gotrue) с email+пароль → JWT + refresh-token.
1. Клиент → /api/notes/{id} с Authorization: Bearer {JWT}.
1. Kong (gateway) валидирует подпись JWT, прокидывает в nabu-api.
1. nabu-api AuthGuard извлекает user_id из JWT, помещает в RuntimeContext.
1. Запрос к Postgres делается под ролью authenticated с set_config('request.jwt.claims', ...) — RLS-политики срабатывают автоматически.
1. Mastra-агенты получают user_id через RuntimeContext и используют его при работе с инструментами.

## 8.3. Vault E2E flow

1. При первой настройке vault: клиент запрашивает у пользователя пароль (отдельный от auth-пароля). Argon2id(password, salt=user.vault_salt) → master_key.
1. Для каждой vault-заметки генерируется data_key (32 случайных байта). Шифрование контента: AES-256-GCM(data_key, content). Шифрование data_key: AES-256-KW(master_key, data_key). На сервер уходит content_ciphertext + wrapped_data_key.
1. При смене пароля: вычисляется новый master_key. На клиенте по очереди расшифровываются wrapped_data_keys старым master_key, перешифровываются новым. data_key'и для контента НЕ меняются — это позволяет ротировать без перешифровки самого контента.
1. При утере пароля: vault безвозвратно недоступен. UX явно об этом предупреждает на каждом шаге.

## 8.4. Доверительные границы

- Доверенная зона (full trust): код клиента в момент исполнения у пользователя (есть пароль).
- Полудоверенная: сервер Nabu (имеет access к default-данным, не имеет к vault).
- Недоверенная: внешние LLM-API; никогда не получают private/vault.
- Недоверенная: интернет; всегда TLS.

# 9. Development view

Как организован код: структура репозиториев, дисциплина зависимостей, конвенции.

## 9.1. Структура монорепозитория

```
nabu/
├── apps/
│   ├── api/              # NestJS server (включая @mastra/nestjs)
│   ├── worker/           # pgmq consumer (тот же NestJS-код, другой entry)
│   ├── scheduler/        # pg_cron + scheduled tasks (NestJS, cron-режим)
│   ├── web/              # Next.js (App Router) фронтенд
│   ├── desktop/          # Tauri 2.x обёртка для Win/macOS/Linux
│   └── mobile/           # Tauri 2.x mobile для iOS/Android
├── packages/
│   ├── shared-types/     # TypeScript-типы (DTO, события, frontmatter-схема)
│   ├── shared-utils/     # Утилиты для frontend и backend
│   ├── ui/               # Общая UI-библиотека (web, desktop, mobile используют)
│   ├── prompts/          # Файлы промптов (.md), версионированные
│   ├── agents/           # Реализация Mastra-агентов
│   ├── tools/            # Mastra-инструменты (RAG, TypeDB-driver, S3-IO)
│   ├── schemas/          # DB schemas (Postgres SQL, TypeDB TQL)
│   ├── sync-engine/      # Outbox/inbox, конфликт-разрешение
│   └── crypto/           # Argon2id, AES-GCM helpers, envelope encryption
├── infra/
│   ├── docker/           # docker-compose.yml + Caddyfile + конфиги
│   ├── migrations/       # Postgres SQL и TypeDB TQL миграции
│   └── runbooks/         # Operational Runbook
├── tests/
│   ├── evals/            # Eval-suite для агентов (golden datasets)
│   ├── e2e/              # Playwright e2e
│   └── load/             # k6 нагрузочные сценарии
├── docs/                 # SAD, SRS, ADRs, Backlog, DPIA и др.
└── .github/workflows/    # CI/CD
```

## 9.2. Дисциплина зависимостей

- apps/* НЕ зависят друг от друга напрямую. Связь только через HTTP/WS API или через общий пакет (например, shared-types).
- packages/* могут зависеть друг от друга, но циклические зависимости запрещены (проверяется CI: madge или similar).
- agents/ зависит от tools/, prompts/, schemas/.
- sync-engine/ зависит только от crypto/ и shared-types/.
- ui/ зависит только от shared-types/.

## 9.3. Конвенции по коду

- TypeScript strict mode везде. Никаких any в публичных API.
- Runtime-валидация всех внешних входов через Zod (DTO для API, frontmatter, события pgmq).
- ESLint + Prettier с зафиксированным конфигом.
- Имена файлов: kebab-case. Имена типов: PascalCase. Имена функций/переменных: camelCase. Константы: SCREAMING_SNAKE_CASE.
- Тесты рядом с кодом (*.spec.ts) или в зеркальной структуре в tests/.
- Промпты — отдельные .md файлы с frontmatter (model, version, vars, eval_ref).
- Каждый агент — отдельный класс/файл с одним публичным методом execute(input): Promise<Output>. Без скрытого состояния.

## 9.4. Версионирование

- Релизы — semver. Major — несовместимое изменение API; minor — новая функциональность; patch — исправления.
- Промпты — собственная нумерация vN (file prompts/<agent>/vN.md). Активная версия указывается в config.toml.
- TypeDB-схема — линейные миграции, файлы 001_*.tql, 002_*.tql, …
- Postgres-схема — то же самое, .sql.

# 10. Сквозные архитектурные принципы

1. Local-first. Данные могут жить вне сервера, сервер — координатор и обогатитель, не единственный держатель истины.
1. Event-driven. Слои общаются событиями, не прямыми вызовами. Это даёт горизонтальную масштабируемость и трассируемость.
1. Idempotency. Каждое мутирующее действие может быть безопасно повторено.
1. Explainability. Каждый агентский вывод объясняем — пользователь видит вход, промпт, цепочку рассуждений (там, где она есть), модель, источники.
1. Observability over assumption. Если что-то происходит — оно должно быть видно в метриках и логах. Без скрытых процессов.
1. Privacy by routing. Доступ к данным регулируется не только правами, но и маршрутизацией: private никогда не уходит на внешние API физически.
1. No vendor lock. Любой компонент должен быть заменяем; нельзя строить на функциях, доступных только в одном cloud.
1. Markdown source of truth. Содержимое — .md, всё остальное — производные представления, которые можно перестроить.
1. Reversible operations. Любое опасное действие можно откатить (или явно проинформировать пользователя, что нельзя — как в случае с забытым vault-паролем).
1. AI-discipline as code. Промпты, eval-suite, model-routing — всё это код в репозитории, на ревью, под CI.
