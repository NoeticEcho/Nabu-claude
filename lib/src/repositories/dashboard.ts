// Дашборд-статистика Nabu (фичи docs/01–02: обзор памяти/знаний/графа/Совета/сфер/RPG).
// Дешёвые SQL-агрегаты по namespace/user_id + graceful TypeDB. Питает /api/stats веб-чата,
// `nabu stats` и любые будущие панели. Ошибки отдельных секций НЕ роняют весь обзор.

import type { Postgres } from "../db/postgres.js";
import { XP_ATTRS } from "../rpg.js";
import type { GraphClient } from "../db/typedb.js";

export interface DashboardOverview {
  status: "ok" | "degraded";
  generatedAt: string;
  warnings: string[];
  memory: {
    episodes: number; episodes7d: number; episodesToday: number;
    facts: number; narratives: number; workingActive: number;
    prospectivePending: number; procedures: number;
  } | null;
  knowledge: { documents: number; chunks: number; notes: number | null } | null;
  graph: { available: boolean; concepts: number | null; associations: number | null };
  council: {
    deliberations: number; open: number; positions: number;
    recommendations: number; recommendationsApplied: number; followupsPending: number;
  } | null;
  domains: {
    projectsActive: number; tasksOpen: number; tasksDoneToday: number;
    goalsActive: number; habitsActive: number; questsActive: number;
    xpTotal: number; xpByAttr: Record<string, number>;
  } | null;
  system: {
    systemTasksOpen: number; proposalsOpen: number;
    approvalsPending: number; effectivenessPoints: number;
  } | null;
  daily: Array<{ day: string; episodes: number; facts: number; chunks: number; metrics: number }>;
}

// XP_ATTRS — единый источник в rpg.ts (аудит R6): не дублируем список атрибутов.

export class DashboardRepository {
  private nsId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly graphClient: GraphClient,
    private readonly namespace: string,
    private readonly configuredUserId?: string,
  ) {}

  private async ns(): Promise<string> {
    if (!this.nsId) this.nsId = await this.pg.resolveNamespace(this.namespace);
    return this.nsId;
  }

  private cachedUserId: string | null = null;

  /** user_id для доменных секций: fail-closed при неоднозначности; результат кэшируется
   * (overview() дергает user() до 3 раз — без кэша это 3 лишних запроса). */
  private async user(): Promise<string> {
    if (this.configuredUserId) return this.configuredUserId;
    if (this.cachedUserId) return this.cachedUserId;
    const rows = await this.pg.query<{ id: string }>("select id from users order by created_at limit 2");
    if (rows.length !== 1) throw new Error("NABU_USER_ID не задан / пользователей не ровно один");
    this.cachedUserId = rows[0]!.id;
    return this.cachedUserId;
  }

  private async one(sql: string, params: unknown[]): Promise<number> {
    const r = await this.pg.queryOne<{ n: string }>(sql, params);
    return Number(r?.n ?? 0);
  }

  async overview(): Promise<DashboardOverview> {
    const warnings: string[] = [];
    const out: DashboardOverview = {
      status: "ok",
      generatedAt: new Date().toISOString(),
      warnings,
      memory: null, knowledge: null,
      graph: { available: false, concepts: null, associations: null },
      council: null, domains: null, system: null, daily: [],
    };
    const ns = await this.ns();

    // ── Память ──
    try {
      const [episodes, episodes7d, episodesToday, facts, narratives, workingActive, prospectivePending, procedures] = await Promise.all([
        this.one("select count(*) as n from episodic_memory where namespace=$1", [ns]),
        this.one("select count(*) as n from episodic_memory where namespace=$1 and occurred_at > now() - interval '7 days'", [ns]),
        this.one("select count(*) as n from episodic_memory where namespace=$1 and occurred_at::date = current_date", [ns]),
        this.one("select count(*) as n from semantic_facts where namespace=$1", [ns]),
        this.one("select count(*) as n from autobiographical_narrative where namespace=$1", [ns]),
        this.one("select count(*) as n from working_memory where namespace=$1 and expires_at > now()", [ns]),
        this.one("select count(*) as n from prospective_memory where namespace=$1 and status='pending'", [ns]),
        this.one("select count(*) as n from procedures where namespace=$1", [ns]),
      ]);
      out.memory = { episodes, episodes7d, episodesToday, facts, narratives, workingActive, prospectivePending, procedures };
    } catch (e) { warnings.push(`память: ${(e as Error).message.slice(0, 120)}`); }

    // ── Знания ──
    try {
      const r = await this.pg.queryOne<{ documents: string; chunks: string }>(
        "select count(distinct source) as documents, count(*) as chunks from knowledge_chunk where namespace=$1", [ns]);
      // notes — таблица заметок (docs/07); отдельный try: в некоторых БД может отсутствовать.
      let notes: number | null = null;
      try {
        const u = await this.user();
        notes = await this.one("select count(*) as n from notes where user_id=$1 and deleted_at is null", [u]);
      } catch { /* нет таблицы/пользователя — notes: null */ }
      out.knowledge = { documents: Number(r?.documents ?? 0), chunks: Number(r?.chunks ?? 0), notes };
    } catch (e) { warnings.push(`знания: ${(e as Error).message.slice(0, 120)}`); }

    // ── Граф (TypeDB, мягко) ──
    try {
      if (await this.graphClient.connect()) {
        out.graph.available = true;
        out.graph.concepts = await this.countGraph("match $c isa concept; reduce $n = count;");
        out.graph.associations = await this.countGraph("match $r isa association; reduce $n = count;");
      }
    } catch { /* граф недоступен — не warning, штатная деградация */ }

    // ── Совет ──
    try {
      const [deliberations, open, positions, recommendations, recommendationsApplied, followupsPending] = await Promise.all([
        this.one("select count(*) as n from deliberation where namespace=$1", [ns]),
        this.one("select count(*) as n from deliberation where namespace=$1 and status not in ('closed')", [ns]),
        this.one("select count(*) as n from deliberation_position p join deliberation d on d.id=p.deliberation_id where d.namespace=$1", [ns]),
        this.one("select count(*) as n from recommendation where namespace=$1", [ns]),
        this.one("select count(*) as n from recommendation where namespace=$1 and status in ('applied','partial')", [ns]),
        this.one("select count(*) as n from recommendation where namespace=$1 and status='given' and (follow_up_at is null or follow_up_at <= now())", [ns]),
      ]);
      out.council = { deliberations, open, positions, recommendations, recommendationsApplied, followupsPending };
    } catch (e) { warnings.push(`совет: ${(e as Error).message.slice(0, 120)}`); }

    // ── Сферы жизни + RPG (fail-closed по user_id) ──
    try {
      const u = await this.user();
      const [projectsActive, tasksOpen, tasksDoneToday, goalsActive, habitsActive, questsActive] = await Promise.all([
        this.one("select count(*) as n from projects where user_id=$1 and status not in ('done','closed','archived')", [u]),
        this.one("select count(*) as n from tasks where user_id=$1 and status not in ('done','completed','cancelled')", [u]),
        this.one("select count(*) as n from tasks where user_id=$1 and completed_at::date = current_date", [u]),
        this.one("select count(*) as n from goals where user_id=$1 and status not in ('done','achieved','dropped')", [u]),
        this.one("select count(*) as n from habits where user_id=$1 and active = true", [u]),
        this.one("select count(*) as n from quests where user_id=$1 and status not in ('done','completed','failed')", [u]),
      ]);
      const sheet = await this.pg.queryOne<Record<string, unknown>>("select * from character_sheet where user_id=$1", [u]);
      const xpByAttr: Record<string, number> = {};
      let xpTotal = 0;
      for (const a of XP_ATTRS) {
        const v = Number((sheet as Record<string, unknown> | undefined)?.[`${a}_xp`] ?? 0);
        xpByAttr[a] = v; xpTotal += v;
      }
      out.domains = { projectsActive, tasksOpen, tasksDoneToday, goalsActive, habitsActive, questsActive, xpTotal, xpByAttr };
    } catch (e) { warnings.push(`сферы: ${(e as Error).message.slice(0, 120)}`); }

    // ── Система ──
    try {
      const [systemTasksOpen, proposalsOpen, approvalsPending, effectivenessPoints] = await Promise.all([
        this.one("select count(*) as n from system_task where namespace=$1 and status in ('open','in_progress','blocked')", [ns]),
        this.one("select count(*) as n from improvement_proposal where namespace=$1 and status='proposed'", [ns]),
        this.one("select count(*) as n from action_approval where namespace=$1 and status='pending' and expires_at > now()", [ns]),
        this.one("select count(*) as n from agent_effectiveness where namespace=$1", [ns]),
      ]);
      out.system = { systemTasksOpen, proposalsOpen, approvalsPending, effectivenessPoints };
    } catch (e) { warnings.push(`система: ${(e as Error).message.slice(0, 120)}`); }

    // ── Дневная динамика (14 дней) ──
    try {
      // metric_values скоупим по user_id (иначе в shared-БД считались бы ЧУЖИЕ метрики —
      // инвариант приватности). Нет однозначного пользователя → метрики в динамике = 0.
      let uid: string | null = null;
      try { uid = await this.user(); } catch { /* без user_id метрики не считаем */ }
      const rows = await this.pg.query<{ day: string; episodes: string; facts: string; chunks: string; metrics: string }>(
        `with days as (select generate_series(current_date - interval '13 days', current_date, '1 day')::date as day)
         select to_char(d.day,'YYYY-MM-DD') as day,
           (select count(*) from episodic_memory e where e.namespace=$1 and e.occurred_at::date=d.day) as episodes,
           (select count(*) from semantic_facts f where f.namespace=$1 and f.created_at::date=d.day) as facts,
           (select count(*) from knowledge_chunk k where k.namespace=$1 and k.created_at::date=d.day) as chunks,
           (select count(*) from metric_values m where $2::uuid is not null and m.user_id=$2::uuid and m.occurred_at::date=d.day) as metrics
         from days d order by d.day`,
        [ns, uid],
      );
      out.daily = rows.map((r) => ({ day: r.day, episodes: Number(r.episodes), facts: Number(r.facts), chunks: Number(r.chunks), metrics: Number(r.metrics) }));
    } catch (e) { warnings.push(`динамика: ${(e as Error).message.slice(0, 120)}`); }

    out.status = warnings.length ? "degraded" : "ok";
    return out;
  }

  /**
   * count через TypeDB 3.x reduce. Ответ HTTP API (conceptRows):
   * answers[0].data.<var> = { kind:"value", value:N } — но парсим либерально
   * (плоские формы тоже), null при неудаче.
   */
  private async countGraph(query: string): Promise<number | null> {
    try {
      const raw = (await this.graphClient.read(query)) as { answers?: Array<Record<string, unknown>> } | undefined;
      const first = raw?.answers?.[0];
      if (!first) return null;
      const scopes: Array<Record<string, unknown>> = [first];
      if (first.data && typeof first.data === "object") scopes.unshift(first.data as Record<string, unknown>);
      for (const scope of scopes) {
        for (const v of Object.values(scope)) {
          if (typeof v === "number") return v;
          if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "number") {
            return (v as { value: number }).value;
          }
        }
      }
      return null;
    } catch { return null; }
  }
}
