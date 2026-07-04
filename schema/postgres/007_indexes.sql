-- schema/postgres/007_indexes.sql
-- Дополнительные индексы (additive, IF NOT EXISTS — безопасно для общей БД).
-- Устраняет seq-scan при семантическом поиске по автобиографическим нарративам:
-- autobiographical_narrative.embedding vector(768) не имел HNSW-индекса (был только
-- уникальный ux_autobio_period). Все прочие embedding-колонки уже проиндексированы HNSW.
create index if not exists ix_autobio_vec on autobiographical_narrative
  using hnsw (embedding vector_cosine_ops);

-- ПРИМЕЧАНИЕ (AUDIT §3.9, отложено намеренно): дедуп semantic_facts по
-- (namespace, subject, predicate, object) НЕ добавляется здесь: unique-ограничение
-- упало бы на уже существующих дублях в ОБЩЕЙ БД (инвариант #9 — не ломать её).
-- Требует предварительного data-миграционного прохода дедупа + затем `ON CONFLICT`
-- в MemoryRepository.addFact. Вынесено в отдельную задачу.
