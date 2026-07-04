// Юнит-тесты транзакционной обёртки Postgres.tx (без реальной БД — фейковый пул).
// Проверяем: BEGIN/COMMIT на успехе, ROLLBACK на ошибке, release() всегда.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Postgres } from "../dist/db/postgres.js";

function fakePool() {
  const calls: string[] = [];
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async (text: string): Promise<any> => {
      calls.push(text);
      if (text === "__boom__") throw new Error("boom");
      return { rows: [{ id: "x" }] };
    },
    release: () => {
      calls.push("release");
    },
  };
  return { calls, pool: { connect: async () => client } };
}

test("tx: begin+commit+release on success, returns value", async () => {
  const pg = new Postgres("postgres://user:pw@localhost/db");
  const { calls, pool } = fakePool();
  (pg as unknown as { pool: unknown }).pool = pool;
  const r = await pg.tx(async (t) => {
    const row = await t.queryOne<{ id: string }>("insert ...");
    return row!.id;
  });
  assert.equal(r, "x");
  assert.deepEqual(calls, ["begin", "insert ...", "commit", "release"]);
});

test("tx: rollback+release on error, error propagates, no commit", async () => {
  const pg = new Postgres("postgres://user:pw@localhost/db");
  const { calls, pool } = fakePool();
  (pg as unknown as { pool: unknown }).pool = pool;
  await assert.rejects(
    pg.tx(async (t) => {
      await t.query("insert ...");
      await t.query("__boom__");
    }),
    /boom/,
  );
  assert.deepEqual(calls, ["begin", "insert ...", "__boom__", "rollback", "release"]);
});
