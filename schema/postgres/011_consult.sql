-- schema/postgres/011_consult.sql
-- Кросс-доменные консультации агентов (идея: не только адъютант/министры могут спрашивать
-- Совет — ЛЮБОЙ агент может запросить экспертизу другого домена). Durable-буфер: работает
-- и в fallback-режиме (relay через адъютанта), и как аудит в Teams-режиме (там агенты
-- общаются напрямую SendMessage). Additive/идемпотентно. Скоуп по namespace.
create table if not exists consult (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  from_agent   text not null,                     -- кто спрашивает (slug агента)
  to_domain    text not null,                     -- health|mind|finance|work|learning|relationships|growth|lifestyle|admin|any
  question     text not null,
  context      jsonb not null default '{}',       -- краткий контекст (не сырые приватные данные!)
  status       text not null default 'open' check (status in ('open','answered','expired')),
  answer       text,
  answered_by  text,                              -- slug ответившего (обычно министр домена)
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);
create index if not exists ix_consult_open on consult(namespace, status, created_at);
