# 27 — Branching и миграции: рабочий процесс

Этот документ описывает, как устроена разработка против облака с Supabase branching, как примиряются миграции Drizzle с форматом Supabase, и что делать с TypeDB, у которого нет git-branching. Дополняет документ `12` (Ops Runbook).

---

## 1. Общая картина

```
                  PR открыт
                     │
        ┌────────────┼─────────────────────────┐
        │            │                          │
   Supabase     Vercel                     TypeDB
   создаёт      создаёт preview-           (вручную/скриптом)
   preview-     деплой, подключённый       shared dev или
   ветку БД     к preview-ветке БД         branch-scoped база
   (миграции    (через integration         если меняется схема
   + seed       env vars)
   автоматом)
        │            │                          │
        └────────────┼──────────────────────────┘
                     │
              Ревью на preview
                     │
                merge в main
                     │
        ┌────────────┼──────────────────────────┐
   Supabase     Vercel                     TypeDB
   применяет    деплоит                    typedb:migrate:prod
   миграции     production                 (осознанный шаг,
   к production                            с подтверждением)
```

Главный принцип: **preview-ветка изолирована**. Что угодно можно сломать в ней, продакшен не затронут. Это и есть ценность branching.

---

## 2. Supabase branching — настройка

Единоразово (уже частично сделано пользователем):

1. В дашборде Supabase включить branching для проекта, привязать GitHub-репозиторий.
2. Указать production-ветку = `main`.
3. В репозитории должна быть директория `supabase/` с `config.toml`, `migrations/`, `seed.sql`.
4. Подключить Supabase↔Vercel integration, чтобы Vercel preview получал env vars preview-ветки БД (URL, anon key) автоматически.

После этого: на каждый PR Supabase поднимает ephemeral preview-ветку, прогоняет `supabase/migrations/*.sql` по порядку, затем `supabase/seed.sql`. При merge в `main` те же миграции применяются к production.

**Тарификация**: preview-ветки оплачиваются, пока активны. Закрытие PR удаляет ветку. Не держать висящие PR с тяжёлыми ветками бесконечно.

---

## 3. Миграции: Drizzle ↔ Supabase

Здесь важная стыковка. Drizzle и Supabase branching имеют разные ожидания, их нужно примирить.

**Источник истины** — Drizzle-схема в `packages/db/schema/*.ts`. Никто не пишет SQL-миграции руками; они генерируются.

**Конфигурация Drizzle** (`drizzle.config.ts`) должна выводить миграции в `supabase/migrations/`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/db/schema/*.ts',
  out: './supabase/migrations',        // ← Supabase подхватывает отсюда
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  migrations: {
    prefix: 'timestamp',               // ← Supabase ожидает <timestamp>_name.sql
  },
});
```

> ⚠️ **Проверить при первом запуске**: Supabase ожидает имена вида `<14-значный timestamp>_name.sql` (например `20260101120000_create_notes.sql`). Drizzle с `prefix: 'timestamp'` даёт unix-timestamp — убедись, что формат совпадает с тем, что Supabase парсит. Если расходится — есть два пути: (а) post-generate скрипт `db:generate`, переименовывающий файлы в Supabase-формат; (б) использовать `supabase migration new <name>` для создания пустого файла с правильным именем и вставлять туда SQL из Drizzle-diff. Зафиксировать выбранный путь в этом документе после проверки.

**Поток создания миграции:**

```bash
# 1. Изменил схему в packages/db/schema/
# 2. Сгенерировал SQL-миграцию
pnpm db:generate
# 3. Проверил сгенерированный SQL глазами (Drizzle иногда генерирует не то, что ждёшь)
# 4. Закоммитил миграцию вместе с изменением схемы в одном PR
# 5. PR → Supabase применяет к preview-ветке → проверяешь, что работает
# 6. Merge → Supabase применяет к production
```

**Железные правила миграций:**
- Никогда не редактировать уже применённую (смёрженную) миграцию. Только новая поверх.
- Миграция и соответствующее изменение схемы — в одном PR (не разносить).
- Деструктивные операции (drop column, drop table) — отдельный PR с явной пометкой и ревью; сначала deprecate, потом удаление в следующем релизе.
- RLS-политики — часть миграции (см. skill `nabu-rls-patterns`). Новая таблица без RLS-политики = ошибка.

**Seed для preview-веток** (`supabase/seed.sql`): минимальный набор тестовых данных (тестовый пользователь, пара заметок), чтобы preview-деплой был сразу рабочим. НЕ класть сюда реальные/чувствительные данные.

---

## 4. TypeDB: branching вручную

TypeDB Cloud **не** имеет git-интегрированного branching. Это honest gap — обрабатываем явно.

**Принцип**: TypeDB-схема меняется редко (это онтология, не данные). Большинство PR её не трогают. Поэтому стратегия зависит от того, меняет ли PR схему.

**Схема версионируется** в `packages/typedb/schema/` как набор `.tql`-файлов + порядок применения. Source of truth — репозиторий.

### Случай A — PR НЕ меняет TypeDB-схему (большинство)
- Preview-деплой использует shared dev-базу `nabu_dev`.
- Ничего делать не нужно.

### Случай B — PR меняет TypeDB-схему
- Создать изолированную базу под этот PR:
  ```bash
  TYPEDB_DATABASE=nabu_pr_42 pnpm typedb:branch
  ```
  Скрипт создаёт базу `nabu_pr_42` и применяет всю схему из `packages/typedb/schema/`.
- В env preview-деплоя указать `TYPEDB_DATABASE=nabu_pr_42` (вручную в Vercel preview env, или через скрипт в CI).
- После merge/закрытия PR — удалить базу: `pnpm typedb:branch:drop nabu_pr_42`.

### Production
- При merge в `main`, если PR менял схему — применить к production **осознанно**:
  ```bash
  TYPEDB_DATABASE=nabu_prod pnpm typedb:migrate:prod
  ```
- Это НЕ автоматический шаг. Требует подтверждения, потому что TypeDB schema undefine может быть деструктивным.
- TypeDB schema migration semantics: добавление типов безопасно; переопределение/удаление типов требует осторожности и может потребовать миграции данных.

**Скрипты** (`packages/typedb/scripts/`): `apply.ts` (применить схему к `TYPEDB_DATABASE`), `branch.ts` (создать + применить), `branch-drop.ts`, `migrate-prod.ts` (с confirmation-промптом).

---

## 5. Согласованность Postgres ↔ TypeDB

Поскольку Postgres ветвится автоматически, а TypeDB — нет, есть риск рассогласования в preview-окружениях.

- Для PR без изменения TypeDB-схемы это не проблема (схема стабильна, данные пишутся через приложение).
- Если PR меняет и Postgres-, и TypeDB-схему — оба изменения в одном PR, preview указывает на preview-ветку Postgres + branch-scoped TypeDB-базу. Проверять их вместе.
- Sync между Postgres (источник истины для контента) и TypeDB (граф сущностей) идёт через события (`DomainEvent`) и worker, не через прямую связь схем. Это снижает связанность.

---

## 6. Чек-лист перед merge PR с миграциями

- [ ] Drizzle-миграция сгенерирована (`pnpm db:generate`), SQL проверен глазами.
- [ ] Миграция применилась на preview-ветке без ошибок.
- [ ] Новые таблицы имеют RLS-политики (skill `nabu-rls-patterns`).
- [ ] Preview-деплой работает с новой схемой.
- [ ] Если менялась TypeDB-схема: branch-scoped база создана, схема применена, проверена.
- [ ] Деструктивные операции (если есть) — явно помечены, отдельный ревью.
- [ ] Production-применение TypeDB-схемы (если нужно) запланировано как осознанный шаг после merge.

---

## 7. Аварийные ситуации

- **Миграция сломала production**: создать revert-миграцию (новый PR), не редактировать старую. Для критичных случаев — Supabase point-in-time recovery (документ `12`).
- **Preview-ветка зависла/не создаётся**: проверить логи Supabase branching, пересоздать через закрытие/переоткрытие PR.
- **TypeDB schema undefine сломал prod**: восстановление из backup (документ `12` §бэкапы). Поэтому production TypeDB-изменения — всегда осознанный шаг с предварительным бэкапом.
