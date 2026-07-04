-- schema/postgres/010_hardening.sql
-- Аддитивное укрепление по аудиту r2 (§3.5/3.6/6.3). Всё идемпотентно.

-- claim_relations.relation: значения были только в комменте — фиксируем CHECK (как в 009 role).
-- NOT VALID: не валидируем существующие строки (аддитивность в общей БД), новые — проверяются.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_claim_relations_relation'
  ) then
    alter table claim_relations
      add constraint ck_claim_relations_relation
      check (relation in ('supports', 'contradicts', 'neutral')) not valid;
  end if;
end $$;

-- notes: фильтр list({status}) и сортировка по created_at не были покрыты индексом.
create index if not exists ix_notes_user_status on notes(user_id, status, created_at);

-- chat_message: ретенция (растёт вечно; чистку делает lib purgeChatHistory + internal-джоб).
create index if not exists ix_chat_message_created on chat_message(namespace, created_at);
