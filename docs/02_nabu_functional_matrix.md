# NABU

*Функциональная матрица*  
*Бенчмарк существующих инструментов*  
*и целевой функциональный состав Nabu по этапам*  
*Версия 1.0 · обоснование объёма работ*  

---

# 1. Назначение документа

Документ решает две задачи:

1. Зафиксировать функциональный объём ключевых аналогов (Notion, Obsidian, Logseq, Roam Research, Tana, Heptabase) — чтобы решения по Nabu опирались на конкретные характеристики, а не на общее впечатление.
1. Определить целевой функциональный состав Nabu с разбивкой на восемь этапов разработки. Каждый этап — самостоятельный релиз, после которого продукт уже полезен, и одновременно — единица планирования для AI-команды разработки через Aperant.
Документ опирается на два принципа: (а) сравнение по конкретным признакам, а не по общему «удобству»; (б) явная привязка каждого признака в Nabu к этапу, на котором он появляется. Этапы пронумерованы Ph0…Ph7.

# 2. Бенчмарк существующих инструментов

Сравнение по 7 группам признаков: хранение и формат, связывание и онтология, ИИ-функциональность, специализированные режимы, многоплатформенность, расширяемость, приватность. Условные обозначения в ячейках: ★ — отличительная сила инструмента; ✓+ — есть и развито; ✓ — есть базово; ~ — частично или через плагин; ✗ — нет; — — неприменимо.

## 2.1. Объекты сравнения

- Notion — облачная workspace-платформа на блочной модели и database-views.
- Obsidian — локальное приложение поверх Markdown-файлов, граф знаний, плагинная экосистема.
- Logseq — outliner на локальных Markdown/Org-mode файлах, блочно-ориентированный, journal-first.
- Roam Research — облачный outliner с блочными ссылками и backlinks, продвинутые queries.
- Tana — облачный «supertag»-ориентированный outliner с AI-функциями и database-views.
- Heptabase — облачное приложение для визуального исследовательского мышления (whiteboards + карточки).

## 2.2. Хранение и формат

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown как нативный формат | ✗ | ★ | ✓+ | ✗ | ✗ | ✗ |
| Локальные файлы (local-first) | ✗ | ★ | ✓+ | ✗ | ✗ | ✗ |
| Облачная синхронизация | ★ | ~ (Sync) | ~ (Sync) | ★ | ✓+ | ✓+ |
| Версионирование контента | ✓ | ~ (плагин) | ~ | ✓ | ✓ | ✓ |
| Self-host | ✗ | ✓+ | ✓+ | ✗ | ✗ | ✗ |
| Импорт MD-корпусов | ✓ | ★ | ✓+ | ✓ | ✓ | ✓ |

## 2.3. Связывание и онтология

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| Wikilinks | ✗ | ★ | ✓+ | ★ | ✓+ | ✓ |
| Block-level ссылки | ~ | ~ (плагин) | ✓+ | ★ | ★ | ✗ |
| Backlinks | ~ | ✓+ | ✓+ | ✓+ | ✓+ | ✓ |
| Транклюзия / embed | ✓ | ~ | ✓+ | ✓+ | ✓+ | ✓ |
| Visual graph view | ✗ | ★ | ✓ | ✓ | ✗ | ★ (canvas) |
| Адаптивные теги / database | ★ | ~ | ✓ | ✓ | ★ (supertags) | ✓ |
| Полиморфная онтология / правила вывода | ✗ | ✗ | ~ | ~ | ~ | ✗ |

## 2.4. ИИ-функциональность

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| AI-ассистент (chat) | ✓+ | ~ (плагин) | ~ (плагин) | ✓ | ✓+ | ✓ |
| Автоматическая классификация | ~ | ~ (плагин) | ✗ | ✗ | ✓ | ✗ |
| Извлечение сущностей | ~ | ~ (плагин) | ✗ | ✗ | ✓ | ✗ |
| Семантический поиск (vector) | ✓ | ~ (плагин) | ~ (плагин) | ✗ | ✓ | ✓ |
| Multi-agent конвейер | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Кастомные AI-агенты пользователя | ~ (DB AI fields) | ~ (плагин) | ✗ | ✗ | ~ | ✗ |
| Дополнение и переписывание текста | ✓+ | ~ (плагин) | ~ | ✓ | ✓+ | ✓ |
| AI-генерация вторичных документов | ✓ (page summary) | ~ | ✗ | ~ | ✓ | ~ |

## 2.5. Специализированные режимы

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| Daily notes | ✓ (шаблон) | ✓+ (плагин) | ★ | ★ | ✓+ | ✓ |
| Habit tracker | ~ (DB) | ~ (плагин) | ~ | ~ | ✓ | ✗ |
| Task management | ✓+ | ~ (плагин) | ✓+ | ✓ | ✓+ | ~ |
| Журналы (мудности, gratitude и пр.) | ~ (шаблон) | ~ (шаблон) | ~ (шаблон) | ~ (шаблон) | ~ (шаблон) | ~ |
| КПТ / гештальт-протоколы | ✗ | ~ (плагин) | ✗ | ✗ | ✗ | ✗ |
| Habit gamification (RPG) | ✗ | ~ (Habitica integ.) | ✗ | ✗ | ✗ | ✗ |
| Research mode / sources | ✓ | ~ (плагин) | ✓ | ~ | ✓ | ★ |
| Whiteboards / canvas | ~ | ✓+ (Canvas) | ~ | ✗ | ✗ | ★ |
| Audio-заметки и транскрипция | ✗ | ~ (плагин) | ~ | ✗ | ✗ | ✗ |
| Финансовые / метрические трекеры | ~ (DB) | ~ (плагин) | ~ | ~ | ✓ | ✗ |

## 2.6. Многоплатформенность и расширяемость

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| Web-клиент | ★ | ✗ | ✓ (Web app) | ✓ | ✓ | ✓ |
| Desktop (Win/macOS/Linux) | ✓+ | ★ | ★ | ✓ | ✓ | ✓ |
| Mobile (iOS/Android) | ✓+ | ✓+ | ✓ | ✓ | ✓ | ✓ |
| Полноценный оффлайн | ~ | ★ | ✓+ | ~ | ~ | ~ |
| Плагины | ~ (API) | ★ | ✓+ | ~ | ✗ | ✗ |
| API / интеграции | ✓+ | ~ | ✓ | ✓ | ~ | ~ |
| MCP / agentic протоколы | ~ | ~ | ✗ | ✗ | ~ | ✗ |

## 2.7. Приватность и контроль данных

| **Признак** | **Notion** | **Obsidian** | **Logseq** | **Roam** | **Tana** | **Heptabase** |
| --- | --- | --- | --- | --- | --- | --- |
| End-to-end шифрование | ✗ | ~ (платный Sync) | ~ | ✗ | ✗ | ✗ |
| Self-host опция | ✗ | ✓+ | ★ | ✗ | ✗ | ✗ |
| Локальный LLM | ✗ | ~ (плагин) | ~ (плагин) | ✗ | ✗ | ✗ |
| Полный экспорт | ✓ (MD/HTML) | ★ (это файлы) | ★ | ✓ | ✓ | ~ |
| Аудит обращений к LLM | ✗ | ~ | ~ | ✗ | ✗ | ✗ |

## 2.8. Сжатые выводы из бенчмарка

1. Markdown + local-first хорошо закрыт Obsidian и Logseq, но они слабы в ИИ и не имеют мультиагентного конвейера.
1. ИИ-функциональность лучше всего у Notion и Tana, но оба — закрытые облачные платформы без локального хранения и без self-host.
1. Полноценный мультиагентный конвейер с конвейерной обработкой ввода не предлагает ни один из шести инструментов. Это ключевая дифференциация Nabu.
1. Психотерапевтические протоколы (КПТ, гештальт, DBT, ACT, IFS) в виде первоклассных режимов не предлагает никто.
1. RPG-геймификация на уровне ядра отсутствует у всех; только Habitica-интеграция в Obsidian через плагин.
1. Полиморфная онтология с правилами вывода (то, что Nabu делает через TypeDB) недоступна нигде.
1. Аудит обращений к LLM и явная маршрутизация по приватности — не реализованы ни у одного инструмента.

# 3. Целевая функциональная матрица Nabu

Восемь этапов (Ph0…Ph7). Каждый этап — самостоятельный релиз с конкретной пользовательской ценностью и набором ИИ-агентов. Этапы упорядочены так, чтобы каждый следующий опирался на инфраструктуру предыдущего и не требовал переделок ядра.

## 3.1. Обзор этапов

| **№** | **Этап** | **Пользовательская ценность по итогам** |
| --- | --- | --- |
| Ph0 | Foundation | Пустое веб-приложение с аутентификацией, базовой моделью данных и CRUD заметок в Markdown. Можно регистрироваться, писать заметки, просматривать список и историю. Никаких ИИ-агентов. |
| Ph1 | Pipeline Core | Запущен мультиагентный конвейер. Любая заметка проходит Scribe → Triage → Entity Extractor → Domain Classifier → Affect Analyzer → Intent Detector → Linker. Появляется семантический поиск (pgvector). Базовые daily notes и inbox. |
| Ph2 | Knowledge Layer | TypeDB и онтология. Linker умеет работать через граф. Появляются Librarian, Ontology Maintainer, Taxonomy Curator, Context Retriever, Insight Agent, Digest Agent, Document Synthesizer (с шаблонами). Появляется graph view и адаптивная таксономия PARA. |
| Ph3 | Life Management | Привычки, проекты, задачи, метрики, RPG-слой, ежедневные ритуалы. Habit Architect, Streak Keeper, Project Manager, Quest Master, PARA Agent, Metrics Tracker, Coach Agent, RPG Game Master. Появляются Character sheet и Quest log. |
| Ph4 | Therapy & Deep Work | Психотерапевтические агенты: CBT, Gestalt, DBT/ACT, IFS. Hypothesis Agent, Socratic Agent. Therapy room как изолированное пространство. Категории видимости private/vault реализованы. |
| Ph5 | Research Mode | Research Assistant, Claim Tracker, Argument Mapper, Web Harvester, Transcriber, Media Annotator. PDF-парсинг, литературные заметки, BibTeX. Research desk. |
| Ph6 | Multi-platform & Local-first | Tauri desktop (Win/macOS/Linux) с локальными MD-файлами, локальный SQLite-кэш, sync engine v1 (last-write-wins), интеграция с Ollama. Tauri mobile (iOS/Android) с quick capture и share-extension. |
| Ph7 | Advanced Analytics & Collab | Forecaster, Anomaly Detector, Correlation Finder, Achievement Designer, Loot & Reward, MCP Bridge. Sync engine v2 (3-way merge, опционально CRDT для коллаборативных файлов). Realtime presence. |

## 3.2. Этап Ph0 — Foundation

**Цель: рабочая инфраструктура без ИИ. Всё, что нужно для дальнейшего наращивания.**

В составе:

- Web-клиент: Next.js + TypeScript + Tailwind + CopilotKit (только базовая интеграция, агентов ещё нет).
- Backend: NestJS-приложение, поднята структура модулей, нет ИИ-логики.
- Supabase self-hosted: Postgres + GoTrue + Storage + Realtime запущены через docker-compose.
- Аутентификация: email/password + magic link + один OAuth-провайдер (например, Google).
- Модель данных в Postgres: users, notes, note_versions, tags, tag_links, audit_log. RLS-политики для всех таблиц.
- S3 (MinIO): bucket для .md-файлов и медиа, Object Versioning включён.
- CRUD заметок через NestJS API: создать, прочитать, обновить, удалить, посмотреть историю.
- UI: Inbox, Library (плоский список), редактор Markdown (CodeMirror/Tiptap), просмотр версий.
- Ручное теггирование, ручное создание daily notes по шаблону.
- Импорт MD-файлов: drag-and-drop одиночных файлов и директорий.
- Минимальный экспорт: вся информация пользователя в виде zip с .md и метаданными.
**Definition of Done этапа Ph0:**

- Зарегистрированный пользователь может за один сеанс импортировать существующий Markdown-vault, создать новую заметку, отредактировать, посмотреть историю, экспортировать данные обратно.
- RLS проверена unit-тестами: ни один пользователь не видит чужих данных.
- Self-host разворачивается одной командой docker-compose up на чистом VPS.

## 3.3. Этап Ph1 — Pipeline Core

**Цель: первый рабочий мультиагентный конвейер.**

В составе:

- Интеграция Mastra.ai через @mastra/nestjs. Mastra-instance регистрируется в DI, агенты — как NestJS-сервисы.
- Supabase Queues (pgmq) подключены, базовый воркер на pg_cron + Edge Function.
- pgvector установлен, эмбеддинги генерируются на каждое создание/обновление заметки.
- Запущены агенты: Conductor (1), UI Composer (2), Critic (3), Scribe (4), Triage (5), Entity Extractor (8), Domain Classifier (9), Affect & Mood Analyzer (10), Intent Detector (11), Linker (12), Context Retriever (17). Нумерация — по реестру v1 концепции.
- Daily note становится автогенерируемой страницей дня с агрегатами входящих, упомянутых сущностей и активных задач.
- Семантический поиск по корпусу + классический поиск (через pg_trgm).
- Автоматическое предложение wikilinks при наборе текста (через Linker).
- Slash-команды: /capture, /search, /related, /classify.
**Definition of Done этапа Ph1:**

- Каждая новая заметка получает в течение 30 секунд: тип (triage), список сущностей, домен, оценку аффекта, intent, минимум 3 семантически близкие заметки.
- Eval-тесты для каждого агента: ≥85% совпадения с золотым стандартом на тестовом наборе ≥200 заметок.
- p95 латентность обработки одной заметки ≤ 30 секунд при типовой нагрузке.
- Аудит вызовов LLM полный: пользователь видит, какие данные и в каком объёме уходили.

## 3.4. Этап Ph2 — Knowledge Layer

**Цель: онтология, синтез, продвинутая навигация.**

В составе:

- TypeDB развёрнут отдельным контейнером. Базовая схема: Person, Place, Project, Goal, Habit, Idea, Concept, Source, Note, Event, Decision, Emotion, Metric, Quest. Отношения: mentions, depends_on, supports, contradicts, achieves, blocks, derives_from, instance_of, part_of, occurs_at.
- Запущены агенты: Transcriber (6), Web Harvester (7), Ontology Maintainer (13), Taxonomy Curator (14), Deduplicator (15), Librarian (16), Insight Agent (18), Digest Agent (21), Document Synthesizer (22).
- Адаптивная таксономия PARA реализована в UI: Projects, Areas, Resources, Archives, Journals, Therapy.
- Graph view (на базе D3/Cytoscape) — навигация по графу знаний с фильтрами.
- Document Synthesizer работает по шаблонам: паспорт проекта, спецификация, литературный обзор, ежедневный/недельный/месячный дайджест.
- Bulk-импорт корпусов (Obsidian, Logseq, Roam, Notion-export) с прохождением через полный конвейер.

## 3.5. Этап Ph3 — Life Management

**Цель: привычки, задачи, проекты, метрики, базовая RPG-механика.**

В составе:

- Запущены агенты: Habit Architect (29), Streak Keeper (30), Project Manager (31), Quest Master (32), PARA Agent (33), Metrics Tracker (34), Coach Agent (28), RPG Game Master (40).
- Schema-расширения: habits, habit_logs, streaks, projects, project_artifacts, tasks, quests, quest_chains, metrics_series, metric_values, character_sheet, character_attrs.
- Habit tracker: cue/routine/reward, минимальные шаги, привязка к якорю.
- Task management: priority, project, parent goal, deadline.
- Quest log с пятью типами квестов (Daily, Side, Main, Epic, Hidden).
- Character sheet с восемью атрибутами (Интеллект, Мудрость, Креативность, Дисциплина, Витальность, Стойкость, Социальность, Достаток).
- Базовые dashboards для метрик.
- Coach Agent для постановки целей SMART/OKR и прояснения ценностей.

## 3.6. Этап Ph4 — Therapy & Deep Work

**Цель: первоклассные психотерапевтические протоколы и приватная маршрутизация.**

В составе:

- Запущены агенты: CBT Agent (24), Gestalt Agent (25), DBT/ACT Agent (26), IFS Agent (27), Hypothesis Agent (19), Socratic Agent (20).
- Шаблоны психотерапевтических дневников (см. v2 концепции, §3.2 — все 9 типов).
- Therapy room — изолированное представление, отдельный левый сайдбар, отдельные права RLS.
- Категории видимости: default, private, vault. UI для назначения и аудита.
- Private-маршрутизация: для категории private LLM-вызовы идут через локальный Ollama (см. требование к локальному узлу пользователя на десктопе).
- Vault-шифрование: пользовательский ключ + E2E.

## 3.7. Этап Ph5 — Research Mode

**Цель: исследовательский режим с источниками, цитатами, аргументами.**

В составе:

- Запущены агенты: Research Assistant (37), Claim Tracker (38), Argument Mapper (39). Усиленные Web Harvester и Transcriber.
- Поддержка медиа: PDF-парсинг с layout-awareness, изображения (OCR), аудио (Whisper), видео (через транскрипт).
- Литературные заметки с метаданными BibTeX/DOI.
- Research desk — многоколоночный режим (источник | заметки | граф аргументов | синтез).
- Карты противоречий и расхождений между источниками.

## 3.8. Этап Ph6 — Multi-platform & Local-first

**Цель: десктопный и мобильный клиенты, локальное хранение, sync engine.**

В составе:

- Tauri 2.x desktop: Windows, macOS, Linux. Использует ту же Next.js SPA-сборку, что и веб.
- Локальное хранение .md в файловой системе пользователя. File watcher интегрирован.
- Локальный SQLite-кэш (через tauri-plugin-sql) с подмножеством метаданных.
- Sync engine v1 (last-write-wins): outbox → API → S3 + Postgres, inbox через Realtime.
- Интеграция с локальным Ollama: автоматическое обнаружение, выбор модели, маршрутизация для private/vault.
- Локальный Whisper для приватной транскрипции.
- Tauri mobile (iOS/Android): quick capture, share extension, чтение, базовое редактирование, голосовые заметки.
- Push-уведомления о завершении тяжёлых агентских задач.

## 3.9. Этап Ph7 — Advanced Analytics & Collab

**Цель: продвинутая аналитика, награды, опциональная коллаборация.**

В составе:

- Запущены агенты: Forecaster (35), Anomaly Detector (36), Correlation Finder (23), Achievement Designer (41), Loot & Reward Agent (42), MCP Bridge Agent (44).
- Sync engine v2: 3-way merge для текста, базовая на base-версии.
- Опциональный CRDT-режим (Yjs или Automerge) для файлов, помеченных как collaborative.
- Realtime presence: видно, какие устройства пользователя онлайн, кто сейчас редактирует файл.
- MCP-коннекторы к внешним системам: календари, почта, банки, фитнес-трекеры.
- Прогнозы и аномалии: ежедневные отчёты о трендах, всплески расходов, падения настроения.
- Корреляционный анализ: явное связывание метрик с записями и привычками.

# 4. Распределение агентов по этапам

Сводная таблица: какой агент появляется на каком этапе и каков статус в момент появления (basic / full).

| **№** | **Агент** | **Уровень (по v1)** | **Этап** | **Состояние в момент появления** |
| --- | --- | --- | --- | --- |
| 1 | Conductor | Оркестрация | Ph1 | basic |
| 2 | UI Composer | Оркестрация | Ph1 | basic, расширяется на Ph3, Ph4 |
| 3 | Critic | Оркестрация | Ph1 | basic, расширяется на Ph4 |
| 4 | Scribe | Приём ввода | Ph1 | full |
| 5 | Triage | Приём ввода | Ph1 | basic, расширяется на Ph4 |
| 6 | Transcriber | Приём ввода | Ph2 | basic, расширяется на Ph5 |
| 7 | Web Harvester | Приём ввода | Ph2 | basic, расширяется на Ph5 |
| 8 | Entity Extractor | Понимание | Ph1 | full |
| 9 | Domain Classifier | Понимание | Ph1 | full |
| 10 | Affect & Mood Analyzer | Понимание | Ph1 | basic, расширяется на Ph4 |
| 11 | Intent Detector | Понимание | Ph1 | full |
| 12 | Linker | Связывание | Ph1 | basic, расширяется на Ph2 |
| 13 | Ontology Maintainer | Связывание | Ph2 | full |
| 14 | Taxonomy Curator | Связывание | Ph2 | full |
| 15 | Deduplicator | Связывание | Ph2 | basic |
| 16 | Librarian | Память | Ph2 | full |
| 17 | Context Retriever | Память | Ph1 | basic, расширяется на Ph2 |
| 18 | Insight Agent | Синтез | Ph2 | basic, расширяется на Ph3, Ph7 |
| 19 | Hypothesis Agent | Синтез | Ph4 | full |
| 20 | Socratic Agent | Синтез | Ph4 | full |
| 21 | Digest Agent | Синтез | Ph2 | full |
| 22 | Document Synthesizer | Синтез | Ph2 | full |
| 23 | Correlation Finder | Синтез | Ph7 | full |
| 24 | CBT Agent | Терапия | Ph4 | full |
| 25 | Gestalt Agent | Терапия | Ph4 | full |
| 26 | DBT / ACT Agent | Терапия | Ph4 | full |
| 27 | IFS Agent | Терапия | Ph4 | full |
| 28 | Coach Agent | Терапия | Ph3 | full |
| 29 | Habit Architect | Привычки | Ph3 | full |
| 30 | Streak Keeper | Привычки | Ph3 | full |
| 31 | Project Manager | Проекты | Ph3 | full |
| 32 | Quest Master | Проекты | Ph3 | full |
| 33 | PARA Agent | Проекты | Ph3 | full |
| 34 | Metrics Tracker | Метрики | Ph3 | full |
| 35 | Forecaster | Метрики | Ph7 | full |
| 36 | Anomaly Detector | Метрики | Ph7 | full |
| 37 | Research Assistant | Исследования | Ph5 | full |
| 38 | Claim Tracker | Исследования | Ph5 | full |
| 39 | Argument Mapper | Исследования | Ph5 | full |
| 40 | RPG Game Master | Геймификация | Ph3 | basic, расширяется на Ph7 |
| 41 | Achievement Designer | Геймификация | Ph7 | full |
| 42 | Loot & Reward Agent | Геймификация | Ph7 | full |
| 43 | Import Agent | Импорт | Ph0 | basic, расширяется на Ph2 |
| 44 | MCP Bridge Agent | Импорт | Ph7 | full |

Таким образом: 11 агентов на Ph1, +9 на Ph2 (накопительно 20), +8 на Ph3 (28), +6 на Ph4 (34), +3 на Ph5 (37), 0 новых на Ph6 (но добавляется multi-platform инфраструктура), +7 на Ph7 (44). Этап Ph0 содержит только Import Agent в самом базовом варианте.
