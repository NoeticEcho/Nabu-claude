// База знаний из индексируемых папок: локальный чанкинг + эмбеддинги (Ollama) + pgvector.
// Приватный контент индексируется ЛОКАЛЬНО и не покидает машину.

import type { Postgres } from "../db/postgres.js";
import type { Embedder } from "../embeddings.js";
import { toVectorLiteral } from "../embeddings.js";
import type { Visibility } from "../types.js";
import { DomainClassifier } from "../domain-classify.js";

export type KnowledgeKind = "personal" | "library";

export interface KnowledgeHit {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  score: number;
  visibility: Visibility;
  kind: KnowledgeKind;
  domain?: string;
  title?: string;
}

export interface IndexOpts {
  visibility?: Visibility;
  kind?: KnowledgeKind;
  domain?: string;
  title?: string;
  origin?: string;
}

export interface KnowledgeSource {
  source: string;
  kind: KnowledgeKind;
  domain?: string;
  title?: string;
  origin?: string;
  chunks: number;
  addedAt: string;
  updatedAt: string;
}

/** Разбить текст на предложения (RU/EN). Держит разделитель; грубо не режет по «т.д.», «т.е.», инициалам. */
export function splitSentences(text: string): string[] {
  // Маскируем точку в инициалах/сокращениях (\u0000), чтобы не разрывать по ним; \u0001 — разделитель.
  const masked = text
    .replace(/\b([\u0410-\u042fA-Z])\.(\s)/g, "$1\u0000$2")
    .replace(/\b(\u0442\.\u0435|\u0442\.\u0434|\u0442\.\u043f|\u0441\u043c|\u0441\u0442\u0440|\u0440\u0438\u0441|\u0442\u0430\u0431\u043b|\u0434\u0440|\u043f\u0440|\u043d\u0430\u043f\u0440|\u0433\u043b|\u0441\u0442)\.(\s)/gi, (_m, a, sp) => a + "\u0000" + sp);
  const parts = masked.replace(/([.!?\u2026]+)(\s+|$)/g, "$1\u0001").split("\u0001");
  return parts.map((s) => s.replace(/\u0000/g, ".").trim()).filter(Boolean);
}

/**
 * Разбить текст на чанки ~maxChars, НЕ разрезая предложения. Упаковываем целыми абзацами; абзац
 * длиннее лимита режем по границам предложений; единственное сверхдлинное предложение — как крайность
 * режем жёстко. Перекрытие — на уровне предложений (последнее(-ие) предложение(-я) предыдущего чанка
 * добавляются в начало следующего) для непрерывности контекста.
 */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let cur = "";
  const flush = (): void => { const t = cur.trim(); if (t) chunks.push(t); cur = ""; };
  const push = (unit: string, sep = "\n"): void => {
    if (!unit) return;
    if (cur.length + unit.length + sep.length <= maxChars) { cur += (cur ? sep : "") + unit; return; }
    flush();
    if (unit.length <= maxChars) { cur = unit; return; }
    // Юнит (абзац) длиннее лимита — упаковываем его предложениями.
    for (const sent of splitSentences(unit)) {
      if (cur.length + sent.length + 1 <= maxChars) { cur += (cur ? " " : "") + sent; continue; }
      flush();
      if (sent.length <= maxChars) { cur = sent; }
      else { for (let i = 0; i < sent.length; i += maxChars) chunks.push(sent.slice(i, i + maxChars)); cur = ""; } // сверхдлинное предложение
    }
  };
  for (const para of clean.split(/\n{2,}/)) push(para.trim());
  flush();

  // Перекрытие по предложениям: в начало каждого чанка (кроме первого) — хвост предыдущего.
  if (overlap > 0) {
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1] ?? "", curChunk = chunks[i] ?? "";
      const sents = splitSentences(prev);
      let tail = "";
      for (let j = sents.length - 1; j >= 0 && tail.length < overlap; j--) tail = (sents[j] ?? "") + (tail ? " " + tail : "");
      if (tail && !curChunk.startsWith(tail)) chunks[i] = `${tail} ${curChunk}`;
    }
  }
  return chunks;
}

/**
 * Семантический чанкинг (опц., NABU_SEMANTIC_CHUNK=1): группирует предложения по смыслу. Эмбеддит
 * каждое предложение, начинает новый чанк, когда близость к текущему падает ниже порога ИЛИ размер
 * превышает лимит. Дороже (эмбеддинг на предложение) — на слабом CPU медленно, поэтому opt-in.
 */
export async function semanticChunk(
  text: string,
  embedder: { embed(t: string, v?: Visibility): Promise<number[]> },
  maxChars = 1500,
): Promise<string[]> {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const sents = splitSentences(clean);
  if (sents.length <= 1) return chunkText(clean, maxChars);
  const threshold = Number(process.env.NABU_SEMANTIC_THRESHOLD) || 0.5;
  const cos = (a: number[], b: number[]): number => {
    let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const x = a[i] as number, y = b[i] as number; d += x * y; na += x * x; nb += y * y; }
    return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  };
  const chunks: string[] = [];
  let cur = sents[0] ?? "";
  let curVec = await embedder.embed(cur, "default");
  for (let i = 1; i < sents.length; i++) {
    const s = sents[i] as string;
    const v = await embedder.embed(s, "default");
    const sim = cos(curVec, v);
    if (sim >= threshold && cur.length + s.length + 1 <= maxChars) {
      cur += " " + s;
      // скользящий центроид — среднее (грубо), чтобы чанк «держал» общий смысл
      curVec = curVec.map((x, k) => (x + (v[k] ?? 0)) / 2);
    } else {
      chunks.push(cur.trim()); cur = s; curVec = v;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Наиболее частый домен среди чанков (для домена источника в реестре при автоклассификации). */
function dominant(domains: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const d of domains) if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best: string | null = null, n = 0;
  for (const [d, c] of counts) if (c > n) { best = d; n = c; }
  return best;
}

export class KnowledgeRepository {
  private nsId: string | null = null;
  private classifier: DomainClassifier | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly embedder: Embedder,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  /** Индексировать один документ: перезаписывает его чанки (идемпотентно по source).
   *  opts.kind='library' + domain/title — reference-знание агентов (НЕ о пользователе). */
  async indexDocument(source: string, text: string, opts: IndexOpts | Visibility = {}): Promise<number> {
    // Обратная совместимость: раньше 3-м аргументом была visibility-строка.
    const o: IndexOpts = typeof opts === "string" ? { visibility: opts } : opts;
    const visibility: Visibility = o.visibility ?? (o.kind === "library" ? "default" : "private");
    const kind: KnowledgeKind = o.kind ?? "personal";
    // Приватность (аудит R6, M1): база знаний — публично-семантический слой (plaintext + эмбеддинг +
    // векторный поиск). Она НЕ шифрует vault. Поэтому vault сюда не принимаем.
    if (visibility === "vault") {
      throw new Error("vault нельзя индексировать в базу знаний (нет шифрования/исключения из поиска). Используйте vault-заметку в nabu-memory.");
    }
    const ns = await this.ns();
    // Чанкинг: по умолчанию — по границам предложений/абзацев (предложения не режутся). Опц.
    // семантический (NABU_SEMANTIC_CHUNK=1): группировка по смыслу через эмбеддинги (дороже).
    const chunks = process.env.NABU_SEMANTIC_CHUNK === "1"
      ? await semanticChunk(text, this.embedder)
      : chunkText(text);
    // Сначала считаем ВСЕ эмбеддинги (долгая часть — Ollama), и лишь потом мутируем БД.
    const vecs: number[][] = [];
    for (const chunk of chunks) vecs.push(await this.embedder.embed(chunk, visibility));
    const embedded = vecs.map(toVectorLiteral);

    // Домен per-chunk: явный o.domain на все, ЛИБО (library без домена) — автоклассификация каждого
    // чанка по таксономии (один источник может покрывать много тем — распределяем автоматически).
    const perChunkDomain: (string | null)[] = [];
    const auto = kind === "library" && !o.domain;
    if (auto) {
      if (!this.classifier) this.classifier = new DomainClassifier(this.embedder);
      for (const v of vecs) perChunkDomain.push((await this.classifier.classifyVec(v)).domain);
    } else {
      for (let i = 0; i < chunks.length; i++) perChunkDomain.push(o.domain ?? null);
    }
    // Домен источника в реестре: явный, иначе доминирующий среди авто-доменов (для обзора).
    const srcDomain = o.domain ?? dominant(perChunkDomain);

    await this.pg.tx(async (t) => {
      await t.query("delete from knowledge_chunk where namespace = $1 and source = $2", [ns, source]);
      for (let i = 0; i < chunks.length; i++) {
        await t.query(
          `insert into knowledge_chunk(namespace, source, chunk_index, content, visibility, kind, domain, title, embedding)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)
           on conflict (namespace, source, chunk_index) do update
             set content = excluded.content, embedding = excluded.embedding, visibility = excluded.visibility,
                 kind = excluded.kind, domain = excluded.domain, title = excluded.title`,
          [ns, source, i, chunks[i], visibility, kind, perChunkDomain[i], o.title ?? null, embedded[i]],
        );
      }
      await t.query(
        `insert into knowledge_source(namespace, source, kind, domain, title, origin, chunks, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (namespace, source) do update
           set kind = excluded.kind, domain = excluded.domain, title = excluded.title,
               origin = excluded.origin, chunks = excluded.chunks, updated_at = now()`,
        [ns, source, kind, srcDomain, o.title ?? null, o.origin ?? source, chunks.length],
      );
    });
    return chunks.length;
  }

  /** Семантический поиск. opts.domain / opts.kind — сузить область (агент ищет в своём домене). */
  async search(query: string, opts: { topK?: number; domain?: string; kind?: KnowledgeKind } | number = {}): Promise<KnowledgeHit[]> {
    const o = typeof opts === "number" ? { topK: opts } : opts; // обратная совместимость (search(q, topK))
    const topK = o.topK ?? 8;
    const ns = await this.ns();
    const qEmb = toVectorLiteral(await this.embedder.embedQuery(query));
    const conds = ["namespace = $1", "embedding is not null", "visibility <> 'vault'"];
    const params: unknown[] = [ns, qEmb, topK];
    if (o.kind) { params.push(o.kind); conds.push(`kind = $${params.length}`); }
    if (o.domain) { params.push(o.domain); conds.push(`domain = $${params.length}`); }
    const rows = await this.pg.query<{
      id: string; source: string; chunk_index: number; content: string;
      visibility: string; kind: string; domain: string | null; title: string | null; score: number;
    }>(
      `select id, source, chunk_index, content, visibility, kind, domain, title,
              1 - (embedding <=> $2::vector) as score
       from knowledge_chunk
       where ${conds.join(" and ")}
       order by embedding <=> $2::vector
       limit $3`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      chunkIndex: r.chunk_index,
      content: r.content,
      score: Number(r.score),
      visibility: r.visibility as Visibility,
      kind: r.kind as KnowledgeKind,
      domain: r.domain ?? undefined,
      title: r.title ?? undefined,
    }));
  }

  /** Список источников библиотеки (реестр). */
  async listSources(opts: { kind?: KnowledgeKind; domain?: string } = {}): Promise<KnowledgeSource[]> {
    const ns = await this.ns();
    const conds = ["namespace = $1"];
    const params: unknown[] = [ns];
    if (opts.kind) { params.push(opts.kind); conds.push(`kind = $${params.length}`); }
    if (opts.domain) { params.push(opts.domain); conds.push(`domain = $${params.length}`); }
    const rows = await this.pg.query<{
      source: string; kind: string; domain: string | null; title: string | null;
      origin: string | null; chunks: number; added_at: string; updated_at: string;
    }>(
      `select source, kind, domain, title, origin, chunks, added_at, updated_at
       from knowledge_source where ${conds.join(" and ")} order by updated_at desc`,
      params,
    );
    return rows.map((r) => ({
      source: r.source, kind: r.kind as KnowledgeKind, domain: r.domain ?? undefined,
      title: r.title ?? undefined, origin: r.origin ?? undefined, chunks: Number(r.chunks),
      addedAt: r.added_at, updatedAt: r.updated_at,
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
