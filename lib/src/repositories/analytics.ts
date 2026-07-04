// Аналитика над временными рядами метрик основного Nabu (metric_series/metric_values).
// Тяжёлые расчёты — на TypeScript (lib/stats), не через python. Читает pg напрямую (batch-путь).

import type { Postgres } from "../db/postgres.js";
import * as stats from "../stats.js";
import type { Point } from "../stats.js";

export interface SeriesInfo {
  id: string;
  name: string;
  unit: string | null;
  domain: string | null;
}

export class AnalyticsRepository {
  private userId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly configuredUserId?: string,
  ) {
    this.userId = configuredUserId ?? null;
  }

  private async user(): Promise<string> {
    if (this.userId) return this.userId;
    // FAIL-CLOSED (как в DomainRepository): без NABU_USER_ID и при >1 пользователе — отказ.
    const rows = await this.pg.query<{ id: string }>("select id from users order by created_at limit 2");
    if (rows.length === 0) throw new Error("Нет пользователей в БД");
    if (rows.length > 1) {
      throw new Error(
        "NABU_USER_ID не задан, а в общей БД несколько пользователей. Задайте NABU_USER_ID для изоляции — доступ к метрикам заблокирован во избежание утечки.",
      );
    }
    this.userId = rows[0]!.id;
    return this.userId;
  }

  async listSeries(): Promise<SeriesInfo[]> {
    const u = await this.user();
    return this.pg.query<SeriesInfo>(
      "select id, name, unit, domain from metric_series where user_id = $1 order by name",
      [u],
    );
  }

  private async resolveSeriesId(ref: string): Promise<string | undefined> {
    const u = await this.user();
    const byId = await this.pg.queryOne<{ id: string }>(
      "select id from metric_series where id::text = $1 and user_id = $2",
      [ref, u],
    );
    if (byId) return byId.id;
    const byName = await this.pg.queryOne<{ id: string }>(
      "select id from metric_series where name = $1 and user_id = $2 order by created_at limit 1",
      [ref, u],
    );
    return byName?.id;
  }

  private async points(seriesRef: string, sinceDays?: number): Promise<Point[]> {
    const id = await this.resolveSeriesId(seriesRef);
    if (!id) return [];
    const rows = await this.pg.query<{ occurred_at: string; value: number }>(
      `select occurred_at, value from metric_values
       where series_id = $1 ${sinceDays ? "and occurred_at > now() - ($2 || ' days')::interval" : ""}
       order by occurred_at asc`,
      sinceDays ? [id, String(sinceDays)] : [id],
    );
    return rows.map((r) => ({ t: new Date(r.occurred_at).getTime(), v: Number(r.value) }));
  }

  async forecast(seriesRef: string, horizon: number): Promise<{ series: string; n: number } & stats.ForecastResult> {
    const pts = await this.points(seriesRef);
    const res = stats.forecast(pts.map((p) => p.v), horizon);
    return { series: seriesRef, n: pts.length, ...res };
  }

  async aggregate(seriesRef: string, sinceDays?: number): Promise<{ series: string } & stats.Aggregates> {
    const pts = await this.points(seriesRef, sinceDays);
    return { series: seriesRef, ...stats.aggregate(pts.map((p) => p.v)) };
  }

  async anomalies(
    seriesRef: string,
    zThreshold = 3,
    sinceDays?: number,
  ): Promise<{ series: string; n: number; anomalies: stats.Anomaly[] }> {
    const pts = await this.points(seriesRef, sinceDays);
    return { series: seriesRef, n: pts.length, anomalies: stats.detectAnomalies(pts, zThreshold) };
  }

  async correlate(
    seriesA: string,
    seriesB: string,
  ): Promise<{
    a: string;
    b: string;
    nObs: number;
    pearson: number;
    spearman: number;
    mutualInformation: number;
    pValue: number;
    note: string;
  }> {
    const [pa, pb] = await Promise.all([this.points(seriesA), this.points(seriesB)]);
    const { x, y } = stats.alignByDay(pa, pb);
    const r = stats.pearson(x, y);
    return {
      a: seriesA,
      b: seriesB,
      nObs: x.length,
      pearson: Number.isFinite(r) ? Math.round(r * 1000) / 1000 : NaN,
      spearman: round3(stats.spearman(x, y)),
      mutualInformation: round3(stats.mutualInformation(x, y)),
      pValue: round3(stats.corrPValue(r, x.length)),
      note: "Ассоциация, НЕ причинность. Возможны конфаундеры; интерпретировать осторожно.",
    };
  }
}

function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
}
