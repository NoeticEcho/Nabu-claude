// claude-run.mjs — ЕДИНЫЙ источник правды для запуска headless `claude -p` в Nabu (аудит R6, M15).
// Раньше ALLOWED_TOOLS и изоляция-флаги дублировались в nabu.mjs, chat-server.mjs, telegram-bot.mjs
// и должны были совпадать вручную — дрейф ослаблял бы security-постуру. Теперь — одно место.

// Базовый узкий allowlist: 8 nabu-MCP серверов + веб-поиск + чтение/запись/навигация + субагенты.
const CORE_ALLOWED = [
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
];

// «Относительно опасные» инструменты: произвольный shell, правка файлов in-place, динамические
// воркфлоу. По умолчанию ЗАПРЕЩЕНЫ (инвариант #7: демон не исполняет shell и не правит код;
// реальные внешние действия — через Nabu-approval, кнопки в Telegram, это ОТДЕЛЬНЫЙ слой).
//
// EXPERIMENTAL: `NABU_DAEMON_ALLOW_DANGEROUS=1` РАЗРЕШАЕТ их (Bash/Edit/Workflow). Осознанное решение
// владельца для DEV/SANDBOX-контекста (вся разработка и продовое развёртывание — в агентной песочнице).
// Флаг ослабляет инвариант #7 — включать ТОЛЬКО в изолированной среде. Дефолт (флаг снят) — безопасен.
const DANGEROUS = ["Bash", "Edit", "NotebookEdit", "Workflow"];

// ВАЖНО: политика вычисляется в момент ВЫЗОВА, а не при импорте. systemd не грузит ~/Nabu/.env, а
// демон подхватывает его через loadEnvIntoProcess() уже ПОСЛЕ статического импорта — значит флаг из
// .env надо читать динамически (иначе бы всегда брался дефолт). Возвращает {allowed, disallowed}.
export function toolPolicy() {
  const allowDangerous = process.env.NABU_DAEMON_ALLOW_DANGEROUS === "1";
  return {
    allowed: [...CORE_ALLOWED, ...(allowDangerous ? DANGEROUS : [])].join(","),
    // Под bypassPermissions доступно всё, что НЕ в disallow. Дефолт: запрещаем опасные + KillShell.
    // При ALLOW_DANGEROUS список пуст — Bash/Edit/Workflow доступны.
    disallowed: allowDangerous ? "" : [...DANGEROUS, "KillShell"].join(","),
  };
}

// Обратная совместимость (снапшот на момент импорта — для не-демонных путей, где env уже загружен).
export const ALLOWED_TOOLS = toolPolicy().allowed;
export const DISALLOWED_TOOLS = toolPolicy().disallowed;

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
  const { allowed, disallowed } = toolPolicy(); // читаем env в момент вызова (после loadEnvIntoProcess)
  args.push("--allowedTools", allowed);
  if (disallowed) args.push("--disallowedTools", disallowed); // hard-exclude (если что-то запрещаем)
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
