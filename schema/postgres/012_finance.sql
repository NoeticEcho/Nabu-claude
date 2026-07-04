-- schema/postgres/012_finance.sql
-- Финансовые транзакции из ФАЙЛОВЫХ ВЫПИСОК банков (CSV-экспорт из личного кабинета).
-- НИКАКИХ банковских API/OAuth: разбор 100% локальный. Данные приватны по умолчанию.
-- Аддитивно и идемпотентно (create ... if not exists). Философия — docs/FINANCE_IMPORT.md.

create table if not exists finance_transaction (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  occurred_on  date not null,
  amount       numeric(14,2) not null,          -- расход отрицательный, приход положительный
  currency     text not null default 'RUB',
  description  text not null,
  category     text not null default 'другое',
  source       text,                            -- метка выписки, напр. 'bank', 'tinkoff'
  tx_hash      text not null,                   -- sha256(occurred_on|amount|description) — дедуп
  created_at   timestamptz not null default now()
);

-- Идемпотентный реимпорт: одна и та же строка выписки (для пользователя) не дублируется.
create unique index if not exists ux_finance_tx_hash on finance_transaction(user_id, tx_hash);

-- Выборки по периоду (summary за N дней) и по категории за период (министр finance).
create index if not exists ix_finance_tx_occurred on finance_transaction(user_id, occurred_on);
create index if not exists ix_finance_tx_category on finance_transaction(user_id, category, occurred_on);
