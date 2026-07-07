// Узкий доступ к доменным таблицам основного Nabu (projects/tasks/goals/habits/quests/
// character_sheet/xp_ledger). Заменяет сырой SQL в субагентах на типизированные методы.
// Скоуп по пользователю (в персональном режиме — единственный/первый). Записи — write-класс.

import type { Postgres, Tx } from "../db/postgres.js";
import {
  XP_ATTRS,
  type XpAttr,
  type CharacterSummary,
  taskXp,
  domainToAttribute,
  characterSummary,
  ONTIME_BONUS,
  HABIT_DISCIPLINE_XP,
  HABIT_DOMAIN_XP,
  GOAL_XP,
  HABIT_MISS_PENALTY,
} from "../rpg.js";

export type { XpAttr } from "../rpg.js";

/** Одно объяснимое начисление XP (строка xp_ledger + применённая величина). */
export interface XpAward {
  attribute: XpAttr;
  amount: number;
  reason: string;
  ledgerId: string;
}

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
  async createProject(name: string, opts: { goal?: string; domains?: string[] } = {}): Promise<{ id: string }> {
    const u = await this.user();
    const r = await this.pg.queryOne<{ id: string }>(
      "insert into projects(user_id, name, goal, domains) values ($1,$2,$3,$4) returning id",
      [u, name, opts.goal ?? null, opts.domains ?? []],
    );
    return { id: r!.id };
  }
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

  /**
   * Обновить статус задачи. При переходе В done/completed (и только тогда — не повторно)
   * детерминированно начисляет XP в discipline: по приоритету (high 15 / normal 10 / low 5)
   * + бонус {@link ONTIME_BONUS} за закрытие в срок. Возвращает начисления для показа в UI.
   */
  async updateTaskStatus(taskId: string, status: string): Promise<{ updated: boolean; xp: XpAward[] }> {
    const u = await this.user();
    const done = status === "done" || status === "completed";
    return this.pg.tx(async (t) => {
      const cur = await t.queryOne<{ status: string; priority: string | null; has_due: boolean; on_time: boolean }>(
        `select status, priority, (due_date is not null) as has_due,
                (due_date is not null and current_date <= due_date) as on_time
         from tasks where id = $1 and user_id = $2`,
        [taskId, u],
      );
      if (!cur) return { updated: false, xp: [] };
      const wasDone = cur.status === "done" || cur.status === "completed";
      await t.query(
        `update tasks set status = $3, completed_at = ${done ? "now()" : "completed_at"}, updated_at = now()
         where id = $1 and user_id = $2`,
        [taskId, u, status],
      );
      const xp: XpAward[] = [];
      // Идемпотентность: начисляем только на реальном переходе в done, не при done→done.
      if (done && !wasDone) {
        const base = taskXp(cur.priority);
        const bonus = cur.on_time ? ONTIME_BONUS : 0;
        const reason = cur.has_due
          ? `Задача закрыта (${cur.priority ?? "normal"}${cur.on_time ? ", в срок" : ", с просрочкой"})`
          : `Задача закрыта (${cur.priority ?? "normal"})`;
        xp.push(await this.awardXpTx(t, u, "discipline", base + bonus, reason, "task"));
      }
      return { updated: true, xp };
    });
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

  /**
   * Обновить статус цели. При переходе В достижение (completed|done|achieved) — и только тогда —
   * начисляет {@link GOAL_XP} в атрибут домена цели (`domain`; по умолчанию growth→resilience).
   * Бросить цель (dropped/abandoned) — честное решение, штрафа НЕТ. Возвращает начисления.
   */
  async updateGoalStatus(
    goalId: string,
    status: string,
    opts: { domain?: string } = {},
  ): Promise<{ updated: boolean; xp: XpAward[] }> {
    const u = await this.user();
    const achieved = status === "completed" || status === "done" || status === "achieved";
    return this.pg.tx(async (t) => {
      const cur = await t.queryOne<{ status: string }>("select status from goals where id = $1 and user_id = $2", [goalId, u]);
      if (!cur) return { updated: false, xp: [] };
      const wasAchieved = cur.status === "completed" || cur.status === "done" || cur.status === "achieved";
      await t.query("update goals set status = $3, updated_at = now() where id = $1 and user_id = $2", [goalId, u, status]);
      const xp: XpAward[] = [];
      if (achieved && !wasAchieved) {
        const attr = domainToAttribute(opts.domain ?? "growth");
        xp.push(await this.awardXpTx(t, u, attr, GOAL_XP, "Цель достигнута", "goal"));
      }
      return { updated: true, xp };
    });
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
  /**
   * Записать выполнение привычки за день. Детерминированное XP:
   *  - done → +{@link HABIT_DISCIPLINE_XP} discipline и +{@link HABIT_DOMAIN_XP} в атрибут домена привычки;
   *  - missed → мягкий штраф {@link HABIT_MISS_PENALTY} discipline (пол 0, атрибут не уходит в минус);
   *  - skipped / planned-skip → без начислений (осознанный пропуск не наказывается).
   * Начисление за день делается один раз (повтор той же отметки не даёт дублей). Возвращает начисления.
   */
  async logHabit(habitId: string, status: string, occurredOn?: string): Promise<{ id: string; xp: XpAward[] }> {
    const u = await this.user();
    return this.pg.tx(async (t) => {
      // Уже было такое же начисляемое событие за этот день? Тогда лог пишем, но XP не дублируем.
      const scored = status === "done" || status === "missed";
      let already = false;
      let dupId: string | null = null;
      if (scored) {
        const dup = await t.queryOne<{ id: string }>(
          `select id from habit_logs
           where habit_id = $1 and user_id = $2 and occurred_on = coalesce($3::date, current_date) and status = $4
           limit 1`,
          [habitId, u, occurredOn ?? null, status],
        );
        already = !!dup;
        dupId = dup?.id ?? null; // R7-E10: возвращаем id СУЩЕСТВУЮЩЕЙ строки, не пустую
      }
      // R6-minor: не плодим дубли лог-строк (портили стрик/историю). Повторная отметка того же
      // дня/статуса — идемпотентна: возвращаем существующую строку, XP не начисляем повторно.
      const r = already
        ? { id: dupId ?? "" }
        : await t.queryOne<{ id: string }>(
            `insert into habit_logs(habit_id, user_id, occurred_on, status)
             values ($1,$2,coalesce($3::date, current_date),$4) returning id`,
            [habitId, u, occurredOn ?? null, status],
          );
      const xp: XpAward[] = [];
      if (scored && !already) {
        if (status === "done") {
          xp.push(await this.awardXpTx(t, u, "discipline", HABIT_DISCIPLINE_XP, "Привычка отмечена", "habit"));
          const dom = await t.queryOne<{ domains: string[] | null }>("select domains from habits where id = $1 and user_id = $2", [habitId, u]);
          const attr = domainToAttribute(dom?.domains?.[0]);
          if (attr !== "discipline") {
            xp.push(await this.awardXpTx(t, u, attr, HABIT_DOMAIN_XP, "Привычка в её сфере жизни", "habit"));
          }
        } else {
          // missed — мягкий, объяснимый штраф; пол 0 гарантируется в awardXpTx.
          xp.push(await this.awardXpTx(t, u, "discipline", HABIT_MISS_PENALTY, "Серия привычки прервалась", "habit"));
        }
      }
      return { id: r!.id, xp };
    });
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

  /**
   * Начислить XP по атрибуту: запись в xp_ledger + инкремент character_sheet.<attr>_xp.
   * Каждый XP объясним (reason). Величина может быть отрицательной (мягкий штраф) — атрибут при этом
   * НИКОГДА не уходит в минус (пол 0). Публичный вход валидирует атрибут по белому списку.
   */
  async awardXp(attribute: string, amount: number, reason: string, sourceType = "agent"): Promise<XpAward> {
    if (!XP_ATTRS.includes(attribute as XpAttr)) {
      throw new Error(`Неизвестный атрибут XP: ${attribute}. Допустимо: ${XP_ATTRS.join(", ")}`);
    }
    const u = await this.user();
    // Атомарно: запись в ledger и инкремент character_sheet — либо оба, либо ни одного.
    return this.pg.tx((t) => this.awardXpTx(t, u, attribute as XpAttr, amount, reason, sourceType));
  }

  /**
   * Транзакционное ядро начисления (переиспользуется детерминированными наградами задач/привычек/целей,
   * чтобы всё было в одной транзакции с изменением статуса). `attribute` — из белого списка XpAttr,
   * поэтому интерполяция имени колонки безопасна. greatest(0, …) держит пол 0 (инвариант #5: штраф мягкий,
   * атрибут не отрицательный). ledger фиксирует НАМЕРЕНИЕ (amount как есть) для честного аудита.
   */
  private async awardXpTx(t: Tx, u: string, attribute: XpAttr, amount: number, reason: string, sourceType: string): Promise<XpAward> {
    const ins = await t.queryOne<{ id: string }>(
      `insert into xp_ledger(user_id, attribute, amount, source_type, reason)
       values ($1,$2,$3,$4,$5) returning id`,
      [u, attribute, amount, sourceType, reason],
    );
    // Гарантируем строку листа (в мульти-профиле она могла не создаться сидом), затем инкремент с полом 0.
    await t.query("insert into character_sheet(user_id) values ($1) on conflict (user_id) do nothing", [u]);
    await t.query(
      `update character_sheet set ${attribute}_xp = greatest(0, coalesce(${attribute}_xp,0) + $2), updated_at = now() where user_id = $1`,
      [u, amount],
    );
    return { ledgerId: ins!.id, attribute, amount, reason };
  }

  /** Богатый лист персонажа: уровни (общий и по атрибутам) + xp-до-следующего, не только сырой xp. */
  async characterSheet(): Promise<CharacterSummary> {
    const u = await this.user();
    const sheet = await this.pg.queryOne<Record<string, unknown>>("select * from character_sheet where user_id = $1", [u]);
    return characterSummary(sheet);
  }
}
