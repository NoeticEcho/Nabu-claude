// nabu-analytics MCP server — тяжёлые численные операции над временными рядами метрик,
// реализованные на TypeScript (lib/stats): прогноз, корреляция, аномалии, агрегаты.
// Читает metric_series/metric_values общей БД напрямую (batch-путь). Узкие типизированные tools.
// Никаких python-воркеров: всё локально в Node, детерминированно.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildDepsOrExit, installGracefulShutdown, ok, fail } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-analytics");
const server = new McpServer({ name: "nabu-analytics", version: "1.4.0" });

// Единый контракт результата — из @nabu/lib (mcp-result), а не локальная копия.
const result = ok;

server.registerTool(
  "list_metrics",
  {
    title: "Список метрик",
    description: "Перечислить временные ряды метрик (metric_series) с единицей и доменом.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    try {
      const series = await deps.analytics.listSeries();
      return result(`Рядов метрик: ${series.length}`, { series });
    } catch (e) {
      return fail(`Ошибка БД: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "forecast_metric",
  {
    title: "Прогноз метрики",
    description:
      "Прогноз ряда на horizon точек (Holt linear trend, TypeScript) с доверительным интервалом. Ряд по имени или id.",
    inputSchema: {
      series: z.string().min(1).describe("Имя или id ряда метрики"),
      horizon: z.number().int().min(1).max(90).default(7),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ series, horizon }) => {
    try {
      const r = await deps.analytics.forecast(series, horizon);
      if (r.n < 4) return result(`Недостаточно данных (${r.n} точек) для надёжного прогноза`, r, ["мало данных"]);
      return result(`Прогноз '${series}' на ${horizon} шагов (${r.method}, conf=${r.confidence})`, r);
    } catch (e) {
      return fail(`Ошибка: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "aggregate_metric",
  {
    title: "Агрегаты метрики",
    description: "count/sum/mean/median/min/max/stddev по ряду (опц. за последние sinceDays дней).",
    inputSchema: { series: z.string().min(1), sinceDays: z.number().int().min(1).max(3650).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ series, sinceDays }) => {
    try {
      const r = await deps.analytics.aggregate(series, sinceDays);
      return result(`Агрегаты '${series}' (n=${r.count})`, r);
    } catch (e) {
      return fail(`Ошибка: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "detect_anomalies",
  {
    title: "Детекция аномалий",
    description:
      "Аномалии ряда (EWMA + z-score, TypeScript): всплески/падения с severity. Порог zThreshold по модулю.",
    inputSchema: {
      series: z.string().min(1),
      zThreshold: z.number().min(1).max(6).default(3),
      sinceDays: z.number().int().min(1).max(3650).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ series, zThreshold, sinceDays }) => {
    try {
      const r = await deps.analytics.anomalies(series, zThreshold, sinceDays);
      return result(`Аномалий в '${series}': ${r.anomalies.length} (из ${r.n} точек)`, r);
    } catch (e) {
      return fail(`Ошибка: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "correlate_metrics",
  {
    title: "Корреляция двух метрик",
    description:
      "Pearson + Spearman + взаимная информация + p-value между двумя рядами (выравнивание по суткам, TypeScript). Только ассоциация, НЕ причинность.",
    inputSchema: { seriesA: z.string().min(1), seriesB: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ seriesA, seriesB }) => {
    try {
      const r = await deps.analytics.correlate(seriesA, seriesB);
      if (r.nObs < 4) return result(`Мало совпадающих наблюдений (${r.nObs})`, r, ["мало данных"]);
      return result(`corr(${seriesA},${seriesB}) pearson=${r.pearson} (n=${r.nObs})`, r);
    } catch (e) {
      return fail(`Ошибка: ${(e as Error).message}`);
    }
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-analytics MCP server готов (stdio)");
}

main().catch((err) => {
  console.error("nabu-analytics fatal:", err);
  process.exit(1);
});
