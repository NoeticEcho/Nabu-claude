# NABU

*Engineering Standards & Development Handbook*  
*Стандарты разработки*  
*Структура · Ветки · PR · Стиль · Зависимости · Документация*  
*Версия 1.0*  

---

# 1. Назначение

Документ — справочник по соглашениям и стандартам инженерной работы над Nabu. Адресован прежде всего AI-команде разработки через Aperant. Любое отклонение от стандартов должно быть обосновано в PR и обсуждено с reviewer'ом.

Документ нормативный. PR, нарушающие стандарты, должны быть исправлены или отвергнуты.

# 2. Структура монорепо

Каноническая структура (повторяется из SAD §4.6.1 для удобства).

```
nabu/
├── apps/
│   ├── api/            — NestJS HTTP API
│   ├── worker/         — NestJS worker (pgmq consumer)
│   ├── web/            — Next.js App Router
│   ├── desktop/        — Tauri 2.x desktop wrapper
│   └── mobile/         — Tauri 2.x mobile wrapper
├── packages/
│   ├── core/           — shared types, utils, validators (zero deps на ноды/реакт)
│   ├── agents/         — Mastra agents, tools, prompts
│   ├── db/             — Postgres migrations, типы, sqlx-клиент
│   ├── typedb/         — TypeDB schemas, migrations, query builders
│   ├── sync/           — sync engine (outbox/inbox, merge)
│   ├── ui/             — React components, дизайн-токены
│   ├── editor/         — Tiptap расширения
│   ├── markdown/       — .md + frontmatter parser/writer
│   └── api-client/     — типизированный клиент NestJS API
├── infra/
│   ├── supabase/       — docker-compose Supabase
│   ├── caddy/          — reverse proxy config
│   ├── monitoring/     — Prometheus, Grafana (опц.)
│   └── scripts/        — make-команды, утилиты
├── tests/
│   ├── evals/<agent>/  — eval-наборы агентов
│   └── e2e/            — Playwright тесты
├── docs/               — ADR, runbook, dev handbook (этот документ)
├── .github/workflows/  — CI/CD
├── docker-compose.yml
├── package.json        — root workspace
├── bun.lock
├── turbo.json
└── tsconfig.base.json
```

## 2.1. Правила

1. Жёсткое правило: apps зависят только от packages. packages не зависят от apps. Циклы запрещены, проверяются madge на CI.
1. packages/core — самый базовый. Не зависит ни от чего, кроме TS стандартной библиотеки и Zod.
1. Любой новый код помещается в существующий пакет, если подходит. Новый пакет создаётся только если функциональность переиспользуется ≥ 2 приложениями.
1. Каждый пакет имеет: package.json, README.md, src/index.ts (единая публичная точка), tests/.

# 3. Стек и версии

| **Инструмент** | **Версия** | **Заметки** |
| --- | --- | --- |
| Node.js | ≥ 22 LTS | Только для CI и инструментов; runtime — bun |
| Bun | ≥ 1.2 | Package manager и runtime для apps/api, apps/worker |
| TypeScript | ≥ 5.5 | strict mode обязателен |
| NestJS | ≥ 10.x | С @mastra/nestjs |
| Next.js | ≥ 14 (App Router) | RSC + Client Components |
| Tauri | ≥ 2.0 | Desktop + mobile |
| Docker Engine | ≥ 24 | Compose v2 |
| PostgreSQL | 16+ | Supabase-managed version |
| TypeDB | 3.x Community | self-hosted |
| pgvector | ≥ 0.7 | HNSW индекс |
| Vitest | ≥ 2.x | Test runner |
| Playwright | ≥ 1.45 | E2E |
| ESLint | ≥ 9 | Flat config |
| Prettier | ≥ 3.x | — |
| Husky / lint-staged | current | pre-commit hooks |

Версии обновляются согласованно. PR с обновлением мажорной версии любого из этого списка — отдельный, изолированный, с тщательным review.

# 4. Git и ветки

## 4.1. Стратегия — trunk-based

- Главная ветка: main. Всегда деплоебельная.
- Feature-ветки — короткоживущие (≤ 3 дня), от main, мерж обратно в main через PR.
- Release-ветки — только для патчей старых мажорных версий (поддержка self-host пользователей).
- Никаких develop-ветвей. Никаких feature-flag-ветвей.

## 4.2. Имена веток

| **Префикс** | **Назначение** |
| --- | --- |
| feat/ | Новая функциональность. feat/E-04-quest-master |
| fix/ | Багфикс. fix/US-01-04-02-version-diff-crash |
| chore/ | Рутина — обновление зависимостей, рефакторинг без изменения поведения |
| docs/ | Только документация |
| test/ | Только тесты (без production-кода) |
| perf/ | Изменение производительности |
| sec/ | Security fix |

В имя ветки рекомендуется включать ID связанной user story (US-NN.NN.NN) или эпика.

## 4.3. Commit messages — Conventional Commits

Формат: <type>(<scope>): <short description>

```
Допустимые типы:
- feat, fix, perf, refactor, docs, test, chore, build, ci, sec
```

```
Scopes (примеры):
- api, worker, web, desktop, mobile
- agents/<agent-name>
- db, typedb, sync, ui, editor
```

```
Примеры:
feat(agents/cbt): add disclaimer to all therapy outputs (US-05.03.01)
fix(sync): correct lamport timestamp comparison for tie-break
docs(adr): add ADR-016 about conductor parallelism
test(agents/entity): expand eval set to 250 examples
```

В теле коммита, если необходимо, — обоснование, ссылки на User Story, breaking-changes.

commitlint enforces format. PR с невалидными коммитами — fail CI.

## 4.4. Rebase vs merge

- Внутри feature-ветки — squash before merge. Каждый PR попадает в main одним atomic commit'ом.
- На main — линейная история (rebase merge). Никаких merge-bubbles.
- При конфликтах с main — rebase feature-ветки на main, force-push (это feature-ветка, force-push разрешён).

# 5. Pull Requests

## 5.1. Описание PR (обязательные поля)

```
### What
Краткое описание изменения, 1-3 предложения.
```

```
### Why
Ссылка на user story (US-NN.NN.NN) или эпик. Связь с FR/NFR из SRS.
```

```
### How
Краткий обзор подхода. Ключевые архитектурные решения.
```

```
### Testing
- Unit tests: [список новых]
- Integration: [новые сценарии]
- Eval (для агентов): [результаты]
- E2E: [если применимо]
```

```
### Breaking changes
[если есть — описать; иначе "None"]
```

```
### Security/Privacy considerations
[если затронуто — описать; иначе "N/A"]
```

```
### Checklist
- [ ] Tests added/updated
- [ ] Docs updated
- [ ] OpenAPI updated (если API)
- [ ] ADR added (если новое архитектурное решение)
- [ ] Eval-suite updated (если затронуты агенты)
- [ ] Migration tested (если затронуты схемы)
```

## 5.2. Размер PR

- Целевой размер: ≤ 400 изменённых строк (включая тесты, без учёта lockfile).
- PR > 1000 строк — нужно разбивать. Reviewer вправе запросить разбиение.
- Исключения: автогенерируемый код, миграции с большой initial schema, lockfile-обновления, генерация типов из OpenAPI.

## 5.3. Reviewers

| **Категория изменений** | **Кто ревьюит** |
| --- | --- |
| Обычная feature | 1 reviewer из core team |
| Изменения в packages/agents/<therapy>/ | 1 core + 1 safety/security reviewer |
| Изменения в security-сервисах (auth, RLS, encryption) | 1 core + 1 security reviewer |
| Изменения схем БД (migrations) | 1 core + 1 backend reviewer |
| Breaking API changes | 1 core + 1 frontend (если затрагивает клиенты) |
| Изменения промптов агентов | 1 core (с обязательным просмотром eval-результата) |

## 5.4. Сроки

- Reviewer должен дать ответ в течение 1 рабочего дня. Если не успевает — переадресовать.
- Автор PR — реагирует на комментарии в течение 1 рабочего дня.
- PR без активности > 5 рабочих дней — закрывается с пометкой stale. Если работа продолжается — открыть новый.

## 5.5. Что НЕ принимается в PR

- Изменения promtпов без обновления eval-suite.
- Изменения схем БД без миграций и тестов миграций.
- Изменения API без обновления OpenAPI и регенерации типов.
- Нарушения конвенций без обоснования.
- Закомментированный 'dead code' — удалить.
- TODO без owner и срока ('TODO: fix this later' — нет; 'TODO(@username, 2026-06): refactor after E-04 lands' — да).
- console.log без удаления (используйте структурированный logger).
- Реальные секреты в коде или конфигах.

# 6. TypeScript: соглашения

## 6.1. tsconfig

- strict: true (включает strictNullChecks, noImplicitAny и др.).
- noImplicitOverride: true.
- noUncheckedIndexedAccess: true (защита от undefined из array/dict access).
- exactOptionalPropertyTypes: true.
- Никаких any в публичных API. unknown допустим, но требует narrowing.
- ts-ignore запрещён. ts-expect-error — только с явным комментарием с обоснованием.

## 6.2. Naming

| **Категория** | **Стиль** |
| --- | --- |
| Файлы | kebab-case: project-passport-synthesizer.ts |
| Папки | kebab-case: agents/therapy-cbt/ |
| Переменные, функции | camelCase: noteId, getUserById |
| Типы, классы, интерфейсы | PascalCase: UserSession, NoteVersion. Никаких I-префиксов (interface IUser → User) |
| Константы (env, true const) | SCREAMING_SNAKE_CASE: MAX_RETRY_COUNT, ANTHROPIC_API_KEY |
| Enum values | PascalCase: VisibilityCategory.Private |
| React components | PascalCase: NoteEditor, BackLinks |
| Hooks | useCamelCase: useNoteSync |
| DB колонки и поля API | snake_case: created_at, user_id (отображение в TS — camelCase через map-layer) |

## 6.3. Imports/exports

- Только named exports. default exports запрещены кроме Next.js page/route и React lazy.
- Path aliases через tsconfig paths: @/components, @nabu/core, @nabu/agents.
- Относительные импорты — только внутри одного пакета и не глубже одного уровня (../ — да, ../../ — пересмотреть структуру).
- Side-effect impurts (import 'something') запрещены кроме polyfills и зарегистрированных reflection-метаданных NestJS.

## 6.4. Структура файла

```
// 1. imports — внешние, внутренние через path-alias, относительные
import { z } from 'zod';
import { type Note } from '@nabu/core';
import { calculateXp } from './xp-calculator';
```

```
// 2. types и interfaces
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;
```

```
// 3. constants
const MAX_TITLE_LENGTH = 200;
```

```
// 4. schemas (zod)
export const CreateNoteSchema = z.object({ ... });
```

```
// 5. реализация — функции и классы
export function createNote(input: CreateNoteInput): Note { ... }
```

## 6.5. Ошибки

- Никаких throw 'string'. Только throw new Error() (или подкласс).
- Иерархия кастомных ошибок в packages/core/errors: ValidationError, NotFoundError, ForbiddenError, ConflictError, ServerError, LlmUnavailableError.
- NestJS exception filters автоматически конвертируют их в нужный HTTP response (см. API spec §2.5).
- Никаких 'silent catch'. Если catch — то либо обработка, либо повторный throw.

# 7. React: соглашения

## 7.1. Структура

- Один компонент — один файл.
- Файлы рядом: component.tsx, component.module.css (если CSS-modules), component.test.tsx.
- Story для шаблонов — рядом: component.stories.tsx (если используется Storybook).

## 7.2. Props и типы

- Тип props называется ComponentNameProps.
- Никаких inline-типов в сигнатуре — выноси.
- Boolean-props без отрицания: isVisible, не isHidden.
- Callback'и: onActionName (onNoteSave, onError).

## 7.3. Hooks

- Custom hooks — в hooks/ внутри пакета или модуля.
- Имена: useThing. Возвращают объект или кортеж по conventional pattern.
- useEffect — с обязательным dep-array. Никаких [] без объяснения.
- Никаких useEffect для синхронной деривации — выносить в useMemo или просто let derived = ...

## 7.4. Состояние

- Локальное — useState/useReducer.
- Сетевое — TanStack Query (react-query). Не fetch напрямую в компонентах.
- Кросс-компонентное состояние — Zustand или React Context (предпочтение Zustand).
- Никакого Redux без обоснования.

## 7.5. Стилизация

- Tailwind CSS как основной.
- Дизайн-токены — через CSS-переменные в @nabu/ui/tokens.
- Никаких inline-style объектов кроме динамических (transform: translateX(${x}px)).
- Никакого CSS-in-JS. Tailwind покрывает 99% кейсов.

# 8. Тесты: конвенции

Полная стратегия — в документе 10. Здесь — конвенции написания.

## 8.1. Расположение

- Unit: рядом с файлом — module.ts + module.test.ts.
- Integration: tests/integration/ в пакете.
- E2E: /tests/e2e/ в корне.
- Evals: /tests/evals/<agent>/golden.jsonl + runner.ts.

## 8.2. Названия

```
describe('createNote', () => {
  it('создаёт заметку с минимальным набором полей', async () => { ... });
```

```
  it('бросает ValidationError на пустой title', async () => { ... });
```

```
  describe('при visibility=private', () => {
    it('не вызывает cloud-LLM провайдеров', async () => { ... });
  });
});
```

Описания читаются как русские предложения. Никаких 'should...', 'returns...' без подлежащего. Тест должен описывать поведение системы.

## 8.3. Моки

- Моки описываются в /tests/mocks/ как переиспользуемые. Никаких inline-mocks с magic-логикой.
- Никаких HTTP в unit-тестах. Используется MSW для мокирования fetch.
- Никаких реальных LLM-вызовов в unit/integration. Только в eval.

# 9. Документация

## 9.1. README каждого пакета

Обязательный README.md в каждом packages/* и apps/*. Структура:

```
# @nabu/<package-name>
```

```
Краткое назначение (1-2 предложения).
```

```
## Public API
```

```
Список ключевых экспортов с их назначением.
```

```
## Usage
```

```
Пример использования (короткий).
```

```
## Dependencies
```

```
Внутренние пакеты, от которых зависит.
```

```
## Tests
```

```
Краткое описание test-strategy для этого пакета.
```

## 9.2. JSDoc / TSDoc

- Публичные API (экспорты из src/index.ts) — обязательно JSDoc с описанием, @param, @returns.
- Внутренние функции — JSDoc по необходимости, если поведение неочевидно.
- Сложные алгоритмы (например, merge в sync) — обязательно обширный комментарий с обоснованием подхода и ссылкой на ADR.

## 9.3. ADR-триггеры

Когда обязательно создаётся ADR (см. документ 06):

1. Выбор технологии/библиотеки, имеющий долгосрочные последствия.
1. Изменение в чисто архитектурном уровне (схемы, протоколы, контракты).
1. Пересмотр существующего ADR (supersedes).
1. Изменение в security-модели.
1. Изменение в data classification или privacy-роутинге.

## 9.4. Inline-комментарии

- Объясняют ПОЧЕМУ, не ЧТО (что — видно из кода).
- Полезные комментарии: // edge-case: пользователь сменил пароль во время push-операции.
- Бесполезные: // increment counter (если строка counter++).
- TODO/FIXME — только с owner и срокам: // TODO(@username, 2026-06-30): handle ...

# 10. Зависимости

## 10.1. Добавление новых зависимостей

1. Прежде чем добавлять — проверить, не покрыто ли уже в core/utils, lodash, существующих deps.
1. Новая зависимость требует ADR (или короткое обоснование в PR-description, если простая).
1. Критерии для допуска: активная поддержка (последний commit < 12 месяцев), > 1000 weekly downloads npm, явная лицензия (MIT/Apache/ISC/BSD), нет известных CVE.
1. Запрещены: GPL, AGPL (за исключением dev-tooling), proprietary, ленцензии с unclear redistribution rights.

## 10.2. Версионирование

- Все версии — точные (^ запрещён для production-deps; ^ допустим для dev-deps).
- Renovate-bot предлагает обновления раз в неделю.
- Security-обновления (critical/high CVE) применяются в течение 7 дней.

## 10.3. Lockfile

- bun.lock в git. Обязательно.
- При конфликте — bun install и коммит результата (не разрешать руками).

# 11. Логирование и observability

## 11.1. Logger

- В NestJS: pino-pretty в dev, JSON в production.
- Уровни: trace, debug, info, warn, error, fatal.
- Никаких console.log в production-коде. Только logger.* со структурированными полями.

## 11.2. Что логируем (и что НЕ логируем)

- Логируем: start/finish важных операций, ошибки с stack, метрики (длительность, размеры).
- НЕ логируем: пароли, JWT-токены, refresh-токены, полные payload'ы LLM-вызовов, содержимое vault-заметок, e-mail (для GDPR).
- PII в логах: только user_id (uuid). Email — НЕТ.

## 11.3. Trace context

- Каждый запрос получает trace_id (uuid v7), который пропагируется через все вызовы NestJS → worker → LLM.
- Логи во всех сервисах включают trace_id для cross-сервисного поиска.
- Опционально (через OPENTELEMETRY_ENABLED=true) — экспорт в Jaeger/Tempo.

# 12. Performance: рутинные правила

- Никаких SELECT * в горячих путях. Указывать колонки.
- Все запросы в горячих путях имеют индекс. Проверка через EXPLAIN ANALYZE в integration-тестах.
- Pagination обязательна для любого GET-списка, max page size = 100.
- React: memo и useMemo — только когда есть измеренная проблема, не профилактически.
- Bundle size мониторится через size-limit; превышение > 10% от baseline — fail CI.

# 13. Accessibility (a11y)

Целевой уровень — WCAG 2.2 AA.

- Все интерактивные элементы доступны с клавиатуры.
- Контрастность ≥ 4.5:1 для обычного текста, ≥ 3:1 для крупного.
- Alt-text обязателен для всех изображений (или явный role="presentation").
- Form-controls имеют связанные labels.
- Skip-links и landmarks (header, nav, main, footer).
- Поддержка reduced-motion для пользователей с prefers-reduced-motion.
- aXe-core или Pa11y в CI как линтер — fail на critical.

# 14. Internationalization (i18n)

- Основные языки на старте: ru, en. Архитектурно — любое число.
- Структура: packages/ui/locales/<lang>.json + apps/web/locales/<lang>.json.
- Использование: next-intl на web, react-intl-format в Tauri.
- Никаких хардкод-строк в коде. Каждая строка — через t('keys.path').
- Даты, числа — через Intl.DateTimeFormat, Intl.NumberFormat.
- Pluralization — через ICU MessageFormat.

# 15. Tooling и editor settings

## 15.1. .editorconfig

```
root = true
```

```
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

```
[*.md]
trim_trailing_whitespace = false
```

## 15.2. VSCode settings

- Расширения (recommended): ESLint, Prettier, Vitest, GitLens, Error Lens, TypeScript Next.
- .vscode/settings.json — формат-on-save включён; ESLint auto-fix on save включён; tab-size 2.
- .vscode/extensions.json содержит список рекомендованных.

## 15.3. Pre-commit hooks (Husky)

1. commitlint — проверка формата commit message.
1. lint-staged — eslint --fix + prettier --write на staged-файлах.
1. typecheck — быстрая tsc на изменённых файлах.
1. gitleaks — проверка на утечку секретов.

# 16. Метаправила для AI-команды

1. Сначала прочитайте все референсы в задаче (US, FR, NFR, ADR, релевантные пакеты). Не начинайте писать код, пока не сложилась полная картина.
1. Если требование в SRS противоречит acceptance criteria в backlog — приоритет SRS. Подайте противоречие в PR-комментарии, не пытайтесь решить молча.
1. Если решение требует выбора между несколькими подходами — добавьте ADR или короткую секцию в PR-description с обоснованием.
1. Если acceptance criteria недостижимы из-за внешних причин — оформите это явно, не маскируйте mock'ами в проде.
1. Тесты пишутся одновременно с кодом, не после. Если задача без тестов — попросите уточнение.
1. При работе с агентами — всегда обновляйте eval-набор. PR с изменением промпта без обновления eval — отклоняется.
1. Никаких введения новых зависимостей без обоснования.
1. Принцип «no surprises»: каждое поведение системы должно объясняться. Если объяснить невозможно — добавьте observability.
1. При сомнении — спросите. Лучше один тур обсуждения, чем три тура исправлений.
