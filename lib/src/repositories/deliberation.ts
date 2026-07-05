// Журнал совещаний Совета: буфер структурированных позиций министров + синтез.
// council-server ведёт эту запись; council-skill читает позиции для выявления конфликтов
// и синтеза с trade-off'ами.

import type { Postgres } from "../db/postgres.js";
import type { MinisterPosition } from "../types.js";

export interface DeliberationRecord {
  id: string;
  question: string;
  status: string;
  positions: MinisterPosition[];
}

export class DeliberationRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async open(question: string): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      "insert into deliberation(namespace, question) values ($1,$2) returning id",
      [ns, question],
    );
    return { id: row!.id };
  }

  async addPosition(deliberationId: string, p: MinisterPosition): Promise<void> {
    await this.pg.tx(async (t) => {
      await t.query(
        `insert into deliberation_position(deliberation_id, minister, recommendation, rationale, risks, confidence, depends_on)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (deliberation_id, minister) do update set
           recommendation = excluded.recommendation, rationale = excluded.rationale,
           risks = excluded.risks, confidence = excluded.confidence, depends_on = excluded.depends_on`,
        [deliberationId, p.minister, p.recommendation, p.rationale, p.risks, p.confidence, p.dependsOn],
      );
      await t.query("update deliberation set updated_at = now() where id = $1", [deliberationId]);
    });
  }

  async getPositions(deliberationId: string): Promise<MinisterPosition[]> {
    const rows = await this.pg.query<{
      minister: string;
      recommendation: string;
      rationale: string;
      risks: string[];
      confidence: number;
      depends_on: string[];
    }>(
      `select minister, recommendation, rationale, risks, confidence, depends_on
       from deliberation_position where deliberation_id = $1 order by created_at asc`,
      [deliberationId],
    );
    return rows.map((r) => ({
      minister: r.minister,
      recommendation: r.recommendation,
      rationale: r.rationale,
      risks: r.risks,
      confidence: Number(r.confidence),
      dependsOn: r.depends_on,
    }));
  }

  async recordSynthesis(
    deliberationId: string,
    s: { conflicts: string[]; tradeoffs: string; synthesis: string; decision?: string },
  ): Promise<void> {
    await this.pg.tx(async (t) => {
      await t.query(
        `insert into deliberation_synthesis(deliberation_id, conflicts, tradeoffs, synthesis, decision)
         values ($1,$2,$3,$4,$5)`,
        [deliberationId, s.conflicts, s.tradeoffs, s.synthesis, s.decision ?? null],
      );
      await t.query("update deliberation set status = 'synthesized', updated_at = now() where id = $1", [
        deliberationId,
      ]);
    });
  }

  async close(deliberationId: string): Promise<void> {
    await this.pg.query("update deliberation set status = 'closed', updated_at = now() where id = $1", [
      deliberationId,
    ]);
  }

  /** Недавние совещания Совета с синтезом — «прошлые наработки» для подъёма в новый разговор.
   *  read-only: адъютант поднимает их автономно, без интерактивного подтверждения. */
  async listRecent(limit = 10): Promise<
    Array<{
      id: string;
      question: string;
      status: string;
      createdAt: string;
      synthesis: string | null;
      tradeoffs: string | null;
      decision: string | null;
    }>
  > {
    const ns = await this.ns();
    const rows = await this.pg.query<{
      id: string;
      question: string;
      status: string;
      created_at: string;
      synthesis: string | null;
      tradeoffs: string | null;
      decision: string | null;
    }>(
      `select d.id, d.question, d.status, d.created_at,
              s.synthesis, s.tradeoffs, s.decision
         from deliberation d
         left join deliberation_synthesis s on s.deliberation_id = d.id
        where d.namespace = $1
        order by d.created_at desc
        limit $2`,
      [ns, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      status: r.status,
      createdAt: r.created_at,
      synthesis: r.synthesis,
      tradeoffs: r.tradeoffs,
      decision: r.decision,
    }));
  }
}
