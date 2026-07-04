-- schema/postgres/006_feedback.sql
-- Обратная связь и трекинг исходов советов (фаза D, фича 13). Additive, скоуп по namespace.
-- Совет/министры фиксируют выданную рекомендацию; feedback-collector позже узнаёт исход;
-- outcome-analyst коррелирует советы с метриками жизни и пишет agent_effectiveness (source=outcome).
create table if not exists recommendation (
  id             uuid primary key default gen_random_uuid(),
  namespace      uuid not null references mem_namespace(id),
  source_agent   text,                              -- council|finance|work|... кто советовал
  domain         text,                              -- сфера жизни
  question       text not null,
  recommendation text not null,
  deliberation_id uuid references deliberation(id) on delete set null,
  context        jsonb not null default '{}',
  status         text not null default 'given',     -- given|applied|partial|not_applied|unknown
  outcome        text,                              -- что вышло (со слов пользователя)
  outcome_rating double precision,                  -- субъективная оценка исхода (напр. 0..5 или -1..1)
  follow_up_at   timestamptz,                       -- когда уместно спросить об исходе
  created_at     timestamptz not null default now(),
  outcome_at     timestamptz
);
create index if not exists ix_recommendation_followup on recommendation(namespace, status, follow_up_at);
create index if not exists ix_recommendation_domain on recommendation(namespace, domain, created_at desc);
