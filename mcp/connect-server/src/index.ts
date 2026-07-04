// nabu-connect MCP server — интеграции с внешними API и автоматизациями (ROADMAP: public-apis,
// n8n/Zapier-класс). Философия: НИКАКИХ broad-инструментов. Пользователь сам декларирует
// коннекторы в config/integrations.json (base_url + auth-env + allowlist путей); агенты получают
// только list_connectors / call_connector (GET-only) / trigger_webhook (исходящая автоматизация,
// high-risk → ОБЯЗАТЕЛЬНЫЙ approvalId, проверяемый по БД governance — модель не может обойти).
// Секреты живут в env (.env), в конфиге — только ИМЕНА переменных.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { join } from "node:path";
import { buildDepsOrExit, installGracefulShutdown, ok, degraded, fail, wrap, resolveLiveConfig, type McpToolResult } from "@nabu/lib";

const deps = buildDepsOrExit("nabu-connect");
const server = new McpServer({ name: "nabu-connect", version: "0.20.0" });

const reg = ((name: string, opts: unknown, h: (...a: unknown[]) => Promise<unknown>) =>
  server.registerTool(name as never, opts as never, ((...a: unknown[]) =>
    wrap(() => h(...a) as Promise<McpToolResult>)) as never)) as unknown as typeof server.registerTool;

// ── Конфиг интеграций ──
interface ConnectorCfg {
  base_url: string;
  description?: string;
  auth?: { type: "none" | "header" | "query"; name?: string; env?: string };
  allow?: string[]; // glob-паттерны путей, например "/v1/rates/*"
}
interface WebhookOutCfg { url_env: string; description?: string; requires_approval?: boolean; secret_env?: string }
interface IntegrationsCfg {
  connectors: Record<string, ConnectorCfg>;
  webhooks?: { out?: Record<string, WebhookOutCfg> };
}

function loadIntegrations(): IntegrationsCfg {
  const p = resolveLiveConfig("integrations.json");
  if (!existsSync(p)) return { connectors: {} };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<IntegrationsCfg>;
    return { connectors: raw.connectors ?? {}, webhooks: raw.webhooks };
  } catch (e) {
    throw new Error(`config/integrations.json не парсится: ${(e as Error).message}`);
  }
}

/** Glob-матч пути по allowlist ("/v1/*" → префикс; "*" — любой сегментный хвост). */
function pathAllowed(path: string, allow: string[] | undefined): boolean {
  if (!allow || allow.length === 0) return false; // нет allowlist = ничего не разрешено (fail-closed)
  return allow.some((pat) => {
    const re = new RegExp("^" + pat.split("*").map(escapeRe).join(".*") + "$");
    return re.test(path);
  });
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_RESPONSE_CHARS = 50_000;

reg(
  "list_connectors",
  {
    title: "Список коннекторов",
    description:
      "Настроенные пользователем внешние API (config/integrations.json): имя, описание, разрешённые " +
      "пути. Секреты не возвращаются. Пусто — предложи пользователю docs/INTEGRATIONS.md.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const cfg = loadIntegrations();
    const items = Object.entries(cfg.connectors).map(([name, c]) => ({
      name,
      description: c.description ?? "",
      baseUrl: c.base_url,
      allow: c.allow ?? [],
      authConfigured: !c.auth || c.auth.type === "none" || !!(c.auth.env && process.env[c.auth.env]),
    }));
    const hooks = Object.entries(cfg.webhooks?.out ?? {}).map(([name, w]) => ({
      name, description: w.description ?? "", requiresApproval: w.requires_approval !== false,
    }));
    return ok(`Коннекторов: ${items.length}, исходящих вебхуков: ${hooks.length}`, { connectors: items, webhooks: hooks });
  },
);

reg(
  "call_connector",
  {
    title: "Вызвать коннектор (только чтение)",
    description:
      "GET-запрос к настроенному коннектору. Путь обязан попадать в allowlist коннектора " +
      "(fail-closed). Write-операции v1 не поддерживает — используй trigger_webhook (с approval) " +
      "или попроси пользователя расширить интеграцию.",
    inputSchema: {
      name: z.string().min(1),
      path: z.string().min(1).max(500).regex(/^\//, "путь начинается с /"),
      query: z.record(z.string(), z.string()).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ name, path, query }) => {
    const cfg = loadIntegrations();
    const c = cfg.connectors[name];
    if (!c) return fail(`Коннектор '${name}' не настроен (см. list_connectors / docs/INTEGRATIONS.md)`);
    if (!pathAllowed(path, c.allow)) {
      return fail(`Путь '${path}' вне allowlist коннектора '${name}' [${(c.allow ?? []).join(", ")}]`);
    }
    const url = new URL(c.base_url.replace(/\/+$/, "") + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: "application/json" };
    if (c.auth && c.auth.type !== "none") {
      const secret = c.auth.env ? process.env[c.auth.env] : undefined;
      if (!secret) return fail(`Ключ для '${name}' не задан: добавьте ${c.auth.env ?? "?"} в .env`);
      if (c.auth.type === "header") headers[c.auth.name ?? "authorization"] = secret;
      else url.searchParams.set(c.auth.name ?? "api_key", secret);
    }
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000), redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        // r3-M6: редиректы не следуем — upstream мог бы увести на внутренний хост (SSRF).
        return degraded(`'${name}' ответил редиректом ${res.status} — редиректы запрещены (обновите base_url на конечный адрес)`, { status: res.status, location: res.headers.get("location") ?? undefined });
      }
    } catch (e) {
      return fail(`Коннектор '${name}' недоступен: ${(e as Error).message}`);
    }
    const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* не-JSON — отдаём текстом */ }
    if (!res.ok) return degraded(`'${name}' ответил ${res.status}`, { status: res.status, data });
    return ok(`'${name}' ${path} → ${res.status}`, { status: res.status, data });
  },
);

reg(
  "trigger_webhook",
  {
    title: "Запустить исходящую автоматизацию (high-risk)",
    description:
      "POST payload на настроенный исходящий вебхук (n8n/Activepieces/Zapier). ВНЕШНЕЕ ДЕЙСТВИЕ: " +
      "обязателен approvalId одобренного запроса (nabu-memory.request_approval c action " +
      "'trigger_webhook:<name>' → пользователь подтверждает кнопкой) — проверяется по БД, " +
      "модель не может обойти. requires_approval:false в конфиге снимает требование (на риск пользователя).",
    inputSchema: {
      name: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
      approvalId: z.string().uuid().optional(),
    },
  },
  async ({ name, payload, approvalId }) => {
    const cfg = loadIntegrations();
    const w = cfg.webhooks?.out?.[name];
    if (!w) return fail(`Исходящий вебхук '${name}' не настроен (config/integrations.json → webhooks.out)`);
    const url = process.env[w.url_env];
    if (!url) return fail(`URL вебхука '${name}' не задан: добавьте ${w.url_env} в .env`);

    if (w.requires_approval !== false) {
      if (!approvalId) {
        return fail(
          `Требуется одобрение: вызови nabu-memory.request_approval({agent, riskClass:"external", ` +
          `action:"trigger_webhook:${name}", summary:<что произойдёт>}), дождись подтверждения ` +
          `пользователя (кнопка в чате/TG) и передай approvalId сюда.`,
        );
      }
      // Реальная проверка по БД (не на доверии к модели) + r3-M5: АТОМАРНОЕ одноразовое
      // потребление (used_at) и уважение expires_at — одно одобрение = ровно один запуск.
      const ns = await deps.pg.resolveNamespace(deps.namespace);
      const consumed = await deps.pg.queryOne<{ id: string }>(
        `update action_approval set used_at = now()
         where id = $1 and namespace = $2 and status = 'approved' and used_at is null
           and action = $3 and (expires_at is null or expires_at > now())
         returning id`,
        [approvalId, ns, `trigger_webhook:${name}`],
      );
      if (!consumed) {
        const row = await deps.pg.queryOne<{ status: string; action: string; used_at: string | null; expires_at: string | null }>(
          "select status, action, used_at, expires_at from action_approval where id=$1 and namespace=$2",
          [approvalId, ns],
        );
        if (!row) return fail("approvalId не найден");
        if (row.used_at) return fail("Approval уже использован (одноразовый) — запросите новый request_approval");
        if (row.expires_at && new Date(row.expires_at) <= new Date()) return fail("Approval истёк — запросите новый");
        if (row.status !== "approved") return fail(`Approval в статусе '${row.status}' — нужен approved`);
        return fail(`Approval выдан для '${row.action}', а не для 'trigger_webhook:${name}'`);
      }
    }

    // Конверт по standard-webhooks: {id, type, source, timestamp, data} + опц. подпись
    // (webhook-id/-timestamp/-signature "v1,<base64 hmac(id.ts.body)>") — интероп n8n/Zapier/Svix.
    // ВАЖНО: private/vault-данные в payload не включать (инвариант приватности).
    const eventId = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const bodyStr = JSON.stringify({ id: eventId, type: `nabu.${name}`, source: "nabu", timestamp: new Date().toISOString(), data: payload });
    const headers: Record<string, string> = { "content-type": "application/json", "webhook-id": eventId, "webhook-timestamp": ts };
    if (w.secret_env && process.env[w.secret_env]) {
      const mac = createHmac("sha256", process.env[w.secret_env]!).update(`${eventId}.${ts}.${bodyStr}`).digest("base64");
      headers["webhook-signature"] = `v1,${mac}`;
    }
    // Retry: 3 попытки с backoff+джиттером на сетевые ошибки и 5xx (4xx не ретраим — это наша ошибка).
    let res: Response | null = null;
    let lastErr: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(url, { method: "POST", headers, body: bodyStr, signal: AbortSignal.timeout(30_000), redirect: "manual" });
        if (res.status >= 300 && res.status < 400) { lastErr = `redirect ${res.status} запрещён (SSRF-защита)`; res = null; break; }
        if (res.status < 500) break;
        lastErr = `HTTP ${res.status}`;
      } catch (e) {
        lastErr = (e as Error).message;
        res = null;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500 + Math.random() * 500));
    }
    if (!res) {
      await deps.governance.logAction({ agent: "nabu-connect", riskClass: "external", action: `trigger_webhook:${name}`, status: "error", approvalId, detail: { error: lastErr } });
      return fail(`Вебхук '${name}' недоступен после 3 попыток: ${lastErr}`);
    }
    await deps.governance.logAction({
      agent: "nabu-connect", riskClass: "external", action: `trigger_webhook:${name}`,
      status: res.ok ? "ok" : "error", approvalId, detail: { httpStatus: res.status },
    });
    return res.ok
      ? ok(`Вебхук '${name}' запущен (${res.status})`, { status: res.status })
      : degraded(`Вебхук '${name}' ответил ${res.status}`, { status: res.status });
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  installGracefulShutdown(deps);
  console.error("nabu-connect MCP server готов (stdio)");
}
main().catch((err) => { console.error("nabu-connect fatal:", err); process.exit(1); });
