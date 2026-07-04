// Кросс-доменные консультации агентов: durable-буфер «вопрос → ответ эксперта домена».
// Любой агент (не только адъютант) может запросить экспертизу другого домена. В Teams-режиме
// агенты общаются напрямую (SendMessage), буфер — аудит; в fallback адъютант релеит:
// list open → диспатч министра → answer → передать ответ исходному агенту. Скоуп по namespace.

import type { Postgres } from "../db/postgres.js";

export type ConsultStatus = "open" | "answered" | "expired";

export interface Consult {
  id: string;
  fromAgent: string;
  toDomain: string;
  question: string;
  context: Record<string, unknown>;
  status: ConsultStatus;
  answer?: string;
  answeredBy?: string;
  createdAt: string;
  answeredAt?: string;
}

export class ConsultRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async request(r: {
    fromAgent: string;
    toDomain: string;
    question: string;
    context?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into consult(namespace, from_agent, to_domain, question, context)
       values ($1,$2,$3,$4,$5) returning id`,
      [ns, r.fromAgent, r.toDomain, r.question, JSON.stringify(r.context ?? {})],
    );
    return { id: row!.id };
  }

  async answer(id: string, answer: string, answeredBy: string): Promise<boolean> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `update consult set status='answered', answer=$3, answered_by=$4, answered_at=now()
       where id=$1 and namespace=$2 and status='open' returning id`,
      [id, ns, answer, answeredBy],
    );
    return !!row;
  }

  async get(id: string): Promise<Consult | undefined> {
    const ns = await this.ns();
    const r = await this.pg.queryOne<ConsultRow>(
      `select id, from_agent, to_domain, question, context, status, answer, answered_by, created_at, answered_at
       from consult where id=$1 and namespace=$2`,
      [id, ns],
    );
    return r ? map(r) : undefined;
  }

  async list(status: ConsultStatus = "open", limit = 20): Promise<Consult[]> {
    const ns = await this.ns();
    const rows = await this.pg.query<ConsultRow>(
      `select id, from_agent, to_domain, question, context, status, answer, answered_by, created_at, answered_at
       from consult where namespace=$1 and status=$2 order by created_at asc limit $3`,
      [ns, status, limit],
    );
    return rows.map(map);
  }
}

interface ConsultRow {
  id: string;
  from_agent: string;
  to_domain: string;
  question: string;
  context: Record<string, unknown>;
  status: string;
  answer: string | null;
  answered_by: string | null;
  created_at: string;
  answered_at: string | null;
}

function map(r: ConsultRow): Consult {
  return {
    id: r.id,
    fromAgent: r.from_agent,
    toDomain: r.to_domain,
    question: r.question,
    context: r.context,
    status: r.status as ConsultStatus,
    answer: r.answer ?? undefined,
    answeredBy: r.answered_by ?? undefined,
    createdAt: r.created_at,
    answeredAt: r.answered_at ?? undefined,
  };
}
