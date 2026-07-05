-- schema/postgres/015_visibility_check.sql
-- Приватность (аудит R6, M8): у колонок `visibility` не было CHECK-констрейнта — опечатка/неверный
-- регистр ('Vault', 'valut') молча трактовались бы как non-vault равенствами и могли утечь.
-- Добавляем `check (visibility in ('default','private','vault'))` на все 6 таблиц. NOT VALID —
-- не сканируем существующие строки (они валидны), но новые/обновляемые проверяются. Идемпотентно.
do $$
declare
  t text;
  c text;
begin
  for t, c in
    select * from (values
      ('episodic_memory', 'ck_episodic_visibility'),
      ('semantic_facts',  'ck_semantic_visibility'),
      ('knowledge_chunk', 'ck_knowledge_visibility'),
      ('notes',           'ck_notes_visibility'),
      ('sources',         'ck_sources_visibility'),
      ('claims',          'ck_claims_visibility')
    ) as v(t, c)
  loop
    if to_regclass(t) is not null
       and not exists (select 1 from pg_constraint where conname = c) then
      execute format(
        'alter table %I add constraint %I check (visibility in (''default'',''private'',''vault'')) not valid',
        t, c);
    end if;
  end loop;
end $$;
