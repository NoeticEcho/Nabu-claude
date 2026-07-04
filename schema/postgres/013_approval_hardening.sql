-- schema/postgres/013_approval_hardening.sql
-- r3-M5: одноразовое потребление approvals. Аддитивно/идемпотентно.
alter table action_approval add column if not exists used_at timestamptz;
create index if not exists ix_action_approval_open on action_approval(namespace, status) where used_at is null;
