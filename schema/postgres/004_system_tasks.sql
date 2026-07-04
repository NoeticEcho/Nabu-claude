-- schema/postgres/004_system_tasks.sql
-- Внутренний трекер задач Nabu (фича 10): бэклог системы — задачи агентов, предложения
-- улучшений, запросы фидбэка, запланированные проактивные действия. Отдельно от
-- пользовательских public.tasks. Additive, скоуп по namespace.
create table if not exists system_task (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  kind         text not null default 'task',      -- task|proposal|improvement|feedback|research|scheduled
  title        text not null,
  detail       text,
  status       text not null default 'open',      -- open|in_progress|blocked|done|dismissed
  priority     text not null default 'normal',    -- low|normal|high
  source_agent text,
  related      jsonb not null default '{}',
  due_at       timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ix_system_task_status on system_task(namespace, status, priority, created_at desc);
create index if not exists ix_system_task_kind on system_task(namespace, kind, status);
