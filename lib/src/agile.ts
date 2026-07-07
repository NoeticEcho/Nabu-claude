// agile.ts — agile/проектное управление (OlimpOS P7): эпики, спринты, доска (kanban), оценка,
// назначение, метрики (velocity/burndown). Поверх projects/tasks. Скоуп по user_id (для проектного
// space — синтетический аккаунт проекта, для личного — сам пользователь).

import type { Postgres } from "./db/postgres.js";

export type BoardColumn = "todo" | "doing" | "review" | "done";

export interface Epic { id: string; title: string; description: string | null; status: string; projectId: string | null; }
export interface Sprint { id: string; name: string; goal: string | null; startsOn: string | null; endsOn: string | null; status: string; projectId: string | null; }
export interface BoardTask { id: string; title: string; column: BoardColumn; estimate: number | null; assigneeUser: string | null; sprintId: string | null; epicId: string | null; priority: string | null; }

export class AgileRepository {
  constructor(private readonly pg: Postgres, private readonly userId: string | undefined) {}

  private uid(): string {
    if (!this.userId) throw new Error("agile: требуется user_id (скоуп проекта/пользователя)");
    return this.userId;
  }

  async createEpic(title: string, opts: { projectId?: string; description?: string } = {}): Promise<Epic> {
    const r = await this.pg.queryOne<EpicRow>(
      "insert into epic(user_id, project_id, title, description) values ($1,$2,$3,$4) returning *",
      [this.uid(), opts.projectId ?? null, title, opts.description ?? null],
    );
    return mapEpic(r!);
  }

  async listEpics(projectId?: string): Promise<Epic[]> {
    const rows = projectId
      ? await this.pg.query<EpicRow>("select * from epic where user_id=$1 and project_id=$2 order by created_at", [this.uid(), projectId])
      : await this.pg.query<EpicRow>("select * from epic where user_id=$1 order by created_at", [this.uid()]);
    return rows.map(mapEpic);
  }

  async createSprint(name: string, opts: { projectId?: string; goal?: string; startsOn?: string; endsOn?: string } = {}): Promise<Sprint> {
    const r = await this.pg.queryOne<SprintRow>(
      "insert into sprint(user_id, project_id, name, goal, starts_on, ends_on) values ($1,$2,$3,$4,$5,$6) returning *",
      [this.uid(), opts.projectId ?? null, name, opts.goal ?? null, opts.startsOn ?? null, opts.endsOn ?? null],
    );
    return mapSprint(r!);
  }

  /** Активировать спринт (остальные того же проекта → closed, если были active). */
  async activateSprint(sprintId: string): Promise<void> {
    await this.pg.tx(async (t) => {
      const s = await t.queryOne<{ project_id: string | null }>("select project_id from sprint where id=$1 and user_id=$2", [sprintId, this.uid()]);
      if (!s) throw new Error("спринт не найден");
      if (s.project_id) await t.query("update sprint set status='closed' where user_id=$1 and project_id=$2 and status='active'", [this.uid(), s.project_id]);
      await t.query("update sprint set status='active' where id=$1 and user_id=$2", [sprintId, this.uid()]);
    });
  }

  async addTaskToSprint(taskId: string, sprintId: string | null): Promise<void> {
    await this.pg.query("update tasks set sprint_id=$3, updated_at=now() where id=$1 and user_id=$2", [taskId, this.uid(), sprintId]);
  }
  async setTaskEpic(taskId: string, epicId: string | null): Promise<void> {
    await this.pg.query("update tasks set epic_id=$3, updated_at=now() where id=$1 and user_id=$2", [taskId, this.uid(), epicId]);
  }
  async estimateTask(taskId: string, points: number): Promise<void> {
    await this.pg.query("update tasks set estimate=$3, updated_at=now() where id=$1 and user_id=$2", [taskId, this.uid(), Math.max(0, Math.round(points))]);
  }
  async assignTask(taskId: string, assigneeUser: string | null): Promise<void> {
    await this.pg.query("update tasks set assignee_user=$3, updated_at=now() where id=$1 and user_id=$2", [taskId, this.uid(), assigneeUser]);
  }

  /** Переместить задачу по доске. done → status='done' + completed_at; иначе снимаем завершённость. */
  async moveTask(taskId: string, column: BoardColumn): Promise<void> {
    const done = column === "done";
    await this.pg.query(
      `update tasks set board_column=$3, status=$4, completed_at=$5, updated_at=now() where id=$1 and user_id=$2`,
      [taskId, this.uid(), column, done ? "done" : "active", done ? new Date().toISOString() : null],
    );
  }

  /** Доска: задачи по колонкам (опц. фильтр по спринту/проекту). */
  async board(opts: { projectId?: string; sprintId?: string } = {}): Promise<Record<BoardColumn, BoardTask[]>> {
    const conds = ["user_id = $1"]; const params: unknown[] = [this.uid()];
    if (opts.projectId) { params.push(opts.projectId); conds.push(`project_id = $${params.length}`); }
    if (opts.sprintId) { params.push(opts.sprintId); conds.push(`sprint_id = $${params.length}`); }
    const rows = await this.pg.query<TaskRow>(
      `select id, title, board_column, estimate, assignee_user, sprint_id, epic_id, priority from tasks where ${conds.join(" and ")} order by priority nulls last, created_at`,
      params,
    );
    const board: Record<BoardColumn, BoardTask[]> = { todo: [], doing: [], review: [], done: [] };
    for (const r of rows) {
      const col = (["todo", "doing", "review", "done"].includes(r.board_column) ? r.board_column : "todo") as BoardColumn;
      board[col].push({ id: r.id, title: r.title, column: col, estimate: r.estimate ?? null, assigneeUser: r.assignee_user ?? null, sprintId: r.sprint_id ?? null, epicId: r.epic_id ?? null, priority: r.priority ?? null });
    }
    return board;
  }

  /** Метрики спринта: суммарные/выполненные story points + счётчики по колонкам (velocity/burndown). */
  async sprintMetrics(sprintId: string): Promise<{ totalPoints: number; donePoints: number; remainingPoints: number; byColumn: Record<string, number>; taskCount: number; doneCount: number }> {
    const rows = await this.pg.query<{ board_column: string; estimate: number | null; }>(
      "select board_column, estimate from tasks where user_id=$1 and sprint_id=$2", [this.uid(), sprintId],
    );
    let total = 0, done = 0, doneCount = 0;
    const byColumn: Record<string, number> = { todo: 0, doing: 0, review: 0, done: 0 };
    for (const r of rows) {
      const pts = r.estimate ?? 0;
      total += pts;
      // AUDIT R8: клампим неизвестную колонку к 'todo' (как в board()), чтобы не плодить чужие ключи.
      const col = (["todo", "doing", "review", "done"].includes(r.board_column) ? r.board_column : "todo");
      byColumn[col] = (byColumn[col] ?? 0) + 1;
      if (col === "done") { done += pts; doneCount++; }
    }
    return { totalPoints: total, donePoints: done, remainingPoints: total - done, byColumn, taskCount: rows.length, doneCount };
  }
}

interface EpicRow { id: string; title: string; description: string | null; status: string; project_id: string | null; }
interface SprintRow { id: string; name: string; goal: string | null; starts_on: string | null; ends_on: string | null; status: string; project_id: string | null; }
interface TaskRow { id: string; title: string; board_column: string; estimate: number | null; assignee_user: string | null; sprint_id: string | null; epic_id: string | null; priority: string | null; }
function mapEpic(r: EpicRow): Epic { return { id: r.id, title: r.title, description: r.description, status: r.status, projectId: r.project_id }; }
function mapSprint(r: SprintRow): Sprint { return { id: r.id, name: r.name, goal: r.goal, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status, projectId: r.project_id }; }
