# NABU

*Test & Eval Strategy*  
*Стратегия тестирования*  
*Пирамида тестов + методология evaluation для LLM-агентов*  
*Версия 1.0*  

---

# 1. Назначение

Документ фиксирует стратегию верификации Nabu. Покрывает: классические тесты (unit, integration, e2e, performance, security), а также evaluation LLM-агентов — отдельный класс работы, неприменимый к обычному testing-подходу.

Документ — нормативный. CI-конфигурация и gating-политики из него выводятся напрямую.

# 2. Пирамида тестов и целевые показатели

| **Уровень** | **Доля** | **Целевое покрытие** | **Назначение и инструменты** |
| --- | --- | --- | --- |
| Unit | ~ 60% | ≥ 70% lines, ≥ 80% branches для core/ | Бизнес-логика, схемы, утилиты. Vitest. Без I/O — моки на границах модулей. |
| Integration | ~ 25% | Все NestJS-модули + ключевые межмодульные сценарии | Vitest + Testcontainers (Postgres, TypeDB, MinIO). Реальные БД, не моки. |
| E2E | ~ 10% | 20-30 пользовательских сценариев | Playwright. Прогон через UI на эфемерном environment, который поднимается в CI. |
| Eval (LLM) | ~ 5% | ≥ 200 примеров на агента | Кастомный runner (Vitest matchers). Golden datasets. Метрики per agent type. См. §6. |

Пропорции — ориентир. Главное — каждый уровень закрывает то, что выше/ниже не может: e2e не заменяет unit на edge case'ы, eval не заменяет integration на CRUD.

# 3. Тулчейн

| **Категория** | **Инструмент и обоснование** |
| --- | --- |
| Test runner | Vitest. Совместим с TS-first; быстрый; HMR на dev; coverage из коробки (v8/istanbul). |
| Mocking | vi.mock + msw (mock service worker) для HTTP. Никаких ad-hoc mocks внутри файлов — выносить в /tests/mocks/. |
| Containers | Testcontainers-node. Поднимает Postgres + TypeDB + MinIO + Redis (опц.) для каждого integration-теста или suite. |
| E2E | Playwright. Кросс-браузер (chromium, firefox, webkit), trace + видеозапись при падении. |
| Property-based | fast-check для свойственных тестов парсеров, sync-логики, conflict resolution. |
| Mutation testing | Stryker. Запускается раз в неделю на main, не на каждом PR (медленный). |
| Performance | k6. Сценарии под нагрузкой против эфемерного environment. |
| Security SAST | CodeQL (GitHub Advanced Security), Semgrep с пресетом owasp-top-10. |
| Security DAST | OWASP ZAP в baseline-режиме на staging; полный scan — еженедельно. |
| Dependency scan | Trivy (контейнерные образы) + npm audit / bun audit + Snyk (опц.). |
| Eval (LLM) | Кастомный runner на Vitest matchers + опционально Mastra evals (когда стабилизируется). |
| Visual regression | Playwright snapshots с порогом 0.5% pixel-diff. Минималистично — не пытаемся покрыть всё UI. |

# 4. Unit-тесты

## 4.1. Что тестируем

- Чистые функции (валидаторы, парсеры, формат-конвертеры).
- Pure-домен логика (формулы XP, lamport-ts compare, merge-алгоритм без БД).
- Service-методы NestJS — изолированные через DI с замоканными provider'ами.
- Zod-схемы — на нормальные/невалидные входы.

## 4.2. Что НЕ тестируем на unit-уровне

- Реальные обращения к БД — это integration.
- LLM-вызовы — это eval.
- End-to-end сценарии через UI — это e2e.

## 4.3. Конвенции

- Файлы: <module>.test.ts рядом с <module>.ts.
- Структура: AAA (Arrange-Act-Assert), один логический сценарий на test().
- Никаких глобальных моков. Каждый тест поднимает свой контекст.
- Snapshot-тесты — только для стабильных структурированных выходов (frontmatter rendering); запрещены для произвольных строк и UI.

## 4.4. Покрытие

- packages/core, packages/markdown, packages/sync — обязательное покрытие ≥ 80% по линиям.
- apps/api, apps/worker — общее покрытие ≥ 70%; критические маршруты (auth, sync, notes CRUD) — ≥ 90%.
- packages/agents — coverage не имеет смысла как метрика (большая часть — конфигурация). Главное — eval. Однако tools/, schemas/ и helpers/ внутри — должны покрываться обычным образом.
- packages/ui — coverage не самоцель; для базовых компонентов ≥ 60%.

# 5. Integration-тесты

## 5.1. Подход

Поднимается реальный Postgres (с применёнными миграциями), TypeDB, MinIO через Testcontainers. Тестируются NestJS-сервисы в их естественной среде. Один testcontainer-набор на test suite (beforeAll); чистка данных — beforeEach.

## 5.2. Что проверяем

- CRUD-сценарии полным циклом (API → service → DB → response).
- RLS-политики Postgres: тест от лица user_A пытается читать/писать данные user_B — должно вернуть 0 строк или 403.
- Sync-протокол: симулируем outbox-батчи, проверяем разрешение конфликтов, идемпотентность op_id.
- Очереди pgmq: ставим сообщение, проверяем что worker его взял и обработал; падение worker'а на середине → возврат сообщения после visibility-timeout.
- TypeDB-операции: insert сущностей, query, schema-introspect.

## 5.3. Тестовые данные

- Фикстуры — в /tests/fixtures/, версионируются в git.
- Factory functions для генерации (через @faker-js/faker).
- Никаких production-данных в тестах. Никаких реальных персональных данных.
- Большие фикстуры (≥ 100 заметок) — генерируются на лету скриптом, не хранятся.

# 6. Evaluation LLM-агентов

## 6.1. Принципиальные отличия от обычных тестов

- Недетерминизм: тот же промпт + та же модель → разные ответы. Метрики не Pass/Fail, а пороги/распределения.
- Дрейф моделей: эталонная метрика на одной модели не переносится на другую. Каждое изменение модели — новый baseline.
- Дороговизна: каждый eval-прогон стоит токены. Не стоит запускать на каждом коммите для всех агентов.
- Невозможность 100% покрытия: golden датасеты — выборка. Дополнение — LLM-as-judge с человеческой проверкой.

## 6.2. Структура золотого датасета

Формат: JSONL. Каждая строка — один пример:

```
{
  "id": "ent-eval-0001",
  "input": {
    "text": "Завтра встреча с Иваном по проекту Феникс в 15:00",
    "context": { "now": "2026-05-20T08:00:00Z" }
  },
  "expected": {
    "entities": [
      { "type": "person", "surface_form": "Иван", "canonical_form": "person_unknown" },
      { "type": "project", "surface_form": "Феникс", "canonical_form": "project_phoenix" },
      { "type": "datetime", "surface_form": "завтра в 15:00", "resolved": "2026-05-21T15:00:00Z" }
    ]
  },
  "tags": ["datetime", "single_person", "single_project"],
  "difficulty": "easy",
  "source": "synthetic" | "real_anonymized"
}
```

## 6.3. Метрики per agent type

Каталог метрик задан в документе 09 (Agent Catalog, §2.4). Здесь — нормативные пороги (примеры; полный список в каждом agent README):

| **Агент** | **Метрики и пороги** |
| --- | --- |
| Entity Extractor | F1 macro ≥ 0.85; precision per type ≥ 0.80; recall per type ≥ 0.75 |
| Triage | Top-1 accuracy ≥ 0.85; top-2 ≥ 0.95; macro-F1 ≥ 0.80 |
| Affect Analyzer | MAE(valence) ≤ 0.2; MAE(arousal) ≤ 0.25; distortions precision @0.7 ≥ 0.75 |
| Linker | Recall@10 ≥ 0.70; precision@5 ≥ 0.80; nDCG@10 ≥ 0.75 |
| Document Synthesizer | Rubric 4 шкалы (точность, структура, полнота, стиль) ≥ 4.0/5.0 от LLM-as-judge + ≥ 80% совпадение с человеческой выборкой |
| Critic | Precision @synthetic_errors ≥ 0.85; Recall @synthetic_errors ≥ 0.75 |
| CBT/Gestalt/DBT/ACT/IFS | Protocol compliance rubric ≥ 4.0/5.0 от психолога-консультанта на 50 кейсах; disclaimer present @ 100% |

## 6.4. Baseline и регрессии

1. Baseline — последний результат eval-suite на main с известными model_version + prompt_version.
1. baseline хранится в evals/baselines/<agent>.json как { metrics, timestamp, model_version, prompt_hash, commit_sha, sample_size }.
1. На каждом PR с изменением prompt.md или конфигурации агента: eval-suite запускается заново; результаты сравниваются с baseline.
1. Gate: падение метрики > 5% от baseline — CI красный. Можно перекрыть human reviewer'ом с явным обоснованием в PR.
1. После merge — baseline автоматически обновляется.

## 6.5. LLM-as-judge

- Используется для генеративных задач, где автоматических метрик нет (Document Synthesizer, Insight, Coach).
- Судья — Claude Opus 4.7 с rubric-промптом и явными критериями.
- Калибровка: на ≥ 80% примеров judge должен сходиться с человеческой оценкой (тестовая выборка ≥ 50 примеров).
- При расхождении — судья помечается как невалидный, eval приостанавливается до настройки.

## 6.6. Прод-мониторинг качества

- В прод-выходах агентов опционально показывается кнопка 👍/👎.
- Аггрегация в dashboards: thumbs-down rate per agent / per day.
- Резкий рост thumbs-down (z-score ≥ 2) → alert; запускается ретеспективный eval.
- Случайная выборка 1% prod-выходов отправляется в eval-pipeline для измерения дрейфа без участия пользователя.

# 7. End-to-end тесты

## 7.1. Сценарии

- Регистрация → создание первой заметки → запуск конвейера → проверка появления entities в графе.
- Импорт MD-vault из 100 файлов → проверка корректности wikilinks и tags.
- Создание привычки → лог за 7 дней → проверка streak и XP.
- Therapy session: открытие, диалог 5 turns, закрытие, проверка что content не утёк в audit.
- Mobile: quick capture → синхронизация → появление на desktop.
- Conflict resolution: одновременная правка на двух эмулируемых клиентах → проверка LWW + conflict-suspended.

## 7.2. Среда

- Эфемерный environment поднимается в GitHub Actions через docker-compose.
- Чистый instance per workflow run.
- LLM-вызовы в e2e: используется отдельный мок-провайдер (deterministic-mock), который возвращает фиксированные ответы по hash от промпта. Это НЕ заменяет eval — это про инфраструктурные тесты.
- Для нескольких ключевых e2e (тяжёлый синтез) — реальный LLM с ограниченным бюджетом и обязательной кэшировкой ответа.

# 8. Performance & Load testing

## 8.1. Ключевые сценарии

| **Сценарий** | **Цель** |
| --- | --- |
| Inbox load | p95 ≤ 300 мс для пользователя с 5000 заметок |
| Semantic search | p95 ≤ 800 мс для пользователя с 50 000 заметок |
| Full pipeline | p95 ≤ 30 с от создания до полного обогащения |
| Sync push (batch 50 ops) | p95 ≤ 2 с |
| TypeDB graph query (depth 3) | p95 ≤ 500 мс на корпусе 100k сущностей |
| Document Synthesizer | p95 ≤ 120 с |

## 8.2. Профиль нагрузки

- Single-user concurrent: 10 одновременных запросов на одного пользователя (типично 1-3, верх — 10).
- Multi-user staged: 100 одновременных пользователей при self-host SaaS-deploy (если применимо).
- Spike test: x5 базовая нагрузка в течение 5 минут — система не должна валиться, latency деградирует плавно.

# 9. Security testing

## 9.1. SAST/secret scanning

- CodeQL на каждый PR. Categories: javascript, typescript.
- Semgrep с пресетом owasp-top-10 и nestjs.
- gitleaks (или trufflehog) для предотвращения утечки секретов в commit.

## 9.2. Dependency scanning

- Trivy на каждый Docker-образ при сборке. Critical CVE — fail сборки.
- bun audit / npm audit на каждый PR. High и Critical — блокируют.
- Renovate-bot для еженедельных обновлений зависимостей.

## 9.3. DAST

- OWASP ZAP baseline scan на staging — еженедельно.
- ZAP full scan — раз в месяц на dedicated test-environment.

## 9.4. Penetration testing

- Раз в год (для production deployments) — внешний penetration test, обязателен для multi-tenant SaaS.
- Для self-host — рекомендован, но не обязателен. Чек-лист самостоятельной проверки в Ops Runbook.

## 9.5. Privacy-specific tests

1. Автоматический тест: создаём заметку с visibility=private, запускаем конвейер, проверяем audit_log — в нём ДОЛЖНЫ быть только записи provider=ollama. Любой external provider — fail теста.
1. Автоматический тест: создаём заметку с visibility=vault, проверяем что в Postgres хранится только шифротекст; пытаемся расшифровать без ключа — fail.
1. Автоматический тест: запрашиваем удаление аккаунта, ждём cooldown, проверяем purge — во всех таблицах user_id отсутствует.
1. Автоматический тест: экспорт пользователя; в zip присутствуют все .md, frontmatter, граф-снимок, метаданные. Содержимое vault — только если ключ предоставлен.

# 10. CI pipeline

## 10.1. На каждый PR

```
Параллельно:
  ├─ lint        (eslint + prettier --check)         < 2 мин
  ├─ typecheck   (tsc --noEmit, projectReferences)   < 3 мин
  ├─ unit        (vitest --coverage)                  < 5 мин
  ├─ integration (vitest + testcontainers)            < 10 мин
  ├─ security    (codeql + semgrep + trivy + audit)   < 8 мин
  └─ eval        (только для затронутых агентов)      < 15 мин
```

```
Затем (последовательно после остальных):
  └─ e2e         (playwright, эфемерный env)          < 20 мин
```

## 10.2. Гейтинг merge

- Все required-jobs — зелёные. Required: lint, typecheck, unit, integration, security.
- eval-on-PR обязателен, если в diff есть packages/agents/<agent>/prompt.md или config.
- e2e обязателен на main; для feature-веток — по тегу e2e-required.
- Coverage delta: -2% от baseline → требует обоснования в PR-описании.
- Human review: ≥ 1 approver. Для PR в packages/agents/<therapy>/, security-related, схемы БД — обязательны 2 approver'а, один — security/safety reviewer.

## 10.3. Расписание (cron-jobs в CI)

| **Job** | **Расписание / триггер** |
| --- | --- |
| Mutation testing | Раз в неделю на main, Stryker, на packages/core |
| Full e2e suite | Каждый push на main + раз в день на main |
| Eval всех агентов на проде (drift detection) | Раз в неделю |
| DAST baseline scan на staging | Раз в неделю |
| Dependency updates (Renovate) | Раз в неделю |
| Container image rebuild с обновлёнными base | Раз в две недели |

# 11. Definition of Ready и Definition of Done для тестов

## 11.1. DoR для feature-PR

1. В description PR указаны acceptance criteria из backlog'а (US-NN.NN.NN).
1. В PR есть план тестов: какие unit, какие integration, какие e2e.
1. Если затронут агент — указано, обновлён ли eval-набор.
1. Если затронуты схемы данных — приложены миграции и тесты для них.

## 11.2. DoD для feature-PR

1. Все required-jobs зелёные.
1. Покрытие на затронутых файлах не упало > 2% от baseline.
1. Все acceptance criteria из связанного US покрыты хотя бы одним тестом.
1. Документация (README пакета, JSDoc публичных API) обновлена.
1. Если затронут промпт — обновлён prompt.vN.md в исторических версиях.
1. Если затронут API — обновлён OpenAPI; типы api-client регенерированы.

# 12. Управление тестовыми данными

- Каждый агент имеет свой eval-набор в tests/evals/<agent>/golden.jsonl. Версионируется в git.
- Большие наборы (≥ 1 МБ) — через Git LFS или DVC.
- Real-world data в evals — только анонимизированная (имена → синтетика, даты → сдвиг, локации → общие).
- Eval-наборы для терапевтических агентов — отдельная процедура: либо синтетика, согласованная с консультантом, либо данные с явным consent.
- Production не используется как источник eval-данных кроме случайной 1%-выборки с opt-in.
