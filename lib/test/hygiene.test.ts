// Юнит-тесты детерминированной гигиены памяти (ROADMAP v0.17-9), без реальной БД.
// Часть 1: текстовые shape-тесты экспортируемого SQL (оконная функция, исключение vault).
// Часть 2: фейковый pg — методы прогоняют нужный SQL и парсят count.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryRepository,
  DEDUP_FACTS_SQL,
  EXPIRE_STALE_PROSPECTIVE_SQL,
  STALE_PROSPECTIVE_DEFAULT_DAYS,
} from "../dist/repositories/memory.js";

// ── Часть 1: shape-тесты SQL ──

test("DEDUP_FACTS_SQL: содержит оконную функцию row_number с partition по 4 колонкам", () => {
  assert.match(DEDUP_FACTS_SQL, /row_number\s*\(\s*\)\s*over/i);
  assert.match(
    DEDUP_FACTS_SQL,
    /partition\s+by\s+namespace\s*,\s*subject\s*,\s*predicate\s*,\s*object/i,
  );
  // tie-break: самая старая (created_at asc, id asc)
  assert.match(DEDUP_FACTS_SQL, /order\s+by\s+created_at\s+asc\s*,\s*id\s+asc/i);
  // удаляем только не-первые в группе
  assert.match(DEDUP_FACTS_SQL, /rn\s*>\s*1/i);
});

test("DEDUP_FACTS_SQL: исключает vault (шифртексты с уникальным IV не совпадают)", () => {
  assert.match(DEDUP_FACTS_SQL, /visibility\s*<>\s*'vault'/i);
});

test("EXPIRE_STALE_PROSPECTIVE_SQL: только pending со сработавшим временем-триггером → expired", () => {
  assert.match(EXPIRE_STALE_PROSPECTIVE_SQL, /set\s+status\s*=\s*'expired'/i);
  assert.match(EXPIRE_STALE_PROSPECTIVE_SQL, /status\s*=\s*'pending'/i);
  assert.match(EXPIRE_STALE_PROSPECTIVE_SQL, /trigger_at\s+is\s+not\s+null/i);
  assert.match(EXPIRE_STALE_PROSPECTIVE_SQL, /trigger_at\s*<\s*now\(\)\s*-/i);
});

// ── Часть 2: фейковый pg (методы не трогают embedder) ──

function fakePg(count: number) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pg = {
    resolveNamespace: async (_name: string) => "ns-1",
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [{ n: String(count) }];
    },
    queryOne: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { n: String(count) };
    },
  };
  return { calls, pg };
}

function makeRepo(pg: unknown) {
  // embedder не используется гигиеной; namespace/opts дефолтные.
  return new MemoryRepository(pg as never, {} as never, "default", {});
}

test("dedupSemanticFacts: прогоняет DEDUP_FACTS_SQL с namespace, возвращает count", async () => {
  const { calls, pg } = fakePg(3);
  const n = await makeRepo(pg).dedupSemanticFacts();
  assert.equal(n, 3);
  const call = calls.find((c) => c.sql === DEDUP_FACTS_SQL);
  assert.ok(call, "должен быть вызван DEDUP_FACTS_SQL");
  assert.deepEqual(call!.params, ["ns-1"]);
});

test("expireStaleProspective: дефолтный порог = STALE_PROSPECTIVE_DEFAULT_DAYS", async () => {
  const { calls, pg } = fakePg(2);
  const n = await makeRepo(pg).expireStaleProspective();
  assert.equal(n, 2);
  const call = calls.find((c) => c.sql === EXPIRE_STALE_PROSPECTIVE_SQL);
  assert.ok(call, "должен быть вызван EXPIRE_STALE_PROSPECTIVE_SQL");
  assert.deepEqual(call!.params, ["ns-1", String(STALE_PROSPECTIVE_DEFAULT_DAYS)]);
});

test("expireStaleProspective: кастомный порог передаётся как строка дней", async () => {
  const { calls, pg } = fakePg(0);
  await makeRepo(pg).expireStaleProspective(90);
  const call = calls.find((c) => c.sql === EXPIRE_STALE_PROSPECTIVE_SQL);
  assert.deepEqual(call!.params, ["ns-1", "90"]);
});

test("hygieneReport: возвращает 4 числовых счётчика, read-only (без delete/update)", async () => {
  const { calls, pg } = fakePg(5);
  const rep = await makeRepo(pg).hygieneReport();
  assert.deepEqual(rep, {
    staleProspective: 5,
    workingExpired: 5,
    factsTotal: 5,
    episodesTotal: 5,
  });
  for (const c of calls) {
    assert.doesNotMatch(c.sql, /\bdelete\b/i, "отчёт не должен удалять");
    assert.doesNotMatch(c.sql, /\bupdate\b/i, "отчёт не должен обновлять");
  }
});
