// local-brain.mjs — «локальный мозг» Nabu, ярус T1 (ROADMAP: гейт «полностью локальный мозг»).
// Локальная модель (Ollama /api/chat + tools) ведёт агентный цикл с БЕЗОПАСНЫМ подмножеством
// тех же MCP-инструментов, что у Claude: память, задачи, календарь, знания. Это апгрейд
// offline-режима: не «ответ по recall», а реальная работа офлайн. Высокорисковые инструменты
// (вебхуки, approvals, vault-чтение) локальному мозгу НЕ выдаются — осознанно.
//
// Zero-dep: свой минимальный MCP-stdio-клиент + fetch к Ollama. Использование:
//   const { answer, steps, toolCalls } = await localBrainAnswer({ message, repoRoot, mcpConfigPath })

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const STEP_TIMEOUT_MS = Number(process.env.NABU_BRAIN_STEP_TIMEOUT_MS || 300_000); // CPU-модели медленные, холодный старт дольше
const MAX_STEPS = 6; // бюджет цикла (инвариант: бюджеты у любого агентного цикла)
const TOOL_RESULT_CAP = 4_000; // символов результата инструмента в контекст

// Безопасное подмножество: read-память/знания + повседневные write'ы личных данных.
// НЕТ: trigger_webhook/call_connector (внешнее), list_vault/get*Decrypted (vault — только
// по явному пути через Claude), approvals, update_note/index_* (конвейер), award_xp (геймификация
// требует суждения о «реальном достижении»).
// Ядро T1 сжато до 8 инструментов: CPU-модели тонут в большом tools-промпте (замерено:
// 22 схемы → таймаут шага даже у 0.8b). Расширение — через NABU_BRAIN_TOOLS (csv) при GPU.
const CORE_TOOLS = ["recall", "remember_episode", "list_tasks", "add_task", "update_task_status", "list_calendar", "list_prospective", "search_knowledge"];
// Даже пользовательский override НЕ может выдать локальному мозгу vault/внешние/approval-tools
// (r5-#5): vault читается только по явному запросу через Claude, не локальной моделью.
const BRAIN_DENYLIST = new Set(["list_vault", "getContentDecrypted", "request_approval", "resolve_approval", "trigger_webhook", "call_connector"]);
const TOOL_ALLOWLIST = new Set(
  (process.env.NABU_BRAIN_TOOLS ? process.env.NABU_BRAIN_TOOLS.split(",").map((s) => s.trim()) : CORE_TOOLS)
    .filter((t) => !BRAIN_DENYLIST.has(t)),
);
const BRAIN_SERVERS = ["nabu-memory", "nabu-domain", "nabu-pipeline", "nabu-analytics"];

const SYSTEM_PROMPT = `Ты — локальный резервный адъютант Nabu (облачный мозг недоступен). Работаешь ОФЛАЙН на локальной модели с ограниченным набором инструментов.

Правила:
- Отвечай на языке пользователя, кратко и по делу.
- ПОЛЬЗУЙСЯ инструментами: память (recall), задачи (list_tasks/add_task/update_task_status), календарь (list_calendar), знания (search_knowledge). Не выдумывай данные о пользователе — если recall пуст, честно скажи.
- Приватность: ничего не уходит в сеть, ты работаешь локально. Vault-записи тебе недоступны — так задумано.
- Границы: не давай медицинских/юридических/финансовых профессиональных советов — направляй к специалисту. Не притворяйся человеком.
- Высокорисковые действия (внешние вызовы, деньги, удаления) тебе недоступны — предложи повторить с полным Nabu.
- Заверши ответ, когда данных достаточно; не гоняй инструменты без нужды.`;

/** Минимальный MCP-stdio клиент: initialize → tools/list → tools/call. */
class McpClient {
  constructor(name, command, args, env) {
    this.name = name;
    this.child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.buf = "";
    this.pending = new Map();
    this.nextId = 1;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buf += chunk;
      let nl;
      while ((nl = this.buf.indexOf("\n")) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          const waiter = this.pending.get(msg.id);
          if (waiter) { this.pending.delete(msg.id); waiter(msg); }
        } catch { /* не-JSON строки сервера игнорируем */ }
      }
    });
    this.child.on("error", () => { /* rpc-таймауты доложат сами */ });
  }

  rpc(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name}.${method}: таймаут`)); }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(t); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); });
      this.child.stdin.write(payload);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async init() {
    await this.rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "nabu-local-brain", version: "1.0" } });
    this.notify("notifications/initialized");
    const { tools } = await this.rpc("tools/list", {});
    return tools ?? [];
  }

  kill() { try { this.child.kill("SIGKILL"); } catch { /* */ } }
}

/** Поднять безопасные серверы из mcp-config, собрать allowlist-инструменты. */
async function bootTools(mcpConfigPath, env) {
  const cfg = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
  const clients = [];
  const tools = []; // { ollamaTool, client, name }
  for (const [name, spec] of Object.entries(cfg.mcpServers ?? {})) {
    if (!BRAIN_SERVERS.includes(name)) continue;
    const c = new McpClient(name, spec.command, spec.args ?? [], { ...process.env, ...env });
    clients.push(c);
    try {
      const list = await c.init();
      for (const t of list) {
        if (!TOOL_ALLOWLIST.has(t.name)) continue;
        tools.push({
          client: c,
          name: t.name,
          ollamaTool: {
            type: "function",
            function: { name: t.name, description: (t.description ?? "").slice(0, 140), parameters: t.inputSchema ?? { type: "object", properties: {} } },
          },
        });
      }
    } catch { /* сервер не поднялся — работаем с остальными */ }
  }
  return { clients, tools };
}

/**
 * Агентный цикл локального мозга. Возвращает { answer, steps, toolCalls } или бросает.
 */
export async function localBrainAnswer({ message, mcpConfigPath, model, log = () => {}, maxSteps = MAX_STEPS, env = {} }) {
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const llm = model || process.env.NABU_LOCAL_LLM || "qwen3:4b";
  const { clients, tools } = await bootTools(mcpConfigPath, env);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  log({ evt: "local_brain_start", model: llm, tools: tools.length });

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
  let steps = 0;
  let toolCalls = 0;
  try {
    while (steps < maxSteps) {
      steps++;
      const r = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: llm, messages, tools: tools.map((t) => t.ollamaTool), stream: false, think: false, options: { num_predict: 900, num_ctx: 8192 } }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`ollama ${r.status}`);
      const j = await r.json();
      const msg = j.message ?? {};
      const calls = msg.tool_calls ?? [];
      if (!calls.length) {
        const answer = (msg.content || j.message?.thinking || "").trim();
        if (!answer) throw new Error("пустой ответ модели");
        log({ evt: "local_brain_done", steps, toolCalls });
        return { answer, steps, toolCalls };
      }
      messages.push(msg);
      for (const call of calls) {
        toolCalls++;
        const name = call.function?.name;
        // Двойная защита (r5): allowlist проверяется И при листинге, И при вызове.
        const t = TOOL_ALLOWLIST.has(name) ? toolByName.get(name) : null;
        let resultText;
        if (!t) {
          resultText = `Инструмент '${name}' недоступен локальному мозгу.`;
        } else {
          try {
            let args = call.function?.arguments ?? {};
            if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
            const res = await t.client.rpc("tools/call", { name, arguments: args }, 60_000);
            const sc = res?.structuredContent;
            resultText = JSON.stringify(sc ?? res?.content ?? res).slice(0, TOOL_RESULT_CAP);
          } catch (e) {
            resultText = `Ошибка инструмента: ${String(e.message).slice(0, 200)}`;
          }
        }
        messages.push({ role: "tool", content: resultText, tool_name: name });
      }
    }
    // бюджет исчерпан — просим финальный ответ без инструментов
    const fin = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: llm, messages: [...messages, { role: "user", content: "Бюджет инструментов исчерпан — дай финальный ответ по собранному." }], stream: false, think: false, options: { num_predict: 700, num_ctx: 8192 } }),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
    });
    const jf = await fin.json();
    const answer = (jf.message?.content || "").trim() || "Не успел собрать ответ за отведённый бюджет — попробуйте позже с полным Nabu.";
    log({ evt: "local_brain_budget", steps, toolCalls });
    return { answer, steps, toolCalls };
  } finally {
    for (const c of clients) c.kill();
  }
}
