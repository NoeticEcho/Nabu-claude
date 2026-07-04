-- schema/postgres/014_chat_thread_text.sql
-- Синхронизация web↔Telegram: thread_id может быть каноническим id разговора (conv-adjutant),
-- а не только UUID. Расширяем тип до text (существующие UUID конвертируются безопасно). Идемпотентно.
do $$
begin
  if (select data_type from information_schema.columns
      where table_name='chat_message' and column_name='thread_id') = 'uuid' then
    alter table chat_message alter column thread_id type text using thread_id::text;
  end if;
end $$;
