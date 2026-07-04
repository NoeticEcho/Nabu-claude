// Само-улучшение Nabu: метрики эффективности (агенты/промпты/скиллы) + предложения улучшений.
// Питает researcher/scout/effectiveness-evaluator/learner. Скоуп по namespace.

import type { Postgres } from "../db/postgres.js";

export type TargetKind = "agent" | "skill" | "prompt" | "workflow" | "council";
export type ProposalCategory =
  | "agent" | "skill" | "prompt" | "workflow" | "mcp" | "tool" | "process" | "schema";
export type ProposalStatus = "proposed" | "accepted" | "rejected" | "implemented";

export interface EffectivenessPoint {
  targetKind: TargetKind;
  target: string;
  metric: string;
  value: number;
  sampleSize?: number;
  period?: string;
  source?: "eval" | "outcome" | "feedback" | "manual";
  notes?: string;
}

export interface Proposal {
  id: string;
  sourceAgent?: string;
  category: ProposalCategory;
  title: string;
  rationale: string;
  proposedChange: string;
  evidence?: Record<string, unknown>;
  impact: "low" | "medium" | "high";
  effort: "low" | "medium" | "high";
  status: ProposalStatus;
  createdAt: string;
}

export class ImprovementRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  // ── Эффективность ──
  async recordEffectiveness(p: EffectivenessPoint): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into agent_effectiveness(namespace, target_kind, target, metric, value, sample_size, period, source, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [ns, p.targetKind, p.target, p.metric, p.value, p.sampleSize ?? 1, p.period ?? null, p.source ?? "manual", p.notes ?? null],
    );
    return { id: row!.id };
  }

  /** Тренд/сводка эффективности (последние записи + среднее по метрике). */
  async getEffectiveness(opts: { target?: string; targetKind?: TargetKind; metric?: string; limit?: number } = {}): Promise<{
    points: Array<{ target: string; targetKind: string; metric: string; value: number; period?: string; createdAt: string }>;
    averages: Array<{ target: string; metric: string; avg: number; n: number }>;
  }> {
    const ns = await this.ns();
    const cond = ["namespace = $1"];
    const params: unknown[] = [ns];
    for (const [col, val] of [["target", opts.target], ["target_kind", opts.targetKind], ["metric", opts.metric]] as const) {
      if (val) {
        params.push(val);
        cond.push(`${col} = $${params.length}`);
      }
    }
    const where = cond.join(" and ");
    params.push(opts.limit ?? 100);
    const points = await this.pg.query<{ target: string; target_kind: string; metric: string; value: number; period: string | null; created_at: string }>(
      `select target, target_kind, metric, value, period, created_at from agent_effectiveness
       where ${where} order by created_at desc limit $${params.length}`,
      params,
    );
    // Группируем по (target_kind, target, metric) — иначе одноимённые цели разных видов смешаются.
    const averages = await this.pg.query<{ target_kind: string; target: string; metric: string; avg: number; n: number }>(
      `select target_kind, target, metric, avg(value) as avg, count(*)::int as n from agent_effectiveness
       where ${where} group by target_kind, target, metric order by target, metric`,
      params.slice(0, -1),
    );
    return {
      points: points.map((p) => ({ target: p.target, targetKind: p.target_kind, metric: p.metric, value: Number(p.value), period: p.period ?? undefined, createdAt: p.created_at })),
      averages: averages.map((a) => ({ target: a.target, metric: a.metric, avg: Number(a.avg), n: Number(a.n) })),
    };
  }

  // ── Предложения ──
  async addProposal(p: {
    sourceAgent?: string;
    category: ProposalCategory;
    title: string;
    rationale: string;
    proposedChange: string;
    evidence?: Record<string, unknown>;
    impact?: "low" | "medium" | "high";
    effort?: "low" | "medium" | "high";
  }): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into improvement_proposal(namespace, source_agent, category, title, rationale, proposed_change, evidence, impact, effort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [ns, p.sourceAgent ?? null, p.category, p.title, p.rationale, p.proposedChange, JSON.stringify(p.evidence ?? {}), p.impact ?? "medium", p.effort ?? "medium"],
    );
    return { id: row!.id };
  }

  async listProposals(opts: { status?: ProposalStatus; category?: ProposalCategory; limit?: number } = {}): Promise<Proposal[]> {
    const ns = await this.ns();
    const cond = ["namespace = $1"];
    const params: unknown[] = [ns];
    if (opts.status) {
      params.push(opts.status);
      cond.push(`status = $${params.length}`);
    }
    if (opts.category) {
      params.push(opts.category);
      cond.push(`category = $${params.length}`);
    }
    params.push(opts.limit ?? 50);
    const rows = await this.pg.query<{
      id: string; source_agent: string | null; category: string; title: string; rationale: string;
      proposed_change: string; evidence: Record<string, unknown>; impact: string; effort: string; status: string; created_at: string;
    }>(
      `select id, source_agent, category, title, rationale, proposed_change, evidence, impact, effort, status, created_at
       from improvement_proposal where ${cond.join(" and ")}
       order by (impact='high') desc, created_at desc limit $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      sourceAgent: r.source_agent ?? undefined,
      category: r.category as ProposalCategory,
      title: r.title,
      rationale: r.rationale,
      proposedChange: r.proposed_change,
      evidence: r.evidence,
      impact: r.impact as "low" | "medium" | "high",
      effort: r.effort as "low" | "medium" | "high",
      status: r.status as ProposalStatus,
      createdAt: r.created_at,
    }));
  }

  async updateProposal(id: string, status: ProposalStatus, decidedBy = "user"): Promise<boolean> {
    const ns = await this.ns();
    const r = await this.pg.queryOne<{ id: string }>(
      `update improvement_proposal set status = $3, decided_by = $4, decided_at = now()
       where id = $1 and namespace = $2 returning id`,
      [id, ns, status, decidedBy],
    );
    return !!r;
  }
}
