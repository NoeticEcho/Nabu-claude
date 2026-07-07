-- 019_multitenancy.sql — фундамент много-тенантности (OlimpOS P1). Аддитивно + идемпотентно.
-- Однопользовательский режим (дефолт) не затрагивается: новые колонки nullable, commons-namespace
-- создаётся, но старые данные (namespace 'default') работают как прежде. См. docs/specs/2026-07-07-p1.

-- ── users: идентификаторы аккаунта + личное пространство ──
alter table users add column if not exists tg_user_id  bigint;
alter table users add column if not exists email        text;
alter table users add column if not exists pass_hash    text;          -- scrypt (node:crypto), только web (P2)
alter table users add column if not exists display_name text;
alter table users add column if not exists personal_namespace uuid references mem_namespace(id);
alter table users add column if not exists status       text not null default 'active';
-- уникальность идентификаторов (частичные индексы: null допускается многократно)
create unique index if not exists ux_users_tg    on users(tg_user_id) where tg_user_id is not null;
create unique index if not exists ux_users_email on users(email)      where email is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_status_chk') then
    alter table users add constraint users_status_chk check (status in ('active','suspended'));
  end if;
end $$;

-- ── membership: связь пользователь↔пространство↔роль (личное/проектное/организация; задел под P3) ──
create table if not exists membership (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  namespace   uuid not null references mem_namespace(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner','member','viewer')),
  created_at  timestamptz not null default now(),
  unique(user_id, namespace)
);
create index if not exists ix_membership_user on membership(user_id);
create index if not exists ix_membership_ns   on membership(namespace);

-- ── agent_registry: банк/рынок агентов (задел под P4). Определения — в файлах, метаданные — здесь ──
create table if not exists agent_registry (
  slug         text primary key,
  origin_user  uuid references users(id) on delete set null,   -- null = встроенный агент
  visibility   text not null default 'builtin' check (visibility in ('builtin','shared','private')),
  spec_path    text,
  created_at   timestamptz not null default now(),
  usage_count  bigint not null default 0
);

-- ── Well-known commons namespace (общий слой: агенты/скиллы/процедуры/агрегаты опыта) ──
-- Фиксированный UUID, чтобы код мог ссылаться константой COMMONS_NS.
insert into mem_namespace (id, name)
values ('00000000-0000-4000-8000-000000000c01', '__commons__')
on conflict (id) do nothing;
