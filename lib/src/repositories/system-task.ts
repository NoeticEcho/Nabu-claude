// Внутренний трекер задач Nabu (фича 10): бэклог самой системы — задачи агентов,
// предложения улучшений, запросы фидбэка, проактивные/запланированные действия.
// Отдельно от пользовательских задач (public.tasks / DomainRepository). Скоуп по namespace.

import type { Postgres } from "../db/postgres.js";

export type SystemTaskKind = "task" | "proposal" | "improvement" | "feedback" | "research" | "scheduled";
export type SystemTaskStatus = "open" | "in_progress" | "blocked" | "done" | "dismissed";

export interface SystemTask {
  id: string;
  kind: SystemTaskKind;
  title: string;
  detail?: string;
  status: SystemTaskStatus;
  priority: "low" | "normal" | "high";
  sourceAgent?: string;
  related?: Record<string, unknown>;
  dueAt?: string;
  createdAt: string;
}

export class SystemTaskRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly namespace: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  async add(t: {
    kind?: SystemTaskKind;
    title: string;
    detail?: string;
    priority?: "low" | "normal" | "high";
    sourceAgent?: string;
    related?: Record<string, unknown>;
    dueAt?: string;
  }): Promise<{ id: string }> {
    const ns = await this.ns();
    const row = await this.pg.queryOne<{ id: string }>(
      `insert into system_task(namespace, kind, title, detail, priority, source_agent, related, due_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        ns,
        t.kind ?? "task",
        t.title,
        t.detail ?? null,
        t.priority ?? "normal",
        t.sourceAgent ?? null,
        JSON.stringify(t.related ?? {}),
        t.dueAt ?? null,
      ],
    );
    return { id: row!.id };
  }

  async list(opts: { kind?: SystemTaskKind; status?: SystemTaskStatus; limit?: number } = {}): Promise<SystemTask[]> {
    const ns = await this.ns();
    const cond = ["namespace = $1"];
    const params: unknown[] = [ns];
    if (opts.kind) {
      params.push(opts.kind);
      cond.push(`kind = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      cond.push(`status = $${params.length}`);
    }
    params.push(opts.limit ?? 50);
    const rows = await this.pg.query<{
      id: string;
      kind: string;
      title: string;
      detail: string | null;
      status: string;
      priority: string;
      source_agent: string | null;
      related: Record<string, unknown>;
      due_at: string | null;
      created_at: string;
    }>(
      `select id, kind, title, detail, status, priority, source_agent, related, due_at, created_at
       from system_task where ${cond.join(" and ")}
       order by (priority='high') desc, created_at desc limit $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as SystemTaskKind,
      title: r.title,
      detail: r.detail ?? undefined,
      status: r.status as SystemTaskStatus,
      priority: r.priority as "low" | "normal" | "high",
      sourceAgent: r.source_agent ?? undefined,
      related: r.related,
      dueAt: r.due_at ?? undefined,
      createdAt: r.created_at,
    }));
  }

  async updateStatus(id: string, status: SystemTaskStatus): Promise<boolean> {
    const ns = await this.ns();
    const r = await this.pg.queryOne<{ id: string }>(
      "update system_task set status = $3, updated_at = now() where id = $1 and namespace = $2 returning id",
      [id, ns, status],
    );
    return !!r;
  }
}
