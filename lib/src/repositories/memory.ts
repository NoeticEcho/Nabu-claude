// Реализация MemoryPort на Postgres + pgvector + локальные эмбеддинги (Ollama).
// Все операции скоупятся по namespace. private/vault эмбеддятся локально (единственный путь).

import type { Postgres } from "../db/postgres.js";
import type { Embedder } from "../embeddings.js";
import { toVectorLiteral } from "../embeddings.js";
import { encryptVault, tryDecrypt } from "../vault-crypto.js";
import type { MemoryPort, RecallQuery } from "../ports.js";
import type {
  Episode,
  Fact,
  Prospective,
  Procedure,
  WorkingItem,
  RecallHit,
} from "../types.js";

// ── Детерминированная гигиена памяти (ROADMAP v0.17-9) ──
// Порог «протухания» намерения: pending-намерение со сработавшим временем-триггером старше
// стольких дней считается кандидатом на expired. Один источник правды для expire+report.
export const STALE_PROSPECTIVE_DEFAULT_DAYS = 30;

// SQL дедупа semantic_facts. Экспортируется для shape-тестов (проверяют оконную функцию и
// исключение vault текстуально). $1 = namespace. Оставляем самую старую строку каждой группы
// (min created_at, tie-break min id), удаляем остальные.
// ВАЖНО: vault-строки шифруются с уникальным IV, поэтому их шифртексты (subject/predicate/object)
// никогда не совпадут даже для семантически одинаковых фактов — дедуп по ним честно невозможен.
// Поэтому visibility='vault' исключён из выборки (`visibility <> 'vault'`).
export const DEDUP_FACTS_SQL = `with d as (
  delete from semantic_facts
  where id in (
    select id from (
      select id,
             row_number() over (
               partition by namespace, subject, predicate, object
               order by created_at asc, id asc
             ) as rn
      from semantic_facts
      where namespace = $1 and visibility <> 'vault'
    ) t
    where t.rn > 1
  )
  returning 1
)
select count(*)::text as n from d`;

// SQL перевода протухших намерений в status='expired'. $1 = namespace, $2 = число дней.
// В схеме нет CHECK-констрейнта на status (лишь комментарий pending|done|cancelled), поэтому
// 'expired' вставляется свободно; комментарий схемы дополнен этим статусом аддитивно.
export const EXPIRE_STALE_PROSPECTIVE_SQL = `with u as (
  update prospective_memory
  set status = 'expired'
  where namespace = $1
    and status = 'pending'
    and trigger_at is not null
    and trigger_at < now() - ($2 || ' days')::interval
  returning 1
)
select count(*)::text as n from u`;

export class MemoryRepository implements MemoryPort {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly embedder: Embedder,
    private readonly namespace: string,
    // Дефолты из config/nabu.config.json (memory.*): раньше были захардкожены.
    private readonly opts: { workingTtlHours?: number; retrievalTopK?: number } = {},
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async rememberEpisode(e: Episode): Promise<{ id: string }> {
    const ns = await this.ns();
    // Vault (инвариант #2): шифруем содержимое ДО записи и НЕ считаем эмбеддинг — plaintext
    // vault не должен попасть даже к локальному Ollama. Как следствие, векторный поиск по vault
    // намеренно невозможен (embedding = null): за приватность платим отсутствием recall.
    const isVault = e.visibility === "vault";
    const event = isVault ? encryptVault(e.event) : e.event;
    // Vault-утечка (аудит r2 §1.2): actors (имена людей!) и context (места/источники) раньше
    // писались плейнтекстом. Теперь для vault шифруем каждый элемент actors и context целиком
    // (jsonb хранит {"$vault": "<enc>"}). Старые vault-строки не мигрируются (см. AUDIT).
    const actors = isVault ? e.actors.map((a) => encryptVault(a)) : e.actors;
    const context = isVault ? { $vault: encryptVault(JSON.stringify(e.context)) } : e.context;
    const emb = isVault ? null : toVectorLiteral(await this.embedder.embed(e.event, e.visibility));
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into episodic_memory(namespace, event, occurred_at, actors, emotion, context, visibility, embedding)
       values ($1,$2,coalesce($3, now()),$4,$5,$6,$7,$8::vector)
       returning id`,
      [
        ns,
        event,
        e.occurredAt ?? null,
        actors,
        e.emotion ?? null,
        JSON.stringify(context),
        e.visibility,
        emb,
      ],
    );
    return { id: row!.id };
  }

  async addFact(f: Fact): Promise<{ id: string }> {
    const ns = await this.ns();
    // Vault: каждое чувствительное поле (subject/predicate/object) шифруем до записи; эмбеддинг
    // не считаем (см. rememberEpisode) — embedding = null, vault недоступен векторному поиску.
    const isVault = f.visibility === "vault";
    const subject = isVault ? encryptVault(f.subject) : f.subject;
    const predicate = isVault ? encryptVault(f.predicate) : f.predicate;
    const object = isVault ? encryptVault(f.object) : f.object;
    // source тоже может быть чувствительным («визит к Dr. X») — шифруем для vault (аудит r2).
    const source = isVault && f.source ? encryptVault(f.source) : (f.source ?? null);
    const emb = isVault
      ? null
      : toVectorLiteral(await this.embedder.embed(`${f.subject} ${f.predicate} ${f.object}`, f.visibility));
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into semantic_facts(namespace, subject, predicate, object, confidence, source, visibility, embedding)
       values ($1,$2,$3,$4,$5,$6,$7,$8::vector)
       returning id`,
      [ns, subject, predicate, object, f.confidence, source, f.visibility, emb],
    );
    return { id: row!.id };
  }

  /**
   * ЯВНОЕ чтение vault-памяти: недавние episodic+semantic строки с visibility='vault',
   * расшифрованные локальным ключом через tryDecrypt (никогда не бросает — при отсутствии/
   * неверном ключе отдаёт заглушку). Обходит recall намеренно: vault недоступен по вектору
   * (embedding=null), это единственный путь его прочитать — только по прямой просьбе пользователя.
   */
  async listVaultRecent(
    limit = 20,
  ): Promise<Array<{ kind: "episodic" | "semantic"; text: string; occurredAt?: string }>> {
    const ns = await this.ns();
    const [eps, facts] = await Promise.all([
      this.pg.query<{ event: string; occurred_at: string }>(
        `select event, occurred_at from episodic_memory
         where namespace = $1 and visibility = 'vault'
         order by occurred_at desc limit $2`,
        [ns, limit],
      ),
      this.pg.query<{ subject: string; predicate: string; object: string }>(
        `select subject, predicate, object from semantic_facts
         where namespace = $1 and visibility = 'vault'
         order by created_at desc limit $2`,
        [ns, limit],
      ),
    ]);
    const out: Array<{ kind: "episodic" | "semantic"; text: string; occurredAt?: string }> = [];
    for (const r of eps)
      out.push({ kind: "episodic", text: tryDecrypt(r.event), occurredAt: r.occurred_at });
    for (const r of facts)
      out.push({
        kind: "semantic",
        text: `${tryDecrypt(r.subject)} — ${tryDecrypt(r.predicate)} — ${tryDecrypt(r.object)}`,
      });
    return out;
  }

  async setWorking(w: WorkingItem): Promise<{ id: string }> {
    const ns = await this.ns();
    // TTL из конфига (working_ttl_hours). Явно вычисляем expires_at, а не полагаемся на DEFAULT схемы.
    const ttlHours = this.opts.workingTtlHours ?? 24;
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into working_memory(namespace, session_id, content, meta, expires_at)
       values ($1,$2,$3,$4, now() + ($5 || ' hours')::interval) returning id`,
      [ns, w.sessionId, w.content, JSON.stringify(w.meta), String(ttlHours)],
    );
    return { id: row!.id };
  }

  async getWorking(sessionId: string): Promise<Array<{ id: string; content: string }>> {
    const ns = await this.ns();
    return this.pg.query<{ id: string; content: string }>(
      `select id, content from working_memory
       where namespace = $1 and session_id = $2 and expires_at > now()
       order by created_at asc`,
      [ns, sessionId],
    );
  }

  async addProspective(p: Prospective): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into prospective_memory(namespace, intent, trigger_at, trigger_cond)
       values ($1,$2,$3,$4) returning id`,
      [ns, p.intent, p.triggerAt ?? null, p.triggerCond ? JSON.stringify(p.triggerCond) : null],
    );
    return { id: row!.id };
  }

  async listProspective(): Promise<Array<{ id: string; intent: string; triggerAt?: string }>> {
    const ns = await this.ns();
    const rows = await this.pg.query<{ id: string; intent: string; trigger_at: string | null }>(
      `select id, intent, trigger_at from prospective_memory
       where namespace = $1 and status = 'pending'
       order by trigger_at asc nulls last`,
      [ns],
    );
    return rows.map((r) => ({ id: r.id, intent: r.intent, triggerAt: r.trigger_at ?? undefined }));
  }

  /** Недавние эпизоды по времени (для консолидации/рефлексии). */
  async listRecentEpisodes(
    limit = 50,
    sinceDays?: number,
  ): Promise<Array<{ id: string; event: string; occurredAt: string; emotion?: string; visibility: string }>> {
    const ns = await this.ns();
    const rows = await this.pg.query<{
      id: string;
      event: string;
      occurred_at: string;
      emotion: string | null;
      visibility: string;
    }>(
      `select id, event, occurred_at, emotion, visibility from episodic_memory
       where namespace = $1 ${sinceDays ? "and occurred_at > now() - ($2 || ' days')::interval" : ""}
       order by occurred_at desc limit ${sinceDays ? "$3" : "$2"}`,
      sinceDays ? [ns, String(sinceDays), limit] : [ns, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      occurredAt: r.occurred_at,
      emotion: r.emotion ?? undefined,
      visibility: r.visibility,
    }));
  }

  /** Сохранить/обновить автобиографический нарратив за период (идемпотентно по period). */
  async saveNarrative(period: string, narrative: string): Promise<{ id: string }> {
    const ns = await this.ns();
    const emb = toVectorLiteral(await this.embedder.embed(narrative, "private"));
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into autobiographical_narrative(namespace, period, narrative, embedding)
       values ($1,$2,$3,$4::vector)
       on conflict (namespace, period) do update set narrative = excluded.narrative, embedding = excluded.embedding
       returning id`,
      [ns, period, narrative, emb],
    );
    return { id: row!.id };
  }

  /**
   * Ретенция серверной истории чата (chat_message, аудит r2 §3.5): удалить сообщения старше
   * olderThanDays. Вызывается internal-джобом 'chat-retention' демона (по умолчанию выключен).
   */
  async purgeChatHistory(olderThanDays = 180): Promise<number> {
    const ns = await this.ns();
    const rows = await this.pg.query<{ n: string }>(
      `with d as (delete from chat_message where namespace = $1 and created_at < now() - ($2 || ' days')::interval returning 1)
       select count(*)::text as n from d`,
      [ns, String(olderThanDays)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Удалить истёкшую рабочую память (TTL-гигиена). Возвращает число удалённых строк. */
  async purgeExpiredWorking(): Promise<number> {
    const rows = await this.pg.query<{ n: string }>(
      "with d as (delete from working_memory where expires_at < now() returning 1) select count(*)::text as n from d",
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Гигиена проспективной памяти: перевести протухшие намерения в status='expired' —
   * pending со сработавшим временем-триггером (trigger_at не NULL и старше olderThanDays дней).
   * НЕ удаляет строки (гигиена без удаления воспоминаний), только меняет статус. Намерения без
   * времени-триггера (только trigger_cond) не трогаются — их «протухание» неопределимо детерминированно.
   * Возвращает число обновлённых строк.
   */
  async expireStaleProspective(olderThanDays = STALE_PROSPECTIVE_DEFAULT_DAYS): Promise<number> {
    const ns = await this.ns();
    const rows = await this.pg.query<{ n: string }>(EXPIRE_STALE_PROSPECTIVE_SQL, [
      ns,
      String(olderThanDays),
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Дедуп точных дублей семантических фактов: в группе (namespace, subject, predicate, object)
   * оставить самую старую строку (min created_at, tie-break min id), удалить остальные. Один
   * SQL с оконной функцией row_number(). Возвращает число удалённых строк.
   * ВАЖНО: vault-строки шифруются с уникальным IV — их шифртексты никогда не совпадут, поэтому
   * дедуп по ним честно не работает; visibility='vault' исключён из выборки (см. DEDUP_FACTS_SQL).
   */
  async dedupSemanticFacts(): Promise<number> {
    const ns = await this.ns();
    const rows = await this.pg.query<{ n: string }>(DEDUP_FACTS_SQL, [ns]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Read-only отчёт гигиены (кандидаты, ничего не меняет). staleProspective — кандидаты по
   * критерию expireStaleProspective (порог STALE_PROSPECTIVE_DEFAULT_DAYS); workingExpired —
   * истёкшая рабочая память (expires_at < now()); factsTotal / episodesTotal — всего строк
   * в неймспейсе. Все счётчики скоупятся по namespace.
   */
  async hygieneReport(): Promise<{
    staleProspective: number;
    workingExpired: number;
    factsTotal: number;
    episodesTotal: number;
  }> {
    const ns = await this.ns();
    const [stale, working, facts, episodes] = await Promise.all([
      this.pg.queryOne<{ n: string }>(
        `select count(*) as n from prospective_memory
         where namespace = $1 and status = 'pending'
           and trigger_at is not null
           and trigger_at < now() - ($2 || ' days')::interval`,
        [ns, String(STALE_PROSPECTIVE_DEFAULT_DAYS)],
      ),
      this.pg.queryOne<{ n: string }>(
        `select count(*) as n from working_memory where namespace = $1 and expires_at < now()`,
        [ns],
      ),
      this.pg.queryOne<{ n: string }>(
        `select count(*) as n from semantic_facts where namespace = $1`,
        [ns],
      ),
      this.pg.queryOne<{ n: string }>(
        `select count(*) as n from episodic_memory where namespace = $1`,
        [ns],
      ),
    ]);
    return {
      staleProspective: Number(stale?.n ?? 0),
      workingExpired: Number(working?.n ?? 0),
      factsTotal: Number(facts?.n ?? 0),
      episodesTotal: Number(episodes?.n ?? 0),
    };
  }

  async countEpisodes(sinceDays?: number): Promise<number> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ n: string }>(
      `select count(*) as n from episodic_memory where namespace = $1 ${
        sinceDays ? "and occurred_at > now() - ($2 || ' days')::interval" : ""
      }`,
      sinceDays ? [ns, String(sinceDays)] : [ns],
    );
    return Number(row?.n ?? 0);
  }

  async addProcedure(p: Procedure): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into procedures(namespace, skill, steps) values ($1,$2,$3) returning id`,
      [ns, p.skill, JSON.stringify(p.steps)],
    );
    return { id: row!.id };
  }

  /**
   * Гибридный recall: семантический поиск по эмбеддингу запроса среди episodic/semantic/
   * autobiographical + возврат отсортированного по близости. topK ограничивает бюджет.
   */
  async recall(q: RecallQuery): Promise<RecallHit[]> {
    const ns = await this.ns();
    const topK = q.topK ?? this.opts.retrievalTopK ?? 12;
    const kinds = q.kinds ?? ["episodic", "semantic", "autobiographical"];
    // Фильтр видимости (инвариант #2, D1 мягкая трактовка): по умолчанию НЕ включаем vault —
    // самый чувствительный уровень отдаётся модели только по явному запросу visibility.
    // Замечание: vault-строки хранятся зашифрованными с embedding=null, поэтому даже при явном
    // включении 'vault' в vis они НЕ найдутся векторным поиском (условие embedding is not null
    // ниже их отсекает). Это by design — vault читается только через listVaultRecent().
    const vis = q.visibility ?? ["default", "private"];
    const qEmb = toVectorLiteral(await this.embedder.embedQuery(q.query));
    const hits: RecallHit[] = [];

    if (kinds.includes("episodic")) {
      const rows = await this.pg.query<{
        id: string;
        event: string;
        occurred_at: string;
        visibility: string;
        score: number;
      }>(
        `select id, event, occurred_at, visibility,
                1 - (embedding <=> $2::vector) as score
         from episodic_memory
         where namespace = $1 and embedding is not null and visibility = any($4)
         order by embedding <=> $2::vector
         limit $3`,
        [ns, qEmb, topK, vis],
      );
      for (const r of rows)
        hits.push({
          id: r.id,
          kind: "episodic",
          text: r.event,
          score: Number(r.score),
          occurredAt: r.occurred_at,
          visibility: r.visibility as RecallHit["visibility"],
        });
    }

    if (kinds.includes("semantic")) {
      const rows = await this.pg.query<{
        id: string;
        subject: string;
        predicate: string;
        object: string;
        visibility: string;
        score: number;
      }>(
        `select id, subject, predicate, object, visibility,
                1 - (embedding <=> $2::vector) as score
         from semantic_facts
         where namespace = $1 and embedding is not null and visibility = any($4)
         order by embedding <=> $2::vector
         limit $3`,
        [ns, qEmb, topK, vis],
      );
      for (const r of rows)
        hits.push({
          id: r.id,
          kind: "semantic",
          text: `${r.subject} — ${r.predicate} — ${r.object}`,
          score: Number(r.score),
          visibility: r.visibility as RecallHit["visibility"],
        });
    }

    if (kinds.includes("autobiographical") && vis.includes("private")) {
      const rows = await this.pg.query<{ id: string; period: string; narrative: string; score: number }>(
        `select id, period, narrative,
                1 - (embedding <=> $2::vector) as score
         from autobiographical_narrative
         where namespace = $1 and embedding is not null
         order by embedding <=> $2::vector
         limit $3`,
        [ns, qEmb, Math.ceil(topK / 3)],
      );
      for (const r of rows)
        hits.push({
          id: r.id,
          kind: "autobiographical",
          text: `[${r.period}] ${r.narrative}`,
          score: Number(r.score),
          visibility: "private",
        });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
