-- schema/postgres/005_self_improvement.sql
-- Само-улучшение Nabu (фазы C): эффективность агентов/промптов/скиллов во времени +
-- структурированные предложения улучшений. Additive, скоуп по namespace.

-- Метрики эффективности (оценка агентов/промптов/скиллов/workflow/Совета).
create table if not exists agent_effectiveness (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  target_kind  text not null,                    -- agent|skill|prompt|workflow|council
  target       text not null,                    -- имя цели (напр. 'finance', 'nabu-council')
  metric       text not null,                    -- accuracy|boundary_compliance|user_rating|latency|...
  value        double precision not null,
  sample_size  integer not null default 1,
  period       text,                             -- напр. '2026-W27'
  source       text not null default 'manual',   -- eval|outcome|feedback|manual
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists ix_effectiveness_target on agent_effectiveness(namespace, target_kind, target, created_at desc);

-- Предложения улучшений (researcher/scout/learner). Ревьюит critic до accepted.
create table if not exists improvement_proposal (
  id             uuid primary key default gen_random_uuid(),
  namespace      uuid not null references mem_namespace(id),
  source_agent   text,
  category       text not null,                  -- agent|skill|prompt|workflow|mcp|tool|process|schema
  title          text not null,
  rationale      text not null,
  proposed_change text not null,
  evidence       jsonb not null default '{}',
  impact         text not null default 'medium', -- low|medium|high
  effort         text not null default 'medium', -- low|medium|high
  status         text not null default 'proposed', -- proposed|accepted|rejected|implemented
  decided_by     text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index if not exists ix_proposal_status on improvement_proposal(namespace, status, impact, created_at desc);
