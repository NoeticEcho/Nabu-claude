-- schema/postgres/003_governance.sql
-- Governance: durable-запись одобрений высокорисковых действий + аудит-лог (инвариант #7).
-- Верхний энфорсер — система разрешений Claude Code; эти таблицы дают структурированную
-- запись approval и аудит выполненных действий. Additive поверх 001_memory.sql.

create table if not exists action_approval (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  agent        text not null,
  risk_class   text not null,                       -- external|financial|destructive|deploy|purchase|communication
  action       text not null,
  target       text,
  summary      text not null,
  preview      jsonb not null default '{}',
  expected     text,
  rollback     text,
  scope        text,
  status       text not null default 'pending',     -- pending|approved|rejected|expired
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   text,                                -- 'user' — модель НЕ одобряет своё действие
  expires_at   timestamptz not null default (now() + interval '1 hour')
);
create index if not exists ix_approval_pending on action_approval(namespace, status, requested_at desc);

create table if not exists action_log (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  agent        text not null,
  risk_class   text not null,
  action       text not null,
  target       text,
  status       text not null,                       -- ok|error|blocked|skipped
  approval_id  uuid references action_approval(id),
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists ix_action_log_ns on action_log(namespace, created_at desc);
