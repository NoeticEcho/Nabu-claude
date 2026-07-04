// База знаний из индексируемых папок: локальный чанкинг + эмбеддинги (Ollama) + pgvector.
// Приватный контент индексируется ЛОКАЛЬНО и не покидает машину.

import type { Postgres } from "../db/postgres.js";
import type { Embedder } from "../embeddings.js";
import { toVectorLiteral } from "../embeddings.js";
import type { Visibility } from "../types.js";

export interface KnowledgeHit {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  score: number;
  visibility: Visibility;
}

/** Разбить текст на чанки ~maxChars с перекрытием, по границам абзацев/предложений. */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // отступить до ближайшей границы абзаца/предложения/пробела
      const slice = clean.slice(start, end);
      const br = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf("\n"));
      if (br > maxChars * 0.5) end = start + br + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

export class KnowledgeRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly embedder: Embedder,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  /** Индексировать один документ: перезаписывает его чанки (идемпотентно по source). */
  async indexDocument(source: string, text: string, visibility: Visibility = "private"): Promise<number> {
    const ns = await this.ns();
    const chunks = chunkText(text);
    // Сначала считаем ВСЕ эмбеддинги (долгая часть — Ollama), и лишь потом мутируем БД:
    // так окно между delete и insert минимально (крах на эмбеддинге не оставит документ пустым).
    const embedded: string[] = [];
    for (const chunk of chunks) embedded.push(toVectorLiteral(await this.embedder.embed(chunk, visibility)));

    // Атомарно: delete + reinsert чанков документа (частичный сбой не оставит документ полу-переиндексированным).
    await this.pg.tx(async (t) => {
      await t.query("delete from knowledge_chunk where namespace = $1 and source = $2", [ns, source]);
      for (let i = 0; i < chunks.length; i++) {
        await t.query(
          `insert into knowledge_chunk(namespace, source, chunk_index, content, visibility, embedding)
           values ($1,$2,$3,$4,$5,$6::vector)
           on conflict (namespace, source, chunk_index) do update
             set content = excluded.content, embedding = excluded.embedding, visibility = excluded.visibility`,
          [ns, source, i, chunks[i], visibility, embedded[i]],
        );
      }
    });
    return chunks.length;
  }

  async search(query: string, topK = 8): Promise<KnowledgeHit[]> {
    const ns = await this.ns();
    const qEmb = toVectorLiteral(await this.embedder.embedQuery(query));
    const rows = await this.pg.query<{
      id: string;
      source: string;
      chunk_index: number;
      content: string;
      visibility: string;
      score: number;
    }>(
      `select id, source, chunk_index, content, visibility,
              1 - (embedding <=> $2::vector) as score
       from knowledge_chunk
       where namespace = $1 and embedding is not null
       order by embedding <=> $2::vector
       limit $3`,
      [ns, qEmb, topK],
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: Number(r.score),
      visibility: r.visibility as Visibility,
    }));
  }

  async stats(): Promise<{ documents: number; chunks: number }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ documents: string; chunks: string }>(
      `select count(distinct source) as documents, count(*) as chunks
       from knowledge_chunk where namespace = $1`,
      [ns],
    );
    return { documents: Number(row?.documents ?? 0), chunks: Number(row?.chunks ?? 0) };
  }
}
