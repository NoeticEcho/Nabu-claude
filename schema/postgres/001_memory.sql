-- schema/postgres/001_memory.sql
-- Схема памяти агентов Nabu (персональный режим в Claude Code).
-- Семь типов памяти из memory_for_agi.md + личность из personality_traits.md.
-- Требует расширения pgvector. Размерность вектора — под выбранную embedding-модель
-- (nomic-embed-text = 768). Скорректировать при смене модели.

create extension if not exists vector;

-- ── Namespace (на случай нескольких профилей/пользователей) ──
create table if not exists mem_namespace (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- ── Рабочая память (working) — временный контекст, TTL ──
create table if not exists working_memory (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  session_id  text not null,
  content     text not null,
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);
create index if not exists ix_working_session on working_memory(namespace, session_id);
create index if not exists ix_working_expiry on working_memory(expires_at);

-- ── Эпизодическая память (episodic) — события с временем/контекстом ──
create table if not exists episodic_memory (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  event        text not null,                       -- что произошло
  occurred_at  timestamptz not null default now(),  -- когда
  actors       text[] not null default '{}',        -- кто участвовал
  emotion      text,                                -- эмоциональная окраска (опц.)
  context      jsonb not null default '{}',         -- место, источник, ссылки
  visibility   text not null default 'private',     -- default|private|vault
  embedding    vector(768),
  created_at   timestamptz not null default now()
);
create index if not exists ix_episodic_time on episodic_memory(namespace, occurred_at desc);
create index if not exists ix_episodic_vec on episodic_memory
  using hnsw (embedding vector_cosine_ops);

-- ── Семантическая память (semantic) — факты/знания ──
-- (Граф сущностей — в TypeDB; здесь — факты с эмбеддингом для поиска.)
create table if not exists semantic_facts (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  subject     text not null,
  predicate   text not null,
  object      text not null,
  confidence  real not null default 0.8,
  source      text,                                 -- откуда факт
  visibility  text not null default 'private',
  embedding   vector(768),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ix_semantic_subject on semantic_facts(namespace, subject);
create index if not exists ix_semantic_vec on semantic_facts
  using hnsw (embedding vector_cosine_ops);

-- ── Процедурная память (procedural) — навыки/процедуры ──
create table if not exists procedures (
  id            uuid primary key default gen_random_uuid(),
  namespace     uuid not null references mem_namespace(id),
  skill         text not null,                      -- название навыка
  steps         jsonb not null,                     -- последовательность шагов
  success_rate  real not null default 0.0,          -- обновляется по исходам
  uses          integer not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ix_procedures_skill on procedures(namespace, skill);

-- ── Проспективная память (prospective) — намерения/напоминания ──
create table if not exists prospective_memory (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  intent       text not null,                       -- что нужно сделать
  trigger_at   timestamptz,                         -- когда (время)
  trigger_cond jsonb,                               -- или условие
  status       text not null default 'pending',     -- pending|done|cancelled|expired (expired — гигиена v0.17-9)
  created_at   timestamptz not null default now()
);
create index if not exists ix_prospective_pending on prospective_memory(namespace, status, trigger_at);

-- ── Автобиографический нарратив (производное от эпизодической) ──
create table if not exists autobiographical_narrative (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  period      text not null,                        -- например '2026-W26' или '2026-06'
  narrative   text not null,                        -- связный нарратив периода
  embedding   vector(768),
  created_at  timestamptz not null default now()
);
create unique index if not exists ux_autobio_period on autobiographical_narrative(namespace, period);

-- ── Ассоциации (associative) — явные связи между единицами памяти ──
-- (Богатый граф — в TypeDB; здесь — быстрые типизированные связи.)
create table if not exists mem_association (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  from_kind   text not null,                        -- episodic|semantic|procedure|...
  from_id     uuid not null,
  to_kind     text not null,
  to_id       uuid not null,
  relation    text not null,                        -- тип связи
  weight      real not null default 1.0,
  created_at  timestamptz not null default now()
);
create index if not exists ix_assoc_from on mem_association(namespace, from_kind, from_id);

-- ── Личность агентов (personality) ──
create table if not exists agent_personality (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  agent       text not null,                        -- adjutant|decision-maker|...
  traits      jsonb not null,                       -- числовые черты
  evolves     boolean not null default false,
  guardrails  jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (namespace, agent)
);

-- Лог эволюции личности (если evolves=true)
create table if not exists agent_personality_log (
  id          uuid primary key default gen_random_uuid(),
  namespace   uuid not null references mem_namespace(id),
  agent       text not null,
  trait       text not null,
  old_value   real not null,
  new_value   real not null,
  reason      text,
  changed_at  timestamptz not null default now()
);
