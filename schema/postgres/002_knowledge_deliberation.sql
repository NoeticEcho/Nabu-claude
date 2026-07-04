-- schema/postgres/002_knowledge_deliberation.sql
-- База знаний из индексируемых папок (для /nabu-index) + журнал совещаний Совета.
-- Additive поверх 001_memory.sql. Требует mem_namespace и pgvector (768).

-- ── База знаний (агентная, отдельно от notes основного Nabu) ──
create table if not exists knowledge_chunk (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  source       text not null,
  chunk_index  integer not null default 0,
  content      text not null,
  visibility   text not null default 'private',
  embedding    vector(768),
  created_at   timestamptz not null default now()
);
create index if not exists ix_knowledge_source on knowledge_chunk(namespace, source);
create index if not exists ix_knowledge_vec on knowledge_chunk using hnsw (embedding vector_cosine_ops);
create unique index if not exists ux_knowledge_chunk on knowledge_chunk(namespace, source, chunk_index);

-- ── Журнал коллегиальных совещаний Совета ──
create table if not exists deliberation (
  id           uuid primary key default gen_random_uuid(),
  namespace    uuid not null references mem_namespace(id),
  question     text not null,
  status       text not null default 'open',   -- open|synthesized|closed
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ix_deliberation_ns on deliberation(namespace, created_at desc);

create table if not exists deliberation_position (
  id              uuid primary key default gen_random_uuid(),
  deliberation_id uuid not null references deliberation(id) on delete cascade,
  minister        text not null,
  recommendation  text not null,
  rationale       text not null,
  risks           text[] not null default '{}',
  confidence      real not null default 0.5,
  depends_on      text[] not null default '{}',
  created_at      timestamptz not null default now(),
  unique (deliberation_id, minister)
);
create index if not exists ix_position_delib on deliberation_position(deliberation_id);

create table if not exists deliberation_synthesis (
  id              uuid primary key default gen_random_uuid(),
  deliberation_id uuid not null references deliberation(id) on delete cascade,
  conflicts       text[] not null default '{}',
  tradeoffs       text not null,
  synthesis       text not null,
  decision        text,
  created_at      timestamptz not null default now()
);
create index if not exists ix_synth_delib on deliberation_synthesis(deliberation_id);
