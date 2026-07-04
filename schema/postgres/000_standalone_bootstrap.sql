-- schema/postgres/000_standalone_bootstrap.sql
-- ТОЛЬКО для STANDALONE-режима (локальный Docker) — минимальный совместимый срез доменных
-- таблиц основного приложения Nabu, чтобы MCP-серверы nabu-domain/nabu-analytics работали
-- без общей облачной БД. В shared-DB режиме этот файл НЕ применяется: там доменные таблицы
-- (projects/tasks/goals/habits/quests/character_sheet/metric_*/xp_ledger) принадлежат основному
-- приложению Nabu — их схема канонична, здесь мы её не дублируем и не переопределяем.
--
-- Дисциплина: всё аддитивно и идемпотентно (create ... if not exists, ON CONFLICT DO NOTHING,
-- WHERE NOT EXISTS). Создаются только те колонки, которые реально читают/пишут репозитории
-- lib/src/repositories/domain.ts и analytics.ts (плюс очевидные created_at/updated_at).
-- Порядок префикса 000 гарантирует, что таблицы появятся раньше 001+ (память/связи).

create extension if not exists vector; -- безвредно, если уже установлено (см. 001_memory.sql)

-- ── Пользователи (в персональном режиме — один) ──
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

-- ── Проекты ──
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  name        text not null,
  goal        text,
  status      text not null default 'active',
  domains     text[] not null default '{}',
  started_at  timestamptz,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_projects_user on projects(user_id);

-- ── Задачи ──
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  project_id   uuid references projects(id) on delete set null,
  title        text not null,
  status       text not null default 'todo',
  priority     text,
  domains      text[] not null default '{}',
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ix_tasks_user on tasks(user_id);

-- ── Цели (SMART) ──
create table if not exists goals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id),
  text             text not null,
  horizon          text,
  status           text not null default 'active',
  smart_specific   text,
  smart_measurable text,
  smart_timebound  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ix_goals_user on goals(user_id);

-- ── Привычки ──
create table if not exists habits (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id),
  name             text not null,
  cue              text,
  routine          text,
  reward           text,
  minimum_step     text,
  anchor           text,
  target_frequency text,
  domains          text[] not null default '{}',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ix_habits_user on habits(user_id);

-- ── Лог привычек ──
create table if not exists habit_logs (
  id          uuid primary key default gen_random_uuid(),
  habit_id    uuid not null references habits(id) on delete cascade,
  user_id     uuid not null references users(id),
  occurred_on date not null default current_date,
  status      text not null default 'done',
  created_at  timestamptz not null default now()
);
create index if not exists ix_habit_logs_user on habit_logs(user_id);

-- ── Квесты ──
create table if not exists quests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  title           text not null,
  quest_type      text,
  status          text not null default 'active',
  goal_id         uuid references goals(id) on delete set null,
  parent_quest_id uuid references quests(id) on delete set null,
  reward_tuppi    integer not null default 0,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ix_quests_user on quests(user_id);

-- ── Лист персонажа (RPG) — по строке на пользователя, 8 XP-атрибутов ──
create table if not exists character_sheet (
  user_id       uuid primary key references users(id),
  intellect_xp  integer not null default 0,
  wisdom_xp     integer not null default 0,
  creativity_xp integer not null default 0,
  discipline_xp integer not null default 0,
  vitality_xp   integer not null default 0,
  resilience_xp integer not null default 0,
  sociality_xp  integer not null default 0,
  wealth_xp     integer not null default 0,
  updated_at    timestamptz not null default now()
);

-- ── Ряды метрик жизни ──
create table if not exists metric_series (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  name       text not null,
  unit       text,
  domain     text,
  created_at timestamptz not null default now()
);
create index if not exists ix_metric_series_user on metric_series(user_id);

-- ── Значения метрик (id bigserial — большой поток точек) ──
create table if not exists metric_values (
  id          bigserial primary key,
  series_id   uuid not null references metric_series(id) on delete cascade,
  user_id     uuid not null references users(id),
  occurred_at timestamptz not null default now(),
  value       double precision not null,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists ix_metric_values_user on metric_values(user_id);
create index if not exists ix_metric_values_series_time on metric_values(series_id, occurred_at);

-- ── Журнал XP (каждое начисление объяснимо: reason) ──
create table if not exists xp_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  attribute   text not null,
  amount      integer not null,
  source_type text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists ix_xp_ledger_user on xp_ledger(user_id);

-- ── Сид: дефолтный пользователь ТОЛЬКО если таблица пуста ──
-- Фиксированный uuid, чтобы инсталлятор мог детерминированно проставить NABU_USER_ID.
-- ВАЖНО: инсталлятор должен выставить NABU_USER_ID = '00000000-0000-0000-0000-000000000001'.
insert into users (id)
select '00000000-0000-0000-0000-000000000001'::uuid
where not exists (select 1 from users);

-- Лист персонажа для дефолтного пользователя (если он был создан выше).
insert into character_sheet (user_id)
values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (user_id) do nothing;
