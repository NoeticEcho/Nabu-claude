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

// Жёстко ЗАПРЕЩЁННЫЕ инструменты (R7-hotfix): демон-дети headless — интерактивных approval-карточек
// Claude Code им показать негде (в Telegram/веб нет UI для гейта). Поэтому:
//  • Bash/Edit/NotebookEdit — исполнение произвольных команд/правка файлов запрещены (инвариант #7:
//    демон не исполняет shell и не правит код in-place; реальные внешние действия — через Nabu-
//    approval, кнопки в Telegram, это ДРУГОЙ слой и он сохраняется).
//  • Workflow — динамические воркфлоу требуют интерактивной карточки «Review dynamic workflow»,
//    которую в headless не подтвердить → адъютант зависал. Запрет заставляет использовать Task-
//    субагентов (они в allowlist, идут без подтверждений) — тот же результат, без гейта и без
//    неконтролируемого веера дорогих агентов.
export const DISALLOWED_TOOLS = ["Bash", "Edit", "NotebookEdit", "Workflow", "KillShell"].join(",");

// Изоляция от внешних плагинов/хуков/облака: только Nabu из репо, только наши MCP-серверы.
// --strict-mcp-config: игнорировать любые MCP из user-global настроек.
// --setting-sources project,local: НЕ грузить ~/.claude (где включены claude-mem/agentmemory/облако).
// --permission-mode bypassPermissions: демон автономен (никаких интерактивных подтверждений —
// показать их всё равно негде); безопасность держится на allow/disallow-списках, а НЕ на промптах.
export const ISOLATION_ARGS = ["--strict-mcp-config", "--setting-sources", "project,local", "--permission-mode", "bypassPermissions"];

// Единая сборка argv для `claude -p` (аудит R6, M16): раньше дублировалась в web и TG мостах и
// должна была совпадать вручную — дрейф ослаблял бы security-постуру. Один источник.
// --plugin-dir repoRoot (M6): плагин Nabu грузится ЯВНО из репо, поэтому cwd можно ставить в
// workspace (~/nabu) — адъютант пишет файлы туда, а не в код-репо, и при этом скилл/агенты на месте.
export function buildClaudeArgs({ text, resumeSessionId, mcpConfigPath, repoRoot }) {
  const args = ["-p", text, "--output-format", "stream-json", "--verbose"];
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
  args.push("--allowedTools", ALLOWED_TOOLS);
  args.push("--disallowedTools", DISALLOWED_TOOLS); // hard-exclude даже под bypassPermissions
  args.push(...ISOLATION_ARGS);
  if (repoRoot) args.push("--plugin-dir", repoRoot);
  return args;
}

// Единый разбор NDJSON-потока `--output-format stream-json` (аудит R6, M16): построчный фрейминг
// был скопирован в оба моста. push(chunk) вызывает onEvent на каждой полной JSON-строке; flush() —
// на «хвосте» без \n (последнее событие на close). Битая строка/битое событие не роняют разбор.
// Per-key async-мьютекс (R7-E3): роль-разговоры conv-<role> делят ОДИН claudeSessionId между
// web и Telegram. Два одновременных сообщения в один conv спавнили `claude --resume <тот же id>`
// параллельно → конкурентная запись файла сессии Claude Code → переплетение/потеря истории.
// Оба моста живут в одном процессе демона, поэтому module-level Map — общий лок. Сериализует
// вызовы по ключу (conversationId): второй ждёт завершения первого.
const _lockChains = new Map();
export function withConversationLock(key, fn) {
  if (!key) return Promise.resolve().then(fn); // без ключа — без сериализации
  const prev = _lockChains.get(key) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn()); // запускаем после предыдущего (его исход игнорим)
  const chain = run.then(() => {}, () => {});    // хвост для следующего ждущего (без проброса ошибки)
  _lockChains.set(key, chain);
  chain.finally(() => { if (_lockChains.get(key) === chain) _lockChains.delete(key); });
  return run;
}

// Текст из полного assistant-события (stream-json): блоки content[type=text] (R7-Q1: раньше
// копипастилось идентично в оба моста). Возвращает массив строк.
export function extractAssistantText(event) {
  const out = [];
  const content = event?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") out.push(block.text);
    }
  }
  return out;
}

export function makeNdjsonParser(onEvent) {
  let buf = "";
  const emit = (line) => {
    if (!line) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    try { onEvent(ev); } catch { /* одно битое событие не роняет разбор */ }
  };
  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        emit(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    },
    flush() { emit(buf.trim()); buf = ""; },
  };
}
