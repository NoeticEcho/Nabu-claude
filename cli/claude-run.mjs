// claude-run.mjs — ЕДИНЫЙ источник правды для запуска headless `claude -p` в Nabu (аудит R6, M15).
// Раньше ALLOWED_TOOLS и изоляция-флаги дублировались в nabu.mjs, chat-server.mjs, telegram-bot.mjs
// и должны были совпадать вручную — дрейф ослаблял бы security-постуру. Теперь — одно место.

// Узкий allowlist: 8 nabu-MCP серверов + веб-поиск + чтение/запись/навигация + субагенты.
// НЕТ Bash/Edit (инвариант #7): демон не исполняет произвольные команды и не правит файлы in-place.
export const ALLOWED_TOOLS = [
  "mcp__nabu-memory",
  "mcp__nabu-pipeline",
  "mcp__nabu-council",
  "mcp__nabu-domain",
  "mcp__nabu-analytics",
  "mcp__nabu-improve",
  "mcp__nabu-voice",
  "mcp__nabu-connect",
  "WebSearch",
  "WebFetch",
  "Read",
  "Write",
  "Glob",
  "Grep",
  "Task",
].join(",");

// Изоляция от внешних плагинов/хуков/облака: только Nabu из репо, только наши MCP-серверы.
// --strict-mcp-config: игнорировать любые MCP из user-global настроек.
// --setting-sources project,local: НЕ грузить ~/.claude (где включены claude-mem/agentmemory/облако).
export const ISOLATION_ARGS = ["--strict-mcp-config", "--setting-sources", "project,local"];
