// nabu-memory MCP server — узкие типизированные операции над 7 типами памяти
// (Postgres+pgvector) и графом (TypeDB). Никакого сырого SQL/TQL наружу. Структурированные
// результаты. private/vault эмбеддятся локально (Ollama). Высокорисковых side-effect'ов нет:
// это персональная память пользователя (класс write_local/read внутри его namespace).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildDepsOrExit, installGracefulShutdown, ok, degraded, wrap, type McpToolResult } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-memory");

const server = new McpServer({ name: "nabu-memory", version: "1.9.0" });

const visibility = z.enum(["default", "private", "vault"]);

// Единый формат результата + автоматический перехват ошибок (см. lib/mcp-result).
// reg наследует сигнатуру server.registerTool (Zod-инференс аргументов сохраняется на месте
// вызова), а хендлер оборачивается в wrap() — любое исключение → структурированный error.
const result = ok;
const reg = ((name: string, opts: unknown, h: (...a: unknown[]) => Promise<unknown>) =>
  server.registerTool(name as never, opts as never, ((...a: unknown[]) =>
    wrap(() => h(...a) as Promise<McpToolResult>)) as never)) as unknown as typeof server.registerTool;

// ── Эпизодическая память ──
reg(
  "remember_episode",
  {
    title: "Запомнить эпизод",
    description:
      "Сохранить эпизодическое событие (что произошло, кто участвовал, эмоция, контекст). Эмбеддинг локальный для private/vault. Возвращает id.",
    inputSchema: {
      event: z.string().min(1).describe("Что произошло"),
      actors: z.array(z.string()).default([]).describe("Кто участвовал"),
      emotion: z.string().optional().describe("Эмоциональная окраска (опц.)"),
      context: z.record(z.string(), z.unknown()).default({}).describe("Место/источник/ссылки"),
      visibility: visibility.default("private"),
      occurredAt: z.string().datetime().optional(),
    },
    annotations: { idempotentHint: false },
  },
  async (args) => {
    const { id } = await deps.memory.rememberEpisode(args);
    return result(`Эпизод сохранён (${id.slice(0, 8)})`, { id });
  },
);

// ── Семантическая память (факты) ──
reg(
  "add_fact",
  {
    title: "Добавить факт",
    description:
      "Сохранить семантический факт о пользователе/мире (subject-predicate-object) с уверенностью и источником. Только факты, не выдумки.",
    inputSchema: {
      subject: z.string().min(1),
      predicate: z.string().min(1),
      object: z.string().min(1),
      confidence: z.number().min(0).max(1).default(0.8),
      source: z.string().optional(),
      visibility: visibility.default("private"),
    },
  },
  async (args) => {
    const { id } = await deps.memory.addFact(args);
    return result(`Факт сохранён (${id.slice(0, 8)})`, { id });
  },
);

// ── Рабочая память ──
reg(
  "set_working",
  {
    title: "Записать в рабочую память",
    description: "Временный контекст сессии (TTL 24ч). Для промежуточных заметок текущего диалога.",
    inputSchema: {
      sessionId: z.string().min(1),
      content: z.string().min(1),
      meta: z.record(z.string(), z.unknown()).default({}),
    },
  },
  async (args) => {
    const { id } = await deps.memory.setWorking(args);
    return result("Записано в рабочую память", { id });
  },
);

reg(
  "get_working",
  {
    title: "Прочитать рабочую память",
    description: "Активный (не истёкший) контекст сессии по sessionId.",
    inputSchema: { sessionId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ sessionId }) => {
    const items = await deps.memory.getWorking(sessionId);
    return result(`Найдено ${items.length} записей`, { items });
  },
);

// ── Проспективная память (намерения/напоминания) ──
reg(
  "add_prospective",
  {
    title: "Добавить намерение",
    description: "Намерение/напоминание с временем или условием срабатывания.",
    inputSchema: {
      intent: z.string().min(1),
      triggerAt: z.string().datetime().optional(),
      triggerCond: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async (args) => {
    const { id } = await deps.memory.addProspective(args);
    return result("Намерение сохранено", { id });
  },
);

reg(
  "list_prospective",
  {
    title: "Список намерений",
    description: "Ожидающие намерения/напоминания (status=pending).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const items = await deps.memory.listProspective();
    return result(`Ожидающих намерений: ${items.length}`, { items });
  },
);

// ── Процедурная память ──
reg(
  "add_procedure",
  {
    title: "Добавить процедуру",
    description: "Навык/процедура как последовательность шагов (процедурная память).",
    inputSchema: { skill: z.string().min(1), steps: z.array(z.unknown()) },
  },
  async (args) => {
    const { id } = await deps.memory.addProcedure(args);
    return result("Процедура сохранена", { id });
  },
);

// ── Гибридный recall ──
reg(
  "recall",
  {
    title: "Вспомнить (семантический поиск)",
    description:
      "Гибридный поиск по памяти (episodic/semantic/autobiographical) по смыслу запроса. Возвращает топ-K хитов с оценкой близости. Только из памяти — не выдумывает.",
    inputSchema: {
      query: z.string().min(1),
      topK: z.number().int().min(1).max(50).default(12),
      kinds: z.array(z.enum(["episodic", "semantic", "autobiographical"])).optional(),
      visibility: z
        .array(z.enum(["default", "private", "vault"]))
        .optional()
        .describe("Фильтр приватности; по умолчанию все локальные. Исключите 'vault' для менее чувствительного контекста."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, topK, kinds, visibility: vis }) => {
    try {
      const hits = await deps.memory.recall({ query, topK, kinds, visibility: vis });
      return result(hits.length ? `Найдено ${hits.length} релевантных единиц` : "Память пуста по этому запросу", {
        hits,
      });
    } catch (err) {
      return degraded("Поиск недоступен (эмбеддер?)", { error: (err as Error).message });
    }
  },
);

// ── Явное чтение vault ──
reg(
  "list_vault",
  {
    title: "Прочитать vault-память",
    description:
      "ЯВНОЕ чтение самой чувствительной (vault) памяти: недавние episodic+semantic записи, расшифрованные локальным ключом NABU_VAULT_KEY. Vault недоступен обычному recall (векторный поиск по нему невозможен by design). Вызывать ТОЛЬКО по прямой просьбе пользователя.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
    annotations: { readOnlyHint: true },
  },
  async ({ limit }) => {
    const items = await deps.memory.listVaultRecent(limit);
    return result(`Vault-записей: ${items.length}`, { items });
  },
);

// ── Консолидация / рефлексия ──
reg(
  "list_recent_episodes",
  {
    title: "Недавние эпизоды",
    description: "Эпизоды по времени (для консолидации/рефлексии). Опц. фильтр по числу дней.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50),
      sinceDays: z.number().int().min(1).max(3650).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ limit, sinceDays }) => {
    const episodes = await deps.memory.listRecentEpisodes(limit, sinceDays);
    return result(`Эпизодов: ${episodes.length}`, { episodes });
  },
);

reg(
  "save_narrative",
  {
    title: "Сохранить автобиографический нарратив",
    description:
      "Связный нарратив за период (например '2026-W26' или '2026-06'). Идемпотентно по периоду. Результат консолидации эпизодов.",
    inputSchema: { period: z.string().min(1), narrative: z.string().min(1) },
  },
  async ({ period, narrative }) => {
    const { id } = await deps.memory.saveNarrative(period, narrative);
    return result(`Нарратив за ${period} сохранён`, { id });
  },
);

// ── Граф (TypeDB) — деградирует, если недоступен ──
reg(
  "graph_upsert_concept",
  {
    title: "Добавить концепт в граф",
    description:
      "Идемпотентно добавить концепт (сущность) в граф TypeDB. При недоступности TypeDB — no-op с предупреждением.",
    inputSchema: {
      name: z.string().min(1),
      entityType: z.string().optional(),
      externalId: z.string().optional(),
      visibility: visibility.optional(),
    },
  },
  async (args) => {
    const avail = await deps.graph.available();
    if (!avail) return result("Концепт не добавлен: TypeDB недоступен", { added: false }, ["TypeDB недоступен"]);
    await deps.graph.upsertConcept(args.name, args);
    return result(`Концепт '${args.name}' в графе`, { added: true });
  },
);

reg(
  "graph_relate",
  {
    title: "Связать концепты",
    description: "Создать ассоциацию между двумя концептами (граф). При недоступности TypeDB — no-op.",
    inputSchema: {
      from: z.string().min(1),
      to: z.string().min(1),
      kind: z.string().min(1),
      weight: z.number().default(1.0),
    },
  },
  async ({ from, to, kind, weight }) => {
    const avail = await deps.graph.available();
    if (!avail) return result("Связь не создана: TypeDB недоступен", { related: false }, ["TypeDB недоступен"]);
    await deps.graph.relateConcepts(from, to, kind, weight);
    return result(`Связь ${from} —${kind}→ ${to}`, { related: true });
  },
);

reg(
  "graph_neighbors",
  {
    title: "Соседи концепта в графе",
    description: "Связанные концепты для заданного (ассоциативная память). Пусто, если TypeDB недоступен.",
    inputSchema: { name: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true },
  },
  async ({ name, limit }) => {
    const neighbors = await deps.graph.neighbors(name, limit);
    return result(`Соседей: ${neighbors.length}`, { neighbors });
  },
);

// ── Governance: approval высокорисковых действий + аудит (инвариант #7) ──
const riskClass = z.enum(["external", "financial", "destructive", "deploy", "purchase", "communication"]);

reg(
  "request_approval",
  {
    title: "Запросить одобрение действия",
    description:
      "Создать durable-запись запроса на одобрение высокорискового действия (деплой, платёж, отправка, необратимое). Возвращает approvalId. НЕ выполняет действие — агент обязан показать запрос пользователю и дождаться явного согласия. Модель НЕ одобряет своё действие сама.",
    inputSchema: {
      agent: z.string().min(1),
      riskClass,
      action: z.string().min(1),
      target: z.string().optional(),
      summary: z.string().min(1),
      preview: z.record(z.string(), z.unknown()).optional(),
      expected: z.string().optional(),
      rollback: z.string().optional(),
      scope: z.string().optional(),
    },
  },
  async (args) => {
    const { id } = await deps.governance.requestApproval(args);
    return result(`Запрос на одобрение создан (${id.slice(0, 8)}). Требуется явное согласие пользователя.`, {
      approvalId: id,
    });
  },
);

reg(
  "list_pending_approvals",
  {
    title: "Ожидающие одобрения",
    description: "Список неистёкших запросов на одобрение (status=pending).",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const items = await deps.governance.listPendingApprovals();
    return result(`Ожидают одобрения: ${items.length}`, { items });
  },
);

// ВАЖНО (аудит Round 6, C1): tool `resolve_approval` НАМЕРЕННО НЕ регистрируется в тулсете модели.
// Резолв одобрения — строго ВНЕ модели: только по нажатию человека в UI (web `POST /api/approvals/:id`
// и Telegram inline-кнопка), которые вызывают `governance.resolveApproval` НАПРЯМУЮ (не через MCP).
// Если бы этот tool был доступен модели, она могла бы одобрить собственное действие
// (request_approval → resolve_approval → trigger_webhook) и обойти инвариант #7. Не возвращать.

reg(
  "log_action",
  {
    title: "Записать действие в аудит",
    description: "Зафиксировать выполненное/заблокированное высокорисковое действие в аудит-лог (со ссылкой на approval).",
    inputSchema: {
      agent: z.string().min(1),
      riskClass,
      action: z.string().min(1),
      target: z.string().optional(),
      status: z.enum(["ok", "error", "blocked", "skipped"]),
      approvalId: z.string().uuid().optional(),
      detail: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async (args) => {
    const { id } = await deps.governance.logAction(args);
    return result(`Действие записано в аудит (${args.status})`, { id });
  },
);

// ── Личность (черты → директивы) ──
reg(
  "render_personality",
  {
    title: "Директивы личности агента",
    description:
      "Отрендерить числовые черты агента (agents/<agent>.json / agent_personality) в текстовые директивы поведения по PERSONALITY_RENDERING.md. Субагент вызывает при активации, чтобы применить свою личность.",
    inputSchema: { agent: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ agent }) => {
    const block = await deps.personality.render(agent);
    if (!block) return degraded(`Профиль '${agent}' не найден`, { agent }, ["нет профиля личности"]);
    return result(`Директивы личности '${agent}'`, { agent, directives: block });
  },
);

reg(
  "seed_personality",
  {
    title: "Засеять личности в БД",
    description: "Идемпотентно перенести числовые черты из agents/*.json в таблицу agent_personality (для эволюции/лога).",
    inputSchema: {},
  },
  async () => {
    const r = await deps.personality.seedFromProfiles();
    return result(`Засеяно профилей личности: ${r.seeded}`, r);
  },
);

reg(
  "evolve_personality",
  {
    title: "Эволюция черты личности (самообучение)",
    description:
      "Сдвиг числовой черты агента по обратной связи (самообучение, фича 8). Работает ТОЛЬКО если у профиля evolves=true; шаг ограничен ±1; honesty/kindness не ниже порогов; изменение логируется в agent_personality_log. Иначе — предложить через improvement_proposal.",
    inputSchema: {
      agent: z.string().min(1),
      trait: z.string().min(1),
      delta: z.number().min(-1).max(1),
      reason: z.string().min(1),
    },
  },
  async ({ agent, trait, delta, reason }) => {
    const okk = await deps.personality.evolveTrait(agent, trait, delta, reason);
    if (!okk) return degraded("Эволюция не применена (evolves=false или ниже порога). Оформите как improvement_proposal.", { agent, trait }, ["evolution gated"]);
    return result(`Черта '${trait}' агента '${agent}' сдвинута на ${delta} (залогировано)`, { agent, trait, delta });
  },
);

// ── Гигиена рабочей памяти (TTL) ──
reg(
  "purge_expired_working",
  {
    title: "Очистить истёкшую рабочую память",
    description: "Удалить строки working_memory с expires_at < now() (гигиена TTL). Возвращает число удалённых.",
    inputSchema: {},
  },
  async () => {
    const n = await deps.memory.purgeExpiredWorking();
    return result(`Удалено истёкших записей: ${n}`, { deleted: n });
  },
);

// ── Внутренний трекер задач Nabu (фича 10) ──
reg(
  "add_system_task",
  {
    title: "Добавить системную задачу Nabu",
    description:
      "Внутренний бэклог Nabu (НЕ пользовательские задачи): задачи агентов, предложения улучшений, запросы фидбэка, проактивные действия. kind: task|proposal|improvement|feedback|research|scheduled.",
    inputSchema: {
      kind: z.enum(["task", "proposal", "improvement", "feedback", "research", "scheduled"]).default("task"),
      title: z.string().min(1),
      detail: z.string().optional(),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
      sourceAgent: z.string().optional(),
      related: z.record(z.string(), z.unknown()).optional(),
      dueAt: z.string().datetime().optional(),
    },
  },
  async (args) => {
    const { id } = await deps.systemTask.add(args);
    return result(`Системная задача создана (${id.slice(0, 8)})`, { id });
  },
);

reg(
  "list_system_tasks",
  {
    title: "Список системных задач Nabu",
    description: "Бэклог Nabu (опц. фильтр kind/status). Для планирования само-улучшения и проактивных действий.",
    inputSchema: {
      kind: z.enum(["task", "proposal", "improvement", "feedback", "research", "scheduled"]).optional(),
      status: z.enum(["open", "in_progress", "blocked", "done", "dismissed"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ kind, status, limit }) => {
    const items = await deps.systemTask.list({ kind, status, limit });
    return result(`Системных задач: ${items.length}`, { items });
  },
);

reg(
  "update_system_task",
  {
    title: "Статус системной задачи",
    description: "Обновить статус задачи бэклога Nabu (open|in_progress|blocked|done|dismissed).",
    inputSchema: {
      id: z.string().uuid(),
      status: z.enum(["open", "in_progress", "blocked", "done", "dismissed"]),
    },
  },
  async ({ id, status }) => {
    const okk = await deps.systemTask.updateStatus(id, status);
    return okk ? result("Статус обновлён", { id, status }) : degraded("Задача не найдена", { id }, ["нет такой задачи"]);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  installGracefulShutdown(deps);
  console.error("nabu-memory MCP server готов (stdio)");
}

main().catch((err) => {
  console.error("nabu-memory fatal:", err);
  process.exit(1);
});
