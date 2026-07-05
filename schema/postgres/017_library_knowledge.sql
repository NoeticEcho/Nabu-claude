-- schema/postgres/017_library_knowledge.sql
-- Библиотека знаний (Q2): отдельный от памяти-о-пользователе слой — книги/доки/URL как reference-
-- знание агентов и Совета. Аддитивно расширяем knowledge_chunk и заводим реестр источников.
-- kind='library' — НЕ о пользователе (справочное знание Nabu); 'personal' — индексированные заметки
-- пользователя. domain — тематика (psychology/law/uiux…), чтобы агенты искали в своей области.

-- Расширение чанков (аддитивно, дефолты сохраняют старое поведение).
alter table knowledge_chunk add column if not exists kind   text not null default 'personal';
alter table knowledge_chunk add column if not exists domain text;
alter table knowledge_chunk add column if not exists title  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_knowledge_kind') then
    alter table knowledge_chunk add constraint ck_knowledge_kind check (kind in ('personal','library')) not valid;
  end if;
end $$;

create index if not exists ix_knowledge_kind_domain on knowledge_chunk(namespace, kind, domain);

-- Реестр источников библиотеки: одна строка на индексированный источник (файл/URL).
create table if not exists knowledge_source (
  id         uuid primary key default gen_random_uuid(),
  namespace  uuid not null references mem_namespace(id),
  source     text not null,                    -- стабильный ключ (путь/URL), уникален в namespace
  kind       text not null default 'library',  -- library | personal
  domain     text,                             -- тематика (psychology/law/uiux…)
  title      text,                             -- человекочитаемое имя
  origin     text,                             -- исходный путь/URL
  chunks     integer not null default 0,
  added_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (namespace, source)
);
create index if not exists ix_knowledge_source_domain on knowledge_source(namespace, kind, domain);
