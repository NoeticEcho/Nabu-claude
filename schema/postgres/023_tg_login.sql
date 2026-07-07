-- 023_tg_login.sql — одноразовые коды входа через Telegram (OlimpOS P2, deep-link auth). Аддитивно.
-- Веб генерит код → пользователь открывает t.me/<bot>?start=<code> → бот линкует свой tg_user_id к коду
-- → веб опрашивает и создаёт сессию. Коды короткоживущие (TTL ~10 мин), одноразовые.

create table if not exists tg_login_code (
  code        text primary key,
  tg_user_id  bigint,                 -- проставляется ботом при /start <code>
  created_at  timestamptz not null default now()
);
create index if not exists ix_tg_login_created on tg_login_code(created_at);
