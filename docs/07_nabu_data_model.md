# NABU

*Data Model & Ontology*  
*Канонические схемы данных*  
*Postgres · TypeDB · S3 · Frontmatter*  
*Версия 1.0*  

---

# 1. Введение

Документ фиксирует схемы данных Nabu во всех канонических хранилищах. Это рабочая поверхность для миграций, ORM-кода, агентов, экспорта/импорта. Любое изменение здесь требует миграции (см. infra/migrations/) и обновления документа в том же PR.

## 1.1. Карта хранилищ

| **Хранилище** | **Что хранит канонически** |
| --- | --- |
| S3 (MinIO) | Содержимое заметок (.md + frontmatter), медиа, версии. Source of truth для контента. |
| Postgres (Supabase) | Метаданные заметок, пользователи, привычки, проекты, задачи, метрики, квесты, audit_log. Эмбеддинги (pgvector). Очереди (pgmq). |
| TypeDB | Граф знаний: типизированные сущности и отношения с правилами вывода. |
| Local SQLite (на desktop) | Подмножество Postgres-метаданных для оффлайн-поиска и outbox исходящих изменений. |
| Tauri Stronghold (только локально) | Vault master key (не покидает устройство). |

# 2. Postgres-схема

Все таблицы в схеме public, кроме auth.* (управляется GoTrue) и pgmq.* (Queues). На всех таблицах с user-данными включён Row Level Security.

## 2.1. Пользователи и аккаунт

auth.users управляется GoTrue. Дополнительные пользовательские данные — в public.users (1-к-1 связь по id).

```
-- public.users: расширение auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  vault_salt bytea,                      -- 16 байт; для деривации vault master_key
  vault_setup_at timestamptz,            -- когда впервые настроен vault
  preferences jsonb not null default '{}'::jsonb,
  rpg_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

```
alter table public.users enable row level security;
create policy users_self_select on public.users
  for select using (id = auth.uid());
create policy users_self_update on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());
```

## 2.2. Заметки и версии

```
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  type text not null,                    -- одно из: idea, daily, project, task, journal, cbt, gestalt, ...
  status text not null default 'fleeting',   -- fleeting | literature | evergreen | archived
  domain text[] not null default '{}',   -- работа, здоровье, отношения, ...
  visibility text not null default 'default', -- default | private | vault
  tags text[] not null default '{}',
  current_version_id uuid,                -- FK на note_versions, обновляется при каждой правке
  content_normalized text,                -- результат Scribe; для индексирования
  fts tsvector generated always as (to_tsvector('russian', coalesce(content_normalized, ''))) stored,
  affect_valence real,                    -- -1..1
  affect_arousal real,                    -- 0..1
  intent text,                            -- task | idea | observation | complaint | decision | goal | question | hypothesis | promise
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz                  -- soft-delete
);
```

```
create index notes_user_idx on public.notes (user_id, updated_at desc);
create index notes_fts_idx on public.notes using gin(fts);
create index notes_tags_idx on public.notes using gin(tags);
create index notes_domain_idx on public.notes using gin(domain);
```

```
alter table public.notes enable row level security;
create policy notes_owner on public.notes
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

```
create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  version_number int not null,
  s3_key text not null,                  -- 'notes/{user_id}/{note_id}/v{n}.md'
  content_hash text not null,            -- sha256
  size_bytes int not null,
  frontmatter jsonb not null,            -- распарсенный frontmatter (для индексации)
  ciphertext boolean not null default false, -- true если visibility=vault
  created_at timestamptz not null default now(),
  unique(note_id, version_number)
);
```

```
create index note_versions_note_idx on public.note_versions (note_id, version_number desc);
alter table public.note_versions enable row level security;
create policy nv_owner on public.note_versions
  using (note_id in (select id from public.notes where user_id = auth.uid()));
```

## 2.3. Теги и связи

```
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  parent_tag_id uuid references public.tags(id),   -- иерархия тегов
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
```

```
create table public.note_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,                 -- денормализация для RLS-производительности
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_note_id uuid not null references public.notes(id) on delete cascade,
  link_type text not null default 'wikilink',  -- wikilink | embed | reference | semantic
  confidence real,                        -- для семантических links — 0..1
  created_at timestamptz not null default now(),
  unique(source_note_id, target_note_id, link_type)
);
```

```
create index note_links_source_idx on public.note_links (source_note_id);
create index note_links_target_idx on public.note_links (target_note_id);
```

```
alter table public.tags enable row level security;
alter table public.note_links enable row level security;
create policy tags_owner on public.tags using (user_id = auth.uid());
create policy nl_owner on public.note_links using (user_id = auth.uid());
```

## 2.4. Эмбеддинги (pgvector)

```
create extension if not exists vector;
```

```
create table public.note_embeddings (
  note_id uuid not null references public.notes(id) on delete cascade,
  version_number int not null,
  model_name text not null,              -- 'nomic-embed-text-v1.5' | 'bge-m3' | ...
  dimension int not null,                -- 1024 для nomic, 1024 для bge-m3
  embedding vector(1024) not null,
  content_hash text not null,            -- ссылка на конкретную версию контента
  scope text not null default 'note',    -- 'note' | 'chunk:0' | 'chunk:1' | ...
  created_at timestamptz not null default now(),
  primary key (note_id, version_number, model_name, scope)
);
```

```
create index ne_hnsw on public.note_embeddings
  using hnsw (embedding vector_cosine_ops);
```

```
alter table public.note_embeddings enable row level security;
create policy ne_owner on public.note_embeddings
  using (note_id in (select id from public.notes where user_id = auth.uid()));
```

## 2.5. Привычки, задачи, проекты, квесты

```
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  cue text,                              -- что запускает привычку
  routine text not null,                 -- сама привычка
  reward text,                           -- немедленное вознаграждение
  minimum_step text,                     -- 'минимальный шаг' для дня усталости
  anchor text,                           -- якорь к существующей привычке
  target_frequency text,                 -- daily | 3x_per_week | custom_cron
  custom_cron text,
  domain text[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

```
create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null,
  occurred_on date not null,
  status text not null,                  -- done | minimum | skipped | scheduled_skip
  note_id uuid references public.notes(id),
  created_at timestamptz not null default now()
);
```

```
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  status text not null default 'open',   -- open | in_progress | done | abandoned
  priority text default 'normal',        -- low | normal | high | urgent
  domain text[],
  project_id uuid references public.projects(id),
  parent_goal_id uuid references public.goals(id),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
```

```
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  goal text,                             -- к чему ведёт проект
  status text not null default 'active', -- planning | active | paused | done | archived
  domain text[],
  passport_note_id uuid references public.notes(id),   -- ссылка на паспорт-документ
  started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
```

```
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  text text not null,
  horizon text,                          -- short | mid | epic
  smart_specific text,
  smart_measurable text,
  smart_achievable text,
  smart_relevant text,
  smart_timebound date,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

```
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  quest_type text not null,              -- daily | side | main | epic | hidden
  parent_quest_id uuid references public.quests(id),  -- цепочка квестов
  goal_id uuid references public.goals(id),
  status text not null default 'available', -- available | active | completed | abandoned
  reward_xp jsonb,                       -- {intellect: 5, discipline: 3}
  reward_tuppi int default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
```

```
-- RLS на всех таблицах user-данных
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.goals enable row level security;
alter table public.quests enable row level security;
create policy habits_owner on public.habits using (user_id = auth.uid());
create policy hl_owner on public.habit_logs using (user_id = auth.uid());
create policy tasks_owner on public.tasks using (user_id = auth.uid());
create policy projects_owner on public.projects using (user_id = auth.uid());
create policy goals_owner on public.goals using (user_id = auth.uid());
create policy quests_owner on public.quests using (user_id = auth.uid());
```

## 2.6. RPG-слой

```
create table public.character_sheet (
  user_id uuid primary key references public.users(id) on delete cascade,
  level int not null default 1,
  classes text[] not null default '{}',  -- многоклассовость
  intellect_xp int not null default 0,
  wisdom_xp int not null default 0,
  creativity_xp int not null default 0,
  discipline_xp int not null default 0,
  vitality_xp int not null default 0,
  resilience_xp int not null default 0,
  sociality_xp int not null default 0,
  wealth_xp int not null default 0,
  tuppi int not null default 0,          -- внутренняя валюта (таблички мудрости)
  updated_at timestamptz not null default now()
);
```

```
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  attribute text not null,               -- intellect | wisdom | ...
  amount int not null,
  source_type text not null,             -- task | quest | habit | note | insight
  source_id uuid,
  reason text,                           -- 'Завершён квест "X"'
  created_at timestamptz not null default now()
);
```

```
alter table public.character_sheet enable row level security;
alter table public.xp_ledger enable row level security;
create policy cs_owner on public.character_sheet using (user_id = auth.uid());
create policy xp_owner on public.xp_ledger using (user_id = auth.uid());
```

## 2.7. Метрики

```
create table public.metric_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  unit text,                             -- 'kg' | 'usd' | 'hours' | 'score'
  domain text not null,                  -- finance | physiology | mental | productivity | time
  scale_type text not null default 'continuous',  -- continuous | ordinal | binary | validated_scale
  validated_scale_id text,               -- 'phq-9' | 'gad-7' | null
  created_at timestamptz not null default now(),
  unique(user_id, name)
);
```

```
create table public.metric_values (
  id bigserial primary key,
  series_id uuid not null references public.metric_series(id) on delete cascade,
  user_id uuid not null,
  occurred_at timestamptz not null,
  value double precision not null,
  source text not null default 'manual', -- manual | apple_health | google_fit | bank_statement
  note_id uuid references public.notes(id),
  created_at timestamptz not null default now()
);
```

```
create index mv_series_time_idx on public.metric_values (series_id, occurred_at desc);
```

```
alter table public.metric_series enable row level security;
alter table public.metric_values enable row level security;
create policy ms_owner on public.metric_series using (user_id = auth.uid());
create policy mv_owner on public.metric_values using (user_id = auth.uid());
```

## 2.8. Audit log

```
create table public.audit_log (
  id bigserial primary key,
  user_id uuid,                          -- null для system-событий
  trace_id uuid,
  event_type text not null,              -- 'note.created' | 'agent.invoked' | 'auth.login' | ...
  agent_name text,                       -- если событие — агентский вызов
  model_provider text,                   -- 'anthropic' | 'ollama' | null
  model_name text,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  status text not null default 'ok',     -- ok | error | blocked
  input_summary text,                    -- ≤ 200 символов, без полного payload
  purpose text,                          -- 'classify' | 'extract_entities' | ...
  metadata jsonb,
  occurred_at timestamptz not null default now()
) partition by range (occurred_at);
```

```
-- Партиции по месяцам, создаются pg_cron'ом
create table public.audit_log_2026_05 partition of public.audit_log
  for values from ('2026-05-01') to ('2026-06-01');
```

```
create index audit_user_idx on public.audit_log (user_id, occurred_at desc);
```

```
alter table public.audit_log enable row level security;
create policy audit_owner_read on public.audit_log
  for select using (user_id = auth.uid());
-- запись разрешена только service_role
```

# 3. TypeDB-схема

Граф знаний Nabu — отдельная TypeDB-база (одна на инстанс). Изоляция пользователей реализуется добавлением user_id-атрибута на корневые типы. Этот подход проще, чем отдельная база на пользователя; цена — RLS-логика на уровне приложения (TypeDB не имеет встроенного аналога Postgres RLS).

## 3.1. Базовая схема (миграция 001_base.tql)

```
define
```

```
# Атрибуты
user-id sub attribute, value string;
note-id sub attribute, value string;
name sub attribute, value string;
content sub attribute, value string;
created-at sub attribute, value datetime;
confidence sub attribute, value double;
weight sub attribute, value double;
domain sub attribute, value string;
status sub attribute, value string;
visibility sub attribute, value string;
```

```
# Корневой тип
nabu-thing sub entity,
  owns user-id,
  owns created-at,
  plays mentioned:mentioned-in,
  plays related:thing-a,
  plays related:thing-b;
```

```
# Сущности
entity-type sub nabu-thing, abstract;
```

```
person sub entity-type, owns name;
place sub entity-type, owns name;
project sub entity-type,
  owns name,
  owns status,
  owns domain,
  plays achieves:achiever;
goal sub entity-type,
  owns content,
  plays achieves:achievement;
habit sub entity-type, owns name, owns domain;
idea sub entity-type, owns content;
concept sub entity-type, owns name;
source sub entity-type, owns name, owns content;  # книга, статья, видео
note sub entity-type,
  owns note-id,
  owns visibility,
  owns status;
event sub entity-type, owns name;
decision sub entity-type, owns content;
emotion sub entity-type, owns name;
metric sub entity-type, owns name;
quest sub entity-type, owns name, owns status;
```

```
# Отношения (бинарные и многоарные)
mentioned sub relation,
  relates mentioner,
  relates mentioned-in,
  owns confidence;
note plays mentioned:mentioner;
entity-type plays mentioned:mentioned-in;
```

```
related sub relation,
  relates thing-a,
  relates thing-b,
  owns weight;
```

```
depends-on sub relation,
  relates dependent,
  relates dependency;
project plays depends-on:dependent;
project plays depends-on:dependency;
```

```
supports sub relation,
  relates supporter,
  relates supported,
  owns confidence;
note plays supports:supporter;
idea plays supports:supported;
decision plays supports:supported;
```

```
contradicts sub relation,
  relates contradictor,
  relates contradicted,
  owns confidence;
note plays contradicts:contradictor;
idea plays contradicts:contradicted;
```

```
achieves sub relation,
  relates achiever,
  relates achievement;
```

```
blocks sub relation,
  relates blocker,
  relates blocked;
```

```
derives-from sub relation,
  relates derivative,
  relates origin;
```

```
occurs-at sub relation,
  relates occurrence,
  relates time-anchor;
event plays occurs-at:occurrence;
```

## 3.2. Правила вывода (примеры)

```
# Транзитивность зависимостей
rule transitive-dependency:
  when {
    $a isa project;
    $b isa project;
    $c isa project;
    (dependent: $a, dependency: $b) isa depends-on;
    (dependent: $b, dependency: $c) isa depends-on;
  } then {
    (dependent: $a, dependency: $c) isa depends-on;
  };
```

```
# Если заметка поддерживает идею, а другая опровергает её — пометить
# для пользовательского внимания
rule conflicting-evidence:
  when {
    $n1 isa note; $n2 isa note; $i isa idea;
    (supporter: $n1, supported: $i) isa supports;
    (contradictor: $n2, contradicted: $i) isa contradicts;
  } then {
    (thing-a: $n1, thing-b: $n2) isa related;
  };
```

```
# Цели, к которым нет ни одной активной задачи — кандидат на review
# (реализуется на уровне приложения как periodic-check, не TypeDB-rule)
```

## 3.3. Версионирование TypeDB-схемы

- Файлы миграций в infra/migrations/typedb/ с именами 001_base.tql, 002_add_metric_links.tql, ...
- Каждая миграция применяется через TypeDB Driver в onModuleInit() при старте сервиса; пропускается если уже применена (запись в Postgres-таблице typedb_migrations).
- Откат миграций — отдельный *.rollback.tql или ручная процедура; для большинства схема-изменений TypeDB rollback не тривиален, поэтому изменения проходят через явный аппрув.

## 3.4. Изоляция пользователей

На уровне TypeDB изоляция реализуется добавлением user-id-атрибута на каждую сущность. Все TQL-запросы из приложения генерируются с обязательным фильтром $thing has user-id $u; $u = '<current_user_id>';. Это инвариант, проверяемый CI-линтером, который анализирует все TQL-template'ы в коде.

# 4. S3-layout

## 4.1. Бакеты

| **Бакет** | **Назначение** |
| --- | --- |
| nabu-notes | Контент заметок (.md) и frontmatter. Object Versioning включён. |
| nabu-media | Изображения, аудио, видео, PDF, прикреплённые к заметкам. |
| nabu-exports | Временные zip-архивы для скачивания пользовательских экспортов. TTL 7 дней (lifecycle policy). |
| nabu-backups | Дампы Postgres, экспорты TypeDB, snapshots критичных таблиц. Доступ только service-role. |

## 4.2. Структура ключей

```
# Контент заметок:
notes/{user_id}/{note_id}/v{version_number}.md
notes/{user_id}/{note_id}/current.md          # симлинк на актуальную версию
```

```
# Vault-заметки (visibility=vault):
notes/{user_id}/{note_id}/v{version_number}.md.enc
# Файл — JSON: { ciphertext: base64, iv: base64, wrapped_data_key: base64, alg: 'AES-256-GCM' }
```

```
# Медиа:
media/{user_id}/{media_id}/{filename}
# Имя media_id — sha256(content)[:16], detect-duplicate at upload time
```

```
# Экспорты:
exports/{user_id}/{export_id}.zip
```

```
# Бэкапы:
backups/postgres/{date}/{file}
backups/typedb/{date}/{file}
backups/manifests/{date}.json   # манифест с list файлов + checksum
```

## 4.3. Политика доступа

- nabu-notes, nabu-media: read/write только из nabu-api/nabu-worker через service-role ключ. Пользователь НЕ обращается к MinIO напрямую.
- nabu-exports: presigned URL с TTL 1 час, выдаются по запросу пользователя через API.
- nabu-backups: read/write только service-role.
- Все бакеты: SSE-S3 (шифрование в покое на стороне MinIO).

# 5. YAML frontmatter-схема

Frontmatter — это блок YAML в начале .md-файла, ограниченный --- сверху и снизу. Содержит метаданные заметки. Парсится при сохранении и индексируется в notes.

## 5.1. Базовая схема (Zod-определение в shared-types)

```
// packages/shared-types/src/frontmatter.ts
import { z } from "zod";
```

```
export const BaseFrontmatter = z.object({
  id: z.string().uuid(),                  // UUID заметки
  type: z.enum([
    "idea", "daily", "project", "task", "journal",
    "cbt", "gestalt", "dbt", "act", "ifs",
    "habit", "metric", "research", "literature",
    "project_passport", "manifesto", "values_card",
    "digest_daily", "digest_weekly", "digest_monthly",
  ]),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  status: z.enum(["fleeting", "literature", "evergreen", "archived"]).default("fleeting"),
  domain: z.array(z.enum([
    "work", "health", "relationships", "finance", "study",
    "creativity", "spiritual", "household",
  ])).default([]),
  visibility: z.enum(["default", "private", "vault"]).default("default"),
  links: z.array(z.string()).default([]), // wikilink references
});
```

```
// Расширения для специфичных типов:
export const DailyFrontmatter = BaseFrontmatter.extend({
  type: z.literal("daily"),
  date: z.string().date(),
  mood: z.number().min(-1).max(1).optional(),
  energy: z.number().min(0).max(1).optional(),
});
```

```
export const CBTFrontmatter = BaseFrontmatter.extend({
  type: z.literal("cbt"),
  protocol: z.enum(["abc", "sbnc", "beck", "behavioral_experiment"]),
  trigger: z.string().optional(),
  belief: z.string().optional(),
  consequence: z.string().optional(),
  distortions: z.array(z.string()).default([]),
  restructured_thought: z.string().optional(),
});
```

```
// ... аналогично для других типов
```

## 5.2. Пример .md файла

```
---
id: 7e9d4a2c-...
type: idea
title: Использовать Tauri Stronghold для vault master key
tags: [security, vault, tauri]
created: 2026-05-20T10:23:00Z
updated: 2026-05-20T10:45:00Z
status: fleeting
domain: [work]
visibility: default
links: [Vault E2E architecture, Argon2id]
---
```

```
# Использовать Tauri Stronghold для vault master key
```

```
Stronghold даёт защищённое локальное хранилище. Master_key выводится
из пользовательского пароля через Argon2id и НЕ покидает устройство.
```

```
См. также [[Vault E2E architecture]].
```

# 6. Local SQLite на desktop-клиенте

Desktop-клиент держит локальный SQLite (через Tauri SQL plugin) для оффлайн-поиска и outbox. Схема — подмножество Postgres-схемы плюс две специфичные таблицы.

```
-- Подмножество Postgres (зеркальные таблицы)
create table notes (
  id text primary key,
  user_id text not null,
  title text not null,
  type text not null,
  status text not null,
  visibility text not null,
  tags text not null default '[]',       -- JSON
  domain text not null default '[]',
  created_at text not null,
  updated_at text not null,
  local_path text                        -- абсолютный путь к .md в vault'е пользователя
);
```

```
create table note_links (
  source_note_id text not null,
  target_note_id text not null,
  link_type text not null,
  primary key (source_note_id, target_note_id, link_type)
);
```

```
create table embeddings (
  note_id text not null,
  scope text not null default 'note',
  embedding blob not null,               -- сериализованный vector
  primary key (note_id, scope)
);
```

```
-- Outbox: исходящие изменения, не синхронизированные с сервером
create table outbox (
  id integer primary key autoincrement,
  event_type text not null,              -- 'note.created' | 'note.updated' | 'note.deleted'
  payload text not null,                 -- JSON
  retry_count integer not null default 0,
  last_attempt_at text,
  created_at text not null default current_timestamp,
  status text not null default 'pending' -- pending | sent | failed
);
```

```
-- Inbox: входящие события от сервера (для дедупликации)
create table inbox (
  event_id text primary key,
  event_type text not null,
  received_at text not null default current_timestamp,
  processed_at text
);
```

```
-- Конфликты, требующие пользовательского внимания
create table conflicts (
  id integer primary key autoincrement,
  note_id text not null,
  local_version integer not null,
  remote_version integer not null,
  status text not null default 'open',   -- open | resolved | dismissed
  detected_at text not null default current_timestamp
);
```

```
create index notes_updated_idx on notes (updated_at desc);
create index outbox_status_idx on outbox (status, created_at);
```

# 7. Схема эмбеддингов

## 7.1. Стратегия чанкирования

- scope = 'note': один эмбеддинг на весь контент заметки. Для коротких заметок (< 500 токенов) этого достаточно.
- scope = 'chunk:N': для длинных заметок — дополнительные чанки по абзацам (или по логическим секциям, если есть headers). Размер чанка ≤ 500 токенов, оверлап 50 токенов.
- При семантическом поиске используется hybrid retrieval: top-K на note-embeddings, top-K на chunk-embeddings; результаты объединяются и переранжируются.

## 7.2. Перегенерация

- Эмбеддинги привязаны к content_hash конкретной версии. При изменении контента содержимое (новый hash) — генерируются новые эмбеддинги.
- Старые эмбеддинги не удаляются сразу — нужны для bisect и rollback. Удаляются ночной задачей при purge версий старше 90 дней (политика retention).
- При смене модели эмбеддингов (например, апгрейд с nomic-v1.5 на nomic-v2) — фоновая миграция: переиндексация порциями по 1000 заметок/час с приоритетом recent first.

## 7.3. Локальные эмбеддинги (для private/vault)

- Для private/vault эмбеддинги генерируются на desktop через Ollama (nomic-embed-text или bge-m3).
- Хранятся локально в SQLite, не реплицируются на сервер.
- Поиск по private/vault — локальный full table scan + cosine similarity. На корпусе ≤ 10 000 vault-заметок это приемлемо.

# 8. Sync-протокол outbox/inbox

## 8.1. Формат события (общий)

```
{
  "event_id": "uuid",
  "event_type": "note.updated",
  "user_id": "uuid",
  "occurred_at": "ISO-8601",
  "device_id": "uuid",                   // идентификатор устройства, на котором событие создано
  "version_vector": { "device_id": lamport_clock, ... },
  "payload": {
    "note_id": "uuid",
    "version_number": 5,
    "content_hash": "sha256...",
    "frontmatter": { ... },
    "content": "...",                    // null если это просто метаданные
    "size_bytes": 1234
  }
}
```

## 8.2. Lamport clock и device_id

- device_id — UUID, генерируется при первой установке клиента, хранится в Tauri Store.
- Каждое локальное событие инкрементирует device_clock; при получении remote-события — берём max(local_clock, remote_clock) + 1.
- При конфликте побеждает событие с большим (clock, device_id)-tuple (lexicographic order).

## 8.3. Inbox-дедупликация

Клиент держит таблицу inbox с обработанными event_id (TTL 30 дней). При получении дубликата (тот же event_id) — игнорирует.
