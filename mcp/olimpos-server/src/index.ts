// nabu-olimpos MCP server — инструменты платформы OlimpOS (P3–P7): agile (эпики/спринты/доска/
// метрики), реестр/рынок агентов, публикация spaces (сайтов), песочница проектов (изолированный
// запуск кода + git). Скоуп берётся из env (NABU_NAMESPACE/USER_ID) — в много-тенантном режиме
// демон выставляет их per-tenant, поэтому все операции идут в пространстве текущего проекта/пользователя.
//
// Классы риска: agile/registry/spaces — write в своём namespace (автономно). sandbox_run —
// исполнение кода в ИЗОЛИРОВАННОМ docker (без сети/секретов/хоста по умолчанию). git push/PR наружу —
// высокий риск, проводится через approval (nabu-memory.request_approval), здесь не выставлен.

import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildDepsOrExit, installGracefulShutdown, ok, fail, wrap,
  listAgents, shareAgent, incrementAgentUsage,
  projectDir, writeSandboxFile, readSandboxFile, runInSandbox, gitStatus, gitCommit, gitClone, dockerAvailable,
  publishSpace, unpublishSpace,
} from "@nabu/lib";

const deps = buildDepsOrExit("nabu-olimpos");
const server = new McpServer({ name: "nabu-olimpos", version: "1.12.0" });

const sitesRoot = () => process.env.NABU_SITES_ROOT || join(process.env.NABU_HOME || ".", "sites");
const workdir = () => { const d = projectDir(deps.namespace); mkdirSync(d, { recursive: true }); return d; };

// ── Agile (P7) ──
server.registerTool("agile_create_epic", {
  title: "Создать эпик", description: "Эпик (крупная фича) в проекте. write.",
  inputSchema: { title: z.string().min(1), projectId: z.string().uuid().optional(), description: z.string().optional() },
}, (a) => wrap(async () => ok("Эпик создан", { epic: await deps.agile.createEpic(a.title, { projectId: a.projectId, description: a.description }) })));

server.registerTool("agile_list_epics", {
  title: "Эпики", description: "Список эпиков (опц. по проекту).",
  inputSchema: { projectId: z.string().uuid().optional() }, annotations: { readOnlyHint: true },
}, (a) => wrap(async () => { const e = await deps.agile.listEpics(a.projectId); return ok(`Эпиков: ${e.length}`, { epics: e }); }));

server.registerTool("agile_create_sprint", {
  title: "Создать спринт", description: "Спринт (итерация) в проекте с целью и датами. write.",
  inputSchema: { name: z.string().min(1), projectId: z.string().uuid().optional(), goal: z.string().optional(), startsOn: z.string().optional(), endsOn: z.string().optional() },
}, (a) => wrap(async () => ok("Спринт создан", { sprint: await deps.agile.createSprint(a.name, { projectId: a.projectId, goal: a.goal, startsOn: a.startsOn, endsOn: a.endsOn }) })));

server.registerTool("agile_activate_sprint", {
  title: "Активировать спринт", description: "Сделать спринт активным (прочие active того же проекта → closed). write.",
  inputSchema: { sprintId: z.string().uuid() },
}, (a) => wrap(async () => { await deps.agile.activateSprint(a.sprintId); return ok("Спринт активирован", { sprintId: a.sprintId }); }));

server.registerTool("agile_task_to_sprint", {
  title: "Задача → спринт", description: "Привязать/отвязать задачу к спринту (sprintId=null — убрать). write.",
  inputSchema: { taskId: z.string().uuid(), sprintId: z.string().uuid().nullable() },
}, (a) => wrap(async () => { await deps.agile.addTaskToSprint(a.taskId, a.sprintId); return ok("Готово", a); }));

server.registerTool("agile_task_estimate", {
  title: "Оценка задачи", description: "Story points задачи. write.",
  inputSchema: { taskId: z.string().uuid(), points: z.number().int().min(0).max(100) },
}, (a) => wrap(async () => { await deps.agile.estimateTask(a.taskId, a.points); return ok("Оценка проставлена", a); }));

server.registerTool("agile_task_assign", {
  title: "Назначить задачу", description: "Назначить задачу на участника (assigneeUser=null — снять). write.",
  inputSchema: { taskId: z.string().uuid(), assigneeUser: z.string().uuid().nullable() },
}, (a) => wrap(async () => { await deps.agile.assignTask(a.taskId, a.assigneeUser); return ok("Назначено", a); }));

server.registerTool("agile_task_move", {
  title: "Двинуть задачу по доске", description: "Колонка kanban: todo|doing|review|done. done → задача завершается. write.",
  inputSchema: { taskId: z.string().uuid(), column: z.enum(["todo", "doing", "review", "done"]) },
}, (a) => wrap(async () => { await deps.agile.moveTask(a.taskId, a.column); return ok(`→ ${a.column}`, a); }));

server.registerTool("agile_board", {
  title: "Доска", description: "Kanban-доска: задачи по колонкам (опц. фильтр проект/спринт).",
  inputSchema: { projectId: z.string().uuid().optional(), sprintId: z.string().uuid().optional() }, annotations: { readOnlyHint: true },
}, (a) => wrap(async () => ok("Доска", { board: await deps.agile.board({ projectId: a.projectId, sprintId: a.sprintId }) })));

server.registerTool("agile_sprint_metrics", {
  title: "Метрики спринта", description: "Velocity/burndown: суммарные/выполненные story points, счётчики по колонкам.",
  inputSchema: { sprintId: z.string().uuid() }, annotations: { readOnlyHint: true },
}, (a) => wrap(async () => ok("Метрики", await deps.agile.sprintMetrics(a.sprintId))));

// ── Реестр/рынок агентов (P4) ──
server.registerTool("agents_list", {
  title: "Агенты (банк)", description: "Доступные агенты: встроенные + опубликованные (shared) + свои private. onlyShared — рынок по популярности.",
  inputSchema: { onlyShared: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() }, annotations: { readOnlyHint: true },
}, (a) => wrap(async () => { const r = await listAgents(deps.pg, { userId: process.env.NABU_USER_ID, onlyShared: a.onlyShared, limit: a.limit }); return ok(`Агентов: ${r.length}`, { agents: r }); }));

server.registerTool("agents_share", {
  title: "Опубликовать агента", description: "Опубликовать личного агента в общий банк (shared) — станет доступен всем. write.",
  inputSchema: { slug: z.string().min(1) },
}, (a) => wrap(async () => { const okk = await shareAgent(deps.pg, a.slug, process.env.NABU_USER_ID || ""); return okk ? ok("Агент опубликован в банк", { slug: a.slug }) : fail("Нельзя опубликовать (нет такого личного агента)", a); }));

server.registerTool("agents_use", {
  title: "Отметить использование агента", description: "Инкремент счётчика использования (рейтинг рынка). write.",
  inputSchema: { slug: z.string().min(1) },
}, (a) => wrap(async () => { await incrementAgentUsage(deps.pg, a.slug); return ok("Учтено", a); }));

// ── Spaces / сайты (P6) ──
server.registerTool("space_publish_site", {
  title: "Опубликовать сайт", description: "Сгенерировать статический сайт из .md проекта (папка 'site/' в песочнице) и опубликовать на /s/<slug>. write/external (публичный URL).",
  inputSchema: { slug: z.string().min(1), title: z.string().optional() },
}, (a) => wrap(async () => {
  const src = join(workdir(), "site");
  if (!existsSync(src)) return fail("Нет папки 'site/' в проекте — сначала запиши туда .md страницы (sandbox_write_file site/index.md ...)", { expected: "site/*.md" });
  const nsId = await deps.pg.resolveNamespace(deps.namespace);
  const r = await publishSpace(deps.pg, nsId, a.slug, src, sitesRoot(), { title: a.title });
  return ok(`Опубликовано: ${r.pages} стр.`, r);
}));

server.registerTool("space_unpublish", {
  title: "Снять публикацию", description: "Сделать space снова приватным. write.",
  inputSchema: {},
}, () => wrap(async () => { const nsId = await deps.pg.resolveNamespace(deps.namespace); await unpublishSpace(deps.pg, nsId); return ok("Space снова приватный", {}); }));

// ── Песочница проектов (P5) ──
server.registerTool("sandbox_write_file", {
  title: "Записать файл в проект", description: "Записать файл в рабочую папку проекта (относительный путь; traversal запрещён). write.",
  inputSchema: { path: z.string().min(1), content: z.string() },
}, (a) => wrap(async () => { writeSandboxFile(workdir(), a.path, a.content); return ok(`Записано: ${a.path}`, { path: a.path }); }));

server.registerTool("sandbox_read_file", {
  title: "Прочитать файл проекта", description: "Прочитать файл из рабочей папки проекта.",
  inputSchema: { path: z.string().min(1) }, annotations: { readOnlyHint: true },
}, (a) => wrap(async () => { try { return ok(a.path, { content: readSandboxFile(workdir(), a.path) }); } catch (e) { return fail(String((e as Error).message)); } }));

server.registerTool("sandbox_run", {
  title: "Выполнить код в песочнице", description: "Выполнить команду в ИЗОЛИРОВАННОМ docker-контейнере (монтируется только папка проекта). network:false по умолчанию (нет сети/секретов/хоста); network:true — для npm/pip/git. Возвращает stdout/stderr/код.",
  inputSchema: { command: z.string().min(1), network: z.boolean().optional(), image: z.string().optional(), timeoutMs: z.number().int().min(1000).max(600000).optional() },
}, (a) => wrap(async () => {
  if (!(await dockerAvailable())) return fail("Docker недоступен — песочница невозможна", {});
  const r = await runInSandbox(workdir(), a.command, { network: a.network, image: a.image, timeoutMs: a.timeoutMs });
  return ok(`exit=${r.code}${r.timedOut ? " (таймаут)" : ""}`, { code: r.code, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-2000), timedOut: r.timedOut });
}));

server.registerTool("sandbox_git_status", {
  title: "git status", description: "Статус git в песочнице проекта.",
  inputSchema: {}, annotations: { readOnlyHint: true },
}, () => wrap(async () => { const r = await gitStatus(workdir()); return ok("git status", { out: r.stdout, code: r.code }); }));

server.registerTool("sandbox_git_commit", {
  title: "git commit", description: "Закоммитить изменения локально в песочнице (без push — push наружу требует approval). write.",
  inputSchema: { message: z.string().min(1) },
}, (a) => wrap(async () => { const r = await gitCommit(workdir(), a.message); return ok(`commit exit=${r.code}`, { out: r.stdout.slice(-1500), code: r.code }); }));

server.registerTool("sandbox_git_clone", {
  title: "git clone", description: "Клонировать репозиторий в песочницу проекта (network). Для приватных — URL с токеном формирует пользователь/approval. write/external.",
  inputSchema: { remote: z.string().url() },
}, (a) => wrap(async () => { const r = await gitClone(workdir(), a.remote); return ok(`clone exit=${r.code}`, { out: r.stdout.slice(-1500), code: r.code }); }));

const transport = new StdioServerTransport();
await server.connect(transport);
installGracefulShutdown(deps);
