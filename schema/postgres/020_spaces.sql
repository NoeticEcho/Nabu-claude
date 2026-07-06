-- 020_spaces.sql — пространства проектов/организаций (OlimpOS P3+P5+P6). Аддитивно, идемпотентно.
-- Space описывает namespace сверх личного: проектное (групповой чат/команда) или организация.
-- Для доменного скоупа (tasks/projects — по user_id) у проектного space есть синтетический
-- «аккаунт проекта» (users-строка), к нему скоупятся общие задачи; люди-участники — через membership.

create table if not exists space (
  namespace     uuid primary key references mem_namespace(id) on delete cascade,
  kind          text not null default 'project' check (kind in ('personal','project','org')),
  name          text,
  slug          text unique,                       -- для публичных URL (P6): /s/<slug>
  account_user  uuid references users(id),         -- синтетический аккаунт для доменного скоупа
  owner_user    uuid references users(id) on delete set null,  -- человек-владелец (создатель)
  tg_chat_id    bigint unique,                      -- привязка групповго Telegram-чата
  visibility    text not null default 'private' check (visibility in ('private','public')),
  created_at    timestamptz not null default now()
);
create index if not exists ix_space_owner on space(owner_user);
create index if not exists ix_space_tgchat on space(tg_chat_id);
