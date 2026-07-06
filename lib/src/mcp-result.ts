// Единый формат результата MCP-tool и обёртка ошибок для всех серверов Nabu.
// Устраняет дублирование result/ok/fail/wrap по 7 серверам и гарантирует единый контракт
// {status, summary, data, warnings} + перехват исключений (никаких сырых MCP-ошибок наружу).

export type ToolStatusStr = "ok" | "degraded" | "error";

export interface McpToolResult {
  // Индекс-сигнатура — для структурной совместимости с CallToolResult SDK (@modelcontextprotocol).
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: { status: ToolStatusStr; summary: string; data: unknown; warnings: string[] };
}

function make(status: ToolStatusStr, summary: string, data: unknown, warnings: string[]): McpToolResult {
  const payload = { status, summary, data, warnings };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

/** Успех (или degraded, если есть предупреждения). */
export function ok(summary: string, data: unknown = {}, warnings: string[] = []): McpToolResult {
  return make(warnings.length ? "degraded" : "ok", summary, data, warnings);
}

/** Частичный/деградированный результат (не ошибка): TypeDB недоступен, gated no-op и т.п. */
export function degraded(summary: string, data: unknown = {}, warnings: string[] = []): McpToolResult {
  return make("degraded", summary, data, warnings);
}

/** Ошибка/не найдено — единообразно status:"error". */
export function fail(summary: string, data: unknown = {}, warnings: string[] = []): McpToolResult {
  return make("error", summary, data, warnings);
}

/** Обёртка хендлера: любое исключение → структурированный error, а не сырое MCP-исключение.
 *  R7-G6: через Promise.resolve().then(fn) — ловим и СИНХРОННЫЙ throw до возврата промиса
 *  (иначе он уходил наружу мимо fail(), нарушая контракт «никаких сырых MCP-ошибок»). */
export function wrap(fn: () => Promise<McpToolResult>): Promise<McpToolResult> {
  return Promise.resolve().then(fn).catch((e) => fail(`Ошибка: ${(e as Error).message ?? String(e)}`));
}
