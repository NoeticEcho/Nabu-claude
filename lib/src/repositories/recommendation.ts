// Трекинг советов и их исходов (фаза D, фича 13). Совет/министры фиксируют рекомендацию;
// feedback-collector узнаёт исход; исход пишется в agent_effectiveness (source=feedback) —
// замыкая контур само-улучшения (фаза C). Скоуп по namespace.

import type { Postgres } from "../db/postgres.js";

export type RecommendationStatus = "given" | "applied" | "partial" | "not_applied" | "unknown";

export interface Recommendation {
  id: string;
  sourceAgent?: string;
  domain?: string;
  question: string;
  recommendation: string;
  status: RecommendationStatus;
  outcome?: string;
  outcomeRating?: number;
  followUpAt?: string;
  createdAt: string;
}

export class RecommendationRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async record(r: {
    sourceAgent?: string;
    domain?: string;
    question: string;
    recommendation: string;
    deliberationId?: string;
    context?: Record<string, unknown>;
    followUpAt?: string;
  }): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into recommendation(namespace, source_agent, domain, question, recommendation, deliberation_id, context, follow_up_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [ns, r.sourceAgent ?? null, r.domain ?? null, r.question, r.recommendation, r.deliberationId ?? null, JSON.stringify(r.context ?? {}), r.followUpAt ?? null],
    );
    return { id: row!.id };
  }

  /** Рекомендации, по которым уместно спросить об исходе (status=given и подошёл follow_up_at). */
  async listPendingFollowup(limit = 20): Promise<Recommendation[]> {
    const ns = await this.ns();
    const rows = await this.pg.query<{
      id: string; source_agent: string | null; domain: string | null; question: string;
      recommendation: string; status: string; outcome: string | null; outcome_rating: number | null;
      follow_up_at: string | null; created_at: string;
    }>(
      `select id, source_agent, domain, question, recommendation, status, outcome, outcome_rating, follow_up_at, created_at
       from recommendation
       where namespace = $1 and status = 'given' and (follow_up_at is null or follow_up_at <= now())
       order by created_at asc limit $2`,
      [ns, limit],
    );
    return rows.map(this.map);
  }

  async listByDomain(domain: string, limit = 50): Promise<Recommendation[]> {
    const ns = await this.ns();
    const rows = await this.pg.query(
      `select id, source_agent, domain, question, recommendation, status, outcome, outcome_rating, follow_up_at, created_at
       from recommendation where namespace = $1 and domain = $2 order by created_at desc limit $3`,
      [ns, domain, limit],
    );
    return (rows as never[]).map(this.map);
  }

  /** Зафиксировать исход применённого совета. */
  async recordOutcome(id: string, o: { status: RecommendationStatus; outcome?: string; outcomeRating?: number }): Promise<boolean> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `update recommendation set status = $3, outcome = $4, outcome_rating = $5, outcome_at = now()
       where id = $1 and namespace = $2 returning id`,
      [id, ns, o.status, o.outcome ?? null, o.outcomeRating ?? null],
    );
    return !!row;
  }

  private map = (r: {
    id: string; source_agent: string | null; domain: string | null; question: string;
    recommendation: string; status: string; outcome: string | null; outcome_rating: number | null;
    follow_up_at: string | null; created_at: string;
  }): Recommendation => ({
    id: r.id,
    sourceAgent: r.source_agent ?? undefined,
    domain: r.domain ?? undefined,
    question: r.question,
    recommendation: r.recommendation,
    status: r.status as RecommendationStatus,
    outcome: r.outcome ?? undefined,
    outcomeRating: r.outcome_rating ?? undefined,
    followUpAt: r.follow_up_at ?? undefined,
    createdAt: r.created_at,
  });
}
