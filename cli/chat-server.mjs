// Nabu web chat server — zero-dependency Node >=22 ES module.
// Bridges a browser chat UI to Claude Code running headless (stream-json),
// persisting only lightweight thread metadata (messages live client-side).
//
// Usage:
//   import { startChatServer } from "./chat-server.mjs";
//   await startChatServer({ port, host, repoRoot, nabuHome, claudeBin });
// or standalone:
//   node cli/chat-server.mjs   (reads PORT / NABU_HOME from env)

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual as tse } from "node:crypto";
import { readFile, writeFile, rename, mkdir, realpath } from "node:fs/promises";
import { appendFileSync, mkdirSync, statSync, renameSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { allSharedConvs, isSharedConv, convTitle, roleOfConv } from "./conversations.mjs";

const CHILD_TIMEOUT_MS = 10 * 60 * 1000; // kill a stuck Claude after 10 minutes
import { ALLOWED_TOOLS, ISOLATION_ARGS } from "./claude-run.mjs";

// ---------------------------------------------------------------------------
// Структурированный JSONL-лог (${nabuHome}/.nabu/logs/chat.jsonl, ротация 5МБ).
// Каждый обмен/ошибка — одна JSON-строка: читается человеком и Claude при отладке.
// ---------------------------------------------------------------------------

const LOG_ROTATE_BYTES = 5 * 1024 * 1024;
const NABU_MCP_SERVERS = ["memory", "pipeline", "council", "voice", "analytics", "domain", "improve", "connect"];

/**
 * Явный MCP-конфиг для headless-сессий: `claude -p` НЕ поднимает MCP-серверы плагина
 * автоматически (проверено вживую — сессия сообщала «MCP-серверов памяти нет»).
 * Генерируем ${nabuHome}/.nabu/mcp-config.json с 8 nabu-серверами из repoRoot и передаём
 * через --mcp-config. Серверы наследуют env процесса (DATABASE_URL и пр.).
 */
export function ensureMcpConfig(nabuHome, repoRoot) {
  const dir = join(nabuHome, ".nabu");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "mcp-config.json");
  const mcpServers = {};
  for (const s of NABU_MCP_SERVERS) {
    mcpServers[`nabu-${s}`] = { command: "node", args: [join(repoRoot, "mcp", `${s}-server`, "dist", "index.js")] };
  }
  writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
  return file;
}

function makeLogger(nabuHome) {
  const dir = join(nabuHome, ".nabu", "logs");
  const file = join(dir, "chat.jsonl");
  return function log(evt) {
    try {
      mkdirSync(dir, { recursive: true });
      try {
        if (statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, file + ".old");
      } catch { /* нет файла — ок */ }
      appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...evt }) + "\n");
    } catch { /* логирование никогда не роняет сервер */ }
  };
}

// ---------------------------------------------------------------------------
// Статистика (/api/stats): ленивый импорт lib/dist → DashboardRepository, кэш 5с.
// При недоступности lib/БД отдаём degraded-каркас — UI рендерит "н/д", не падает.
// ---------------------------------------------------------------------------

// Per-profile кэш deps (мульти-профиль v2): ключ "" = дефолтное пространство из env.
const libDepsCache = new Map();
// Живые конфиги вне git (r3-M1): зеркало resolveLiveConfig из lib (zero-dep локальная копия).
function liveConfigPath(repoRoot, name) {
  const home = process.env.NABU_HOME || join(homedirCompat(), "nabu");
  const dir = process.env.NABU_CONFIG_DIR || join(home, ".nabu", "config");
  const live = join(dir, name);
  const tpl = join(repoRoot, "config", name);
  try {
    if (!statSafe(live) && statSafe(tpl)) {
      mkdirSync(dir, { recursive: true });
      const tmp = `${live}.${process.pid}.seed`;
      writeFileSync(tmp, readFileSync(tpl));
      renameSync(tmp, live); // атомарный посев
    }
  } catch { /* fallback на шаблон */ }
  return statSafe(live) ? live : tpl;
}
function homedirCompat() { return process.env.HOME || process.env.USERPROFILE || ""; }
function statSafe(p) { try { statSync(p); return true; } catch { return false; } }

function profilesConfig(repoRoot) {
  try {
    return JSON.parse(readFileSync(liveConfigPath(repoRoot, "profiles.json"), "utf8"))?.profiles ?? {};
  } catch { return {}; }
}
function getLibDeps(repoRoot, profile = "") {
  const key = profile || "";
  if (!libDepsCache.has(key)) {
    const p = (async () => {
      const lib = await import(pathToFileURL(join(repoRoot, "lib", "dist", "index.js")).href);
      lib.hydrateEnv?.();
      const prof = key ? profilesConfig(repoRoot)[key] : null;
      if (key && !prof) throw new Error(`Профиль '${key}' не найден в config/profiles.json`);
      if (prof && (!prof.namespace || !prof.user_id)) {
        throw new Error(`Профиль '${key}' неполный (нужны namespace И user_id) — nabu profiles add ${key}`);
      }
      return lib.buildDeps(prof ? { namespace: prof.namespace, userId: prof.user_id } : {});
    })();
    p.catch(() => { libDepsCache.delete(key); }); // повторная попытка после сбоя
    libDepsCache.set(key, p);
  }
  return libDepsCache.get(key);
}

const hookIdempotency = new Map(); // hook -> Map<idemKey, ts> (память процесса; ретраи короткоживущие)

const STATS_TTL_MS = 5000;
let statsCache = { at: 0, data: null };

/** Offline-fallback: recall из локальной памяти + локальная LLM (Ollama). Без Claude. */
async function offlineAnswer(repoRoot, message, profile = "") {
  const deps = await getLibDeps(repoRoot, profile); // r5-#3: recall в пространстве профиля треда, не main
  let context = "";
  try {
    const hits = await deps.memory.recall({ query: message, topK: 5 });
    context = (hits ?? []).map((h) => `- ${String(h.text ?? h.content ?? "").slice(0, 200)}`).join("\n");
  } catch { /* память недоступна — отвечаем без контекста */ }
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.NABU_LOCAL_LLM || "qwen3:4b";
  const prompt = `Ты — локальный резервный режим ассистента Nabu (Claude недоступен). Ответь кратко по-русски на вопрос пользователя, опираясь ТОЛЬКО на контекст из памяти ниже. Нет ответа в контексте — честно скажи, что офлайн-режим ограничен и предложи повторить позже.\n\nКонтекст памяти:\n${context || "(пусто)"}\n\nВопрос: ${message}\n\nОтвет:`;
  const r = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, think: false, options: { num_predict: 400 } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const text = (j.response || j.thinking || "").trim();
  if (!text) return null;
  return `⚠️ **Офлайн-режим** (Claude недоступен; отвечает локальная модель ${model} по памяти — возможности ограничены)\n\n${text}`;
}

/** Узкий read-only список имён концептов из TypeDB (для drill-down графа знаний).
 * Дублирует парсинг fetch-ответа из lib/graph.ts (extractFetch) — zero-dep локальная копия,
 * чтобы не тянуть репозиторный метод в web-слой. При недоступности TypeDB бросает — вызывающая
 * сторона оборачивает в safe() и деградирует. */
async function readConceptNames(graphClient, limit = 24) {
  const raw = await graphClient.read(
    `match $c isa concept, has concept-name $n; limit ${limit}; fetch { "n": $n };`,
  );
  const out = [];
  for (const ans of (raw && raw.answers) || []) {
    const v = ans && ans.n;
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object" && typeof v.value === "string") out.push(v.value);
  }
  return [...new Set(out)];
}

function degradedStats(message) {
  return {
    status: "degraded",
    generatedAt: new Date().toISOString(),
    warnings: [message],
    memory: null,
    knowledge: null,
    graph: { available: false, concepts: null, associations: null },
    council: null,
    domains: null,
    system: null,
    daily: [],
  };
}

// ---------------------------------------------------------------------------
// Серверная история чата (P1-5): сообщения — в Postgres (chat_message, scope namespace).
// Best-effort: сбой БД не ломает чат (история тогда живёт только в localStorage браузера).
// ---------------------------------------------------------------------------

const chatNsCache = new Map(); // namespace(строка) -> id (мульти-профиль: у каждого свой)
async function chatNs(deps) {
  if (!chatNsCache.has(deps.namespace)) chatNsCache.set(deps.namespace, await deps.pg.resolveNamespace(deps.namespace));
  return chatNsCache.get(deps.namespace);
}

async function persistMessage(repoRoot, threadId, role, content, costUsd = null, profile = "") {
  if (!content) return;
  try {
    const deps = await getLibDeps(repoRoot, profile);
    const ns = await chatNs(deps);
    await deps.pg.query(
      "insert into chat_message(namespace, thread_id, role, content, cost_usd) values ($1,$2,$3,$4,$5)",
      [ns, threadId, role, content, costUsd],
    );
  } catch { /* best-effort */ }
}

async function loadMessages(repoRoot, threadId, limit = 200, profile = "") {
  const deps = await getLibDeps(repoRoot, profile);
  const ns = await chatNs(deps);
  const rows = await deps.pg.query(
    `select role, content, cost_usd, created_at from chat_message
     where namespace=$1 and thread_id=$2 order by id desc limit $3`,
    [ns, threadId, limit],
  );
  return rows.reverse().map((r) => ({ role: r.role, text: r.content, costUsd: r.cost_usd, at: r.created_at }));
}

async function deleteMessages(repoRoot, threadId, profile = "") {
  try {
    const deps = await getLibDeps(repoRoot, profile);
    const ns = await chatNs(deps);
    await deps.pg.query("delete from chat_message where namespace=$1 and thread_id=$2", [ns, threadId]);
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// Thread store — a single JSON file under ${nabuHome}/.nabu/chat-threads.json.
// Shape: [{ id, title, claudeSessionId, createdAt, updatedAt }]
// Мутации сериализованы in-process (см. threadsLock) — гонка read-modify-write закрыта.
// ---------------------------------------------------------------------------

let threadsLock = Promise.resolve();
function withThreadsLock(fn) {
  const run = threadsLock.then(fn, fn);
  threadsLock = run.catch(() => { /* не рвём цепочку */ });
  return run;
}

function threadsPaths(nabuHome) {
  const dir = join(nabuHome, ".nabu");
  return { dir, file: join(dir, "chat-threads.json") };
}

async function readThreads(nabuHome) {
  const { file } = threadsPaths(nabuHome);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    // Corrupt/unreadable file: degrade gracefully rather than crash.
    return [];
  }
}

async function writeThreads(nabuHome, threads) {
  const { dir, file } = threadsPaths(nabuHome);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(threads, null, 2), "utf8");
  await rename(tmp, file); // atomic replace on same filesystem
}

function upsertThread(nabuHome, thread) {
  return withThreadsLock(async () => {
    const threads = await readThreads(nabuHome);
    const idx = threads.findIndex((t) => t.id === thread.id);
    if (idx === -1) threads.push(thread);
    else threads[idx] = { ...threads[idx], ...thread };
    await writeThreads(nabuHome, threads);
    return thread;
  });
}

function deleteThread(nabuHome, id) {
  return withThreadsLock(async () => {
    const threads = await readThreads(nabuHome);
    const next = threads.filter((t) => t.id !== id);
    const removed = next.length !== threads.length;
    if (removed) await writeThreads(nabuHome, next);
    return removed;
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: "not_found" });
}

async function readRequestBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

function openSse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Prime the stream so proxies/browsers flush headers immediately.
  res.write(": ok\n\n");
}

function sseSend(res, obj) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ---------------------------------------------------------------------------
// Claude Code streaming bridge
// ---------------------------------------------------------------------------

// Extract text pieces from an assistant message event's content array.
function extractAssistantText(event) {
  const out = [];
  const content = event?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        out.push(block.text);
      }
    }
  }
  return out;
}

// Extract text from a streaming delta event (stream_event / partial assistant).
function extractDeltaText(event) {
  // stream-json may emit incremental deltas in a few shapes; be liberal.
  const delta = event?.delta ?? event?.event?.delta;
  if (delta && delta.type === "text_delta" && typeof delta.text === "string") {
    return delta.text;
  }
  if (typeof event?.text === "string" && event?.type === "text") {
    return event.text;
  }
  return null;
}

// Extract tool_use names from an assistant message event.
function extractToolNames(event) {
  const names = [];
  const content = event?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "tool_use" && block.name) {
        names.push(block.name);
      }
    }
  }
  return names;
}

/**
 * Run one Claude Code exchange, streaming results over SSE.
 * Resolves with { sessionId } once the child completes (or errors are emitted).
 */
function runClaudeExchange({ res, claudeBin, repoRoot, message, resumeSessionId, threadId = null, mcpConfigPath = null, extraEnv = {}, cwd = null, captureFiles = null }) {
  return new Promise((resolve) => {
    const args = [
      "-p",
      message, // passed as a distinct argv element — no shell, no injection
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
    args.push("--allowedTools", ALLOWED_TOOLS);
    // Изоляция от внешних плагинов/хуков (claude-mem и др.): только Nabu (см. telegram-bot).
    args.push(...ISOLATION_ARGS);

    let child;
    try {
      child = spawn(claudeBin, args, {
        cwd: cwd || repoRoot, // адъютант работает в рабочей папке пользователя
        env: { ...process.env, ...extraEnv }, // профиль треда → NABU_NAMESPACE/USER_ID (MCP наследуют)
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      sseSend(res, { type: "error", message: `failed to launch claude: ${err.message}` });
      if (!res.writableEnded) res.end();
      resolve({ sessionId: null, costUsd: null, errored: true, sawResult: false });
      return;
    }

    let sessionId = resumeSessionId || null;
    let sawResult = false;
    let settled = false;
    let stdoutBuf = "";
    let stderrTail = "";
    let costUsd = null;
    let errored = false;
    let fullText = ""; // полный текст ответа — для серверной истории (P1-5)
    let sawDelta = false; // пришли token-дельты → полные assistant-блоки не аппендим (дубль)

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
      } catch {}
      // При ошибке и включённом offline-fallback поток НЕ закрываем: handleChat допишет
      // локальный ответ и done. Иначе — прежнее поведение.
      const holdOpen = errored && !fullText && process.env.NABU_OFFLINE_FALLBACK === "1";
      if (!holdOpen && !res.writableEnded) res.end();
      resolve({ sessionId, costUsd, errored, sawResult, fullText, ...extra });
    };

    const timer = setTimeout(() => {
      errored = true;
      sseSend(res, { type: "error", message: "claude timed out after 10 minutes" });
      try {
        child.kill("SIGKILL");
      } catch {}
      finish();
    }, CHILD_TIMEOUT_MS);

    const handleEvent = (event) => {
      if (!event || typeof event !== "object") return;

      // Capture the session id from the init/system event (and anywhere it appears).
      if (typeof event.session_id === "string" && event.session_id) {
        sessionId = event.session_id;
      }

      const type = event.type;

      if (type === "assistant") {
        // Взаимоисключение с дельтами: при включённых partial-messages полные assistant-блоки
        // ДУБЛИРУЮТ уже пришедшие дельты — не аппендим их второй раз (аудит r2 §2.11).
        if (!sawDelta) {
          for (const text of extractAssistantText(event)) {
            if (text) { fullText += text; sseSend(res, { type: "text", text }); }
          }
        }
        for (const name of extractToolNames(event)) {
          sseSend(res, { type: "tool", name });
        }
        return;
      }

      // Streaming partials (when Claude emits token-level deltas).
      if (type === "stream_event" || type === "content_block_delta" || type === "text") {
        const t = extractDeltaText(event);
        if (t) { sawDelta = true; fullText += t; sseSend(res, { type: "text", text: t }); }
        return;
      }

      if (type === "result") {
        sawResult = true;
        costUsd = event.total_cost_usd ?? null;
        // Файлы, созданные адъютантом за обмен — ДО done (иначе поток уже закрыт).
        if (captureFiles) {
          try { const files = captureFiles(); if (files && files.length) sseSend(res, { type: "files", files }); } catch { /* */ }
        }
        sseSend(res, {
          type: "done",
          threadId,
          costUsd,
        });
        finish({ sawResult: true });
        return;
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk;
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // skip unparseable lines
        }
        try {
          handleEvent(event);
        } catch {
          // never let a malformed event kill the stream
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-500);
    });

    child.on("error", (err) => {
      errored = true;
      if (!(process.env.NABU_OFFLINE_FALLBACK === "1" && !fullText)) {
        sseSend(res, { type: "error", message: `claude process error: ${err.message}` });
      }
      finish();
    });

    child.on("close", (code) => {
      // Flush any trailing buffered line.
      const line = stdoutBuf.trim();
      if (line) {
        try {
          handleEvent(JSON.parse(line));
        } catch {}
      }
      if (settled) return;
      if (!sawResult) {
        errored = true;
        const detail = stderrTail ? ` — ${stderrTail}` : "";
        // При активном offline-фолбэке error-событие не шлём: следом придёт честный
        // офлайн-ответ (или handleChat закроет поток с ошибкой сам).
        if (!(process.env.NABU_OFFLINE_FALLBACK === "1" && !fullText)) {
          sseSend(res, {
            type: "error",
            message: `claude exited (code ${code}) without a result${detail}`,
          });
        }
      }
      finish();
    });

    // Kill the child if the client disconnects.
    res.on("close", () => {
      if (!settled) {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Request routing
// ---------------------------------------------------------------------------

// Лимит одновременных Claude-детей (аудит R6, M14): без него любой localhost-клиент мог запустить
// неограниченно процессов (каждый до 10 мин) → истощение ресурсов + неограниченные траты Claude.
// По умолчанию 4, переопределяется NABU_MAX_CONCURRENT_CHATS.
const MAX_CONCURRENT_CHATS = Math.max(1, Number(process.env.NABU_MAX_CONCURRENT_CHATS) || 4);
let activeChatChildren = 0;

async function handleChat(req, res, opts) {
  const { nabuHome, repoRoot, claudeBin } = opts;
  let body;
  try {
    const raw = await readRequestBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    sendJson(res, 400, { error: "bad_request", message: err.message });
    return;
  }

  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) {
    sendJson(res, 400, { error: "empty_message" });
    return;
  }

  // Гейт нагрузки: не запускаем больше MAX_CONCURRENT_CHATS Claude-сессий одновременно.
  // Проверка+инкремент атомарны (JS однопоточен); декремент — по закрытию ответа (покрывает ВСЕ
  // пути выхода, включая ранние return и разрыв клиента).
  if (activeChatChildren >= MAX_CONCURRENT_CHATS) {
    res.writeHead(429, { "content-type": "application/json", "retry-after": "10" });
    res.end(JSON.stringify({ error: "busy", message: `Сейчас выполняется ${activeChatChildren} сессий (лимит ${MAX_CONCURRENT_CHATS}). Повторите через несколько секунд.` }));
    return;
  }
  activeChatChildren++;
  let chatReleased = false;
  const releaseChat = () => { if (!chatReleased) { chatReleased = true; activeChatChildren--; } };
  res.once("close", releaseChat);

  // Resolve or create the thread.
  let thread;
  const threads = await readThreads(nabuHome);
  if (body.threadId) {
    thread = threads.find((t) => t.id === body.threadId) || null;
    // Общий роль-разговор (conv-adjutant/…): если ещё не создан — создаём с каноническим id
    // (та же сессия/история, что в Telegram), не генерируя случайный UUID.
    if (!thread && isSharedConv(body.threadId)) {
      const _role = roleOfConv(body.threadId);
      thread = { id: body.threadId, title: convTitle(_role), claudeSessionId: null, role: _role, shared: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await upsertThread(nabuHome, thread);
    }
  }
  const now = new Date().toISOString();
  if (!thread) {
    // Профиль фиксируется на треде при создании (мульти-профиль v2): вся жизнь треда —
    // в одном пространстве памяти. Неизвестный профиль игнорируем (дефолтное пространство).
    const reqProfile = typeof body.profile === "string" && body.profile ? body.profile : "";
    const reqProf = reqProfile ? profilesConfig(repoRoot)[reqProfile] : null;
    // Пинуем только ПОЛНЫЙ профиль (fail-closed r3-C3): половинчатый = утечка в основное пространство.
    const profile = reqProf && reqProf.namespace && reqProf.user_id ? reqProfile : "";
    thread = {
      id: randomUUID(),
      title: message.slice(0, 60),
      claudeSessionId: null,
      profile,
      createdAt: now,
      updatedAt: now,
    };
    await upsertThread(nabuHome, thread);
  }

  openSse(res);
  // Tell the client which thread this stream belongs to (esp. for new threads).
  sseSend(res, { type: "thread", threadId: thread.id, title: thread.title });

  const t0 = Date.now();
  // Профиль треда — ДО первого использования (TDZ-регрессия r3-C2 чинена).
  // Снапшот файлов workspace ДО обмена — поймать созданные адъютантом файлы (отчёты).
  const wsSnap = () => { try { return new Set(readdirSync(repoRoot).filter((f) => !f.startsWith("."))); } catch { return new Set(); } };
  const filesBefore = wsSnap();
  const threadProfile = thread.profile || "";
  const profEnv = threadProfile
    ? (() => {
        const p = profilesConfig(repoRoot)[threadProfile];
        return p && p.namespace && p.user_id ? { NABU_NAMESPACE: p.namespace, NABU_USER_ID: p.user_id } : {};
      })()
    : {};
  persistMessage(repoRoot, thread.id, "user", message, null, threadProfile); // fire-and-forget
  const captureFiles = () => {
    const after = new Set(readdirSync(repoRoot).filter((f) => !f.startsWith(".")));
    const isDoc = (f) => /\.(md|txt|csv|json|pdf|html|log|tsv|yaml|yml)$/i.test(f);
    const fresh = [...after].filter((f) => !filesBefore.has(f) && isDoc(f));
    const delivered = [];
    for (const f of fresh.slice(0, 5)) {
      try { renameSync(join(repoRoot, f), join(opts.nabuHome, f)); } catch { /* оставить где есть */ }
      delivered.push(f);
    }
    return delivered;
  };
  const { sessionId, costUsd, errored, fullText } = await runClaudeExchange({
    res,
    claudeBin,
    repoRoot,
    message,
    resumeSessionId: thread.claudeSessionId,
    threadId: thread.id,
    mcpConfigPath: opts.mcpConfigPath,
    extraEnv: profEnv,
    captureFiles,
  });
  let answeredOffline = false;
  if (errored && !fullText && process.env.NABU_OFFLINE_FALLBACK === "1") {
    // Offline-degraded: Claude недоступен → локальная модель отвечает по памяти,
    // ЧЕСТНО помечая деградацию. Ассистент не «умирает» без сети/квоты.
    try {
      // T1 «локальный мозг»: агентный цикл с MCP-tools; при провале — старый recall-путь.
      let off = null;
      try {
        const { localBrainAnswer } = await import("./local-brain.mjs");
        const r = await localBrainAnswer({ message, mcpConfigPath: opts.mcpConfigPath, log: (e) => opts.log?.(e), env: profEnv });
        off = `⚠️ **Локальный мозг** (Claude недоступен; локальная модель с инструментами — экспериментально)\n\n${r.answer}`;
      } catch (e) {
        opts.log?.({ evt: "local_brain_fallback", error: String(e.message).slice(0, 150) });
        off = await offlineAnswer(repoRoot, message, threadProfile);
      }
      if (off) {
        sseSend(res, { type: "text", text: off });
        sseSend(res, { type: "done", threadId: thread.id, costUsd: 0, offline: true });
        persistMessage(repoRoot, thread.id, "assistant", off, 0, threadProfile);
        answeredOffline = true;
      }
    } catch (e) { opts.log?.({ evt: "offline_fallback_error", error: String(e.message).slice(0, 200) }); }
    if (!answeredOffline) {
      // r5-#4: и локальный мозг, и recall не смогли (напр. Ollama выключен) — НЕ молчим:
      // отдаём честное сообщение + done, иначе клиент висит спиннером без событий.
      const msg = "⚠️ Офлайн-режим недоступен: локальные модели не отвечают (Ollama не запущен?). Повторите позже или с полным Nabu.";
      sseSend(res, { type: "text", text: msg });
      sseSend(res, { type: "done", threadId: thread.id, costUsd: 0, offline: true });
    }
    if (!res.writableEnded) res.end(); // поток держали открытым для фолбэка — закрываем в любом случае
  }
  if (fullText) persistMessage(repoRoot, thread.id, "assistant", fullText, costUsd ?? null, threadProfile);
  // Беседа → эпизодическая память Nabu (первоклассная память). Приватно, локальный эмбеддинг.
  if (fullText && message.trim().length >= 12) {
    (async () => {
      try {
        const deps = await getLibDeps(repoRoot, threadProfile);
        await deps.memory.rememberEpisode({
          event: `Беседа (веб): пользователь — «${message.slice(0, 1500)}». Ответ: ${fullText.slice(0, 1500)}`,
          actors: ["пользователь", "адъютант"],
          context: { source: "web", threadId: thread.id },
          visibility: "private",
        });
      } catch (e) { opts.log?.({ evt: "web_episode_error", error: String(e.message).slice(0, 120) }); }
    })();
  }


  // JSONL-лог обмена (для диагностики; текст сообщения НЕ пишем — приватность).
  opts.log?.({
    evt: "chat",
    threadId: thread.id,
    resumed: !!thread.claudeSessionId,
    promptChars: message.length,
    ms: Date.now() - t0,
    costUsd: costUsd ?? null,
    ok: !errored,
    offline: answeredOffline || undefined,
  });

  // Persist updated session id / timestamp.
  try {
    await upsertThread(nabuHome, {
      id: thread.id,
      title: thread.title,
      claudeSessionId: sessionId || thread.claudeSessionId || null,
      createdAt: thread.createdAt,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // best-effort persistence; the stream already ended
  }
}

function createRequestHandler(opts) {
  const { repoRoot } = opts;
  const uiFile = join(repoRoot, "cli", "ui", "chat.html");

  return async function handler(req, res) {
    // Защита от DNS-rebinding: сервер слушает 127.0.0.1, но злонамеренный сайт может
    // резолвить свой домен в 127.0.0.1 — тогда Host будет не localhost. Отклоняем.
    const hostHdr = String(req.headers.host || "").toLowerCase();
    // Default-deny: отсутствующий Host тоже отклоняем (HTTP/1.1 обязывает его слать).
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHdr)) {
      sendJson(res, 403, { error: "forbidden_host" });
      return;
    }
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      notFound(res);
      return;
    }
    const path = url.pathname;
    const method = req.method || "GET";

    // CSRF-гейт (аудит R6, M5): мутирующие запросы (POST/PUT/PATCH/DELETE) от браузера обязаны
    // быть same-origin. Вредоносный сайт, делающий fetch на 127.0.0.1:4517, шлёт Origin своего
    // домена / Sec-Fetch-Site: cross-site → отклоняем (иначе любая открытая вкладка могла бы
    // резолвить approval'ы). Не-браузерные localhost-клиенты (нет Origin/Sec-Fetch) — пропускаем
    // (это заявленная localhost-модель доверия). Вебхуки `/api/hooks/*` исключены — у них HMAC.
    if (method !== "GET" && method !== "HEAD" && !path.startsWith("/api/hooks/")) {
      const sfs = String(req.headers["sec-fetch-site"] || "");
      const origin = String(req.headers["origin"] || "");
      let crossOrigin = false;
      if (sfs && sfs !== "same-origin" && sfs !== "same-site" && sfs !== "none") crossOrigin = true;
      if (origin) {
        try { if (new URL(origin).host.toLowerCase() !== hostHdr) crossOrigin = true; }
        catch { crossOrigin = true; }
      }
      if (crossOrigin) { sendJson(res, 403, { error: "cross_origin_forbidden" }); return; }
    }

    try {
      // GET / → serve the UI
      if (method === "GET" && (path === "/" || path === "/index.html")) {
        let html;
        try {
          html = await readFile(uiFile, "utf8");
        } catch {
          sendText(res, 500, "chat.html not found", "text/plain; charset=utf-8");
          return;
        }
        sendText(res, 200, html, "text/html; charset=utf-8");
        return;
      }

      // ── Входящие вебхуки автоматизаций (n8n/IFTTT/Zapier → Nabu): POST /api/hooks/<name> ──
      // Имя и токен декларируются в config/integrations.json (webhooks.in), токен — в env.
      // action: "note" → заметка (private), "prospective" → намерение. Тело ≤1МБ (общий лимит).
      if (method === "POST" && /^\/api\/hooks\/[a-zA-Z0-9_-]+$/.test(path)) {
        const name = path.split("/")[3];
        let hookCfg = null;
        try {
          const integ = JSON.parse(readFileSync(liveConfigPath(opts.repoRoot, "integrations.json"), "utf8"));
          hookCfg = integ?.webhooks?.in?.[name] ?? null;
        } catch { /* нет конфига */ }
        if (!hookCfg) { sendJson(res, 404, { error: "unknown_hook" }); return; }
        const expected = hookCfg.token_env ? process.env[hookCfg.token_env] : null;
        const got = url.searchParams.get("token") || req.headers["x-nabu-token"];
        const tokOk = expected && typeof got === "string" && got.length === expected.length &&
          (() => { try { return tse(Buffer.from(got), Buffer.from(expected)); } catch { return false; } })();
        if (!tokOk) {
          opts.log?.({ evt: "hook_denied", name });
          sendJson(res, 403, { error: "forbidden" });
          return;
        }
        const rawBody = (await readRequestBody(req)) || "";
        // Опциональный HMAC (secret_env в конфиге): токен доказывает «знает хук», подпись —
        // «payload не подменён». Формат standard-webhooks-совместимый: подписывается
        // `${timestamp}.${body}`; заголовки X-Nabu-Timestamp + X-Nabu-Signature (hex sha256).
        if (hookCfg.secret_env) {
          const secret = process.env[hookCfg.secret_env];
          const ts = String(req.headers["x-nabu-timestamp"] || "");
          const sig = String(req.headers["x-nabu-signature"] || "");
          const skewOk = ts && Math.abs(Date.now() - Number(ts)) < 5 * 60 * 1000; // replay-окно 5 мин
          let sigOk = false;
          if (secret && skewOk && sig) {
            const { createHmac, timingSafeEqual } = await import("node:crypto");
            const want = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
            try { sigOk = sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want)); } catch { /* длины/кодировка */ }
          }
          if (!sigOk) {
            opts.log?.({ evt: "hook_denied", name, reason: !secret ? "no_secret_env" : !skewOk ? "timestamp" : "signature" });
            sendJson(res, 403, { error: "bad_signature" });
            return;
          }
        }
        // Идемпотентность: повтор с тем же ключом (ретраи n8n/Zapier) не создаёт дубль.
        const idemKey = String(req.headers["x-nabu-idempotency-key"] || "");
        let markIdem = null; // r3-M12: помечаем ключ только ПОСЛЕ успешной записи —
        // иначе транзиентный сбой + ретрай = ложный duplicate и потерянный захват.
        if (idemKey) {
          const seen = hookIdempotency.get(name) ?? new Map();
          hookIdempotency.set(name, seen);
          const now = Date.now();
          for (const [k, t] of seen) if (now - t > 60 * 60 * 1000) seen.delete(k); // TTL 1ч
          if (seen.has(idemKey)) { sendJson(res, 200, { ok: true, duplicate: true }); return; }
          markIdem = () => { if (seen.size < 10_000) seen.set(idemKey, Date.now()); };
        }
        let body = {};
        try { body = JSON.parse(rawBody || "{}"); } catch { /* текст тоже примем ниже */ }
        const text = typeof body === "object" && body
          ? String(body.text ?? body.content ?? body.message ?? JSON.stringify(body)).slice(0, 20_000)
          : String(body).slice(0, 20_000);
        if (!text.trim()) { sendJson(res, 400, { error: "empty" }); return; }
        try {
          const deps = await getLibDeps(opts.repoRoot);
          if (hookCfg.action === "prospective") {
            const r = await deps.memory.addProspective({ intent: text.slice(0, 2000) });
            opts.log?.({ evt: "hook", name, action: "prospective", ok: true });
            markIdem?.();
            sendJson(res, 200, { ok: true, id: r.id, action: "prospective" });
          } else {
            const r = await deps.notes.add({ title: (typeof body === "object" && body?.title ? String(body.title) : text).slice(0, 80), content: text, visibility: "private" });
            opts.log?.({ evt: "hook", name, action: "note", ok: true });
            markIdem?.();
            sendJson(res, 200, { ok: true, id: r.id, action: "note" });
          }
        } catch (e) {
          opts.log?.({ evt: "hook", name, ok: false, error: String(e.message).slice(0, 200) });
          sendJson(res, 500, { error: String(e.message).slice(0, 200) });
        }
        return;
      }

      // PWA-lite: манифест + иконка (тёмные; «на домашний экран» с телефона)
      if (method === "GET" && path === "/manifest.webmanifest") {
        sendText(res, 200, JSON.stringify({
          name: "Nabu — Совет", short_name: "Nabu", lang: "ru",
          start_url: "/", display: "standalone",
          background_color: "#0e1116", theme_color: "#0e1116",
          icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
        }), "application/manifest+json; charset=utf-8");
        return;
      }
      if (method === "GET" && path === "/icon.svg") {
        sendText(res, 200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#7b5cff"/></linearGradient></defs>
<rect width="128" height="128" rx="28" fill="#0e1116"/>
<rect x="10" y="10" width="108" height="108" rx="22" fill="url(#g)"/>
<text x="64" y="86" font-family="system-ui,-apple-system,sans-serif" font-size="64" font-weight="800" fill="#fff" text-anchor="middle">N</text>
</svg>`, "image/svg+xml; charset=utf-8");
        return;
      }

      // GET /api/threads
      if (method === "GET" && path === "/api/threads") {
        const threads = await readThreads(opts.nabuHome);
        // Синхронизация: общие роль-разговоры (адъютант+министры) всегда в списке — те же,
        // что в Telegram. Если разговора ещё нет в файле — показываем виртуально (создастся при 1-м сообщении).
        const byId = new Map(threads.map((t) => [t.id, t]));
        for (const c of allSharedConvs()) {
          if (!byId.has(c.id)) threads.push({ id: c.id, title: c.title, claudeSessionId: null, role: c.role, shared: true, createdAt: "2000-01-01", updatedAt: "2000-01-01" });
          else byId.get(c.id).shared = true;
        }
        // Общие разговоры — сверху (закреплены), затем свободные веб-треды по свежести.
        threads.sort((a, b) => (Number(!!b.shared) - Number(!!a.shared)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
        sendJson(res, 200, threads);
        return;
      }

      // GET /api/threads/:id/messages — серверная история треда
      if (method === "GET" && /^\/api\/threads\/[^/]+\/messages$/.test(path)) {
        const id = decodeURIComponent(path.split("/")[3]);
        try {
          const th = (await readThreads(opts.nabuHome)).find((t) => t.id === id);
          sendJson(res, 200, { messages: await loadMessages(opts.repoRoot, id, 200, th?.profile || "") });
        } catch (e) {
          // БД недоступна → пустая история (UI использует localStorage-fallback)
          sendJson(res, 200, { messages: [], degraded: true, error: String(e.message).slice(0, 200) });
        }
        return;
      }

      // DELETE /api/threads/:id
      if (method === "DELETE" && path.startsWith("/api/threads/")) {
        const id = decodeURIComponent(path.slice("/api/threads/".length));
        if (!id) {
          sendJson(res, 400, { error: "missing_id" });
          return;
        }
        // Профиль треда читаем ДО удаления из файла — иначе каскад бил бы в чужой namespace (r3-M10).
        const delTh = (await readThreads(opts.nabuHome)).find((t) => t.id === id);
        const removed = await deleteThread(opts.nabuHome, id);
        await deleteMessages(opts.repoRoot, id, delTh?.profile || ""); // каскад в БД (внутри best-effort try/catch)
        sendJson(res, removed ? 200 : 404, { ok: removed });
        return;
      }

      // POST /api/chat
      if (method === "POST" && path === "/api/chat") {
        await handleChat(req, res, opts);
        return;
      }

      // GET /api/stats/details?section=… — drill-down карточек дашборда (P1-9).
      // Оркестрирует существующие lib-методы + узкие read-only pg/graph запросы.
      // ИНВАРИАНТ приватности #2: vault НИКОГДА не попадает в выдачу (visibility <> 'vault').
      // Ответ: { section, title(RU-fallback), note?, groups?:[{key,label,items}], items? }.
      // groups даёт читаемые подсекции; UI локализует title/label по section+key (i18n).
      if (method === "GET" && path === "/api/stats/details") {
        const section = url.searchParams.get("section") || "";
        // safe(): секции деградируют по-отдельности (сбой одной не роняет весь drill-down).
        const safe = (p, fb) => Promise.resolve(p).then((x) => x).catch(() => fb);
        try {
          const deps = await getLibDeps(repoRoot);
          if (section === "memory") {
            const ns = await chatNs(deps);
            const [facts, factCount, episodesRaw] = await Promise.all([
              safe(deps.pg.query(
                `select subject, predicate, object, confidence, created_at from semantic_facts
                 where namespace=$1 and visibility <> 'vault' order by created_at desc limit 10`, [ns]), []),
              safe(deps.pg.queryOne(
                `select count(*) as n from semantic_facts where namespace=$1 and visibility <> 'vault'`, [ns]), null),
              safe(deps.memory.listRecentEpisodes(20), []),
            ]);
            const episodes = episodesRaw.filter((e) => e.visibility !== "vault").slice(0, 12);
            const groups = [
              { key: "facts", label: "Факты", items: facts.map((f) => ({
                main: `${f.subject} · ${f.predicate} · ${f.object}`,
                sub: `${Math.round(Number(f.confidence) * 100)}% · ${String(f.created_at).slice(0, 10)}`,
              })) },
              { key: "episodes", label: "Недавние эпизоды", items: episodes.map((e) => ({
                main: e.event,
                sub: `${String(e.occurredAt).slice(0, 16).replace("T", " ")}${e.emotion ? " · " + e.emotion : ""}`,
              })) },
            ];
            const note = factCount ? `Фактов всего (без vault): ${Number(factCount.n)}` : undefined;
            sendJson(res, 200, { section, title: "Память", note, groups });
          } else if (section === "graph") {
            const groups = [];
            let note;
            const available = await safe(deps.graph.available(), false);
            if (!available) {
              note = "TypeDB недоступен — граф знаний офлайн.";
            } else {
              const concepts = await safe(readConceptNames(deps.graphClient, 24), []);
              groups.push({ key: "concepts", label: "Концепты", items: concepts.map((n) => ({ main: n, sub: "" })) });
              if (concepts.length) {
                const first = concepts[0];
                const nb = await safe(deps.graph.neighbors(first, 12), []);
                groups.push({ key: "neighbors", label: `Связи: ${first}`, items: nb.map((n) => ({ main: n, sub: "" })) });
              } else {
                note = "В графе пока нет концептов.";
              }
            }
            sendJson(res, 200, { section, title: "Граф знаний", note, groups });
          } else if (section === "domains") {
            const [tasks, goalsAll, habits] = await Promise.all([
              safe(deps.domain.listTasks({ open: true }), []),
              safe(deps.domain.listGoals(), []),
              safe(deps.domain.listHabits(true), []),
            ]);
            const goals = goalsAll.filter((g) => !["done", "achieved", "dropped"].includes(g.status)).slice(0, 12);
            const groups = [
              { key: "tasks", label: "Открытые задачи", items: tasks.slice(0, 15).map((t) => ({
                main: t.title, sub: `${t.status}${t.due_date ? " · до " + String(t.due_date).slice(0, 10) : ""}` })) },
              { key: "goals", label: "Активные цели", items: goals.map((g) => ({
                main: g.text, sub: `${g.horizon ?? "—"} · ${g.status}` })) },
              { key: "habits", label: "Привычки", items: habits.slice(0, 12).map((h) => ({
                main: h.name, sub: h.target_frequency ? String(h.target_frequency) : (h.anchor ? String(h.anchor) : "") })) },
            ];
            sendJson(res, 200, { section, title: "Сферы жизни", groups });
          } else if (section === "council") {
            const ns = await chatNs(deps);
            const [delibs, followups] = await Promise.all([
              safe(deps.pg.query(
                `select question, status, created_at from deliberation
                 where namespace=$1 order by created_at desc limit 12`, [ns]), []),
              safe(deps.recommendation.listPendingFollowup(8), []),
            ]);
            const groups = [
              { key: "deliberations", label: "Недавние совещания", items: delibs.map((d) => ({
                main: d.question, sub: `${d.status} · ${String(d.created_at).slice(0, 10)}` })) },
              { key: "followups", label: "Ждут исхода", items: followups.map((r) => ({
                main: r.recommendation.slice(0, 160), sub: `${r.domain ?? "—"} · ${String(r.createdAt).slice(0, 10)}` })) },
            ];
            sendJson(res, 200, { section, title: "Совет", groups });
          } else if (section === "system") {
            const items = (await deps.improvement.listProposals({ status: "proposed", limit: 12 })).map((p) => ({
              main: p.title, sub: `${p.category} · impact ${p.impact}`,
            }));
            sendJson(res, 200, { section, title: "Открытые предложения улучшений", items });
          } else if (section === "trends") {
            const series = (await deps.analytics.listSeries()).slice(0, 4);
            let items = [];
            for (const s of series) {
              const f = await deps.analytics.forecast(s.id, 7);
              items.push({
                main: `${s.name}${s.unit ? " (" + s.unit + ")" : ""}`,
                sub: f.n < 4 ? "мало данных для прогноза" : `n=${f.n} · прогноз: ${f.points.map((p) => p.value).join(" → ")} · conf ${f.confidence}`,
              });
            }
            if (!series.length) items = [{ main: "Метрик пока нет", sub: "логируйте через nabu-domain.log_metric" }];
            sendJson(res, 200, { section, title: "Тренды метрик (прогноз 7 шагов)", items });
          } else {
            sendJson(res, 400, { error: "unknown_section" });
          }
        } catch (e) {
          sendJson(res, 200, { section, title: section, items: [], note: `недоступно: ${String(e.message).slice(0, 160)}` });
        }
        return;
      }

      // GET /api/about — «Обо мне»: тёплый дайджест того, что Nabu знает о пользователе.
      // Только собственные данные пользователя в его локальном UI → private показывать можно.
      // ИНВАРИАНТ #2: vault НИКОГДА не показывается (visibility <> 'vault' / фильтр по эпизодам).
      // GET /api/file?name=<f> — скачать файл верхнего уровня workspace (безопасно: без ../, без точечных).
      if (method === "GET" && path === "/api/file") {
        const name = url.searchParams.get("name") || "";
        if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || name.startsWith(".")) { sendJson(res, 400, { error: "bad_name" }); return; }
        const fp = join(opts.nabuHome, name);
        try {
          const buf = readFileSync(fp);
          res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${encodeURIComponent(name)}"` });
          res.end(buf);
        } catch { sendJson(res, 404, { error: "not_found" }); }
        return;
      }

      if (method === "GET" && path === "/api/about") {
        const safe = (p, fb) => Promise.resolve(p).then((x) => x).catch(() => fb);
        try {
          const deps = await getLibDeps(repoRoot);
          const ns = await chatNs(deps);
          const [factRows, episodesRaw, goalsAll, habits, character, factCount, epCount] = await Promise.all([
            safe(deps.pg.query(
              `select subject, predicate, object, confidence from semantic_facts
               where namespace=$1 and visibility <> 'vault'
               order by confidence desc, created_at desc limit 14`, [ns]), []),
            safe(deps.memory.listRecentEpisodes(12), []),
            safe(deps.domain.listGoals(), []),
            safe(deps.domain.listHabits(true), []),
            safe(deps.domain.getCharacter(), null),
            safe(deps.pg.queryOne(`select count(*) as n from semantic_facts where namespace=$1 and visibility <> 'vault'`, [ns]), null),
            safe(deps.pg.queryOne(`select count(*) as n from episodic_memory where namespace=$1 and visibility <> 'vault'`, [ns]), null),
          ]);
          const facts = factRows.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, confidence: Number(f.confidence) }));
          const goals = goalsAll.filter((g) => !["done", "achieved", "dropped"].includes(g.status))
            .slice(0, 12).map((g) => ({ text: g.text, horizon: g.horizon ?? null, status: g.status }));
          const recentEpisodes = episodesRaw.filter((e) => e.visibility !== "vault").slice(0, 5)
            .map((e) => ({ event: e.event, occurredAt: e.occurredAt, emotion: e.emotion ?? null }));
          const habitsOut = habits.slice(0, 12).map((h) => ({ name: h.name, targetFrequency: h.target_frequency ?? null, anchor: h.anchor ?? null }));
          // Персонаж: level в character_sheet НЕ хранится — не выдумываем (инвариант #4),
          // показываем суммарный XP и сильнейшую грань (по *_xp столбцам).
          let characterOut = null;
          if (character) {
            const attrs = ["intellect", "wisdom", "creativity", "discipline", "vitality", "resilience", "sociality", "wealth"];
            let xpTotal = 0, topAttr = null, topVal = -1;
            for (const a of attrs) {
              const v = Number(character[`${a}_xp`] ?? 0);
              xpTotal += v;
              if (v > topVal) { topVal = v; topAttr = a; }
            }
            characterOut = { xpTotal, topAttr, topXp: topVal < 0 ? 0 : topVal };
          }
          sendJson(res, 200, {
            facts, goals, habits: habitsOut, recentEpisodes, character: characterOut,
            counts: {
              factsTotal: factCount ? Number(factCount.n) : facts.length,
              episodesTotal: epCount ? Number(epCount.n) : recentEpisodes.length,
              goalsActive: goals.length,
              habitsActive: habitsOut.length,
            },
          });
        } catch (e) {
          sendJson(res, 200, { degraded: true, note: String(e.message).slice(0, 160), facts: [], goals: [], habits: [], recentEpisodes: [], character: null, counts: {} });
        }
        return;
      }

      // ── Approvals (P2): ВНЕКОНТЕКСТНОЕ подтверждение высокорисковых действий ──
      // Кнопка в UI → этот эндпоинт → governance.resolveApproval. Решение принимает
      // ЧЕЛОВЕК в браузере (не модель) — закрывает self-approval гэп аудита.
      if (method === "GET" && path === "/api/approvals") {
        try {
          const deps = await getLibDeps(repoRoot);
          sendJson(res, 200, { approvals: await deps.governance.listPendingApprovals() });
        } catch (e) {
          sendJson(res, 200, { approvals: [], note: String(e.message).slice(0, 160) });
        }
        return;
      }
      if (method === "POST" && /^\/api\/approvals\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split("/")[3]);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          sendJson(res, 404, { error: "not_found" }); // не-UUID раньше падал pg-кастом в 500
          return;
        }
        let body;
        try { body = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "bad_json" }); return; }
        const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : null;
        if (!decision) { sendJson(res, 400, { error: "decision must be approved|rejected" }); return; }
        try {
          const deps = await getLibDeps(repoRoot);
          const done = await deps.governance.resolveApproval(id, decision, "user:web");
          opts.log?.({ evt: "approval", id, decision, ok: done });
          sendJson(res, done ? 200 : 404, { ok: done });
        } catch (e) {
          sendJson(res, 500, { error: String(e.message).slice(0, 200) });
        }
        return;
      }

      // GET /api/stats — дашборд (кэш 5с; при недоступности lib/БД — degraded, не 500)
      if (method === "GET" && path === "/api/profiles") {
        const all = profilesConfig(repoRoot);
        const valid = Object.entries(all).filter(([, p]) => p?.namespace && p?.user_id).map(([n]) => n);
        const broken = Object.keys(all).length - valid.length;
        sendJson(res, 200, { profiles: valid, ...(broken ? { invalid: broken } : {}) });
        return;
      }

      if (method === "GET" && path === "/api/stats") {
        try {
          const now = Date.now();
          const statsProfile = url.searchParams.get("profile") || "";
          if (statsProfile) {
            // Per-profile статистика — мимо общего кэша (запрос редкий, изоляция важнее).
            const deps = await getLibDeps(repoRoot, statsProfile);
            sendJson(res, 200, await deps.dashboard.overview());
            return;
          }
          if (!statsCache.data || now - statsCache.at > STATS_TTL_MS || url.searchParams.has("fresh")) {
            const deps = await getLibDeps(repoRoot);
            statsCache = { at: now, data: await deps.dashboard.overview() };
          }
          sendJson(res, 200, statsCache.data);
        } catch (err) {
          opts.log?.({ evt: "stats_error", message: String(err.message).slice(0, 300) });
          const degraded = degradedStats(`статистика недоступна: ${err.message}`);
          // Negative-cache — только для дефолтного пути: сбой ?profile= не должен
          // отравлять общий дашборд (r3-M11).
          if (!(url.searchParams.get("profile") || "")) statsCache = { at: Date.now(), data: degraded };
          sendJson(res, 200, degraded);
        }
        return;
      }

      notFound(res);
    } catch (err) {
      opts.log?.({ evt: "http_error", path, message: String(err.message).slice(0, 300) });
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal", message: err.message });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startChatServer({
  port = 4517,
  host = "127.0.0.1",
  repoRoot,
  nabuHome,
  claudeBin = process.platform === "win32" ? "claude.cmd" : "claude",
} = {}) {
  if (!repoRoot) throw new Error("startChatServer: repoRoot is required");
  if (!nabuHome) throw new Error("startChatServer: nabuHome is required");

  const log = makeLogger(nabuHome);
  let mcpConfigPath = null;
  try {
    mcpConfigPath = ensureMcpConfig(nabuHome, repoRoot);
  } catch (e) {
    log({ evt: "mcp_config_error", message: e.message });
  }
  log({ evt: "server_start", port, host, mcpConfigPath });
  const handler = createRequestHandler({ repoRoot, nabuHome, claudeBin, log, mcpConfigPath });
  const server = createServer(handler);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Bind to host only — default 127.0.0.1, never exposed externally.
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://${host}:${boundPort}`;
      resolve({ server, url });
    });
  });
}

// ---------------------------------------------------------------------------
// Standalone entrypoint
// ---------------------------------------------------------------------------

async function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const here = fileURLToPath(import.meta.url);
    const invoked = await realpath(argv1);
    return here === invoked || (await realpath(here)) === invoked;
  } catch {
    return false;
  }
}

if (await isMainModule()) {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = dirname(dirname(here)); // cli/.. → repo root
  const nabuHome = process.env.NABU_HOME || join(process.env.HOME || repoRoot, "nabu");
  const port = process.env.PORT ? Number(process.env.PORT) : 4517;
  const claudeBin = process.env.CLAUDE_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");

  try {
    const { url } = await startChatServer({ port, repoRoot, nabuHome, claudeBin });
    process.stdout.write(`Nabu chat server listening on ${url}\n`);
    process.stdout.write(`  repoRoot: ${repoRoot}\n`);
    process.stdout.write(`  nabuHome: ${nabuHome}\n`);
  } catch (err) {
    process.stderr.write(`Failed to start chat server: ${err.message}\n`);
    process.exit(1);
  }
}

// ── Экспорт для Telegram-бота (тот же процесс демона → общая threadsLock/deps) ──
// Позволяет TG писать в те же chat_threads.json + chat_message + делить claude-сессии с web.
export const _sync = {
  readThreads,
  upsertThread,
  persistMessage,
  loadMessages,
  getLibDeps,
};
