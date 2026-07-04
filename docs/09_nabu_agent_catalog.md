# NABU

*Agent Catalog*  
*Каталог 44 агентов и Prompt Library*  
*Полная спецификация мультиагентного слоя*  
*Версия 1.0*  

---

# 1. Назначение

Документ — нормативный каталог всех 44 агентов Nabu. Для каждого зафиксированы: слой, назначение, входы, выходы, инструменты, модель по умолчанию, фаза появления, eval-метрика, скелет системного промпта. Это контракт, который AI-команда реализует через Mastra.ai в пакете packages/agents.

# 2. Общие соглашения

## 2.1. Структура агента в коде

```
packages/agents/<group>/<agent-name>/
├── agent.ts        — определение Mastra-агента
├── prompt.md       — системный промпт (текущая версия)
├── prompt.v1.md    — исторические версии (immutable)
├── schema.ts       — Zod-схемы input/output
├── tools.ts        — список tools
├── eval.jsonl      — золотой набор (≥ 200 примеров)
├── eval.runner.ts  — runner для eval-suite
└── README.md       — описание + ссылки на FR
```

## 2.2. Runtime Context

Каждый агент получает Runtime Context от Mastra. Стандартные поля:

- user_id (uuid)
- session_id (uuid)
- visibility (default|private|vault)
- trace_id (correlation across services)
- abort_signal (AbortSignal для отмены)
- locale ('ru'|'en'|...)
- now (ISO timestamp)
- model_router (для динамического выбора модели)

## 2.3. Соглашения по моделям

| **Класс задачи** | **Модель** | **Когда применяется** |
| --- | --- | --- |
| Лёгкая классификация / NER | Claude Haiku 4.5 | Triage, Entity, Domain, Affect, Intent — высокая частота, низкая ставка на одну ошибку |
| Основная рабочая | Claude Sonnet 4.6 | Linker, Insight, Coach, CBT/Gestalt/DBT/ACT/IFS, Project Manager, Quest Master |
| Тяжёлый синтез | Claude Opus 4.7 | Document Synthesizer, Critic (полная версия), Hypothesis, Digest (месячный+), Correlation Finder |
| Локально (private/vault) | Qwen 2.5 14B-Instruct (Ollama) | Все агенты, обрабатывающие private/vault — независимо от их default-модели |
| Эмбеддинги (cloud) | voyage-3 или text-embedding-3-large | Для default-категории |
| Эмбеддинги (local) | nomic-embed-text или bge-m3 | Для private/vault, на Ollama |
| Транскрипция (cloud) | whisper-large-v3 (через API) | Для default-аудио |
| Транскрипция (local) | whisper.cpp с моделью medium | Для private-аудио, на десктопе |

## 2.4. Метрики eval по типам задач

| **Тип задачи** | **Метрики** |
| --- | --- |
| NER (Entity Extractor) | F1 macro по типам сущностей; precision и recall per type ≥ 0.80 |
| Классификация (Triage, Domain, Intent) | Accuracy, macro-F1 ≥ 0.85; confusion matrix фиксируется per-release |
| Регрессия (Affect — valence, arousal) | MAE ≤ 0.2 по нормированной шкале [-1, 1] |
| Поиск (Linker, Context Retriever) | Recall@10 на ручной разметке релевантности; nDCG@10 |
| Genеративная задача (Document Synthesizer) | Rubric-based scoring (4 шкалы: фактическая точность, структура, полнота, стиль) — LLM-as-judge с проверочной выборкой человеком |
| Критика (Critic) | Precision на обнаружении противоречий (с учётом ground truth из специально вброшенных ошибок) |
| Терапевтические (CBT/Gestalt/...) | Compliance to protocol checklist (rubric) + human review на представительной выборке |

# 3. Слой оркестрации (агенты 1–3)

`Агент 01 · `**Conductor**

| **Слой / группа** | **Оркестрация** |
| --- | --- |
| Назначение | Определяет маршрут обработки. По характеру входа, visibility и intent строит DAG агентов для конкретного раунда. |
| Входы | RuntimeContext + { note_id, version, trigger: 'created'\|'updated'\|'replay' } |
| Выходы | ExecutionPlan { stages: [{ agent_name, depends_on: [...], expected_outputs: [...] }] } |
| Инструменты | list-agents (получить доступные), get-note-meta (получить тип и visibility) |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1 (basic), расширяется на Ph2/Ph4 при добавлении новых типов вводов |
| Метрика eval | Accuracy в выборе плана vs hand-crafted golden plan на 100 сценариях |

**Шаблон системного промпта (skeleton):**

```
# System: Conductor
You are the orchestrator of the Nabu agent pipeline.
Inputs: note metadata, visibility, trigger.
Output: a JSON ExecutionPlan with stages and dependencies.
```

```
Rules:
- If visibility=private or vault, NEVER include cloud-only agents.
- Always include Critic as the last stage.
- Parallelize independent stages.
- Skip Entity/Linker if note.type=fleeting and content < 20 chars.
```

`Агент 02 · `**UI Composer**

| **Слой / группа** | **Оркестрация** |
| --- | --- |
| Назначение | Формирует генеративные UI-фрагменты для CopilotKit под текущую задачу: формы, чек-листы, таймлайны, дашборды. |
| Входы | RuntimeContext + { intent, context_data, ui_constraints? } |
| Выходы | JSX-описание UI как структурированный JSON (CopilotKit Generative UI schema) |
| Инструменты | list-ui-blocks, get-design-tokens |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph1 (basic), расширяется на Ph3/Ph4 (виджеты привычек, character sheet, therapy room) |
| Метрика eval | Rubric (валидность JSX, соответствие дизайн-токенам, выполнение требований) ≥ 4.0/5.0 |

**Шаблон системного промпта (skeleton):**

```
# System: UI Composer
Generate a JSX block for CopilotKit Generative UI.
Use ONLY tokens from get-design-tokens.
Respond with valid JSON matching the CopilotKit schema.
```

`Агент 03 · `**Critic**

| **Слой / группа** | **Оркестрация** |
| --- | --- |
| Назначение | Проверяет выходы других агентов на противоречия с базой знаний, галлюцинации, нарушения политик приватности. |
| Входы | Original input + outputs of other agents + relevant context |
| Выходы | { verdict: 'pass'\|'warn'\|'block', issues: [{ severity, kind, description, suggested_action }] } |
| Инструменты | graph-query (TypeDB), check-policy, validate-claim |
| Модель по умолчанию | Claude Sonnet 4.6 (Ph1), Claude Opus 4.7 (Ph4 — полная версия с расширенной критикой терапевтических выходов) |
| Появляется | Ph1, расширяется на Ph4 |
| Метрика eval | Precision/Recall на специально подмешанных в выходы ошибках (synthetic ground truth) ≥ 0.85/0.75 |

**Примечание: **Critic — это второй слой защиты, не замена human review для PR с terapy/security изменениями.

**Шаблон системного промпта (skeleton):**

```
# System: Critic
Inspect agent outputs for:
1. Contradictions with the knowledge graph.
2. Unsupported claims.
3. Privacy policy violations (e.g., vault content leaking to default output).
4. For therapy agents: protocol compliance, no clinical claims, disclaimer present.
```

```
Output JSON verdict.
```

# 4. Слой приёма ввода (агенты 4–7)

`Агент 04 · `**Scribe**

| **Слой / группа** | **Приём ввода** |
| --- | --- |
| Назначение | Нормализует входящий текст: пунктуация, абзацы, очистка артефактов транскрипции, исправление опечаток (минимально-инвазивно). |
| Входы | raw_text + source_hint ('voice'\|'web'\|'manual'\|'paste') |
| Выходы | normalized_text + change_log |
| Инструменты | — |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1 |
| Метрика eval | BLEU между normalized и эталоном ≥ 0.92; F1 на пунктуации ≥ 0.85 |

`Агент 05 · `**Triage**

| **Слой / группа** | **Приём ввода** |
| --- | --- |
| Назначение | Классифицирует ввод по типу записи. Возвращает один или несколько типов с весами. |
| Входы | text + frontmatter_hints |
| Выходы | { types: [{ name, weight }], primary_type } |
| Инструменты | — |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1, расширяется на Ph4 (новые типы — therapy_*) |
| Метрика eval | Accuracy top-1 ≥ 0.85; macro-F1 по 30+ типам ≥ 0.80 |

**Примечание: **Типы определены в реестре types.yaml — 30+ значений: fleeting_note, literature_note, evergreen_note, daily_note, journal_*, task, idea, observation, decision, ...

`Агент 06 · `**Transcriber**

| **Слой / группа** | **Приём ввода** |
| --- | --- |
| Назначение | Транскрипция голоса (Whisper) и OCR изображений. Возвращает текст + временные метки/координаты для дальнейшей привязки. |
| Входы | audio_blob\|image_blob |
| Выходы | transcript + segments (audio) или text_blocks с (x,y,w,h) для изображений |
| Инструменты | whisper-cloud, whisper-local, ocr-tesseract |
| Модель по умолчанию | whisper-large-v3 (cloud) / whisper.cpp medium (local) |
| Появляется | Ph2 (basic), расширяется на Ph5 (layout-aware OCR) |
| Метрика eval | WER ≤ 0.08 на нормальной речи; CER ≤ 0.05 на печатном тексте OCR |

`Агент 07 · `**Web Harvester**

| **Слой / группа** | **Приём ввода** |
| --- | --- |
| Назначение | Получает контент по сохранённой URL, реферирует, нормализует. Извлекает метаданные (автор, дата, тип). |
| Входы | url + capture_options |
| Выходы | { title, author, published_at, content_md, summary, citation: {bibtex} } |
| Инструменты | fetch-url, readability-extract, archive.org-snapshot |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph2, расширяется на Ph5 (PDF-парсинг с layout) |
| Метрика eval | Content extraction F1 ≥ 0.90 (по эталону mozilla-readability); metadata completeness ≥ 0.80 |

# 5. Слой понимания (агенты 8–11)

`Агент 08 · `**Entity Extractor**

| **Слой / группа** | **Понимание** |
| --- | --- |
| Назначение | Извлекает сущности: люди, места, проекты, концепты, даты, суммы, эмоции, телесные ощущения. |
| Входы | normalized_text + context (recent entities for disambiguation) |
| Выходы | [{ type, surface_form, canonical_form, attributes, start, end, confidence }] |
| Инструменты | search-entities (по существующим в TypeDB для дедупликации) |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1 |
| Метрика eval | F1 macro ≥ 0.85; precision per type ≥ 0.80 |

**Примечание: **После Entity новые сущности кладутся в Postgres staging-таблицу entities_pending; Ontology Maintainer (#13) переносит их в TypeDB с дедупликацией.

`Агент 09 · `**Domain Classifier**

| **Слой / группа** | **Понимание** |
| --- | --- |
| Назначение | Присваивает один или несколько доменов жизни (работа, здоровье, отношения, финансы, учёба, творчество, духовное, бытовое). |
| Входы | normalized_text + entities |
| Выходы | [{ domain, weight }] |
| Инструменты | — |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1 |
| Метрика eval | Macro-F1 ≥ 0.85 |

**Примечание: **Также назначает visibility = private для очевидно чувствительных записей (психотерапия, личная медицина) — с явной флаг-меткой proposed_visibility для подтверждения пользователем.

`Агент 10 · `**Affect & Mood Analyzer**

| **Слой / группа** | **Понимание** |
| --- | --- |
| Назначение | Оценивает эмоциональный тон (valence, arousal), уровень тревоги/стресса; помечает когнитивные искажения при их наличии. |
| Входы | normalized_text |
| Выходы | { valence: [-1,1], arousal: [0,1], distortions: [name, ...], emotions: [name, weight] } |
| Инструменты | — |
| Модель по умолчанию | Claude Haiku 4.5 (Ph1), Claude Sonnet 4.6 (Ph4 — для терапевтических) |
| Появляется | Ph1, расширяется на Ph4 |
| Метрика eval | MAE на valence ≤ 0.2; precision на distortions ≥ 0.75 (порог уверенности 0.7) |

`Агент 11 · `**Intent Detector**

| **Слой / группа** | **Понимание** |
| --- | --- |
| Назначение | Различает intent: задача / идея / наблюдение / жалоба / решение / цель / вопрос / гипотеза / обещание. |
| Входы | normalized_text + entities + domain |
| Выходы | { intents: [{ kind, target_entity_id?, urgency, weight }] } |
| Инструменты | — |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph1 |
| Метрика eval | Macro-F1 ≥ 0.80 |

**Примечание: **Если intent=задача — Project Manager (#31) или Quest Master (#32) подбирает контейнер.

# 6. Слой связывания (агенты 12–15)

`Агент 12 · `**Linker**

| **Слой / группа** | **Связывание** |
| --- | --- |
| Назначение | Находит семантически близкие заметки (pgvector) и существующие связи в графе (TypeDB). Предлагает wikilinks. |
| Входы | note_id + content + entities |
| Выходы | { semantic_neighbors: [{note_id, score, snippet}], graph_paths: [{from, relations, to}], suggested_wikilinks: [{target_note, anchor_text}] } |
| Инструменты | pgvector-search, typedb-shortest-paths, search-by-title |
| Модель по умолчанию | Claude Sonnet 4.6 (для финального ранжирования и составления wikilinks; векторный поиск — без LLM) |
| Появляется | Ph1 (только pgvector), Ph2 (с TypeDB) |
| Метрика eval | Recall@10 на ручной разметке ≥ 0.70; precision@5 ≥ 0.80 |

`Агент 13 · `**Ontology Maintainer**

| **Слой / группа** | **Связывание** |
| --- | --- |
| Назначение | Переносит сущности из Postgres staging в TypeDB; при появлении новых типов — предлагает расширение схемы. Все изменения схемы — отдельная миграция. |
| Входы | entities_pending batch |
| Выходы | { inserted_entities, schema_change_proposals: [{type_name, justification, sample_count}] } |
| Инструменты | typedb-insert, typedb-schema-introspect, propose-migration |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph2 |
| Метрика eval | Дубликаты ≤ 2% на корпусе с известными повторяющимися сущностями; schema-proposals — Critic-проверка |

**Примечание: **Schema-change proposals не применяются автоматически. Пользователь (или AI-команда) ревьюит и применяет вручную через миграцию.

`Агент 14 · `**Taxonomy Curator**

| **Слой / группа** | **Связывание** |
| --- | --- |
| Назначение | Поддерживает чистоту PARA-структуры: объединяет дубликаты тегов, разделяет переусложнённые, переименовывает плохо названные. Запускается по pg_cron и по триггеру (пользователь нажал «прибрать»). |
| Входы | tags_state + tag_links_state |
| Выходы | [{ op: 'merge'\|'split'\|'rename'\|'archive', source, target, justification }] |
| Инструменты | tag-stats, tag-similarity |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph2 |
| Метрика eval | User acceptance rate предложений ≥ 0.60 (после первых 10 запусков на корпусе) |

`Агент 15 · `**Deduplicator**

| **Слой / группа** | **Связывание** |
| --- | --- |
| Назначение | Находит дубликаты и почти-дубликаты заметок, предлагает склейку или связывание. |
| Входы | note_id (новая заметка) + corpus |
| Выходы | [{ candidate_id, similarity, recommended_action: 'merge'\|'link'\|'keep_separate' }] |
| Инструменты | pgvector-search (threshold ≥ 0.92), minhash, content-diff |
| Модель по умолчанию | Claude Sonnet 4.6 (для финальной классификации сомнительных случаев) |
| Появляется | Ph2 |
| Метрика eval | Precision на парах merge ≥ 0.90 (минимизируем ложные склейки) |

# 7. Слой памяти (агенты 16–17)

`Агент 16 · `**Librarian**

| **Слой / группа** | **Память** |
| --- | --- |
| Назначение | Продвигает заметки по Zettelkasten-статусам (fleeting → literature → evergreen) на основании правил (возраст, кол-во backlinks, переработка, последняя правка). |
| Входы | notes batch (per pg_cron) + their metadata + link graph |
| Выходы | [{ note_id, current_status, proposed_status, rationale }] |
| Инструменты | graph-metrics (in-degree, out-degree), age, last_edit_distance |
| Модель по умолчанию | Claude Haiku 4.5 (правила преобладают, LLM — для пограничных случаев) |
| Появляется | Ph2 |
| Метрика eval | Согласованность с пользовательской разметкой на тестовом vault ≥ 0.85 |

`Агент 17 · `**Context Retriever**

| **Слой / группа** | **Память** |
| --- | --- |
| Назначение | На любой запрос от другого агента собирает релевантный контекст из всех хранилищ: pgvector (семантика), TypeDB (граф), Postgres (метаданные), S3 (содержимое). |
| Входы | { subject_id?, query?, k_neighbors, max_tokens, time_window? } |
| Выходы | { documents: [{ note_id, content, score, kind: 'semantic'\|'graph'\|'recent' }], graph_facts: [...] } |
| Инструменты | pgvector-search, typedb-query, recent-notes |
| Модель по умолчанию | Claude Sonnet 4.6 (для финальной фильтрации и приоритизации) |
| Появляется | Ph1 (basic, только pgvector), Ph2 (полный) |
| Метрика eval | User study: рейтинг полезности контекста для downstream-генерации |

# 8. Слой синтеза (агенты 18–23)

`Агент 18 · `**Insight Agent**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Находит паттерны, повторяющиеся темы, противоречия в корпусе. Формулирует наблюдения о пользователе и его деятельности. |
| Входы | new_note + corpus_excerpt + previously_known_insights |
| Выходы | [{ insight, supporting_notes, contradicting_notes?, confidence, kind: 'pattern'\|'shift'\|'tension' }] |
| Инструменты | context-retriever, graph-query, time-series-stats |
| Модель по умолчанию | Claude Opus 4.7 (для тяжёлого insight-моделирования), Claude Sonnet 4.6 (для микро-insights) |
| Появляется | Ph2 (basic), Ph3/Ph7 (расширения) |
| Метрика eval | Rubric (новизна, обоснованность, ясность) ≥ 4.0/5.0 от пользователя на пилотной выборке |

**Примечание: **Insight НЕ показывается автоматически в обычном UI. Insights появляются в Daily/Weekly digest и в Inbox с пометкой 'observation'.

`Агент 19 · `**Hypothesis Agent**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Генерирует проверяемые гипотезы и предлагает мини-эксперименты (по принципу behavioral experiments КПТ или Lean Startup). |
| Входы | insight + relevant context |
| Выходы | { hypothesis, falsification_criteria, suggested_experiment, duration, success_metric } |
| Инструменты | context-retriever |
| Модель по умолчанию | Claude Opus 4.7 |
| Появляется | Ph4 |
| Метрика eval | Rubric (проверяемость, конкретность критерия фальсификации) ≥ 4.0/5.0 |

`Агент 20 · `**Socratic Agent**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Задаёт уточняющие вопросы вокруг свежей записи. Запускается ТОЛЬКО по явному вызову пользователя или конфигурации. |
| Входы | note + user_questioning_preferences |
| Выходы | { questions: [{ text, kind: 'clarify'\|'challenge'\|'extend' }] } |
| Инструменты | context-retriever |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph4 |
| Метрика eval | User opt-in retention на запрос Socratic в течение 30 дней ≥ 0.30 |

**Примечание: **Промпт явно ограничен: не более 5 вопросов, не более одного challenging, никакой моральной оценки.

`Агент 21 · `**Digest Agent**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Генерирует ежедневные, недельные, месячные, квартальные сводки. Группирует по доменам, выделяет ключевые события, прогресс целей, выполнение привычек. |
| Входы | { period: 'day'\|'week'\|'month'\|'quarter', user_id } |
| Выходы | structured digest в виде .md заметки с разделами (highlights, completed, in_flight, drops, insights) |
| Инструменты | context-retriever (с временным фильтром), metrics-aggregate, quest-status |
| Модель по умолчанию | Claude Sonnet 4.6 (day/week), Claude Opus 4.7 (month/quarter) |
| Появляется | Ph2 |
| Метрика eval | Rubric (полнота, фактическая точность, читабельность) ≥ 4.0/5.0 |

`Агент 22 · `**Document Synthesizer**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Генерирует вторичные документы по шаблонам: паспорт проекта, спецификация, литературный обзор, манифест, ценностная карта. Шаблоны — редактируемые .md в templates/. |
| Входы | { template_id, subject_id, parameters } |
| Выходы | .md документ с заполненными разделами + ссылки на исходные заметки |
| Инструменты | context-retriever (для всех связанных заметок), template-loader, graph-walk |
| Модель по умолчанию | Claude Opus 4.7 |
| Появляется | Ph2 |
| Метрика eval | User acceptance rate (отсутствие правок до сохранения) ≥ 0.60 |

**Примечание: **Самый дорогой агент по токенам. На каждый вызов — explicit consent и оценка стоимости пользователю.

`Агент 23 · `**Correlation Finder**

| **Слой / группа** | **Синтез** |
| --- | --- |
| Назначение | Ищет статистически осмысленные связи между метриками, привычками и текстом заметок. Возвращает ТОЛЬКО связи с явным уровнем неопределённости. |
| Входы | time series + corpus + window |
| Выходы | [{ var_a, var_b, correlation, p_value, n_obs, confound_warnings: [...] }] |
| Инструменты | stats-correlation, mutual-information, granger-test, context-retriever |
| Модель по умолчанию | Claude Opus 4.7 (для интерпретации и предупреждений), статистика — без LLM |
| Появляется | Ph7 |
| Метрика eval | Precision (нет ложноположительных при синтетическом сценарии без зависимостей) ≥ 0.95 при FDR ≤ 0.05 |

**Примечание: **Категорически НЕ говорит 'causes', всегда 'associated with'. Confounders фиксируются.

# 9. Слой терапии (агенты 24–28)

Все терапевтические агенты обязаны: (а) маршрутизироваться через локальный Ollama для visibility=private; (б) включать явный disclaimer в каждом ответе; (в) проходить human review для prompt-изменений; (г) иметь rubric eval с участием психолога-консультанта.

`Агент 24 · `**CBT Agent**

| **Слой / группа** | **Терапия** |
| --- | --- |
| Назначение | Помогает работать с дисфункциональными мыслями: идентификация когнитивных искажений (10 классических), сократический диалог, поведенческие эксперименты, расписание активности. |
| Входы | journal_entry (по схеме ABC/SBNC/Beck) + history |
| Выходы | { distortions_identified, socratic_questions, suggested_reframe?, behavioral_experiment_suggestion? } |
| Инструменты | context-retriever (история КПТ-записей) |
| Модель по умолчанию | Claude Sonnet 4.6 (cloud); Qwen 2.5 14B (local for private) |
| Появляется | Ph4 |
| Метрика eval | Precision на распознавании 10 искажений ≥ 0.80; rubric от консультанта ≥ 4.0/5.0 |

**Примечание: **Промпт ограничивает: задаёт вопросы, не предписывает. Disclaimer в конце каждого ответа.

`Агент 25 · `**Gestalt Agent**

| **Слой / группа** | **Терапия** |
| --- | --- |
| Назначение | Поддерживает работу с осознаванием, полярностями, незавершёнными ситуациями. Помогает заметить телесные ощущения и эмоции в настоящем моменте. |
| Входы | journal_entry + history |
| Выходы | { awareness_focus_suggestions, polarities_detected, unfinished_situations } |
| Инструменты | context-retriever |
| Модель по умолчанию | Claude Sonnet 4.6 / Qwen 2.5 14B |
| Появляется | Ph4 |
| Метрика eval | Rubric от гештальт-консультанта ≥ 4.0/5.0 на 50 кейсах |

`Агент 26 · `**DBT / ACT Agent**

| **Слой / группа** | **Терапия** |
| --- | --- |
| Назначение | Поддерживает навыки эмоциональной регуляции (DBT), дистресс-толерантности, mindfulness. Работа с ACT-матрицей и ценностно-ориентированными действиями. |
| Входы | journal_entry + skills_history |
| Выходы | { recommended_skill, matrix_quadrant, values_alignment_score } |
| Инструменты | context-retriever |
| Модель по умолчанию | Claude Sonnet 4.6 / Qwen 2.5 14B |
| Появляется | Ph4 |
| Метрика eval | Compliance с DBT skills modules / ACT-матрицей в выборках консультанта ≥ 4.0/5.0 |

`Агент 27 · `**IFS Agent**

| **Слой / группа** | **Терапия** |
| --- | --- |
| Назначение | Помогает идентифицировать «части» (parts) и их отношения с Self. Поддерживает экстернализацию и диалог. |
| Входы | journal_entry + previously_identified_parts |
| Выходы | { parts_detected: [{ name, role: 'manager'\|'firefighter'\|'exile', message }], self_state_assessment } |
| Инструменты | context-retriever (история частей) |
| Модель по умолчанию | Claude Sonnet 4.6 / Qwen 2.5 14B |
| Появляется | Ph4 (опционально) |
| Метрика eval | Rubric от IFS-консультанта ≥ 4.0/5.0 |

**Примечание: **Самый деликатный из терапевтических. Включается пользователем явно. Не делает интервенций, только обозначает структуру.

`Агент 28 · `**Coach Agent**

| **Слой / группа** | **Терапия** |
| --- | --- |
| Назначение | Постановка целей (SMART, OKR), прояснение ценностей, обзор недели/месяца с точки зрения целей. |
| Входы | goals_state + recent_journals + values_map |
| Выходы | { goal_clarity_score, suggested_revisions, alignment_with_values } |
| Инструменты | context-retriever, goals-query, metrics-query |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph3 |
| Метрика eval | User retention на еженедельный coach-обзор ≥ 0.50 |

# 10. Слои привычек, проектов, метрик (агенты 29–36)

`Агент 29 · `**Habit Architect**

| **Слой / группа** | **Привычки** |
| --- | --- |
| Назначение | Проектирует привычки по моделям Fogg (Tiny Habits) и Clear (Atomic Habits): cue, routine, reward, минимальный шаг, якорь. |
| Входы | { target_behavior, current_context, prior_attempts } |
| Выходы | structured habit_spec |
| Инструменты | context-retriever (история привычек) |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph3 |
| Метрика eval | User adoption (выполнение ≥ 7 дней подряд) ≥ 0.40 для созданных через Architect |

`Агент 30 · `**Streak Keeper**

| **Слой / группа** | **Привычки** |
| --- | --- |
| Назначение | Ведёт стрики, страхует серии (плановый пропуск не сбивает), даёт милые поощрения за продолжение. |
| Входы | habit_log |
| Выходы | { streak_state, encouragement?, recovery_suggestion? } |
| Инструменты | habit-query |
| Модель по умолчанию | Claude Haiku 4.5 (правила преобладают) |
| Появляется | Ph3 |
| Метрика eval | Никаких штрафов — формально не eval-able; следим за тем, что streak не сбивается на planned-skip |

`Агент 31 · `**Project Manager**

| **Слой / группа** | **Проекты** |
| --- | --- |
| Назначение | Ведёт карточку проекта, обновляет статус по упоминаниям в новых заметках, отслеживает риски и блокировки. |
| Входы | new_note (где упомянут проект) + project_state |
| Выходы | { status_update?, new_risks?, new_artifacts?, blockers? } |
| Инструменты | project-query, context-retriever |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph3 |
| Метрика eval | Precision на детектировании статуса ≥ 0.85 |

`Агент 32 · `**Quest Master**

| **Слой / группа** | **Проекты** |
| --- | --- |
| Назначение | Конвертирует цели в цепочки квестов (атомизированные задачи). Поддерживает пять типов квестов (Daily, Side, Main, Epic, Hidden). |
| Входы | goal_or_intent + RPG_state |
| Выходы | quest_chain (graph of quests with dependencies) |
| Инструменты | goal-query, character-state |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph3 |
| Метрика eval | Adoption: ≥ 0.60 квестов начаты в течение 7 дней после генерации |

`Агент 33 · `**PARA Agent**

| **Слой / группа** | **Проекты** |
| --- | --- |
| Назначение | Поддерживает чистоту PARA-структуры. Переходы Project → Area → Archive по правилам. |
| Входы | PARA_state + activity_signals |
| Выходы | [{ item, from, to, justification }] |
| Инструменты | para-query, activity-stats |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph3 |
| Метрика eval | User acceptance ≥ 0.70 |

`Агент 34 · `**Metrics Tracker**

| **Слой / группа** | **Метрики** |
| --- | --- |
| Назначение | Принимает значения метрик вручную или через интеграции. Нормализует, индексирует, отвечает на запросы агрегатов. |
| Входы | metric_values_batch |
| Выходы | stored + aggregates |
| Инструменты | metrics-insert, metrics-query |
| Модель по умолчанию | —  (без LLM; чистая бизнес-логика) |
| Появляется | Ph3 |
| Метрика eval | Корректность агрегатов: 100% |

`Агент 35 · `**Forecaster**

| **Слой / группа** | **Метрики** |
| --- | --- |
| Назначение | Прогнозы 1/7/30 дней на временные ряды с доверительным интервалом. |
| Входы | metric_series + horizon |
| Выходы | { forecast_points, ci_low, ci_high, model_used, confidence } |
| Инструменты | ets-forecast, prophet (python через worker), arima |
| Модель по умолчанию | Claude Opus 4.7 — только для интерпретации, не для предсказания |
| Появляется | Ph7 |
| Метрика eval | MAPE ≤ 20% на 7-дневном горизонте по mood; CI coverage ≥ 0.80 |

`Агент 36 · `**Anomaly Detector**

| **Слой / группа** | **Метрики** |
| --- | --- |
| Назначение | Поднимает уведомления о значимых отклонениях: резкое падение настроения, всплеск расходов, пропуски привычек. |
| Входы | metric_series + thresholds |
| Выходы | [{ series, timestamp, kind, severity, suggested_action }] |
| Инструменты | ewma-anomaly, isolation-forest |
| Модель по умолчанию | —  (статистика преобладает); LLM-формулировка alert'а — Sonnet 4.6 |
| Появляется | Ph7 |
| Метрика eval | Precision ≥ 0.80 (не спамить ложными) |

# 11. Слои исследований, геймификации, импорта (агенты 37–44)

`Агент 37 · `**Research Assistant**

| **Слой / группа** | **Исследования** |
| --- | --- |
| Назначение | Ведёт литературные заметки с BibTeX/DOI-метаданными. Помогает с экстрактом тезисов из источников. |
| Входы | source (PDF/web/book chapter) |
| Выходы | literature_note .md с frontmatter (bibtex, doi, key_claims, methods, conclusions) |
| Инструменты | pdf-parse, crossref-lookup, citation-format |
| Модель по умолчанию | Claude Sonnet 4.6 (Ph5), Claude Opus 4.7 (для тяжёлых источников) |
| Появляется | Ph5 |
| Метрика eval | Точность извлечения BibTeX-полей ≥ 0.95; полнота извлечения тезисов rubric ≥ 4.0/5.0 |

`Агент 38 · `**Claim Tracker**

| **Слой / группа** | **Исследования** |
| --- | --- |
| Назначение | Выделяет тезисы (claims) и отслеживает поддерживающие и опровергающие источники. |
| Входы | literature_notes + new_source |
| Выходы | [{ claim, supports: [source_ids], contradicts: [source_ids], confidence }] |
| Инструменты | graph-query (claims), nli-classifier |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph5 |
| Метрика eval | NLI accuracy ≥ 0.80 на финансовой/биомедицинской выборке |

`Агент 39 · `**Argument Mapper**

| **Слой / группа** | **Исследования** |
| --- | --- |
| Назначение | Строит визуальные карты аргументов и контраргументов. Экспорт как граф. |
| Входы | claims + relations |
| Выходы | argument_graph (.graphml совместимый) |
| Инструменты | graph-build, layout-suggest |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph5 |
| Метрика eval | Структурная корректность графа vs ручная разметка ≥ 0.80 |

`Агент 40 · `**RPG Game Master**

| **Слой / группа** | **Геймификация** |
| --- | --- |
| Назначение | Начисляет XP за выполненные задачи, квесты, регулярные записи, привычки, инсайты. Поднимает уровни. Каждый XP объясним. |
| Входы | activity_event |
| Выходы | { xp_delta_per_attr: {...}, level_up?, new_class?, narrative_message? } |
| Инструменты | character-query, rpg-rules |
| Модель по умолчанию | Claude Haiku 4.5 (для narrative-сообщений), правила — без LLM |
| Появляется | Ph3 (basic), Ph7 (полный) |
| Метрика eval | User retention с включённым RPG ≥ 0.70 на 90 дней (proxy) |

`Агент 41 · `**Achievement Designer**

| **Слой / группа** | **Геймификация** |
| --- | --- |
| Назначение | Генерирует достижения на основе паттернов поведения и завершённых квестов. Прозрачные правила, без скрытой геймификации. |
| Входы | user_history + active_quests + character_state |
| Выходы | [{ achievement_name, criteria, current_progress, narrative }] |
| Инструменты | user-history-query, pattern-detect |
| Модель по умолчанию | Claude Sonnet 4.6 |
| Появляется | Ph7 |
| Метрика eval | User acceptance rate ≥ 0.60 |

`Агент 42 · `**Loot & Reward Agent**

| **Слой / группа** | **Геймификация** |
| --- | --- |
| Назначение | Поддерживает внутреннюю валюту «таблички мудрости» (Tuppi) — символическую, без real-money. Обмен на функциональные разблокировки и косметику. |
| Входы | achievement_unlocked \| quest_finished |
| Выходы | { tuppi_awarded, new_unlocks_available, narrative } |
| Инструменты | tuppi-query, unlocks-catalog |
| Модель по умолчанию | Claude Haiku 4.5 |
| Появляется | Ph7 |
| Метрика eval | Никаких deceptive patterns. Manual review всех unlocks-каталогов. |

`Агент 43 · `**Import Agent**

| **Слой / группа** | **Импорт** |
| --- | --- |
| Назначение | Обрабатывает импорт MD-vault'ов (Obsidian, Logseq, Roam, Notion-export, обычный MD). Разрешает wikilinks, сохраняет frontmatter. |
| Входы | uploaded_archive + format_hint? |
| Выходы | { imported_notes_count, resolved_links, errors } |
| Инструменты | format-detect, wikilink-resolve, frontmatter-parse |
| Модель по умолчанию | Claude Sonnet 4.6 (для разрешения неоднозначностей и format hints) |
| Появляется | Ph0 (basic), Ph2 (полный) |
| Метрика eval | Lossless round-trip для Obsidian vault: ≥ 99.5% содержимого, 100% wikilinks |

`Агент 44 · `**MCP Bridge Agent**

| **Слой / группа** | **Импорт** |
| --- | --- |
| Назначение | Подключает внешние сервисы (calendar, health, banking, fitness) через MCP. Полученные данные интегрирует как сущности/события в граф знаний. |
| Входы | mcp_event_or_query |
| Выходы | structured entities/events for ingestion |
| Инструменты | mcp-client |
| Модель по умолчанию | Claude Sonnet 4.6 (для интерпретации специфичных полей внешних сервисов) |
| Появляется | Ph7 |
| Метрика eval | Точность интеграции (поля корректно мэппятся) ≥ 0.95 на эталонных MCP-серверах |

# 12. Версионирование промптов и eval-проводка

1. Каждый промпт — файл prompt.md в директории агента. История — prompt.v1.md, prompt.v2.md..., immutable.
1. При коммите prompt.md записывается prompt_hash = sha256(content). В audit_log каждого вызова — этот hash.
1. PR с изменением prompt.md обязательно запускает eval-suite агента. Падение метрики > 5% от baseline (последний green-build на main) — CI красный.
1. baseline хранится в evals/baselines/<agent>.json и обновляется автоматически при merge в main.
1. Eval-suite агента запускается также по cron раз в неделю на проде против актуальной модели — выявление дрейфа.

# 13. Контракт безопасности агентов

1. Категория visibility передаётся в Runtime Context. Mastra-router выбирает провайдера на основании visibility и конфигурации агента.
1. Для visibility=private — провайдер ollama_local. Если Ollama недоступен — задача помечается как deferred, ошибка возвращается через очередь.
1. Для visibility=vault — клиент дешифрует только при открытии; конвейер на сервере не запускается. Конвейер на локальном Tauri-runtime.
1. Каждый агент-выход проходит через Critic (#3). Critic блокирует выходы с обнаруженными нарушениями приватности.
1. Терапевтические агенты (#24–#28) — отдельный класс. Изменения их промптов требуют human review (см. SRS NFR-3010, backlog metaправила).
