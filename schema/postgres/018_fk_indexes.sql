-- 018_fk_indexes.sql — покрывающие индексы на FK-колонки (R7-Q4, аддитивно, идемпотентно).
-- Без них child-таблицы сканируются последовательно при ON DELETE CASCADE/SET NULL и при JOIN'ах
-- по родителю. На single-user объёмах некритично, но дёшево и правильно. Все — IF NOT EXISTS.

create index if not exists ix_tasks_project        on tasks(project_id);
create index if not exists ix_tasks_parent_goal    on tasks(parent_goal_id);
create index if not exists ix_quests_goal          on quests(goal_id);
create index if not exists ix_quests_parent_quest  on quests(parent_quest_id);
create index if not exists ix_recommendation_delib on recommendation(deliberation_id);
create index if not exists ix_claims_source        on claims(source_id);
create index if not exists ix_claim_relations_src  on claim_relations(source_id);
create index if not exists ix_claim_relations_tgt  on claim_relations(target_claim_id);
create index if not exists ix_note_links_target    on note_links(target_note_id);
create index if not exists ix_action_log_approval  on action_log(approval_id);
