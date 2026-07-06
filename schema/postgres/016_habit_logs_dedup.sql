-- schema/postgres/016_habit_logs_dedup.sql
-- R6-minor: у habit_logs не было unique-констрейнта → повторная отметка того же дня/статуса плодила
-- дубли, портя стрик/историю. Дедупим существующие (оставляем самую раннюю строку на ключ) и
-- добавляем unique-индекс. Идемпотентно. Логика logHabit теперь тоже не вставляет дубль.
-- R7-Q6: дедуп-DELETE выполняем только ОДИН раз — при первом применении (когда unique-индекса ещё
-- нет). Иначе каждый повторный прогон схемы делал бесполезный full-scan habit_logs.
do $$
begin
  if not exists (select 1 from pg_class where relname = 'ux_habit_logs_dedup') then
    delete from habit_logs a using habit_logs b
     where a.habit_id = b.habit_id and a.user_id = b.user_id
       and a.occurred_on = b.occurred_on and a.status = b.status
       and a.created_at > b.created_at;
  end if;
end $$;
create unique index if not exists ux_habit_logs_dedup
  on habit_logs(habit_id, user_id, occurred_on, status);
