// nabu-improve MCP server — само-улучшение Nabu (фазы C): метрики эффективности агентов/промптов/
// скиллов и структурированные предложения улучшений. Питает researcher/scout/effectiveness-evaluator/
// learner. Предложения ревьюит critic до accepted; принятые/внедрённые ведутся через system_task.
// Узкие типизированные tools, структурированные результаты.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildDepsOrExit, installGracefulShutdown, ok, fail, wrap } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-improve");
const server = new McpServer({ name: "nabu-improve", version: "1.1.0" });
// Единый контракт результата — из @nabu/lib (ok/fail/wrap), без локальных копий.

const targetKind = z.enum(["agent", "skill", "prompt", "workflow", "council"]);
const category = z.enum(["agent", "skill", "prompt", "workflow", "mcp", "tool", "process", "schema"]);
const status = z.enum(["proposed", "accepted", "rejected", "implemented"]);

// ── Эффективность (фича 12) ──
server.registerTool("record_effectiveness", {
  title: "Записать метрику эффективности",
  description: "Зафиксировать метрику агента/скилла/промпта/workflow/Совета (accuracy, boundary_compliance, user_rating, latency…). source: eval|outcome|feedback|manual.",
  inputSchema: {
    targetKind, target: z.string().min(1), metric: z.string().min(1),
    value: z.number(), sampleSize: z.number().int().min(1).default(1),
    period: z.string().optional(), source: z.enum(["eval", "outcome", "feedback", "manual"]).default("manual"),
    notes: z.string().optional(),
  },
}, (a) => wrap(async () => { const r = await deps.improvement.recordEffectiveness(a); return ok(`Метрика '${a.metric}' для '${a.target}' записана`, r); }));

server.registerTool("get_effectiveness", {
  title: "Эффективность (тренд/среднее)",
  description: "Точки и средние по метрикам эффективности (опц. фильтр target/kind/metric). Для оценки и приоритизации улучшений.",
  inputSchema: { target: z.string().optional(), targetKind: targetKind.optional(), metric: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) },
  annotations: { readOnlyHint: true },
}, ({ target, targetKind: tk, metric, limit }) => wrap(async () => {
  const r = await deps.improvement.getEffectiveness({ target, targetKind: tk, metric, limit });
  return ok(`Точек: ${r.points.length}, агрегатов: ${r.averages.length}`, r);
}));

// ── Предложения улучшений (фичи 9, 11, 8) ──
server.registerTool("add_proposal", {
  title: "Добавить предложение улучшения",
  description: "Структурированное предложение по улучшению Nabu (от researcher/scout/learner). category: agent|skill|prompt|workflow|mcp|tool|process|schema. Ревьюит critic до accepted.",
  inputSchema: {
    sourceAgent: z.string().optional(), category,
    title: z.string().min(1), rationale: z.string().min(1), proposedChange: z.string().min(1),
    evidence: z.record(z.string(), z.unknown()).optional(),
    impact: z.enum(["low", "medium", "high"]).default("medium"),
    effort: z.enum(["low", "medium", "high"]).default("medium"),
  },
}, (a) => wrap(async () => { const r = await deps.improvement.addProposal(a); return ok(`Предложение создано (${r.id.slice(0, 8)}): ${a.title}`, r); }));

server.registerTool("list_proposals", {
  title: "Список предложений",
  description: "Бэклог предложений улучшений (опц. фильтр status/category). Для ревью и приоритизации.",
  inputSchema: { status: status.optional(), category: category.optional(), limit: z.number().int().min(1).max(200).default(50) },
  annotations: { readOnlyHint: true },
}, ({ status: st, category: cat, limit }) => wrap(async () => {
  const items = await deps.improvement.listProposals({ status: st, category: cat, limit });
  return ok(`Предложений: ${items.length}`, { proposals: items });
}));

server.registerTool("update_proposal", {
  title: "Решение по предложению",
  description: "Изменить статус предложения (proposed→accepted|rejected|implemented). Принятие — по решению пользователя/после critic. decided_by='user' по умолчанию.",
  inputSchema: { id: z.string().uuid(), status, decidedBy: z.string().default("user") },
}, ({ id, status: st, decidedBy }) => wrap(async () => {
  const okk = await deps.improvement.updateProposal(id, st, decidedBy);
  return okk ? ok(`Предложение → ${st}`, { id, status: st }) : fail("Предложение не найдено", { id });
}));

// ── Трекинг советов и исходов (фаза D, фича 13) ──
const recStatus = z.enum(["given", "applied", "partial", "not_applied", "unknown"]);

server.registerTool("record_recommendation", {
  title: "Зафиксировать выданный совет",
  description: "Записать рекомендацию Совета/министра для последующего трекинга исхода. followUpAt — когда уместно спросить, как применилось.",
  inputSchema: {
    sourceAgent: z.string().optional(), domain: z.string().optional(),
    question: z.string().min(1), recommendation: z.string().min(1),
    deliberationId: z.string().uuid().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    followUpAt: z.string().datetime().optional(),
  },
}, (a) => wrap(async () => { const r = await deps.recommendation.record(a); return ok(`Совет зафиксирован (${r.id.slice(0, 8)})`, r); }));

server.registerTool("list_recommendations_followup", {
  title: "Советы для опроса об исходе",
  description: "Рекомендации со статусом given, по которым уместно спросить пользователя, как применилось и каков результат.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
  annotations: { readOnlyHint: true },
}, ({ limit }) => wrap(async () => { const items = await deps.recommendation.listPendingFollowup(limit); return ok(`К опросу: ${items.length}`, { recommendations: items }); }));

server.registerTool("record_outcome", {
  title: "Записать исход совета + метрику эффективности",
  description: "Зафиксировать со слов пользователя, как применился совет и каков результат. Обновляет recommendation И пишет agent_effectiveness (source=feedback) — замыкая контур само-улучшения.",
  inputSchema: {
    id: z.string().uuid(), status: recStatus,
    outcome: z.string().optional(), outcomeRating: z.number().min(0).max(10).optional(),
    sourceAgent: z.string().optional(), domain: z.string().optional(),
  },
}, ({ id, status: st, outcome, outcomeRating, sourceAgent, domain }) => wrap(async () => {
  const okk = await deps.recommendation.recordOutcome(id, { status: st, outcome, outcomeRating });
  if (!okk) return fail("Рекомендация не найдена", { id });
  // замкнуть на эффективность: если есть оценка исхода — записать метрику (даже без sourceAgent:
  // тогда цель — 'council', иначе контур само-улучшения молча терял оценку).
  if (typeof outcomeRating === "number") {
    await deps.improvement.recordEffectiveness({
      targetKind: sourceAgent ? "agent" : "council", target: sourceAgent ?? "council",
      metric: "advice_outcome_rating",
      value: outcomeRating, source: "feedback", notes: domain ? `domain=${domain}` : undefined,
    });
  }
  return ok(`Исход записан (${st})`, { id, status: st });
}));

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-improve MCP server готов (stdio)");
}
main().catch((err) => { console.error("nabu-improve fatal:", err); process.exit(1); });
