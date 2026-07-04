-- schema/postgres/008_standalone_research_notes.sql
-- STANDALONE: заметки (docs/07 §2.2–2.3) + research-слой (sources/claims, Ph5),
-- на которые ссылаются агенты (linker, deduplicator, research-assistant, claim-tracker,
-- argument-mapper) + дозаполнение колонок docs/07 в bootstrap-таблицах.
-- Всё аддитивно/идемпотентно (IF NOT EXISTS); в shared-БД эти таблицы принадлежат
-- основному Nabu (совпадающие CREATE — no-op).

-- ── Заметки (docs/07 §2.2, адаптировано: без note_versions/S3/fts; user_id → users) ──
-- Читают: agents/linker.md, agents/deduplicator.md. «Сколько заметок» в статистике — отсюда.
create table if not exists notes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id),
  title              text not null,
  type               text not null default 'idea',
  status             text not null default 'fleeting',   -- fleeting|literature|evergreen|archived
  domain             text[] not null default '{}',
  visibility         text not null default 'default',    -- default|private|vault
  tags               text[] not null default '{}',
  content_normalized text,
  affect_valence     real,
  affect_arousal     real,
  intent             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists ix_notes_user on notes(user_id, updated_at desc);

-- ── Связи заметок (docs/07 §2.3) — производит Linker (#12) ──
create table if not exists note_links (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id),
  source_note_id uuid not null references notes(id) on delete cascade,
  target_note_id uuid not null references notes(id) on delete cascade,
  link_type      text not null default 'wikilink',       -- wikilink|embed|reference|semantic
  confidence     real,
  created_at     timestamptz not null default now(),
  unique(source_note_id, target_note_id, link_type)
);
create index if not exists ix_note_links_user on note_links(user_id);

-- ── Источники (research, Ph5): research-assistant.md (write), claim-tracker/argument-mapper (read) ──
create table if not exists sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  kind         text not null default 'web',              -- web | pdf | book_chapter
  title        text,
  author       text,
  year         int,
  doi          text,
  url          text,
  bibtex_key   text,
  bibtex       text,
  key_claims   jsonb not null default '[]',
  methods      text,
  conclusions  text,
  visibility   text not null default 'private',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ix_sources_user on sources(user_id);

-- ── Тезисы (claims): claim-tracker (read+write), argument-mapper (read) ──
create table if not exists claims (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  text         text not null,
  source_id    uuid references sources(id) on delete set null,
  confidence   real not null default 0.5,
  visibility   text not null default 'private',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ix_claims_user on claims(user_id);

-- ── Связи тезис↔источник / тезис↔тезис (supports|contradicts|neutral) ──
create table if not exists claim_relations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id),
  claim_id        uuid not null references claims(id) on delete cascade,
  source_id       uuid references sources(id) on delete cascade,
  target_claim_id uuid references claims(id) on delete cascade,
  relation        text not null,                         -- supports | contradicts | neutral
  confidence      real not null default 0.5,
  created_at      timestamptz not null default now()
);
create index if not exists ix_claim_rel_user  on claim_relations(user_id);
create index if not exists ix_claim_rel_claim on claim_relations(claim_id);

-- ── Дозаполнение bootstrap-таблиц до docs/07 (§2.5, §2.6) ──
alter table character_sheet add column if not exists level int not null default 1;
alter table character_sheet add column if not exists tuppi int not null default 0;
alter table tasks add column if not exists parent_goal_id uuid references goals(id) on delete set null;
