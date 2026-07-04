// Узкий доступ к доменным таблицам основного Nabu (projects/tasks/goals/habits/quests/
// character_sheet/xp_ledger). Заменяет сырой Supabase SQL в субагентах на типизированные методы.
// Скоуп по пользователю (в персональном режиме — единственный/первый). Записи — write-класс.

import type { Postgres } from "../db/postgres.js";

const XP_ATTRS = [
  "intellect",
  "wisdom",
  "creativity",
  "discipline",
  "vitality",
  "resilience",
  "sociality",
  "wealth",
] as const;
export type XpAttr = (typeof XP_ATTRS)[number];

export class DomainRepository {
  private userId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly configuredUserId?: string,
  ) {
    this.userId = configuredUserId ?? null;
  }

  private async user(): Promise<string> {
    if (this.userId) return this.userId;
    // FAIL-CLOSED: в общей многопользовательской БД без NABU_USER_ID нельзя угадывать владельца —
    // это привело бы к чтению/записи чужих данных. Fallback допустим ТОЛЬКО если пользователь один.
    const rows = await this.pg.query<{ id: string }>("select id from users order by created_at limit 2");
    if (rows.length === 0) throw new Error("Нет пользователей в БД");
    if (rows.length > 1) {
      throw new Error(
        "NABU_USER_ID не задан, а в общей БД несколько пользователей. Задайте NABU_USER_ID (uuid из public.users) для корректной изоляции — доступ к доменным данным заблокирован во избежание утечки.",
      );
    }
    this.userId = rows[0]!.id;
    return this.userId;
  }

  // ── Проекты ──
  async listProjects(status?: string): Promise<unknown[]> {
    const u = await this.user();
    return this.pg.query(
      `select id, name, goal, status, domains, started_at, closed_at from projects
       where user_id = $1 ${status ? "and status = $2" : ""} order by created_at desc`,
      status ? [u, status] : [u],
    );
  }
  async updateProjectStatus(projectId: string, status: string): Promise<boolean> {
    const u = await this.user();
    const r = await this.pg.queryOne<{ id: string }>(
      "update projects set status = $3, updated_at = now() where id = $1 and user_id = $2 returning id",
      [projectId, u, status],
    );
    return !!r;
  }

  // ── Задачи ──
  async listTasks(opts: { projectId?: string; status?: string; open?: boolean; dueWithinDays?: number } = {}): Promise<unknown[]> {
    const u = await this.user();
    const cond = ["user_id = $1"];
    const params: unknown[] = [u];
    if (opts.projectId) {
      params.push(opts.projectId);
      cond.push(`project_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      cond.push(`status = $${params.length}`);
    }
    if (opts.open) {
      cond.push(`status not in ('done', 'completed', 'cancelled')`);
    }
    if (opts.dueWithinDays != null) {
      params.push(String(opts.dueWithinDays));
      cond.push(`due_date is not null and due_date <= current_date + ($${params.length} || ' days')::interval`);
    }
    return this.pg.query(
      `select id, title, status, priority, domains, project_id, due_date, completed_at
       from tasks where ${cond.join(" and ")} order by due_date asc nulls last, created_at desc`,
      params,
    );
  }
  /** Создать задачу (ведение дел — мастхэв-цикл: добавить → увидеть → закрыть). */
  async addTask(
    title: string,
    opts: { due?: string; priority?: string; projectId?: string; domains?: string[] } = {},
  ): Promise<{ id: string }> {
    const u = await this.user();
    const r = await this.pg.queryOne<{ id: string }>(
      `insert into tasks(user_id, project_id, title, priority, domains, due_date)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [u, opts.projectId ?? null, title, opts.priority ?? null, opts.domains ?? [], opts.due ?? null],
    );
    return { id: r!.id };
  }

  async updateTaskStatus(taskId: string, status: string): Promise<boolean> {
    const u = await this.user();
    const done = status === "done" || status === "completed";
    const r = await this.pg.queryOne<{ id: string }>(
      `update tasks set status = $3, completed_at = ${done ? "now()" : "completed_at"}, updated_at = now()
       where id = $1 and user_id = $2 returning id`,
      [taskId, u, status],
    );
    return !!r;
  }

  // ── Цели ──
  async listGoals(status?: string): Promise<unknown[]> {
    const u = await this.user();
    return this.pg.query(
      `select id, text, horizon, status, smart_specific, smart_measurable, smart_timebound from goals
       where user_id = $1 ${status ? "and status = $2" : ""} order by created_at desc`,
      status ? [u, status] : [u],
    );
  }

  // ── Привычки ──
  async listHabits(activeOnly = true): Promise<unknown[]> {
    const u = await this.user();
    return this.pg.query(
      `select id, name, cue, routine, reward, minimum_step, anchor, target_frequency, domains, active
       from habits where user_id = $1 ${activeOnly ? "and active = true" : ""} order by created_at desc`,
      [u],
    );
  }
  async logHabit(habitId: string, status: string, occurredOn?: string): Promise<{ id: string }> {
    const u = await this.user();
    const r = await this.pg.queryOne<{ id: string }>(
      `insert into habit_logs(habit_id, user_id, occurred_on, status)
       values ($1,$2,coalesce($3::date, current_date),$4) returning id`,
      [habitId, u, occurredOn ?? null, status],
    );
    return { id: r!.id };
  }

  // ── Квесты ──
  async listQuests(status?: string): Promise<unknown[]> {
    const u = await this.user();
    return this.pg.query(
      `select id, title, quest_type, status, goal_id, parent_quest_id, reward_tuppi, completed_at
       from quests where user_id = $1 ${status ? "and status = $2" : ""} order by created_at desc`,
      status ? [u, status] : [u],
    );
  }

  // ── Персонаж / RPG ──
  async getCharacter(): Promise<unknown> {
    const u = await this.user();
    return this.pg.queryOne("select * from character_sheet where user_id = $1", [u]);
  }

  // ── Метрики жизни (фича 13): лог значений в metric_series/metric_values ──
  /** Записать значение метрики. Создаёт ряд по имени, если его нет (единица/домен опц.). */
  async logMetric(name: string, value: number, opts: { unit?: string; domain?: string; occurredAt?: string } = {}): Promise<{ seriesId: string; valueId: string }> {
    const u = await this.user();
    // Атомарно: (создание ряда при отсутствии) + запись значения не должны расходиться.
    return this.pg.tx(async (t) => {
      let series = await t.queryOne<{ id: string }>(
        "select id from metric_series where user_id = $1 and name = $2 order by created_at limit 1",
        [u, name],
      );
      if (!series) {
        series = await t.queryOne<{ id: string }>(
          "insert into metric_series(user_id, name, unit, domain) values ($1,$2,$3,$4) returning id",
          [u, name, opts.unit ?? null, opts.domain ?? null],
        );
      }
      const val = await t.queryOne<{ id: string }>(
        `insert into metric_values(series_id, user_id, occurred_at, value, source)
         values ($1,$2,coalesce($3::timestamptz, now()),$4,'nabu') returning id`,
        [series!.id, u, opts.occurredAt ?? null, value],
      );
      return { seriesId: series!.id, valueId: String(val!.id) }; // valueId — bigint, отдаём строкой
    });
  }

  /** Начислить XP по атрибуту: запись в xp_ledger + инкремент character_sheet.<attr>_xp. Каждый XP объясним (reason). */
  async awardXp(attribute: string, amount: number, reason: string, sourceType = "agent"): Promise<{ ledgerId: string; attribute: string }> {
    if (!XP_ATTRS.includes(attribute as XpAttr)) {
      throw new Error(`Неизвестный атрибут XP: ${attribute}. Допустимо: ${XP_ATTRS.join(", ")}`);
    }
    const u = await this.user();
    // Атомарно: запись в ledger и инкремент character_sheet — либо оба, либо ни одного.
    const r = await this.pg.tx(async (t) => {
      const ins = await t.queryOne<{ id: string }>(
        `insert into xp_ledger(user_id, attribute, amount, source_type, reason)
         values ($1,$2,$3,$4,$5) returning id`,
        [u, attribute, amount, sourceType, reason],
      );
      // инкремент соответствующей колонки (attribute из белого списка — безопасно)
      await t.query(
        `update character_sheet set ${attribute}_xp = coalesce(${attribute}_xp,0) + $2, updated_at = now() where user_id = $1`,
        [u, amount],
      );
      return ins;
    });
    return { ledgerId: r!.id, attribute };
  }
}
