-- 024_api_token.sql — личные bearer-токены публичного API (Public API v1). Аддитивно, идемпотентно.
-- Токен выдаётся один раз в открытом виде (nabu_pat_<random>), в БД хранится ТОЛЬКО sha256-хеш.
-- Резолвинг: Authorization: Bearer <token> → sha256 → активный api_token → user_id → тенант.
-- Токены отзываемы (revoked_at) и привязаны к пользователю (on delete cascade вместе с аккаунтом).

create table if not exists api_token (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,          -- sha256(token) hex
  name         text,                          -- человекочитаемая метка («iPhone», «CI»)
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists ix_api_token_user on api_token(user_id);
create index if not exists ix_api_token_active on api_token(token_hash) where revoked_at is null;
