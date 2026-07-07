// api-v1.mjs — Публичный REST API Nabu (v1). Токен-аутентификация (bearer PAT), scoped по тенанту,
// работает и в много-тенанте (token → user), и в локальном режиме (статический NABU_API_TOKEN).
//
// Встраивается в chat-server: /api/v1/* обрабатывается ДО куки-гейта и освобождён от same-origin CSRF
// (аутентификация токеном, не куками — как /api/hooks). Свой bearer-гейт: 401 без валидного токена,
// кроме публичных health и bootstrap-выдачи токена.
//
// Зависимости инжектируются из chat-server (общий процесс демона → общие threads/deps/claude-сессии):
//   sync = { readThreads, upsertThread, persistMessage, loadMessages, getLibDeps, getLibModule, runClaudeExchange }
// плюс конфиг { repoRoot, nabuHome, claudeBin, mcpConfigPath, log }.

import { timingSafeEqual } from "node:crypto";
import { withConversationLock } from "./claude-run.mjs";

const API_VERSION = "v1";

function sendJson(res, code, obj, headers = {}) {
  if (res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(body);
}
// Единый конверт ошибок: { error: { code, message } }.
function apiErr(res, httpCode, code, message) {
  return sendJson(res, httpCode, { error: { code, message } });
}
function ctEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
function bearer(req) {
  const m = String(req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
}

// Простой in-memory rate-limit (скользящее окно), как в web-auth.
const _rl = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const e = _rl.get(key);
  if (!e || e.resetAt < now) { _rl.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  e.count += 1;
  return e.count > max;
}

// res-заглушка: поглощает SSE-запись runClaudeExchange для sync-режима (нужен только fullText).
function captureSink() {
  return { writableEnded: false, write() { return true; }, writeHead() {}, setHeader() {}, flushHeaders() {}, end() { this.writableEnded = true; } };
}

export function createApiV1({ repoRoot, nabuHome, claudeBin, mcpConfigPath, log, sync }) {
  const multit = () => process.env.NABU_MULTITENANT === "1";

  async function libMod() { return sync.getLibModule(repoRoot); }
  async function depsFor(profile) { return sync.getLibDeps(repoRoot, profile || ""); }

  /**
   * Резолвинг тенанта из bearer-токена.
   * - много-тенант: verifyToken(pg, token) → { userId, profile:userId }.
   * - локальный: сверка со статическим NABU_API_TOKEN (constant-time) → дефолтный скоуп (env NABU_USER_ID).
   * Возврат: { userId, profile } | { disabled:true } | null (401).
   */
  async function resolveTenant(req) {
    const token = bearer(req);
    if (multit()) {
      if (!token) return null;
      const [L, deps] = [await libMod(), await depsFor("")];
      const v = await L.verifyToken(deps.pg, token);
      return v ? { userId: v.userId, profile: v.userId } : null;
    }
    const expected = process.env.NABU_API_TOKEN || "";
    if (!expected) return { disabled: true }; // API в локальном режиме не сконфигурирован
    if (!token || !ctEq(token, expected)) return null;
    return { userId: process.env.NABU_USER_ID || null, profile: "" };
  }

  // Идентификатор разговора адъютанта для тенанта (делится с web/TG). Клиент может передать свой суффикс.
  function convIdFor(t, suffix) {
    const base = t.userId ? `conv-adjutant-${t.userId}` : "conv-adjutant";
    return suffix ? `${base}-${String(suffix).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)}` : base;
  }

  // ── Основной обработчик. Возвращает true, если запрос обработан. ──
  async function handle(req, res, path, method, readBody) {
    if (!path.startsWith("/api/v1/") && path !== "/api/v1") return false;
    const sub = path.replace(/^\/api\/v1\/?/, ""); // без префикса

    // Публичные (без токена).
    if (method === "GET" && (sub === "health" || sub === "")) {
      let version = "?";
      try { version = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url))).version; } catch { /* */ }
      return sendJson(res, 200, { ok: true, api: API_VERSION, version, multitenant: multit() }), true;
    }

    // Bootstrap-выдача токена: email+пароль → { token } (только много-тенант; локально токен статический).
    if (method === "POST" && sub === "auth/token") {
      if (!multit()) return apiErr(res, 400, "not_multitenant", "В локальном режиме используйте статический NABU_API_TOKEN."), true;
      let b; try { b = JSON.parse((await readBody()) || "{}"); } catch { return apiErr(res, 400, "bad_json", "невалидный JSON"), true; }
      const { email, password, name } = b;
      if (rateLimited(`apitok:${String(email || "").toLowerCase()}:${clientIp(req)}`, 8, 60_000)) return apiErr(res, 429, "rate_limited", "слишком много попыток"), true;
      if (!email || !password) return apiErr(res, 400, "bad_request", "нужны email и password"), true;
      const [L, deps] = [await libMod(), await depsFor("")];
      const t = await L.loginWebUser(deps.pg, email, password);
      if (!t) return apiErr(res, 401, "invalid_credentials", "неверный email или пароль"), true;
      const issued = await L.issueToken(deps.pg, t.userId, name || "api");
      return sendJson(res, 200, { token: issued.token, id: issued.id, note: "Сохраните токен — он показывается один раз." }), true;
    }

    // Всё остальное требует валидного тенанта.
    const tenant = await resolveTenant(req);
    if (tenant?.disabled) return apiErr(res, 503, "api_disabled", "API не сконфигурирован (задайте NABU_API_TOKEN или включите NABU_MULTITENANT)."), true;
    if (!tenant) return apiErr(res, 401, "unauthorized", "нужен валидный Bearer-токен"), true;

    try {
      // ── Управление токенами (bearer) ──
      if (multit() && sub === "auth/tokens") {
        const [L, deps] = [await libMod(), await depsFor("")];
        if (method === "GET") return sendJson(res, 200, { tokens: await L.listTokens(deps.pg, tenant.userId) }), true;
        if (method === "POST") { let b; try { b = JSON.parse((await readBody()) || "{}"); } catch { b = {}; } const issued = await L.issueToken(deps.pg, tenant.userId, b.name || "api"); return sendJson(res, 200, { token: issued.token, id: issued.id, note: "Показывается один раз." }), true; }
      }
      if (multit() && method === "DELETE" && sub.startsWith("auth/tokens/")) {
        const id = sub.slice("auth/tokens/".length);
        const [L, deps] = [await libMod(), await depsFor("")];
        const okk = await L.revokeToken(deps.pg, tenant.userId, id);
        return sendJson(res, okk ? 200 : 404, okk ? { ok: true } : { error: { code: "not_found", message: "токен не найден" } }), true;
      }

      // ── Профиль ──
      if (method === "GET" && sub === "me") {
        return sendJson(res, 200, { userId: tenant.userId, namespace: tenant.userId ? `u:${tenant.userId}` : (process.env.NABU_NAMESPACE || "default"), multitenant: multit() }), true;
      }

      const deps = await depsFor(tenant.profile);
      const q = new URL(req.url, "http://localhost").searchParams;
      const pageLimit = Math.min(Number(q.get("limit")) || 50, 200);

      // ── Память (recall; vault исключён на уровне репозитория) ──
      if (method === "GET" && sub === "memory/recall") {
        const query = q.get("q") || "";
        if (!query) return apiErr(res, 400, "bad_request", "нужен параметр q"), true;
        const hits = await deps.memory.recall({ query, topK: pageLimit });
        return sendJson(res, 200, { hits: (hits || []).map((h) => ({ id: h.id, kind: h.kind, text: h.text, score: h.score, visibility: h.visibility, occurredAt: h.occurredAt ?? null })) }), true;
      }

      // ── Задачи ──
      if (sub === "tasks") {
        if (method === "GET") return sendJson(res, 200, { tasks: await deps.domain.listTasks({ projectId: q.get("projectId") || undefined, status: q.get("status") || undefined, open: q.get("open") === "1" || undefined }) }), true;
        if (method === "POST") { const b = JSON.parse((await readBody()) || "{}"); if (!b.title) return apiErr(res, 400, "bad_request", "нужен title"), true; return sendJson(res, 200, { task: await deps.domain.addTask(b.title, { projectId: b.projectId, priority: b.priority, due: b.due }) }), true; }
      }
      if (method === "POST" && sub.startsWith("tasks/") && sub.endsWith("/status")) {
        const id = sub.slice("tasks/".length, -("/status".length));
        const b = JSON.parse((await readBody()) || "{}");
        if (!b.status) return apiErr(res, 400, "bad_request", "нужен status"), true;
        return sendJson(res, 200, await deps.domain.updateTaskStatus(id, b.status)), true;
      }

      // ── Проекты ──
      if (sub === "projects") {
        if (method === "GET") return sendJson(res, 200, { projects: await deps.domain.listProjects(q.get("status") || undefined) }), true;
        if (method === "POST") { const b = JSON.parse((await readBody()) || "{}"); if (!b.name) return apiErr(res, 400, "bad_request", "нужен name"), true; return sendJson(res, 200, { project: await deps.domain.createProject(b.name, { goal: b.goal }) }), true; }
      }

      // ── OlimpOS (доска/агенты, read) ──
      if (method === "GET" && sub === "olimpos/board") return sendJson(res, 200, { board: await deps.agile.board({ projectId: q.get("projectId") || undefined, sprintId: q.get("sprintId") || undefined }) }), true;
      if (method === "GET" && sub === "olimpos/agents") { const L = await libMod(); return sendJson(res, 200, { agents: await L.listAgents(deps.pg, { userId: tenant.userId || undefined, onlyShared: q.get("market") === "1" }) }), true; }

      // ── Разговоры (метаданные тредов тенанта + сообщения) ──
      if (method === "GET" && sub === "conversations") {
        const all = await sync.readThreads(nabuHome);
        const mine = all.filter((th) => tenant.userId ? String(th.id).includes(tenant.userId) : !/-[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(th.id)));
        return sendJson(res, 200, { conversations: mine.map((th) => ({ id: th.id, title: th.title, role: th.role, updatedAt: th.updatedAt })) }), true;
      }
      if (method === "GET" && sub.startsWith("conversations/") && sub.endsWith("/messages")) {
        const id = sub.slice("conversations/".length, -("/messages".length));
        if (tenant.userId && !String(id).includes(tenant.userId)) return apiErr(res, 403, "forbidden", "разговор не принадлежит вам"), true;
        return sendJson(res, 200, { messages: await sync.loadMessages(repoRoot, id, pageLimit, tenant.profile) }), true;
      }

      // ── Чат с адъютантом ──
      if (method === "POST" && (sub === "chat" || sub === "chat/stream")) {
        if (rateLimited(`apichat:${tenant.userId || clientIp(req)}`, 20, 60_000)) return apiErr(res, 429, "rate_limited", "слишком много запросов к чату"), true;
        let b; try { b = JSON.parse((await readBody()) || "{}"); } catch { return apiErr(res, 400, "bad_json", "невалидный JSON"), true; }
        const message = String(b.message || "").trim();
        if (!message) return apiErr(res, 400, "bad_request", "нужно поле message"), true;
        if (message.length > 32_000) return apiErr(res, 413, "too_large", "сообщение слишком длинное"), true;
        const cid = convIdFor(tenant, b.conversationId);
        const extraEnv = tenant.userId ? { NABU_NAMESPACE: `u:${tenant.userId}`, NABU_USER_ID: tenant.userId } : {};
        const stream = sub === "chat/stream";
        if (stream) res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "connection": "keep-alive", "x-accel-buffering": "no" });

        let result;
        await withConversationLock(cid, async () => {
          const threads = await sync.readThreads(nabuHome);
          const resumeSessionId = threads.find((t) => t.id === cid)?.claudeSessionId || null;
          await sync.persistMessage(repoRoot, cid, "user", message, null, tenant.profile);
          result = await sync.runClaudeExchange({
            res: stream ? res : captureSink(),
            claudeBin, repoRoot, message, resumeSessionId, mcpConfigPath, extraEnv, cwd: nabuHome,
          });
          const text = (result?.fullText || "").trim();
          if (text) await sync.persistMessage(repoRoot, cid, "assistant", text, result?.costUsd ?? null, tenant.profile);
          await sync.upsertThread(nabuHome, {
            id: cid, title: "API · Адъютант", role: "adjutant",
            claudeSessionId: result?.sessionId || resumeSessionId || null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          });
        });
        if (stream) { if (!res.writableEnded) res.end(); return true; }
        return sendJson(res, 200, { conversationId: cid, text: (result?.fullText || "").trim(), sessionId: result?.sessionId || null, costUsd: result?.costUsd ?? null }), true;
      }

      return apiErr(res, 404, "not_found", `неизвестный маршрут ${API_VERSION}: ${sub}`), true;
    } catch (e) {
      log?.({ evt: "apiv1_error", path, error: String(e?.message ?? e).slice(0, 300) });
      return apiErr(res, 500, "internal", "внутренняя ошибка"), true;
    }
  }

  return { handle };
}
