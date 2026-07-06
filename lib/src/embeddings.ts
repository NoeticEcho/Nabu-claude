// Эмбеддинги: локальная Ollama (по умолчанию) ИЛИ любой OpenAI-совместимый API (облако или
// приватный self-hosted сервер пользователя). Развязывает Nabu и модель по разным машинам.
//
// ПРИВАТНОСТЬ (инвариант #2): по умолчанию — локальная Ollama, ничего не уходит в сеть. Удалённый
// провайдер (`NABU_EMBED_PROVIDER=openai` + OPENAI_EMBED_BASE_URL) — ЯВНЫЙ выбор пользователя: он
// направляет эмбеддинги на СВОЙ приватный сервер (приватность сохранена) или на облако (компромисс
// приватности — на его ответственность). Если endpoint не loopback/приватный, а контент private/
// vault — требуется явное согласие `NABU_EMBED_ALLOW_REMOTE=1` (иначе отказ).

import type { Env } from "./config.js";
import type { Visibility } from "./types.js";

type Provider = "ollama" | "openai";

export class Embedder {
  private readonly provider: Provider;
  private readonly apiKey: string;
  private readonly sendDimensions: boolean;
  private readonly allowRemote: boolean;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimension: number,
    opts: { provider?: Provider; apiKey?: string; sendDimensions?: boolean; allowRemote?: boolean } = {},
  ) {
    this.provider = opts.provider ?? "ollama";
    this.apiKey = opts.apiKey ?? "";
    this.sendDimensions = opts.sendDimensions ?? false;
    this.allowRemote = opts.allowRemote ?? false;
  }

  static fromEnv(env: Env, dimension = 768): Embedder {
    const dim = Number(process.env.NABU_EMBED_DIM) || dimension;
    // Провайдер: явный NABU_EMBED_PROVIDER, либо 'openai' если задан OPENAI_EMBED_BASE_URL.
    const explicit = (process.env.NABU_EMBED_PROVIDER || "").toLowerCase();
    const openaiBase = process.env.OPENAI_EMBED_BASE_URL;
    const provider: Provider = explicit === "openai" || (explicit !== "ollama" && !!openaiBase) ? "openai" : "ollama";
    if (provider === "openai") {
      const base = (openaiBase || "https://api.openai.com/v1").replace(/\/$/, "");
      const model = process.env.OPENAI_EMBED_MODEL || env.ollamaEmbedModel;
      return new Embedder(base, model, dim, {
        provider: "openai",
        apiKey: process.env.OPENAI_EMBED_API_KEY || process.env.OPENAI_API_KEY || "",
        sendDimensions: process.env.NABU_EMBED_DIMENSIONS === "1" || /text-embedding-3/i.test(model),
        allowRemote: process.env.NABU_EMBED_ALLOW_REMOTE === "1",
      });
    }
    return new Embedder(env.ollamaBaseUrl, env.ollamaEmbedModel, dim, { provider: "ollama" });
  }

  get dim(): number {
    return this.dimension;
  }

  /** true, если endpoint — loopback/приватный хост (безопасно слать private/vault). */
  private isLocalEndpoint(): boolean {
    try {
      const h = new URL(this.baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
      return h === "localhost" || h.endsWith(".localhost") || h === "::1"
        || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)
        || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
    } catch { return false; }
  }

  /** Гейт приватности: удалённый endpoint + private/vault без явного согласия → отказ. */
  private assertPrivacy(visibility: Visibility): void {
    if (this.provider === "ollama") return; // локальный путь — ок
    if (this.isLocalEndpoint()) return; // приватный self-hosted сервер — ок
    if (visibility === "private" || visibility === "vault") {
      if (!this.allowRemote) {
        throw new Error(
          `Отказ (приватность): эмбеддинг ${visibility}-контента на УДАЛЁННЫЙ endpoint (${this.baseUrl}). ` +
          `Направьте OPENAI_EMBED_BASE_URL на свой приватный сервер, ИЛИ явно разрешите облако через ` +
          `NABU_EMBED_ALLOW_REMOTE=1 (компромисс приватности — на вашу ответственность).`,
        );
      }
    }
  }

  /** nomic-embed-text-v2 требует task-префиксы (только Ollama-nomic); для прочих — без изменений. */
  private prefix(text: string, task: "document" | "query"): string {
    if (this.provider === "ollama" && /nomic-embed/i.test(this.model)) {
      return task === "query" ? `search_query: ${text}` : `search_document: ${text}`;
    }
    return text;
  }

  /** Эмбеддинг документа/факта для хранения. */
  async embed(text: string, visibility: Visibility = "private"): Promise<number[]> {
    this.assertPrivacy(visibility);
    const [v] = await this.embedInputs([this.prefix(text, "document")]);
    return v!;
  }

  /** Эмбеддинг поискового запроса. */
  async embedQuery(text: string): Promise<number[]> {
    // Запрос обычно менее чувствителен, но применяем тот же гейт консервативно (private).
    this.assertPrivacy("private");
    const [v] = await this.embedInputs([this.prefix(text, "query")]);
    return v!;
  }

  /** Эмбеддинг набора чанков. Для OpenAI — нативный батч (быстро); для Ollama — поштучно. */
  async embedBatch(texts: string[], visibility: Visibility = "private"): Promise<number[][]> {
    if (texts.length === 0) return [];
    this.assertPrivacy(visibility);
    const inputs = texts.map((t) => this.prefix(t, "document"));
    if (this.provider === "openai") {
      const out: number[][] = [];
      const B = Math.max(1, Number(process.env.NABU_EMBED_BATCH) || 64);
      for (let i = 0; i < inputs.length; i += B) out.push(...(await this.embedInputs(inputs.slice(i, i + B))));
      return out;
    }
    const out: number[][] = [];
    for (const t of inputs) out.push((await this.embedInputs([t]))[0]!);
    return out;
  }

  /** Низкоуровневый эмбеддинг набора входов (после префиксов). Возвращает массив векторов.
   *  Ретрай с backoff на транзиентных сбоях (сеть/429/5xx) — критично для облачных провайдеров
   *  при массовой индексации (замечено: ~23% файлов падали на «fetch failed» без ретрая). */
  private async embedInputs(inputs: string[]): Promise<number[][]> {
    const timeoutMs = Number(process.env.NABU_EMBED_TIMEOUT_MS ?? 120_000);
    const tries = Math.max(1, Number(process.env.NABU_EMBED_RETRIES) || 4);
    let lastErr: unknown;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        // Жёсткий предохранитель поверх AbortSignal: даже если чтение тела ответа зависнет
        // (заголовки пришли, а поток тела встал — AbortSignal не всегда прерывает res.json()),
        // Promise.race гарантированно освободит прогон. Замечено: без него массовая индексация
        // «висла» на отдельных файлах бесконечно.
        const hardMs = timeoutMs + 5_000;
        const call = this.provider === "openai"
          ? this.embedOpenAI(inputs, timeoutMs)
          : this.embedOllama(inputs, timeoutMs);
        return await Promise.race([
          call,
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`embed hard-timeout (${hardMs}ms)`)), hardMs).unref?.()),
        ]);
      } catch (e) {
        lastErr = e;
        if (!isTransient(e) || attempt === tries - 1) throw e;
        // backoff: 0.5s, 1s, 2s… + джиттер по номеру попытки (детерминированно, без Math.random)
        const delay = 500 * 2 ** attempt + attempt * 137;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  private async embedOllama(inputs: string[], timeoutMs: number): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of inputs) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        if ((e as Error).name === "TimeoutError") throw new Error(`Ollama embeddings timeout (${timeoutMs}ms) — модель зависла или недоступна`);
        throw e;
      }
      if (!res.ok) throw new Error(`Ollama embeddings failed: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { embedding?: number[] };
      out.push(this.validate(json.embedding));
    }
    return out;
  }

  private async embedOpenAI(inputs: string[], timeoutMs: number): Promise<number[][]> {
    if (!this.apiKey) throw new Error("OpenAI-эмбеддер: не задан OPENAI_EMBED_API_KEY");
    const body: Record<string, unknown> = { model: this.model, input: inputs };
    if (this.sendDimensions) body.dimensions = this.dimension; // text-embedding-3 и совместимые
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new Error(`OpenAI embeddings timeout (${timeoutMs}ms) — endpoint ${this.baseUrl} недоступен`);
      throw e;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings failed: ${res.status} ${res.statusText} ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[]; index?: number }> };
    const data = json.data ?? [];
    // Сортируем по index (порядок гарантирован спецификацией, но подстрахуемся).
    data.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== inputs.length) throw new Error(`OpenAI вернул ${data.length} эмбеддингов вместо ${inputs.length}`);
    return data.map((d) => this.validate(d.embedding));
  }

  private validate(emb: number[] | undefined): number[] {
    if (!emb || emb.length === 0) throw new Error("Провайдер вернул пустой эмбеддинг");
    if (emb.length !== this.dimension) {
      throw new Error(`Размерность эмбеддинга ${emb.length} ≠ ожидаемой ${this.dimension} (модель ${this.model}). Задайте NABU_EMBED_DIM или dimensions.`);
    }
    return emb;
  }

  /** Проверка доступности провайдера (для smoke/health). */
  async ping(): Promise<boolean> {
    try {
      if (this.provider === "openai") {
        const [v] = await this.embedInputs(["ping"]);
        return Array.isArray(v) && v.length === this.dimension;
      }
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Транзиентная ли ошибка (стоит ретраить): сетевой сбой, таймаут, 429, 5xx. */
function isTransient(e: unknown): boolean {
  const err = e as { name?: string; message?: string; cause?: unknown };
  const msg = (err?.message || "").toLowerCase();
  if (err?.name === "TimeoutError" || msg.includes("timeout")) return true;
  if (msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("enotfound")
    || msg.includes("econnrefused") || msg.includes("socket") || msg.includes("network")) return true;
  // HTTP-статус в тексте («… failed: 429 …» / «… 503 …»): ретраим 429 и 5xx.
  const m = msg.match(/\b(429|5\d\d)\b/);
  return !!m;
}

/** Формат pgvector-литерала для параметра запроса: '[0.1,0.2,...]'. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
