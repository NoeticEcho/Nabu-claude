-- schema/postgres/009_chat_history.sql
-- Серверная история веб-чата (ROADMAP P1-5): сообщения тредов живут в БД (scope по namespace),
-- видны с любого устройства и переживают очистку браузера. Тред-метаданные остаются в
-- ~/.nabu/chat-threads.json (лёгкие); здесь — содержимое. Additive/идемпотентно.
create table if not exists chat_message (
  id         bigserial primary key,
  namespace  uuid not null references mem_namespace(id),
  thread_id  uuid not null,
  role       text not null check (role in ('user','assistant')),
  content    text not null,
  cost_usd   double precision,
  created_at timestamptz not null default now()
);
create index if not exists ix_chat_message_thread on chat_message(namespace, thread_id, id);
