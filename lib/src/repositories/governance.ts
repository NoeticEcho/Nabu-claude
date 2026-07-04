// Governance: durable-запись одобрений высокорисковых действий + аудит-лог (инвариант #7).
// ВАЖНО: финальный энфорсер — система разрешений Claude Code (prompt на реальное действие) +
// явное согласие пользователя. Модель НЕ одобряет собственное действие: resolveApproval
// вызывается только после явного «да» пользователя (decided_by='user').

import type { Postgres } from "../db/postgres.js";

export type RiskClass =
  | "external"
  | "financial"
  | "destructive"
  | "deploy"
  | "purchase"
  | "communication";

export interface ApprovalRequest {
  agent: string;
  riskClass: RiskClass;
  action: string;
  target?: string;
  summary: string;
  preview?: Record<string, unknown>;
  expected?: string;
  rollback?: string;
  scope?: string;
}

export class GovernanceRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async requestApproval(r: ApprovalRequest): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into action_approval(namespace, agent, risk_class, action, target, summary, preview, expected, rollback, scope)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        ns,
        r.agent,
        r.riskClass,
        r.action,
        r.target ?? null,
        r.summary,
        JSON.stringify(r.preview ?? {}),
        r.expected ?? null,
        r.rollback ?? null,
        r.scope ?? null,
      ],
    );
    return { id: row!.id };
  }

  async listPendingApprovals(): Promise<
    Array<{ id: string; agent: string; riskClass: string; action: string; summary: string; requestedAt: string }>
  > {
    const ns = await this.ns();
    const rows = await this.pg.query<{
      id: string;
      agent: string;
      risk_class: string;
      action: string;
      summary: string;
      requested_at: string;
    }>(
      `select id, agent, risk_class, action, summary, requested_at from action_approval
       where namespace = $1 and status = 'pending' and expires_at > now()
       order by requested_at desc`,
      [ns],
    );
    return rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      riskClass: r.risk_class,
      action: r.action,
      summary: r.summary,
      requestedAt: r.requested_at,
    }));
  }

  /** Разрешение одобрения. Только по явному решению ПОЛЬЗОВАТЕЛЯ (decidedBy='user'). */
  async resolveApproval(id: string, decision: "approved" | "rejected", decidedBy = "user"): Promise<boolean> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `update action_approval set status = $3, decided_at = now(), decided_by = $4
       where id = $1 and namespace = $2 and status = 'pending' and expires_at > now()
       returning id`,
      [id, ns, decision, decidedBy],
    );
    return !!row;
  }

  async logAction(a: {
    agent: string;
    riskClass: string;
    action: string;
    target?: string;
    status: "ok" | "error" | "blocked" | "skipped";
    approvalId?: string;
    detail?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into action_log(namespace, agent, risk_class, action, target, status, approval_id, detail)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        ns,
        a.agent,
        a.riskClass,
        a.action,
        a.target ?? null,
        a.status,
        a.approvalId ?? null,
        JSON.stringify(a.detail ?? {}),
      ],
    );
    return { id: row!.id };
  }
}
