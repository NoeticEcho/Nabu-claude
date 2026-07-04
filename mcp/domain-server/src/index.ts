// nabu-domain MCP server — узкие типизированные операции над доменными таблицами основного
// Nabu (projects/tasks/goals/habits/quests/character_sheet/xp_ledger). Заменяет сырой SQL в
// субагентах на безопасные tools. Записи — write-класс; необратимое/массовое агент проводит
// через approval (nabu-memory.request_approval). Скоуп по пользователю.

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildDepsOrExit, installGracefulShutdown, ok, degraded, fail, wrap, loadCalendars , resolveLiveConfig } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-domain");
const server = new McpServer({ name: "nabu-domain", version: "1.6.0" });
// Единый контракт результата — из @nabu/lib (ok/fail/wrap), без локальных копий.

// ── Проекты ──
server.registerTool("list_projects", {
  title: "Проекты", description: "Список проектов пользователя (опц. фильтр по статусу).",
  inputSchema: { status: z.string().optional() }, annotations: { readOnlyHint: true },
}, ({ status }) => wrap(async () => { const r = await deps.domain.listProjects(status); return ok(`Проектов: ${r.length}`, { projects: r }); }));

server.registerTool("update_project_status", {
  title: "Статус проекта", description: "Обновить статус проекта (write). Необратимое/закрытие — согласуй с пользователем.",
  inputSchema: { projectId: z.string().uuid(), status: z.string().min(1) },
}, ({ projectId, status }) => wrap(async () => { const okk = await deps.domain.updateProjectStatus(projectId, status); return okk ? ok("Статус обновлён", { projectId, status }) : fail("Проект не найден", { projectId }); }));

// ── Задачи ──
server.registerTool("list_tasks", {
  title: "Задачи", description: "Задачи пользователя. open:true — только незакрытые; dueWithinDays — со сроком в ближайшие N дней (просроченные первыми).",
  inputSchema: { projectId: z.string().uuid().optional(), status: z.string().optional(), open: z.boolean().optional(), dueWithinDays: z.number().int().min(0).max(365).optional() }, annotations: { readOnlyHint: true },
}, ({ projectId, status, open, dueWithinDays }) => wrap(async () => { const r = await deps.domain.listTasks({ projectId, status, open, dueWithinDays }); return ok(`Задач: ${r.length}`, { tasks: r }); }));

server.registerTool("add_task", {
  title: "Добавить задачу",
  description: "Создать задачу пользователя (ведение дел). due — YYYY-MM-DD; priority — high|normal|low; domains — сферы жизни.",
  inputSchema: {
    title: z.string().min(1).max(500),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["high", "normal", "low"]).optional(),
    projectId: z.string().uuid().optional(),
    domains: z.array(z.string()).max(5).optional(),
  },
}, ({ title, due, priority, projectId, domains }) => wrap(async () => {
  const r = await deps.domain.addTask(title, { due, priority, projectId, domains });
  return ok(`Задача создана: ${title.slice(0, 60)}`, { id: r.id });
}));

server.registerTool("update_task_status", {
  title: "Статус задачи", description: "Обновить статус задачи (write). done/completed проставляет completed_at.",
  inputSchema: { taskId: z.string().uuid(), status: z.string().min(1) },
}, ({ taskId, status }) => wrap(async () => { const okk = await deps.domain.updateTaskStatus(taskId, status); return okk ? ok("Статус задачи обновлён", { taskId, status }) : fail("Задача не найдена", { taskId }); }));

// ── Цели ──
server.registerTool("list_goals", {
  title: "Цели", description: "Цели пользователя (SMART), опц. по статусу.",
  inputSchema: { status: z.string().optional() }, annotations: { readOnlyHint: true },
}, ({ status }) => wrap(async () => { const r = await deps.domain.listGoals(status); return ok(`Целей: ${r.length}`, { goals: r }); }));

// ── Привычки ──
server.registerTool("list_habits", {
  title: "Привычки", description: "Привычки пользователя (по умолчанию активные).",
  inputSchema: { activeOnly: z.boolean().default(true) }, annotations: { readOnlyHint: true },
}, ({ activeOnly }) => wrap(async () => { const r = await deps.domain.listHabits(activeOnly); return ok(`Привычек: ${r.length}`, { habits: r }); }));

server.registerTool("log_habit", {
  title: "Отметить привычку", description: "Записать выполнение привычки за день (write). planned-skip не сбивает серию (streak-keeper).",
  inputSchema: { habitId: z.string().uuid(), status: z.enum(["done", "skipped", "planned-skip"]), date: z.string().optional() },
}, ({ habitId, status, date }) => wrap(async () => { const r = await deps.domain.logHabit(habitId, status, date); return ok("Привычка отмечена", r); }));

// ── Квесты ──
server.registerTool("list_quests", {
  title: "Квесты", description: "Квесты пользователя (опц. по статусу).",
  inputSchema: { status: z.string().optional() }, annotations: { readOnlyHint: true },
}, ({ status }) => wrap(async () => { const r = await deps.domain.listQuests(status); return ok(`Квестов: ${r.length}`, { quests: r }); }));

// ── Персонаж / RPG ──
server.registerTool("get_character", {
  title: "Лист персонажа", description: "RPG-лист: уровень, классы, XP по 8 атрибутам, tuppi.",
  inputSchema: {}, annotations: { readOnlyHint: true },
}, () => wrap(async () => { const c = await deps.domain.getCharacter(); return ok("Лист персонажа", { character: c }); }));

server.registerTool("log_metric", {
  title: "Записать метрику жизни",
  description: "Залогировать значение метрики (настроение, сон, вес, расходы…). Создаёт ряд по имени, если нет. Питает nabu-analytics (тренды/аномалии/корреляции). Приватные метрики — локально.",
  inputSchema: {
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().optional(),
    domain: z.string().optional(),
    occurredAt: z.string().datetime().optional(),
  },
}, ({ name, value, unit, domain, occurredAt }) => wrap(async () => {
  const r = await deps.domain.logMetric(name, value, { unit, domain, occurredAt });
  return ok(`Метрика '${name}'=${value} записана`, r);
}));

server.registerTool("award_xp", {
  title: "Начислить XP", description: "Начислить XP по атрибуту (intellect|wisdom|creativity|discipline|vitality|resilience|sociality|wealth) с обязательной причиной. Каждый XP объясним. Write.",
  inputSchema: {
    attribute: z.enum(["intellect", "wisdom", "creativity", "discipline", "vitality", "resilience", "sociality", "wealth"]),
    amount: z.number().int().min(1).max(1000),
    reason: z.string().min(1),
  },
}, ({ attribute, amount, reason }) => wrap(async () => { const r = await deps.domain.awardXp(attribute, amount, reason); return ok(`+${amount} XP (${attribute})`, r); }));

// ── Календарь (ICS без OAuth) ──
server.registerTool("list_calendar", {
  title: "Календарь (ICS)",
  description: "События из ICS-календарей (файлы/URL-подписки без OAuth) на ближайшие N дней. Источники — config calendar.ics_sources. Read-only.",
  inputSchema: { days: z.number().int().min(1).max(60).default(7) }, annotations: { readOnlyHint: true },
}, ({ days }) => wrap(async () => {
  const cfg = JSON.parse(readFileSync(resolveLiveConfig("nabu.config.json"), "utf8"));
  const sources = (cfg.calendar?.ics_sources ?? []) as Array<{ name?: string; url?: string; path?: string }>;
  if (!sources.length) return degraded("Календари не настроены — заполните config calendar.ics_sources", { events: [] });
  const { events, errors } = await loadCalendars(sources, { horizonDays: days });
  return ok(`Событий: ${events.length}`, { events, errors }, errors);
}));

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-domain MCP server готов (stdio)");
}
main().catch((err) => { console.error("nabu-domain fatal:", err); process.exit(1); });
