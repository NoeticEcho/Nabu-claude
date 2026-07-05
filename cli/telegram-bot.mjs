// Nabu Telegram-бот — опциональный клиент. Zero-dependency Node ≥22 ES module.
//
// Включается ТОЛЬКО при заданном TELEGRAM_BOT_TOKEN (иначе демон его не поднимает).
// Мост между Telegram и Claude Code (headless, stream-json) — тем же конвейером, что и
// веб-чат (cli/chat-server.mjs): те же --mcp-config / --allowedTools / --resume.
//
// Раскладка форума. По команде /setup в супергруппе-форуме бот создаёт темы:
//   «📥 Входящие» (заметки), «🎖 Адъютант» (обычный диалог) и 9 министров Совета.
//   Сообщение в тему маршрутизируется по роли этой темы (message_thread_id).
//
// Один пользователь. Система персональная: бот обслуживает ровно один чат.
//   • Если задан TELEGRAM_CHAT_ID — принимаются апдейты только из этого чата.
//   • Иначе первый чат, приславший /start, «привязывается» (boundChatId, persisted);
//     все прочие чаты игнорируются (попытка логируется однократно).
//
// ПРИВАТНОСТЬ. Содержимое сообщений проходит через серверы Telegram — это осознанный
//   выбор пользователя (не e2e). vault-содержимое СЮДА отправлять нельзя. Тексты
//   сообщений в лог не пишутся (пишем только метаданные обмена).
//
// ГОЛОС. voice/audio/video_note расшифровываются ЛОКАЛЬНО (whisper, scripts/transcribe.py):
//   аудио скачивается из хранилища Telegram (где оно и так уже лежало) во временный файл,
//   транскрибируется на этой машине и файл удаляется. Само аудио никуда, кроме уже
//   имевшегося хранилища Telegram, не уходит — в облако/Claude уходит только текст расшифровки.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { convId, isSharedConv } from "./conversations.mjs";
// Общий стор web-чата (тот же процесс демона): единая история + сессии web↔TG (синхронизация).
let _syncStore = null;
async function sync() {
  if (!_syncStore) { try { _syncStore = (await import("./chat-server.mjs"))._sync; } catch { _syncStore = false; } }
  return _syncStore || null;
}
import { randomUUID } from "node:crypto";

// Живые дочерние процессы (claude/whisper) на уровне модуля: run-хелперы объявлены вне
// фабрики startTelegramBot, а stop() обязан их добивать (иначе сироты при рестарте демона).
const liveChildren = new Set();

const CHILD_TIMEOUT_MS = 10 * 60 * 1000; // убить зависший claude через 10 минут
const CHUNK_LIMIT = 4000; // Telegram лимит сообщения ~4096; режем с запасом по строкам
const POLL_TIMEOUT_S = 50; // серверный long-poll getUpdates
const NET_BACKOFF_MS = 5000; // пауза после сетевой ошибки long-poll

// Живой стрим ответа через editMessageText.
const CURSOR = " ▌"; // суффикс-курсор «печатается» в стримящемся сообщении
const STREAM_LIMIT = 3900; // порог: сообщение финализируем и продолжаем в новом (лимит TG 4096)
const STREAM_EDIT_MS = 2000; // не чаще одного edit в 2 c
const STREAM_MIN_DELTA = 40; // и только если накопилось ≥40 новых символов с прошлого edit
const TG_RETRY_MAX_S = 30; // потолок ожидания по 429 retry_after

// Тот же узкий allowlist, что и в chat-server: MCP Nabu + чтение + субагенты.
const ALLOWED_TOOLS = [
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

// Темы форума: роль → заголовок. Порядок = порядок создания в /setup.
const MINISTERS = [
  ["health", "🏥 Здоровье"],
  ["mind", "🧠 Разум"],
  ["finance", "💰 Финансы"],
  ["work", "💼 Работа"],
  ["learning", "📚 Обучение"],
  ["relationships", "❤️ Отношения"],
  ["growth", "🌱 Рост"],
  ["lifestyle", "🏡 Быт"],
  ["admin", "📋 Дела"],
];
const TOPIC_LAYOUT = [
  ["inbox", "📥 Входящие"],
  ["adjutant", "🎖 Адъютант"],
  ...MINISTERS,
];
const MINISTER_SLUGS = new Set(MINISTERS.map(([slug]) => slug));

const GREETING = [
  "Привет! Я — Telegram-мост к Nabu, вашему персональному ИИ-«Совету».",
  "",
  "Здесь можно вести обычный диалог с адъютантом — просто напишите сообщение.",
  "",
  "Лучше всего я раскрываюсь в супергруппе-форуме: выполните там команду /setup —",
  "я создам темы «📥 Входящие» (для заметок), «🎖 Адъютант» (диалог) и по теме на",
  "каждого из 9 министров Совета (здоровье, разум, финансы, работа, обучение,",
  "отношения, рост, быт, дела). Сообщение в тему попадёт к нужному эксперту.",
  "",
  "Для /setup включите в супергруппе «Темы» (Topics) и дайте мне права администратора.",
].join("\n");

// ---------------------------------------------------------------------------
// Состояние: ${nabuHome}/.nabu/telegram-state.json (atomic tmp+rename).
// { offset, boundChatId, topics: { [threadId]: { role, title } },
//   sessions: { [threadId|"main"]: claudeSessionId } }
// ---------------------------------------------------------------------------

function statePaths(nabuHome) {
  const dir = join(nabuHome, ".nabu");
  return { dir, file: join(dir, "telegram-state.json") };
}

function readState(nabuHome) {
  const base = { offset: 0, boundChatId: null, topics: {}, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(statePaths(nabuHome).file, "utf8"));
    return {
      offset: Number(parsed.offset) || 0,
      boundChatId: parsed.boundChatId ?? null,
      topics: parsed.topics && typeof parsed.topics === "object" ? parsed.topics : {},
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
    };
  } catch {
    // нет файла / битый — начинаем с чистого состояния
    return base;
  }
}

function writeState(nabuHome, state) {
  const { dir, file } = statePaths(nabuHome);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file); // атомарная замена в пределах ФС
}

// ---------------------------------------------------------------------------
// Мелкие утилиты
// ---------------------------------------------------------------------------

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(t); resolve(); };
    // Обязательно снимаем listener при нормальном резолве: signal долгоживущий,
    // иначе каждый backoff накапливает слушателя (MaxListenersExceededWarning).
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Режем длинный текст на куски ≤ limit по границам строк (одну сверхдлинную строку — жёстко).
// Markdown → Telegram HTML (parse_mode=HTML). Telegram поддерживает узкий набор тегов:
// b/i/u/s/code/pre/a/blockquote. Конвертируем безопасно: сначала экранируем <>&, потом
// накладываем разметку. Незакрытая разметка в середине стрима не рендерится — HTML применяем
// только на ФИНАЛЬНОМ сегменте (стрим идёт плейнтекстом).
function mdToTgHtml(md) {
  let t = String(md);
  // защитить содержимое code/pre от дальнейшей обработки — вынести в плейсхолдеры
  const stash = [];
  const keep = (html) => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };
  // ```block```
  t = t.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    keep(`<pre>${esc(code.replace(/\n$/, ""))}</pre>`));
  // `inline`
  t = t.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  // экранируем остальное
  t = esc(t);
  // заголовки ## → жирная строка
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  // жирный **x** / __x__
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
  // курсив *x* / _x_ (не задевая уже использованные)
  t = t.replace(/(^|[^*])\*([^*\n]+)\*($|[^*])/g, "$1<i>$2</i>$3");
  t = t.replace(/(^|[^_])_([^_\n]+)_($|[^_])/g, "$1<i>$2</i>$3");
  // зачёркнутый ~~x~~
  t = t.replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  // ссылки [text](url)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => `<a href="${esc(url)}">${txt}</a>`);
  // маркеры списков → • (плоско)
  t = t.replace(/^[\t ]*[-*+]\s+/gm, "• ");
  // вернуть code/pre
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  return t;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function chunkText(text, limit = CHUNK_LIMIT) {
  const out = [];
  let cur = "";
  for (const line of String(text).split("\n")) {
    if (line.length > limit) {
      if (cur) { out.push(cur); cur = ""; }
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit));
      continue;
    }
    const candidate = cur ? cur + "\n" + line : line;
    if (candidate.length > limit) { out.push(cur); cur = line; }
    else cur = candidate;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

// Собрать текстовые блоки из assistant-события stream-json (как в chat-server).
function extractAssistantText(event) {
  const out = [];
  const content = event?.message?.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") out.push(block.text);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Claude Code: один headless-обмен. Текст собираем и возвращаем целиком, а по мере
// накопления зовём onText(collected) — чтобы вызывающий стримил ответ в Telegram.
// ---------------------------------------------------------------------------

function runClaude({ claudeBin, repoRoot, text, resumeSessionId, mcpConfigPath, onText, cwd }) {
  return new Promise((resolve) => {
    const args = ["-p", text, "--output-format", "stream-json", "--verbose"];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
    args.push("--allowedTools", ALLOWED_TOOLS);
    // Изоляция: только Nabu. --strict-mcp-config — лишь наши MCP-серверы; --setting-sources
    // project,local — грузим ТОЛЬКО настройки репо (Nabu), НЕ user-global (где включён внешний
    // claude-mem и прочие плагины/хуки). Память пользователя оркеструет исключительно Nabu.
    args.push("--strict-mcp-config", "--setting-sources", "project,local");

    let child;
    try {
      child = spawn(claudeBin, args, { cwd: cwd || repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      liveChildren.add(child);
      child.once("close", () => liveChildren.delete(child));
    } catch (err) {
      resolve({ sessionId: resumeSessionId || null, text: "", costUsd: null, errored: true, error: err.message });
      return;
    }

    let sessionId = resumeSessionId || null;
    let collected = "";
    let costUsd = null;
    let sawResult = false;
    let errored = false;
    let settled = false;
    let stdoutBuf = "";
    let stderrTail = "";

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdout?.removeAllListeners(); child.stderr?.removeAllListeners(); } catch {}
      resolve({ sessionId, text: collected, costUsd, errored, error: errored && !collected ? stderrTail : undefined });
    };

    const timer = setTimeout(() => {
      errored = true;
      stderrTail = "claude timed out after 10 minutes";
      try { child.kill("SIGKILL"); } catch {}
      finish();
    }, CHILD_TIMEOUT_MS);

    const handleEvent = (event) => {
      if (!event || typeof event !== "object") return;
      if (typeof event.session_id === "string" && event.session_id) sessionId = event.session_id;
      if (event.type === "assistant") {
        let changed = false;
        for (const t of extractAssistantText(event)) if (t) { collected += t; changed = true; }
        if (changed) { try { onText?.(collected); } catch { /* стрим best-effort, не роняет разбор */ } }
      } else if (event.type === "result") {
        sawResult = true;
        costUsd = event.total_cost_usd ?? null;
        finish();
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
        try { event = JSON.parse(line); } catch { continue; }
        try { handleEvent(event); } catch { /* битое событие не роняет разбор */ }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk).slice(-500); });

    child.on("error", (err) => { errored = true; stderrTail = err.message; finish(); });

    child.on("close", (code) => {
      const line = stdoutBuf.trim();
      if (line) { try { handleEvent(JSON.parse(line)); } catch {} }
      if (settled) return;
      if (!sawResult) {
        errored = true;
        stderrTail = `claude exited (code ${code})${stderrTail ? " — " + stderrTail : ""}`;
      }
      finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

export function startTelegramBot({ repoRoot, nabuHome, claudeBin = process.platform === "win32" ? "claude.cmd" : "claude", log = () => {} } = {}) {
  if (!repoRoot) throw new Error("startTelegramBot: repoRoot is required");
  if (!nabuHome) throw new Error("startTelegramBot: nabuHome is required");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Бросаем ДО любой сети: без токена клиент не должен подниматься.
  if (!token) throw new Error("startTelegramBot: TELEGRAM_BOT_TOKEN не задан — Telegram-клиент отключён");

  const pinnedChatId = process.env.TELEGRAM_CHAT_ID ? Number(process.env.TELEGRAM_CHAT_ID) : null;
  const pinned = pinnedChatId != null && Number.isFinite(pinnedChatId);

  const state = readState(nabuHome);
  const persist = () => { try { writeState(nabuHome, state); } catch (e) { log({ evt: "tg_state_error", error: String(e.message).slice(0, 200) }); } };

  const abort = new AbortController();
  let stopped = false;
  const loggedIgnored = new Set(); // чаты, чья попытка уже залогирована (однократно)
  let depsPromise = null; // ленивый lib/dist для сохранения заметок

  // ── Telegram Bot API ──
  async function tg(method, params = {}, { timeoutMs = 30000, signal } = {}) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    // Один повтор — только для 429 (Too Many Requests) по retry_after.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const sig = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal: sig,
        });
        const body = await r.json().catch(() => null);
        if (r.status === 429 && attempt === 0) {
          const retryAfter = Math.min(Math.max(Number(body?.parameters?.retry_after) || 1, 1), TG_RETRY_MAX_S);
          log({ evt: "tg_rate_limited", method, retryAfter });
          await sleep(retryAfter * 1000, signal);
          if (stopped) return null;
          continue; // повторяем тот же вызов один раз
        }
        if (!r.ok || !body || body.ok !== true) {
          const desc = body?.description || "";
          // Правка сообщения без изменений — не ошибка (частый случай при стриме).
          if (r.status === 400 && /message is not modified/i.test(desc)) return { ok: true, not_modified: true };
          log({ evt: "tg_api_error", method, status: r.status, description: desc || null });
          return null;
        }
        return body;
      } catch (e) {
        // Прерывание по stop() — не ошибка, не шумим в лог.
        if (e?.name !== "AbortError") log({ evt: "tg_api_error", method, error: String(e.message).slice(0, 200) });
        return null;
      }
    }
    return null;
  }

  const threadParams = (msg) => (msg.message_thread_id != null ? { message_thread_id: msg.message_thread_id } : {});

  // Отправка ответа: без parse_mode (никаких entity-ошибок), с эхом темы, чанками ≤4000.
  async function reply(msg, text, opts = {}) {
    const extra = opts.parseMode ? { parse_mode: opts.parseMode } : {};
    for (const c of chunkText(text)) {
      await tg("sendMessage", { chat_id: msg.chat.id, text: c, ...threadParams(msg), ...extra });
    }
  }

  // Индикатор «печатает…» пока работает claude; возвращает функцию остановки.
  function startTyping(msg) {
    const ping = () => { void tg("sendChatAction", { chat_id: msg.chat.id, action: "typing", ...threadParams(msg) }); };
    ping();
    const id = setInterval(ping, 8000);
    return () => clearInterval(id);
  }

  // ── Живой стрим ответа через editMessageText ──
  // schedule(collected) — двигать отображение к текущему тексту (с троттлингом и чанкингом);
  // finish(fullText)     — финальный рендер без курсора; отдаёт { sentAny, edits }.
  // Рендер сериализован (один pump за раз), чтобы правки не гонялись и не переставлялись.
  function makeStreamer(msg) {
    let committed = 0;   // символов, уже финализированных в завершённые сообщения
    let curMsgId = null; // id открытого (стримящегося) сообщения; null — открытого нет
    let lastEditAt = 0;  // время последнего edit (троттлинг 2 c)
    let lastLen = 0;     // длина collected на момент последнего рендера (дельта символов)
    let sentAny = false; // отправляли ли хоть что-то (иначе — прежнее поведение на пустой ответ)
    let edits = 0;
    const closed = []; // {id, text} завершённых сегментов — на финале рендерим КАЖДЫЙ в HTML

    // Точка разреза сегмента: не длиннее limit, по последней "\n" в окне, иначе жёстко.
    function cutPoint(text, start, limit) {
      const hardEnd = Math.min(start + limit, text.length);
      const nl = text.lastIndexOf("\n", hardEnd - 1);
      if (nl > start) return { end: nl, skip: 1 }; // режем по строке, "\n" — разделитель
      return { end: hardEnd, skip: 0 };            // сверхдлинная строка — жёсткий рез
    }

    async function sendSeg(text, withCursor, html) {
      let res;
      if (html) {
        res = await tg("sendMessage", { chat_id: msg.chat.id, text: mdToTgHtml(text), parse_mode: "HTML", ...threadParams(msg) });
        if (!res) res = await tg("sendMessage", { chat_id: msg.chat.id, text, ...threadParams(msg) });
      } else {
        res = await tg("sendMessage", { chat_id: msg.chat.id, text: text + (withCursor ? CURSOR : ""), ...threadParams(msg) });
      }
      curMsgId = res?.result?.message_id ?? null;
      if (curMsgId != null) sentAny = true;
    }
    async function editSeg(text, withCursor, html) {
      if (curMsgId == null) return;
      edits++;
      let res;
      if (html) {
        // Финальный рендер: markdown → Telegram HTML. При entity-ошибке — откат на плейн.
        res = await tg("editMessageText", { chat_id: msg.chat.id, message_id: curMsgId, text: mdToTgHtml(text), parse_mode: "HTML" });
        if (!res) res = await tg("editMessageText", { chat_id: msg.chat.id, message_id: curMsgId, text });
      } else {
        res = await tg("editMessageText", { chat_id: msg.chat.id, message_id: curMsgId, text: text + (withCursor ? CURSOR : "") });
      }
      if (!res) curMsgId = null;
    }

    // Довести отображение до collected. final=true → без курсора, дочистить остаток.
    async function render(collected, final) {
      // Закрываем переполненные сегменты «на лету» и продолжаем в новом сообщении.
      while (collected.length - committed > STREAM_LIMIT) {
        const { end, skip } = cutPoint(collected, committed, STREAM_LIMIT);
        const seg = collected.slice(committed, end);
        if (curMsgId == null) await sendSeg(seg, false);
        else await editSeg(seg, false);
        if (curMsgId != null) closed.push({ id: curMsgId, text: seg }); // запомнить для HTML-финала
        committed = end + skip;
        curMsgId = null;      // следующий сегмент — новое сообщение
        lastLen = committed;  // дельту считаем от начала нового сегмента
        lastEditAt = 0;
      }
      const seg = collected.slice(committed);
      if (!seg) return;
      if (curMsgId == null) {
        await sendSeg(seg, !final, final); // первое сообщение; final → сразу HTML-рендер
        lastEditAt = Date.now();
        lastLen = collected.length;
        return;
      }
      if (final) { await editSeg(seg, false, true); lastLen = collected.length; return; }
      const now = Date.now();
      if (now - lastEditAt >= STREAM_EDIT_MS && collected.length - lastLen >= STREAM_MIN_DELTA) {
        await editSeg(seg, true);
        lastEditAt = now;
        lastLen = collected.length;
      }
    }

    let latest = "";
    let pumping = false;
    let pumpDone = Promise.resolve();
    function schedule(text) {
      latest = text;
      if (pumping) return; // pump сам подхватит новейший latest
      pumping = true;
      pumpDone = (async () => {
        try {
          for (;;) {
            const snap = latest;
            await render(snap, false);
            if (latest === snap) break; // за время рендера ничего нового не пришло
          }
        } finally { pumping = false; }
      })();
      pumpDone.catch(() => {}); // рендер best-effort
    }
    async function finish(fullText) {
      await pumpDone.catch(() => {});
      await render(fullText, true); // последний сегмент уже с HTML
      // Ранее закрытые сегменты длинного ответа отправлялись плейнтекстом — перерендерим в HTML.
      for (const seg of closed) {
        const res = await tg("editMessageText", { chat_id: msg.chat.id, message_id: seg.id, text: mdToTgHtml(seg.text), parse_mode: "HTML" });
        if (res) edits++;
      }
      return { sentAny, edits };
    }
    return { schedule, finish };
  }

  // ── lib/dist (для заметок): ленивый импорт с кэшом, как getLibDeps в chat-server ──
  function getDeps() {
    if (!depsPromise) {
      depsPromise = (async () => {
        const lib = await import(pathToFileURL(join(repoRoot, "lib", "dist", "index.js")).href);
        lib.hydrateEnv?.();
        return lib.buildDeps();
      })();
      depsPromise.catch(() => { depsPromise = null; }); // разрешаем повторную попытку
    }
    return depsPromise;
  }

  // ── Команды ──
  async function handleStart(msg) {
    await reply(msg, GREETING);
  }

  async function handleSetup(msg) {
    if (!msg.chat.is_forum) {
      await reply(msg, "Команда /setup работает только в супергруппе-форуме с включёнными темами. Создайте супергруппу, включите «Темы» (Topics) в её настройках, добавьте меня администратором и повторите /setup здесь.");
      return;
    }
    const existingRoles = new Set(Object.values(state.topics).map((t) => t?.role));
    const created = [];
    const skipped = [];
    for (const [role, title] of TOPIC_LAYOUT) {
      if (existingRoles.has(role)) { skipped.push(title); continue; }
      const res = await tg("createForumTopic", { chat_id: msg.chat.id, name: title });
      if (!res || !res.result || res.result.message_thread_id == null) {
        await reply(msg, `Не смог создать тему «${title}». Обычно это значит, что у меня нет прав администратора с разрешением «Управление темами» (Manage Topics). Дайте мне права администратора в этой супергруппе и повторите /setup.`);
        return;
      }
      state.topics[String(res.result.message_thread_id)] = { role, title };
      persist();
      created.push(title);
    }
    await reply(
      msg,
      `Готово. Создано тем: ${created.length}${created.length ? " (" + created.join(", ") + ")" : ""}.` +
        (skipped.length ? ` Уже были: ${skipped.length}.` : "") +
        "\n\nПишите в «📥 Входящие» — сохраню как заметку. В «🎖 Адъютант» — обычный диалог. В тему министра — ответ соответствующего эксперта Совета.",
    );
  }

  async function handleHelp(msg) {
    await reply(
      msg,
      "🎖 <b>Nabu — команды</b>\n\n" +
        "Проще всего — просто напишите словами, я адъютант и всё пойму. Команды — ярлыки:\n\n" +
        "<b>Дела и жизнь</b>\n" +
        "/nabu-tasks — задачи и дела\n" +
        "/nabu-ask — вопрос Совету\n" +
        "/nabu-council — созвать Совет по сложному вопросу\n" +
        "/nabu-decide — помочь принять решение\n" +
        "/nabu-triage — разобрать входящее/приоритеты\n\n" +
        "<b>Память и знания</b>\n" +
        "/nabu-recall — поднять из памяти\n" +
        "/nabu-digest — сводка-дайджест\n" +
        "/nabu-research — исследовать тему (веб)\n" +
        "/nabu-metrics — метрики и прогресс\n" +
        "/nabu-agents — кто в Совете\n\n" +
        "<b>Быстро</b>\n" +
        "!текст @завтра — быстро добавить задачу\n" +
        "🎤 голосовое — расшифрую и отвечу · 📎 файл — прочту · фото — распознаю\n\n" +
        "<b>Управление ботом</b>\n" +
        "/status · /setup · /approvals · /help\n\n" +
        "<i>Команды установки/индексации/расписания (nabu-init, nabu-index, nabu-cron) — в десктоп-CLI.</i>",
      { parseMode: "HTML" },
    );
  }

  async function handleStatus(msg) {
    const bound = pinned ? pinnedChatId : state.boundChatId;
    await reply(
      msg,
      "Статус Nabu-бота:\n" +
        `• Привязанный чат: ${bound ?? "не привязан"}${pinned ? " (закреплён через TELEGRAM_CHAT_ID)" : ""}\n` +
        `• Тем создано: ${Object.keys(state.topics).length}\n` +
        `• Активных сессий: ${Object.keys(state.sessions).length}`,
    );
  }

  // ── Сохранение заметки (роль inbox) ──
  async function quickAddTask(msg, raw) {
    try {
      let title = raw.trim();
      let due;
      const m = /\s@(сегодня|завтра|\d{4}-\d{2}-\d{2})\s*$/iu.exec(title);
      if (m) {
        title = title.slice(0, m.index).trim();
        const d = new Date();
        if (/завтра/i.test(m[1])) d.setDate(d.getDate() + 1);
        // Локальная дата (не toISOString/UTC): в +TZ около полуночи «завтра» съезжало на сегодня.
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        due = /\d{4}/.test(m[1]) ? m[1] : local;
      }
      if (!title) { await reply(msg, "Пустая задача. Формат: !текст [@завтра|@YYYY-MM-DD]"); return; }
      const deps = await getDeps();
      const r = await deps.domain.addTask(title.slice(0, 500), { due });
      await reply(msg, `✅ Задача: «${title.slice(0, 80)}»${due ? ` (срок ${due})` : ""} — id ${String(r.id).slice(0, 8)}`);
      log({ evt: "tg_quick_task", ok: true, due: !!due });
    } catch (e) {
      await reply(msg, `Не удалось создать задачу: ${String(e.message).slice(0, 150)}`);
    }
  }

  async function saveNote(msg, text) {
    try {
      const deps = await getDeps();
      // Через NotesRepository (fail-closed user-резолюция внутри) — раньше здесь был
      // raw-SQL дубль той же логики (аудит r2 §5.1).
      const row = await deps.notes.add({ title: text.slice(0, 80), content: text, visibility: "private" });
      await reply(msg, `📥 Сохранено в заметки (id: ${String(row?.id ?? "?").slice(0, 8)})`);
    } catch (e) {
      await reply(msg, `Не удалось сохранить заметку: ${String(e.message).slice(0, 200)}`);
    }
  }

  // ── Диалог с адъютантом / министром (claude-конвейер) ──
  async function runAgent(msg, prompt, sessionKey, role, opts = {}) {
    const stopTyping = startTyping(msg);
    const t0 = Date.now();
    const cfgFile = join(nabuHome, ".nabu", "mcp-config.json");
    const mcpConfigPath = existsSync(cfgFile) ? cfgFile : null;
    const streamer = makeStreamer(msg);

    // Снапшот файлов верхнего уровня workspace ДО обмена — чтобы поймать созданные адъютантом
    // отчёты, где бы он их ни записал (cwd теперь workspace). Внутренний .nabu/точки — исключаем.
    // Адъютант пишет файлы относительно cwd (=repoRoot). Снапшотим repoRoot, ловим НОВЫЕ
    // документы, отправляем и уносим в workspace (чтобы не засорять код).
    const wsSnapshot = () => {
      try { return new Set(readdirSync(repoRoot).filter((f) => !f.startsWith("."))); } catch { return new Set(); }
    };
    const filesBefore = wsSnapshot();

    // Синхронизация web↔TG: adjutant/министры — ОБЩИЙ разговор (общий thread_id + сессия + история).
    const st = await sync();
    const cid = convId(role); // conv-adjutant / conv-<министр>
    let sharedSession = null;
    if (st) {
      try {
        const th = (await st.readThreads(nabuHome)).find((t) => t.id === cid);
        sharedSession = th?.claudeSessionId || null;
        await st.persistMessage(repoRoot, cid, "user", opts.originalText || prompt); // история — исходный текст
      } catch { /* стор недоступен — работаем автономно */ }
    }
    const resumeSessionId = sharedSession || state.sessions[sessionKey];

    let result;
    try {
      result = await runClaude({
        claudeBin,
        repoRoot,
        text: prompt,
        resumeSessionId,
        mcpConfigPath,
        onText: (t) => streamer.schedule(t),
      });
    } finally {
      stopTyping();
    }
    if (result.sessionId) { state.sessions[sessionKey] = result.sessionId; persist(); }
    // Записать общую сессию + ответ в общую историю (виден в веб-чате как тот же разговор).
    if (st) {
      try {
        await st.upsertThread(nabuHome, { id: cid, title: `${role === "adjutant" ? "🎖 Адъютант" : role} (Telegram+Web)`, claudeSessionId: result.sessionId || sharedSession || null, role, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        if (result.text?.trim()) await st.persistMessage(repoRoot, cid, "assistant", result.text.trim(), result.costUsd ?? null);
      } catch { /* best-effort */ }
    }
    // Финальный рендер без курсора; sentAny=false → потоком ничего не ушло.
    const { sentAny, edits } = await streamer.finish(result.text);
    const answer = result.text.trim();
    if (!sentAny) {
      // Пустой ответ или ранняя ошибка (ни одного сообщения не отправлено) — прежнее поведение.
      await reply(msg, answer || `Не удалось получить ответ${result.error ? ": " + String(result.error).slice(0, 200) : "."}`);
    }
    // Лог обмена — только метаданные, без текста (приватность).
    log({ evt: "tg", role, ms: Date.now() - t0, ok: !result.errored, costUsd: result.costUsd ?? null, edits });
    // Опциональная озвучка (NABU_TTS=1): текст уже доставлен — провал TTS ни на что не влияет.
    // Голосовой цикл: NABU_TTS=1 — всегда; NABU_TTS=0 — никогда;
    // не задан — голосом отвечаем НА ГОЛОС (бесшовный voice-диалог, Горизонт-1).
    const ttsWanted = process.env.NABU_TTS === "1" || (process.env.NABU_TTS !== "0" && opts.voiceOrigin === true);
    if (ttsWanted && !result.errored && answer) {
      maybeSendTts(msg, answer).catch((e) => log({ evt: "tg_tts_error", error: String(e.message).slice(0, 150) }));
    }
    // Беседа → эпизодическая память Nabu (первоклассная память, а не внешний плагин).
    // Приватно, локальный эмбеддинг. Тривиальное (короткое/команды) — пропускаем.
    if (result.text?.trim() && (opts.originalText || "").trim().length >= 12 && !/^!\s*\S/.test(opts.originalText || "")) {
      (async () => {
        try {
          const deps = await getDeps();
          const u = (opts.originalText || "").slice(0, 1500);
          const a = result.text.trim().slice(0, 1500);
          await deps.memory.rememberEpisode({
            event: `Беседа (${role}): пользователь — «${u}». Ответ: ${a}`,
            actors: ["пользователь", role === "adjutant" ? "адъютант" : role],
            context: { source: "telegram", role, channel: cid },
            visibility: "private",
          });
        } catch (e) { log({ evt: "tg_episode_error", error: String(e.message).slice(0, 120) }); }
      })();
    }
    // Файлы, которые адъютант создал для пользователя — отправить.
    // (а) явный outbox; (б) новые файлы в workspace, появившиеся за этот обмен (отчёты и т.п.).
    (async () => {
      await flushOutbox(msg);
      try {
        const after = wsSnapshot();
        const isDoc = (f) => /\.(md|txt|csv|json|pdf|html|log|tsv|yaml|yml)$/i.test(f);
        const fresh = [...after].filter((f) => !filesBefore.has(f) && isDoc(f));
        for (const f of fresh.slice(0, 5)) {
          const fp = join(repoRoot, f);
          try {
            const st = statSync(fp);
            if (st.isFile() && st.size < 20 * 1024 * 1024) {
              await sendDocumentFile(msg, fp);
              log({ evt: "tg_file_sent", file: f });
              try { renameSync(fp, join(nabuHome, f)); } catch { try { unlinkSync(fp); } catch { /* */ } } // унести из кода в workspace
            }
          } catch { /* */ }
        }
      } catch (e) { log({ evt: "tg_file_capture_error", error: String(e.message).slice(0, 100) }); }
    })().catch((e) => log({ evt: "tg_outbox_error", error: String(e.message).slice(0, 100) }));
  }

  // ── Маршрутизация обычного текста по теме ──
  // Единая точка входа для текста: и для набранных сообщений, и для расшифрованного голоса.
  async function routeText(msg, text, opts = {}) {
    const threadId = msg.message_thread_id ?? null;
    const topic = threadId != null ? state.topics[String(threadId)] : null;
    const role = topic?.role || "adjutant"; // без темы / неизвестная тема → адъютант

    if (role === "inbox") { await saveNote(msg, text); return; }

    // Быстрый ввод задачи (Горизонт-2, «ведение дел»): "!купить молоко @завтра" — детерминированно,
    // мгновенно, БЕЗ Claude-квоты. Срок: @сегодня | @завтра | @YYYY-MM-DD (опционально, в конце).
    if (/^!\s*\S/.test(text)) {
      await quickAddTask(msg, text.replace(/^!\s*/, ""));
      return;
    }

    const sessionKey = threadId != null ? String(threadId) : "main";
    let prompt = text;

    // Reply/цитата: пользователь ответил на сообщение (выделил как reply). Даём модели контекст —
    // что именно цитируется, и от кого (адъютант/Совет vs сам пользователь).
    const rt = msg.reply_to_message;
    // msg.quote — конкретный выделенный фрагмент (новая фича Telegram); иначе — весь текст.
    const quoted = (msg.quote?.text || rt?.text || rt?.caption || "").trim();
    if (quoted) {
      const fromBot = rt?.from?.is_bot === true;
      const who = fromBot ? "твоё предыдущее сообщение (Nabu/Совет)" : "своё прежнее сообщение";
      const q = quoted.length > 1500 ? quoted.slice(0, 1500) + "…" : quoted;
      prompt =
        `[Пользователь отвечает на ${who}, цитируя:]\n«${q}»\n\n[Его сообщение по этой цитате:]\n${text}`;
    }

    if (MINISTER_SLUGS.has(role)) {
      prompt =
        `Вопрос адресован министру «${role}». Подними субагента ${role} (или ответь в его роли и границах компетенции) и дай его ответ пользователю.\n\n` +
        prompt;
    }
    await runAgent(msg, prompt, sessionKey, role, { ...opts, originalText: text });
  }

  // ── Голос: локальная транскрипция (whisper) → та же маршрутизация, что и для текста ──

  // ── Локальная озвучка ответа (piper через scripts/tts.py; строго best-effort) ──
  const TTS_MAX = Number(process.env.NABU_TTS_MAX_CHARS || 900);
  async function maybeSendTts(msg, answer) {
    const py = detectPython();
    if (!py) return; // нет python — тихо пропускаем (текст уже у пользователя)
    const speak = answer.length > TTS_MAX
      ? answer.slice(0, TTS_MAX) + " … Полный ответ — текстом выше."
      : answer;
    const tmpDir = join(nabuHome, ".nabu", "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const wav = join(tmpDir, `tts-${Date.now()}.wav`);
    const r = await new Promise((res) => {
      const child = spawn(py, [join(repoRoot, "scripts", "tts.py"), "--text", speak, "--out", wav], { stdio: ["ignore", "pipe", "pipe"] });
      liveChildren.add(child);
      child.once("close", () => liveChildren.delete(child));
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("error", () => res(null));
      child.on("close", (code) => res(code === 0 ? out : null));
    });
    if (!r) { try { unlinkSync(wav); } catch { /* */ } return; }
    const ogg = /OGG: (\S+)/.exec(r)?.[1];
    const file = ogg && ogg !== "none" ? ogg : wav;
    try {
      await sendMediaFile(msg, file, ogg && ogg !== "none" ? "voice" : "audio");
    } finally {
      for (const f of [wav, ogg && ogg !== "none" ? ogg : null]) {
        if (f) { try { unlinkSync(f); } catch { /* */ } }
      }
    }
  }

  /** Multipart-отправка файла (sendVoice для ogg/opus, sendAudio для wav). */
  async function sendMediaFile(msg, filePath, kind) {
    const buf = readFileSync(filePath);
    const fd = new FormData();
    fd.set("chat_id", String(msg.chat.id));
    const tid = msg.message_thread_id;
    if (tid != null) fd.set("message_thread_id", String(tid));
    fd.set(kind === "voice" ? "voice" : "audio", new Blob([buf]), kind === "voice" ? "answer.ogg" : "answer.wav");
    const method = kind === "voice" ? "sendVoice" : "sendAudio";
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", body: fd, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) log({ evt: "tg_tts_send_fail", status: res.status });
  }

  // Определить доступный интерпретатор Python один раз (кэш). Порядок: NABU_PYTHON (тест/
  // переопределение) → python3 → python. null, если ни один не отвечает на --version.
  let pythonBin; // undefined/null = не найден (НЕ кэшируем навсегда: python, установленный
  // после старта демона, должен подхватиться без рестарта); string = найден.
  function detectPython() {
    if (typeof pythonBin === "string") return pythonBin;
    pythonBin = null;
    for (const bin of [process.env.NABU_PYTHON, "python3", "python"]) {
      if (!bin) continue;
      try {
        const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
        if (!r.error && r.status === 0) { pythonBin = bin; break; }
      } catch { /* нет такого бинарника — пробуем следующий */ }
    }
    return pythonBin;
  }

  // Bot API Telegram НЕ отдаёт через getFile/download файлы больше 20 МБ — жёсткий лимит.
  // (Обойти можно только локальным Bot API сервером; для нас — честно сообщить пользователю.)
  const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
  const MAX_AUDIO_BYTES = TG_DOWNLOAD_LIMIT;
  async function downloadVoice(filePath) {
    const ext = filePath.match(/\.[a-z0-9]+$/i)?.[0] || ".oga";
    const tmpDir = join(nabuHome, ".nabu", "tmp");
    mkdirSync(tmpDir, { recursive: true }); // создаём tmp лениво
    const dest = join(tmpDir, `tg-voice-${randomUUID()}${ext}`);
    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`скачивание не удалось (HTTP ${r.status})`);
    const declared = Number(r.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
      throw new Error(`аудио слишком большое (${declared} b > лимит ${MAX_AUDIO_BYTES} b)`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.byteLength > MAX_AUDIO_BYTES) {
      throw new Error(`аудио слишком большое (${buf.byteLength} b > лимит ${MAX_AUDIO_BYTES} b)`);
    }
    writeFileSync(dest, buf);
    return dest;
  }

  // Запустить локальный воркер транскрипции. Контракт: последняя непустая строка stdout — JSON
  // {ok:true,text,language,segments} | {ok:false,error,hint}. Убиваем по общему таймауту (10 мин).
  function runTranscribe(bin, audioPath) {
    return new Promise((resolve) => {
      const args = [
        join(repoRoot, "scripts", "transcribe.py"),
        audioPath,
        process.env.WHISPER_MODEL || "large-v3",
        "auto",
      ];
      let child;
      try {
        child = spawn(bin, args, { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        liveChildren.add(child);
        child.once("close", () => liveChildren.delete(child));
      } catch (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      let stdout = "";
      let stderrTail = "";
      let settled = false;
      const done = (val) => { if (settled) return; settled = true; clearTimeout(timer); resolve(val); };
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        done({ ok: false, error: "транскрипция превысила лимит 10 минут", hint: "разбейте аудио на части" });
      }, CHILD_TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => { stdout += c; });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => { stderrTail = (stderrTail + c).slice(-500); });
      child.on("error", (err) => done({ ok: false, error: err.message }));
      child.on("close", (code) => {
        const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const last = lines[lines.length - 1];
        if (last) { try { done(JSON.parse(last)); return; } catch { /* не JSON — ниже общий отказ */ } }
        done({
          ok: false,
          error: `воркер завершился без результата (код ${code})${stderrTail ? " — " + stderrTail : ""}`,
          hint: "pip install faster-whisper",
        });
      });
    });
  }

  // Обработать голосовое/аудио/кружок: подтвердить, скачать, расшифровать локально, отмаршрутизировать.
  async function handleVoice(msg, media) {
    const t0 = Date.now();
    const duration = media?.duration ?? null;
    await reply(msg, "🎙 Расшифровываю…");
    let audioPath = null;
    try {
      const bin = detectPython();
      if (!bin) {
        await reply(msg, "Не удалось расшифровать: не найден интерпретатор Python.\npip install faster-whisper");
        log({ evt: "tg_voice", ok: false, ms: Date.now() - t0 });
        return;
      }
      const declaredSize = Number(media?.file_size) || 0;
      if (declaredSize > TG_DOWNLOAD_LIMIT) {
        await reply(msg, `Файл ~${Math.round(declaredSize / 1e6)} МБ — Telegram не даёт ботам скачивать файлы больше 20 МБ. Пришлите запись как голосовое сообщение (кнопка микрофона — оно сжимается) или более короткий/сжатый файл.`);
        log({ evt: "tg_voice", ok: false, reason: "too_big", bytes: declaredSize, ms: Date.now() - t0 });
        return;
      }
      const got = await tg("getFile", { file_id: media.file_id });
      const filePath = got?.result?.file_path;
      if (!filePath) throw new Error("Telegram не отдал файл (вероятно, больше 20 МБ — лимит Bot API на скачивание). Пришлите короче или голосовым сообщением.");
      audioPath = await downloadVoice(filePath);
      const res = await runTranscribe(bin, audioPath);
      // tmp больше не нужен ни при успехе, ни при отказе — удаляем сразу.
      try { unlinkSync(audioPath); } catch {}
      audioPath = null;
      if (!res || res.ok !== true) {
        const err = res?.error || "не удалось расшифровать аудио";
        const hint = res?.hint || "pip install faster-whisper";
        await reply(msg, `Не удалось расшифровать: ${String(err).slice(0, 200)}\n${hint}`);
        log({ evt: "tg_voice", ok: false, ms: Date.now() - t0 });
        return;
      }
      const transcript = String(res.text || "").trim();
      if (!transcript) {
        await reply(msg, "Не удалось расшифровать: пустой результат.\npip install faster-whisper");
        log({ evt: "tg_voice", ok: false, ms: Date.now() - t0 });
        return;
      }
      // Показать пользователю, что именно услышали, затем — обычная маршрутизация текста.
      const preview = transcript.slice(0, 400);
      await reply(msg, `🎤 Расшифровка: «${preview}${transcript.length > 400 ? "…" : ""}»`);
      // Кэп: сверхдлинный транскрипт как один argv может упереться в ARG_MAX (E2BIG).
      const MAX_TRANSCRIPT = 30_000;
      const routed = transcript.length > MAX_TRANSCRIPT
        ? transcript.slice(0, MAX_TRANSCRIPT) + `\n\n[транскрипт обрезан: ${transcript.length} символов]`
        : transcript;
      await routeText(msg, routed, { voiceOrigin: true });
      log({ evt: "tg_voice", ok: true, ms: Date.now() - t0, seconds: duration });
    } catch (e) {
      // Сетевые/файловые провалы — без вводящего в заблуждение pip-хинта.
      await reply(msg, `Не удалось расшифровать: ${String(e.message).slice(0, 200)}`);
      log({ evt: "tg_voice", ok: false, ms: Date.now() - t0 });
    } finally {
      if (audioPath) { try { unlinkSync(audioPath); } catch {} }
    }
  }

  // ── Approvals (P2): ВНЕКОНТЕКСТНОЕ подтверждение — человек жмёт кнопку, модель не может
  //    одобрить сама себя. Решение пишется в аудит как user:telegram. ──
  async function handleApprovals(msg) {
    let deps;
    try { deps = await getDeps(); } catch (e) { await reply(msg, "БД недоступна: " + e.message); return; }
    let list;
    try { list = await deps.governance.listPendingApprovals(); }
    catch (e) { await reply(msg, "Не удалось получить список: " + e.message); return; }
    if (!list.length) { await reply(msg, "Нет действий, ожидающих подтверждения."); return; }
    for (const a of list.slice(0, 10)) {
      await tg("sendMessage", {
        chat_id: msg.chat.id,
        ...(msg.message_thread_id != null ? { message_thread_id: msg.message_thread_id } : {}),
        text: `🔐 [${a.riskClass}] ${a.action}\n${a.summary}\nагент: ${a.agent} · ${String(a.requestedAt).slice(0, 16).replace("T", " ")}`,
        reply_markup: { inline_keyboard: [[
          { text: "✅ Одобрить", callback_data: `apr:${a.id}:approved` },
          { text: "❌ Отклонить", callback_data: `apr:${a.id}:rejected` },
        ]] },
      });
    }
    if (list.length > 10) await reply(msg, `…и ещё ${list.length - 10} (повторите /approvals после решения этих).`);
  }

  async function handleCallback(cq) {
    const chatId = cq.message?.chat?.id;
    const okChat = pinned ? chatId === pinnedChatId : chatId === state.boundChatId;
    if (!okChat) { await tg("answerCallbackQuery", { callback_query_id: cq.id }); return; }
    // Обучаемая проактивность: 👍 сбрасывает backoff джобы, 🔇 удваивает интервал (cap ×4).
    const pro = /^pro:([a-z0-9_-]{1,40}):(ok|less)$/.exec(cq.data || "");
    if (pro) {
      const [, jobName, action] = pro;
      const pf = join(nabuHome, ".nabu", "proactivity.json");
      let st = {};
      try { st = JSON.parse(readFileSync(pf, "utf8")); } catch { /* нет файла */ }
      const j = st[jobName] ?? { mult: 1, sinceOk: 0 };
      let note;
      if (action === "ok") {
        j.mult = 1; j.sinceOk = 0;
        note = "Понял — буду продолжать в этом ритме 👍";
      } else {
        j.mult = Math.min(4, (j.mult || 1) * 2); j.sinceOk = 0;
        note = j.mult >= 4
          ? `Интервал ×${j.mult} (максимум). Совсем выключить: nabu schedule disable ${jobName}`
          : `Понял — реже (интервал ×${j.mult}).`;
      }
      st[jobName] = j;
      try {
        const tmp = `${pf}.${process.pid}.tmp`; // uniq tmp (r3-M13): демон пишет тот же файл
        writeFileSync(tmp, JSON.stringify(st, null, 2));
        renameSync(tmp, pf);
      } catch { /* best-effort */ }
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: note });
      log({ evt: "tg_proactivity", job: jobName, action, mult: j.mult });
      return;
    }
    const m = /^apr:([0-9a-f-]{36}):(approved|rejected)$/.exec(cq.data || "");
    if (!m) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Неизвестное действие" }); return; }
    const [, id, decision] = m;
    let done = false;
    let err = "";
    try {
      const deps = await getDeps();
      done = await deps.governance.resolveApproval(id, decision, "user:telegram");
    } catch (e) { err = e.message; }
    log({ evt: "tg_approval", decision, ok: done });
    await tg("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: done ? (decision === "approved" ? "Одобрено" : "Отклонено") : "Не найдено/истекло" + (err ? ": " + err.slice(0, 60) : ""),
    });
    if (done && cq.message) {
      await tg("editMessageText", {
        chat_id: chatId, message_id: cq.message.message_id,
        text: cq.message.text + "\n\n" + (decision === "approved" ? "✅ ОДОБРЕНО (user:telegram)" : "❌ ОТКЛОНЕНО (user:telegram)"),
      });
    }
  }

  // ── Один апдейт ──
  async function handleUpdate(update) {
    if (update.callback_query) return handleCallback(update.callback_query);
    const msg = update.message;
    if (!msg || !msg.chat || msg.chat.id == null) return;
    const chatId = msg.chat.id;
    const text = typeof msg.text === "string" ? msg.text : "";
    const isCommand = text.trim().startsWith("/");
    const cmd = isCommand ? text.trim().split(/\s+/)[0].split("@")[0].toLowerCase() : "";

    // Контроль доступа (персональная система, ровно один чат).
    let allowed;
    if (pinned) {
      allowed = chatId === pinnedChatId;
    } else if (state.boundChatId != null) {
      allowed = chatId === state.boundChatId;
    } else if (cmd === "/start") {
      state.boundChatId = chatId; // первый /start привязывает чат
      persist();
      log({ evt: "tg_bound", chatId });
      allowed = true;
    } else {
      allowed = false;
    }
    if (!allowed) {
      if (!loggedIgnored.has(chatId)) {
        if (loggedIgnored.size >= 100) loggedIgnored.clear(); // не растём бесконечно при спаме
        loggedIgnored.add(chatId);
        log({ evt: "tg_ignored_chat", chatId });
      }
      return;
    }

    if (cmd === "/start") return handleStart(msg);
    if (cmd === "/setup") return handleSetup(msg);
    if (cmd === "/status") return handleStatus(msg);
    if (cmd === "/approvals") return handleApprovals(msg);
    if (cmd === "/help" || cmd === "/nabu") return handleHelp(msg);
    // Команды Nabu (/nabu-ask, /nabu-council, /nabu-tasks, …) — форвардим адъютанту как намерение:
    // headless-claude НЕ исполняет плагин-слэш-команды через -p, но адъютант знает их и выполняет
    // суть своими инструментами. CLI-only команды он коротко пояснит.
    if (cmd.startsWith("/nabu")) {
      // Нормализуем: /nabu_tasks (из меню) и /nabu-tasks (ручной ввод) → команда nabu-tasks.
      const name = cmd.replace(/^\//, "").replace(/_/g, "-");
      const argStr = text.trim().slice(cmd.length).trim();
      const intent =
        `Пользователь вызвал команду Nabu «${name}»` + (argStr ? ` с аргументами: ${argStr}` : "") + ".\n" +
        `Выполни СУТЬ этой команды средствами Nabu (у тебя есть все инструменты памяти/дел/Совета). ` +
        `Если это команда только для десктоп-CLI (установка/индексация/расписание/сборка) — коротко скажи, что она выполняется в CLI, и предложи, что можешь сделать здесь.`;
      return routeText(msg, intent, { commandOrigin: name, originalText: text });
    }
    if (isCommand) { await reply(msg, "Неизвестная команда. Команды Nabu пишите как /nabu-… (напр. /nabu-tasks, /nabu-ask, /nabu-council) — /help покажет список. Или просто напишите словами — я адъютант и всё пойму. Управление: /start, /setup, /status, /approvals."); return; }
    if (text) return routeText(msg, text);
    // Голос / аудио / видео-кружок: расшифровать локально и отмаршрутизировать как текст.
    const media = msg.voice || msg.audio || msg.video_note;
    if (media && media.file_id) return handleVoice(msg, media);
    // Фото → память (Горизонт-1): извлечь текст локально (vision-модель/OCR) → заметка.
    const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null; // максимальный размер
    const imgDoc = msg.document && /^image\//.test(msg.document.mime_type || "") ? msg.document : null;
    if ((photo || imgDoc)?.file_id) return handlePhoto(msg, photo || imgDoc);
    // Документ (не картинка): извлечь текст → как сообщение (или заметка во Входящих).
    if (msg.document?.file_id) return handleDocument(msg, msg.document);
    // Прочие не-текстовые сообщения (стикеры/медиа/сервисные) молча пропускаем.
  }

  // ── Документ → сообщение: читаем текст (txt/md/csv/json/код) или pdf (pdftotext) локально ──
  const MAX_DOC_BYTES = 20 * 1024 * 1024;
  const TEXT_EXT = /\.(md|txt|csv|tsv|json|yaml|yml|xml|log|ini|conf|py|js|ts|mjs|sh|html|css|sql|rst|org|tex)$/i;
  async function handleDocument(msg, doc) {
    const t0 = Date.now();
    let path = null;
    try {
      await tg("sendChatAction", { chat_id: msg.chat.id, action: "typing", ...threadParams(msg) });
      const name = doc.file_name || "файл";
      if (doc.file_size && doc.file_size > MAX_DOC_BYTES) { await reply(msg, `Файл «${name}» слишком большой (${Math.round(doc.file_size/1e6)}МБ > 20МБ).`); return; }
      const got = await tg("getFile", { file_id: doc.file_id });
      const fp = got?.result?.file_path;
      if (!fp) { await reply(msg, "Не удалось получить файл из Telegram."); return; }
      path = await downloadVoice(fp); // тот же загрузчик (URL→tmp, лимит), имя не важно
      let content = "";
      const isPdf = /\.pdf$/i.test(name) || doc.mime_type === "application/pdf";
      if (isPdf) {
        const r = spawnSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
        if (!r.error && r.status === 0) content = String(r.stdout || "").trim();
        else { await reply(msg, "PDF не разобрать: установите poppler(-utils) (pdftotext)."); return; }
      } else if (TEXT_EXT.test(name) || /^text\//.test(doc.mime_type || "") || doc.mime_type === "application/json") {
        content = readFileSync(path, "utf8");
      } else {
        await reply(msg, `Файл «${name}» — бинарный/неподдерживаемый тип. Пришлите текст, md, csv, json, код или PDF.`);
        return;
      }
      if (!content.trim()) { await reply(msg, `Файл «${name}» пуст.`); return; }
      content = content.slice(0, 30_000);
      const caption = (msg.caption || "").trim();
      // Во «Входящих» — сохранить как заметку; иначе — отправить содержимое как сообщение адъютанту/министру.
      const threadId = msg.message_thread_id ?? null;
      const role = (threadId != null ? state.topics[String(threadId)]?.role : null) || "adjutant";
      if (role === "inbox") {
        await saveNote(msg, `${caption ? caption + "\n\n" : ""}[файл: ${name}]\n${content}`);
      } else {
        const prompt = `${caption ? caption + "\n\n" : ""}Пользователь прислал файл «${name}». Его содержимое:\n\n${content}`;
        await routeText({ ...msg, text: prompt }, prompt);
      }
      log({ evt: "tg_document", ok: true, ms: Date.now() - t0, name: name.slice(0, 40), chars: content.length });
    } catch (e) {
      log({ evt: "tg_document", ok: false, error: String(e.message).slice(0, 150) });
      await reply(msg, `Не удалось обработать файл: ${String(e.message).slice(0, 150)}`);
    } finally {
      if (path) { try { unlinkSync(path); } catch { /* */ } }
    }
  }

  // ── Отправка файла пользователю: sendDocument (multipart) ──
  async function sendDocumentFile(msg, filePath) {
    const buf = readFileSync(filePath);
    const fd = new FormData();
    fd.set("chat_id", String(msg.chat.id));
    const tid = msg.message_thread_id;
    if (tid != null) fd.set("message_thread_id", String(tid));
    fd.set("document", new Blob([buf]), filePath.split("/").pop() || "file");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: fd, signal: AbortSignal.timeout(120_000) });
    return res.ok;
  }

  // ── Outbox: после обмена бот отправляет файлы, которые адъютант положил в ~/nabu/.nabu/outbox ──
  async function flushOutbox(msg) {
    const dir = join(nabuHome, ".nabu", "outbox");
    let files;
    try { files = readdirSync(dir).filter((f) => !f.startsWith(".")); } catch { return; }
    for (const f of files.slice(0, 5)) {
      const fp = join(dir, f);
      try {
        const ok = await sendDocumentFile(msg, fp);
        if (ok) { unlinkSync(fp); log({ evt: "tg_outbox_sent", file: f }); }
      } catch (e) { log({ evt: "tg_outbox_error", file: f, error: String(e.message).slice(0, 100) }); }
    }
  }

  // ── Фото → память: локальное извлечение текста (vision через Ollama или tesseract) ──
  // Ничего не уходит в облако: NABU_VISION_MODEL (напр. qwen2.5-vl) через локальный Ollama,
  // иначе tesseract; нет ни того ни другого — честный ответ с подсказкой.
  async function handlePhoto(msg, media) {
    const t0 = Date.now();
    let imgPath = null;
    try {
      await tg("sendChatAction", { chat_id: msg.chat.id, action: "typing", ...threadParams(msg) });
      if ((Number(media?.file_size) || 0) > TG_DOWNLOAD_LIMIT) {
        await reply(msg, `Изображение ~${Math.round(Number(media.file_size) / 1e6)} МБ — Telegram не даёт ботам скачивать файлы больше 20 МБ. Пришлите сжатее или меньшего размера.`);
        return;
      }
      const got = await tg("getFile", { file_id: media.file_id });
      const fp = got?.result?.file_path;
      if (!fp) { await reply(msg, "Telegram не отдал файл (вероятно, больше 20 МБ — лимит Bot API на скачивание). Пришлите меньшего размера."); return; }
      imgPath = await downloadVoice(fp); // тот же загрузчик: URL→tmp, лимит размера
      let text = "";
      let method = "";
      const vision = process.env.NABU_VISION_MODEL;
      if (vision) {
        try {
          const b64 = readFileSync(imgPath).toString("base64");
          const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
          const r = await fetch(`${base}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: vision,
              prompt: "Извлеки ВЕСЬ текст с изображения дословно. Если текста нет — опиши содержимое одним абзацем по-русски. Без вступлений.",
              images: [b64], stream: false, think: false, options: { num_predict: 800 },
            }),
            signal: AbortSignal.timeout(120_000),
          });
          if (r.ok) { const j = await r.json(); text = (j.response || j.thinking || "").trim(); method = `vision:${vision}`; }
        } catch { /* → tesseract */ }
      }
      if (!text) {
        const r = spawnSync("tesseract", [imgPath, "stdout", "-l", process.env.NABU_OCR_LANGS || "rus+eng"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
        if (!r.error && r.status === 0) { text = String(r.stdout || "").trim(); method = "tesseract"; }
      }
      if (!text) {
        await reply(msg, "Не смог извлечь текст: настройте NABU_VISION_MODEL (локальная vision-модель Ollama) или установите tesseract(-ocr).");
        return;
      }
      const caption = (msg.caption || "").trim();
      const content = `${caption ? caption + "\n\n" : ""}[из фото, ${method}]\n${text}`.slice(0, 20_000);
      await saveNote(msg, content);
      log({ evt: "tg_photo", ok: true, ms: Date.now() - t0, method, chars: text.length });
    } catch (e) {
      log({ evt: "tg_photo", ok: false, error: String(e.message).slice(0, 150) });
      await reply(msg, `Не удалось обработать фото: ${String(e.message).slice(0, 150)}`);
    } finally {
      if (imgPath) { try { unlinkSync(imgPath); } catch { /* */ } }
    }
  }

  // ── Per-topic конкурентность (аудит r2 §1.1) ──
  // Раньше цикл ПОЛНОСТЬЮ await'ил каждый апдейт: один 10-минутный claude-обмен замораживал
  // ВСЕ топики (и approvals-кнопки). Теперь: внутри одного топика — последовательно (resume-
  // сессии не рвутся), между топиками — параллельно; poll-насос не блокируется.
  const chains = new Map(); // threadKey -> хвост promise-цепочки топика
  function threadKeyOf(update) {
    if (update.callback_query) return "ctl"; // approvals/команды управления — своя быстрая цепочка
    const tid = update.message?.message_thread_id;
    return tid != null ? `t${tid}` : "main";
  }
  function dispatch(update) {
    const key = threadKeyOf(update);
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => handleUpdate(update))
      .catch((e) => log({ evt: "tg_handle_error", error: String(e?.message ?? e).slice(0, 200) }));
    chains.set(key, next);
    next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
  }

  // Меню команд Telegram (кнопка «/» в чате) — чтобы команды Nabu были видны и подсказывались.
  async function registerCommands() {
    // Telegram допускает в именах команд только [a-z0-9_] (дефис = BOT_COMMAND_INVALID).
    // Поэтому меню — с подчёркиваниями; при вызове нормализуем «_»→«-» к реальным командам Nabu.
    // Набрать вручную можно и через дефис (/nabu-tasks) — текст всё равно доходит и форвардится.
    const commands = [
      { command: "help", description: "Список команд и возможностей" },
      { command: "nabu_tasks", description: "Задачи и дела" },
      { command: "nabu_ask", description: "Вопрос Совету" },
      { command: "nabu_council", description: "Созвать Совет по сложному вопросу" },
      { command: "nabu_decide", description: "Помочь принять решение" },
      { command: "nabu_recall", description: "Поднять из памяти" },
      { command: "nabu_digest", description: "Сводка-дайджест" },
      { command: "nabu_research", description: "Исследовать тему (веб)" },
      { command: "nabu_metrics", description: "Метрики и прогресс" },
      { command: "nabu_triage", description: "Разобрать входящее/приоритеты" },
      { command: "nabu_agents", description: "Кто в Совете" },
      { command: "status", description: "Статус бота" },
      { command: "setup", description: "Создать темы форума" },
      { command: "approvals", description: "Ожидающие подтверждения" },
    ];
    // Повтор: одиночный вызов при старте может попасть на транзиентный сетевой сбой (fetch failed).
    for (let attempt = 0; attempt < 4 && !stopped; attempt++) {
      const r = await tg("setMyCommands", { commands }).catch(() => null);
      if (r?.ok) { log({ evt: "tg_commands_set", n: commands.length }); return; }
      await sleep(2000, undefined);
    }
    log({ evt: "tg_commands_set_failed" });
  }

  // ── Long-polling ──
  async function loop() {
    log({ evt: "tg_start", pinned, boundChatId: state.boundChatId });
    await registerCommands();
    while (!stopped) {
      const body = await tg(
        "getUpdates",
        { offset: state.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ["message", "callback_query"] },
        { timeoutMs: (POLL_TIMEOUT_S + 10) * 1000, signal: abort.signal },
      );
      if (stopped) break;
      if (!body) { await sleep(NET_BACKOFF_MS, abort.signal); continue; } // сеть/ошибка → backoff
      for (const update of body.result || []) {
        if (stopped) break;
        // Двигаем offset ДО обработки (anti-poison): апдейт не повторится даже при исключении.
        // Следствие (задокументировано): at-most-once — сообщение, прерванное рестартом демона
        // посреди обмена, не будет переспрошено; ответ на него не придёт.
        state.offset = update.update_id + 1;
        persist();
        dispatch(update);
      }
    }
    log({ evt: "tg_stop" });
  }

  // Запуск фонового цикла (не блокируем вызывающего).
  loop().catch((e) => log({ evt: "tg_loop_fatal", error: String(e.message).slice(0, 200) }));

  return {
    stop() {
      stopped = true;
      abort.abort();
      for (const c of liveChildren) {
        try { c.kill("SIGKILL"); } catch { /* уже мёртв */ }
      }
      liveChildren.clear();
    },
  };
}
