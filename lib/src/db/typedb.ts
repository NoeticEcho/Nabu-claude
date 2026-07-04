// Клиент TypeDB 3.x через нативный HTTP API (без npm-драйвера — на npm только 2.x,
// протокольно несовместимый с сервером 3.x). Аутентификация: POST /v1/signin → token;
// запросы: POST /v1/query {databaseName, transactionType, query} (one-shot, сам коммитит).
//
// Graceful-degradation: если эндпоинт/креды недоступны, available=false и вызывающая
// сторона (memory/pipeline server) работает на Postgres (best-practices: tool unavailable
// → безопасный fallback). Интерактивный агент может ходить в граф через TypeDB MCP напрямую.

import type { Env } from "../config.js";

type TxType = "read" | "write" | "schema";

export function normalizeBaseUrl(url: string): string {
  // Убираем хвостовой слэш; схему/порт оставляем как в .env.
  return url.replace(/\/+$/, "");
}

export class GraphClient {
  private token: string | null = null;
  private _available: boolean | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly database: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  static fromEnv(env: Env): GraphClient {
    return new GraphClient(
      normalizeBaseUrl(env.typedb.url),
      env.typedb.database,
      env.typedb.username,
      env.typedb.password,
    );
  }

  private async signin(): Promise<boolean> {
    if (!this.baseUrl || !this.password) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v1/signin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: this.username, password: this.password }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { token?: string };
      if (!json.token) return false;
      this.token = json.token;
      return true;
    } catch {
      return false;
    }
  }

  /** Проверка/логин. Кэшируем ТОЛЬКО успех: если TypeDB был недоступен, повторяем при следующем
   * вызове (длинноживущий сервер сможет восстановиться после возврата TypeDB). Никогда не бросает. */
  async connect(): Promise<boolean> {
    if (this._available === true) return true;
    this._available = await this.signin();
    return this._available;
  }

  get available(): boolean {
    return this._available === true;
  }

  private async runQuery(query: string, transactionType: TxType, retried = false): Promise<unknown> {
    if (!(await this.connect())) throw new Error("TypeDB недоступен");
    const res = await fetch(`${this.baseUrl}/v1/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ databaseName: this.database, transactionType, query }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 && !retried) {
      // токен истёк — перелогин РОВНО один раз (без неограниченной рекурсии).
      this.token = null;
      if (await this.signin()) return this.runQuery(query, transactionType, true);
    }
    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      throw new Error(`TypeDB query failed: ${res.status} ${res.statusText} — ${body}`);
    }
    return res.json();
  }

  async define(tql: string): Promise<void> {
    await this.runQuery(tql, "schema");
  }
  async write(tql: string): Promise<void> {
    await this.runQuery(tql, "write");
  }
  async read(tql: string): Promise<unknown> {
    return this.runQuery(tql, "read");
  }

  async close(): Promise<void> {
    this.token = null;
  }
}

/** Экранирование строкового значения для TypeQL-литерала (включая переводы строк/таб). */
export function tqlString(s: string): string {
  const esc = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${esc}"`;
}
