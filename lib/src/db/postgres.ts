// Прямое подключение к общей БД (Supabase Postgres) через пул pg.
// Батч-индексация и MCP-серверы используют пул; интерактивный агент — через MCP-tools.

import pg from "pg";
import type { Env } from "../config.js";

/** Скоуп запросов внутри транзакции (см. Postgres.tx). */
export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<T | undefined>;
}

export class Postgres {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    // Бюджет соединений к ОБЩЕЙ Supabase: несколько MCP-серверов делят лимит pooler'а с
    // основным приложением Nabu. Держим малый пул на процесс; переопределяется NABU_PG_POOL_MAX.
    const poolMax = Math.max(1, Number(process.env.NABU_PG_POOL_MAX ?? 3));
    this.pool = new pg.Pool({
      connectionString,
      max: poolMax,
      idleTimeoutMillis: 30_000,
      // TLS: по умолчанию не проверяем цепочку (Supabase pooler за TLS). Для строгой проверки
      // задать NABU_PG_SSL_STRICT=1 (и sslmode=verify-full/CA в DATABASE_URL). См. docs/SECURITY note.
      ssl: connectionString.includes("sslmode=disable")
        ? undefined
        : { rejectUnauthorized: process.env.NABU_PG_SSL_STRICT === "1" },
    });
  }

  static fromEnv(env: Env): Postgres {
    return new Postgres(env.databaseUrl);
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const res = await this.pool.query<T>(text, params as never[]);
    return res.rows;
  }

  async queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(text, params);
    return rows[0];
  }

  /** Разрешить (или создать) namespace по имени → его uuid. */
  async resolveNamespace(name: string): Promise<string> {
    const existing = await this.queryOne<{ id: string }>(
      "select id from mem_namespace where name = $1",
      [name],
    );
    if (existing) return existing.id;
    const created = await this.queryOne<{ id: string }>(
      "insert into mem_namespace(name) values ($1) on conflict (name) do update set name = excluded.name returning id",
      [name],
    );
    return created!.id;
  }

  /**
   * Выполнить fn в одной транзакции (BEGIN/COMMIT, ROLLBACK при исключении).
   * Нужно для атомарных мульти-write (ledger+sheet, series+value, delete+insert), чтобы
   * частичный сбой не оставлял БД в рассогласованном состоянии.
   */
  async tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const scoped = {
      query: async <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> =>
        (await client.query<R>(text, params as never[])).rows,
      queryOne: async <R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<R | undefined> =>
        (await client.query<R>(text, params as never[])).rows[0],
    } as Tx;
    try {
      await client.query("begin");
      const result = await fn(scoped);
      await client.query("commit");
      return result;
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {
        /* соединение могло уже упасть — пул его переработает */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
