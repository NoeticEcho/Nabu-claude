// Локальные эмбеддинги через Ollama. Приватный контент (private/vault) НИКОГДА не
// уходит в облако — только этот локальный путь. Тяжёлая операция вынесена из Claude.

import type { Env } from "./config.js";
import type { Visibility } from "./types.js";

export class Embedder {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly dimension: number,
  ) {}

  static fromEnv(env: Env, dimension = 768): Embedder {
    return new Embedder(env.ollamaBaseUrl, env.ollamaEmbedModel, dimension);
  }

  get dim(): number {
    return this.dimension;
  }

  /** nomic-embed-text-v2 требует task-префиксы; для других моделей — без изменений. */
  private prefix(text: string, task: "document" | "query"): string {
    if (/nomic-embed/i.test(this.model)) {
      return task === "query" ? `search_query: ${text}` : `search_document: ${text}`;
    }
    return text;
  }

  /** Эмбеддинг документа/факта для хранения. private/vault — только локально. */
  async embed(text: string, _visibility: Visibility = "private"): Promise<number[]> {
    return this.embedRaw(this.prefix(text, "document"));
  }

  /** Эмбеддинг поискового запроса (task=query для корректной близости у nomic). */
  async embedQuery(text: string): Promise<number[]> {
    return this.embedRaw(this.prefix(text, "query"));
  }

  private async embedRaw(text: string): Promise<number[]> {
    // Таймаут: зависший Ollama не должен блокировать батч-индексацию навечно.
    // Дефолт 120с: CPU-инференс nomic-v2-moe на длинном чанке реально занимает ~30–60с
    // (замерено: 780 символов ≈ 48с на обычном десктопе). Переопределяется NABU_EMBED_TIMEOUT_MS.
    const timeoutMs = Number(process.env.NABU_EMBED_TIMEOUT_MS ?? 120_000);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") {
        throw new Error(`Ollama embeddings timeout (${timeoutMs}ms) — модель зависла или недоступна`);
      }
      throw e;
    }
    if (!res.ok) {
      throw new Error(`Ollama embeddings failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { embedding?: number[] };
    const emb = json.embedding;
    if (!emb || emb.length === 0) {
      throw new Error("Ollama вернул пустой эмбеддинг");
    }
    if (emb.length !== this.dimension) {
      throw new Error(
        `Размерность эмбеддинга ${emb.length} ≠ ожидаемой ${this.dimension} (модель ${this.model})`,
      );
    }
    return emb;
  }

  /** Проверка доступности Ollama (для smoke/health). */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Формат pgvector-литерала для параметра запроса: '[0.1,0.2,...]'. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
