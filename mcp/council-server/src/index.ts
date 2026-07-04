// nabu-council MCP server — ведёт запись совещания (deliberation): буфер структурированных
// позиций министров, синтез с trade-off'ами. Оркестрацию (кого созвать, как рассуждать)
// делает Claude Code через skill `council`; сервер лишь хранит структуру и отдаёт её обратно.
// Узкие типизированные tools, структурированные результаты.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildDepsOrExit, installGracefulShutdown, ok, degraded, wrap, type McpToolResult } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-council");
const server = new McpServer({ name: "nabu-council", version: "1.1.0" });

const result = ok;
const reg = ((name: string, opts: unknown, h: (...a: unknown[]) => Promise<unknown>) =>
  server.registerTool(name as never, opts as never, ((...a: unknown[]) =>
    wrap(() => h(...a) as Promise<McpToolResult>)) as never)) as unknown as typeof server.registerTool;

reg(
  "open_deliberation",
  {
    title: "Открыть совещание",
    description: "Начать коллегиальное совещание Совета по вопросу. Возвращает deliberationId для сбора позиций.",
    inputSchema: { question: z.string().min(1) },
  },
  async ({ question }) => {
    const { id } = await deps.deliberation.open(question);
    return result(`Совещание открыто (${id.slice(0, 8)})`, { deliberationId: id });
  },
);

reg(
  "add_position",
  {
    title: "Добавить позицию министра",
    description:
      "Записать структурированную позицию министра в совещание (ARCHITECTURE §4). Идемпотентно по министру.",
    inputSchema: {
      deliberationId: z.string().uuid(),
      minister: z.string().min(1),
      recommendation: z.string().min(1),
      rationale: z.string().min(1),
      risks: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1),
      dependsOn: z.array(z.string()).default([]),
    },
  },
  async (args) => {
    const { deliberationId, ...p } = args;
    await deps.deliberation.addPosition(deliberationId, p);
    return result(`Позиция '${p.minister}' записана`, { minister: p.minister });
  },
);

reg(
  "get_positions",
  {
    title: "Позиции совещания",
    description: "Все собранные позиции министров — для выявления конфликтов и синтеза.",
    inputSchema: { deliberationId: z.string().uuid() },
    annotations: { readOnlyHint: true },
  },
  async ({ deliberationId }) => {
    const positions = await deps.deliberation.getPositions(deliberationId);
    return result(`Собрано позиций: ${positions.length}`, { positions });
  },
);

reg(
  "record_synthesis",
  {
    title: "Записать синтез",
    description:
      "Зафиксировать синтез Совета: выявленные конфликты, честные trade-off'ы, итоговую интегрированную рекомендацию (не усреднение) и, если есть, решение.",
    inputSchema: {
      deliberationId: z.string().uuid(),
      conflicts: z.array(z.string()).default([]),
      tradeoffs: z.string().min(1),
      synthesis: z.string().min(1),
      decision: z.string().optional(),
    },
  },
  async ({ deliberationId, conflicts, tradeoffs, synthesis, decision }) => {
    await deps.deliberation.recordSynthesis(deliberationId, { conflicts, tradeoffs, synthesis, decision });
    return result("Синтез записан", { deliberationId });
  },
);

reg(
  "close_deliberation",
  {
    title: "Закрыть совещание",
    description: "Пометить совещание закрытым.",
    inputSchema: { deliberationId: z.string().uuid() },
  },
  async ({ deliberationId }) => {
    await deps.deliberation.close(deliberationId);
    return result("Совещание закрыто", { deliberationId });
  },
);

// ── Кросс-доменные консультации: ЛЮБОЙ агент может запросить экспертизу другого домена ──
const consultDomain = z.enum([
  "health", "mind", "finance", "work", "learning",
  "relationships", "growth", "lifestyle", "admin", "any",
]);

reg(
  "request_consult",
  {
    title: "Запросить консультацию другого домена",
    description:
      "Агент запрашивает экспертизу/уточнение у другого домена (durable-буфер). В Teams-режиме " +
      "предпочтителен прямой SendMessage министру; буфер — fallback и аудит. Адъютант релеит " +
      "открытые консультации министрам. В context — краткая суть, НЕ сырые приватные данные.",
    inputSchema: {
      fromAgent: z.string().min(1),
      toDomain: consultDomain,
      question: z.string().min(1).max(4000),
      context: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ fromAgent, toDomain, question, context }) => {
    const r = await deps.consult.request({ fromAgent, toDomain, question, context });
    return result(`Консультация запрошена (${r.id.slice(0, 8)}): ${fromAgent} → ${toDomain}`, r);
  },
);

reg(
  "answer_consult",
  {
    title: "Ответить на консультацию",
    description: "Министр/эксперт домена отвечает на запрос консультации. Только open-записи.",
    inputSchema: {
      id: z.string().uuid(),
      answer: z.string().min(1),
      answeredBy: z.string().min(1),
    },
  },
  async ({ id, answer, answeredBy }) => {
    const done = await deps.consult.answer(id, answer, answeredBy);
    return done ? result("Ответ записан", { id }) : degraded("Консультация не найдена или уже отвечена", { id });
  },
);

reg(
  "get_consult",
  {
    title: "Получить консультацию",
    description: "Статус/ответ по id (исходный агент забирает ответ при повторном диспатче).",
    inputSchema: { id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    const c = await deps.consult.get(id);
    return c ? result(`Консультация ${c.status}`, c) : degraded("Не найдена", { id });
  },
);

reg(
  "list_consults",
  {
    title: "Открытые консультации",
    description: "Список консультаций (по умолчанию open) — адъютант проверяет после диспатчей и релеит министрам.",
    inputSchema: {
      status: z.enum(["open", "answered", "expired"]).default("open"),
      limit: z.number().int().min(1).max(50).default(20),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, limit }) => {
    const items = await deps.consult.list(status, limit);
    return result(`Консультаций (${status}): ${items.length}`, { consults: items });
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-council MCP server готов (stdio)");
}

main().catch((err) => {
  console.error("nabu-council fatal:", err);
  process.exit(1);
});
