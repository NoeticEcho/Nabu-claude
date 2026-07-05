#!/usr/bin/env node
// nabu — zero-config CLI/демон Nabu-claude.
//
//   nabu init            первичная настройка: .env, docker-стек (pgvector+TypeDB[+Ollama]),
//                        схемы, модель эмбеддингов, smoke. Идемпотентно.
//   nabu start|stop      демон в фоне: планировщик agent-задач (claude -p), TTL-purge,
//                        проверка обновлений, встроенный веб-чат (http://127.0.0.1:4517).
//   nabu status|logs     состояние/лог демона и инфраструктуры.
//   nabu chat            открыть веб-чат (поднимет демон при необходимости).
//   nabu update          git pull --ff-only → npm install → build → рестарт демона.
//   nabu doctor          диагностика окружения.
//   nabu schedule …      list | enable <job> | disable <job>.
//   nabu install-service автозапуск: systemd (Linux) · launchd (macOS) · Task Scheduler (Windows).
//
// Ноль зависимостей (только node: builtins). Node ≥22. Всё локально: 127.0.0.1.
// Режимы: standalone (локальный docker-стек; по умолчанию при отсутствии .env)
// Режим один — standalone (локальный docker-стек); shared-режим удалён в v1.0.0.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, renameSync, unlinkSync, readdirSync, appendFileSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { homedir, platform } from "node:os";
import { createServer } from "node:net";
import { createWriteStream, createReadStream } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const NABU_HOME = process.env.NABU_HOME || join(homedir(), "nabu");
const STATE_DIR = join(NABU_HOME, ".nabu");
const ENV_PATH = process.env.NABU_ENV_PATH || join(REPO_ROOT, ".env");
const PID_FILE = join(STATE_DIR, "daemon.pid");
const LOG_FILE = join(STATE_DIR, "daemon.log");
// ── Живые конфиги пользователя — ВНЕ git (r3-M1): рантайм-правки (schedule enable, profiles add,
// календари, коннекторы) ломали `git pull` в nabu update. Репо хранит ШАБЛОНЫ (config/*),
// живые копии — в ~/nabu/.nabu/config/ (сеются при первом обращении; NABU_CONFIG_DIR переопределяет).
const CONFIG_DIR = process.env.NABU_CONFIG_DIR || join(NABU_HOME, ".nabu", "config");
function liveConfig(name) {
  const live = join(CONFIG_DIR, name);
  if (!existsSync(live)) {
    const tpl = join(REPO_ROOT, "config", name);
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      if (existsSync(tpl)) {
        const tmp = `${live}.${process.pid}.seed`;
        writeFileSync(tmp, readFileSync(tpl));
        renameSync(tmp, live); // атомарный посев: конкурентный читатель не увидит полфайла
      }
    } catch { /* нет прав/шаблона — читатели откатятся на шаблон */ }
  }
  return existsSync(live) ? live : join(REPO_ROOT, "config", name);
}
const SCHEDULE_FILE = liveConfig("schedule.json");
const SCHEDULE_STATE = join(STATE_DIR, "schedule-state.json");
const UPDATE_STATUS = join(STATE_DIR, "update-status.json");
const CHAT_PORT = Number(process.env.NABU_CHAT_PORT || 4517);
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
const EMBED_MODEL = "nomic-embed-text-v2-moe:latest";
// Узкий allowlist для headless-запусков claude (чат/расписание): MCP Nabu + чтение + субагенты.
import { ALLOWED_TOOLS } from "./claude-run.mjs";

// ── утилиты ──
const IS_WIN = platform() === "win32";
// Windows: npm/claude — это .cmd-шимы (spawnSync без shell не найдёт "npm"/"claude").
const NPM = IS_WIN ? "npm.cmd" : "npm";
const CLAUDE_BIN = IS_WIN ? "claude.cmd" : "claude";
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[36m", x: "\x1b[0m", d: "\x1b[2m" };
const ok = (m) => console.log(`${C.g}✓${C.x} ${m}`);
const warn = (m) => console.log(`${C.y}!${C.x} ${m}`);
const err = (m) => console.error(`${C.r}✗${C.x} ${m}`);
const info = (m) => console.log(`${C.b}·${C.x} ${m}`);
const die = (m, code = 1) => { err(m); process.exit(code); };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: r.status ?? -1, out: (r.stdout || "").trim(), errOut: (r.stderr || "").trim() };
}
/** Async-двойник sh(): для путей, живущих внутри демона (r3-M2 — spawnSync фризил event-loop:
 * ночной tar тома TypeDB на минуты убивал чат и TG). */
function shAsync(cmd, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { ...opts });
    let out = "";
    let errOut = "";
    child.stdout?.on("data", (d) => { out += d; });
    child.stderr?.on("data", (d) => { errOut += d; });
    child.on("error", (e) => res({ code: -1, out: out.trim(), errOut: (errOut + e.message).trim() }));
    child.on("close", (code) => res({ code: code ?? -1, out: out.trim(), errOut: errOut.trim() }));
  });
}
const has = (bin) => sh(platform() === "win32" ? "where" : "which", [bin]).code === 0;

function readEnvFile() {
  const map = {};
  if (!existsSync(ENV_PATH)) return map;
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) map[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return map;
}
function appendEnvKeys(pairs) {
  // НИКОГДА не перезаписываем существующие ключи — только дописываем недостающие.
  const existing = readEnvFile();
  const missing = Object.entries(pairs).filter(([k]) => existing[k] === undefined);
  if (!missing.length) return [];
  const block = missing.map(([k, v]) => `${k}=${v}`).join("\n");
  appendFileSync(ENV_PATH, (existsSync(ENV_PATH) && readFileSync(ENV_PATH, "utf8").length ? "\n" : "") + block + "\n");
  return missing.map(([k]) => k);
}
/** Upsert одного ключа в .env (в отличие от appendEnvKeys — перезаписывает существующий). */
function setEnvKey(key, value) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = text + (text && !text.endsWith("\n") ? "\n" : "") + line + "\n";
  writeFileSync(ENV_PATH, text);
}
function loadEnvIntoProcess() {
  for (const [k, v] of Object.entries(readEnvFile())) if (process.env[k] === undefined) process.env[k] = v;
  applyProfile();
}

/**
 * Мульти-профиль (Горизонт-2, v1): config/profiles.json задаёт именованные пространства
 * (namespace/user_id[/telegram_chat_id]). --profile X или NABU_PROFILE=X переопределяет
 * NABU_NAMESPACE/NABU_USER_ID до инициализации lib. Один демон = один профиль (второй
 * профиль в фоне = второй NABU_HOME + порт, см. docs). Память/approvals полностью раздельны.
 */
let profileApplied = false;
function applyProfile() {
  if (profileApplied) return;
  profileApplied = true;
  const name = globalThis.__nabuProfileFlag || process.env.NABU_PROFILE;
  if (!name) return;
  const cfg = readJson(liveConfig("profiles.json"), null);
  const prof = cfg?.profiles?.[name];
  if (!prof) {
    die(`Профиль '${name}' не найден в config/profiles.json`);
  }
  if (!prof.namespace || !prof.user_id) {
    die(`Профиль '${name}' неполный: нужны И namespace, И user_id (иначе межпрофильная утечка). Создайте корректно: nabu profiles add ${name}`);
  }
  process.env.NABU_NAMESPACE = prof.namespace;
  process.env.NABU_USER_ID = prof.user_id;
  if (prof.telegram_chat_id) process.env.TELEGRAM_CHAT_ID = String(prof.telegram_chat_id);
  info(`Профиль: ${name} (namespace=${prof.namespace ?? "—"})`);
}
function detectMode() {
  // Nabu — standalone-only (решение v1.0.0): вся БД живёт в локальном docker-стеке.
  const env = readEnvFile();
  return env.DATABASE_URL ? "standalone" : "none";
}
const composeArgs = (extra, profile = false) => ["compose", "-f", join(REPO_ROOT, "docker-compose.yml"), ...(profile ? ["--profile", "ollama"] : []), ...extra];
function dockerAvailable() { return has("docker") && sh("docker", ["info"]).code === 0; }
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };
// uniq tmp = pid+uuid: не топчут файл ни два процесса (демон+бот), ни параллельные fire-and-forget
// записи В ОДНОМ процессе (job-results/proactivity/schedule-state) — иначе torn-file/ENOENT (R6-M13).
function writeJson(p, v) { const t = `${p}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(t, JSON.stringify(v, null, 2)); renameSync(t, p); }
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function daemonPid() { const pid = Number(readFileSync(PID_FILE, "utf8").trim() || 0); return pid && pidAlive(pid) ? pid : null; }
const safeDaemonPid = () => { try { return daemonPid(); } catch { return null; } };

/** Интерактивное подтверждение y/N (флаг --yes пропускает). Не-TTY без --yes = отказ. */
async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    err("Нужно подтверждение, но нет интерактивного терминала. Добавьте --yes.");
    return false;
  }
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

/** Рекурсивное удаление (best-effort). */
function rmrf(p) {
  try { rmSync(p, { recursive: true, force: true }); return true; } catch { return false; }
}

/** Порт свободен на 127.0.0.1? */
function portFree(port) {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.once("listening", () => s.close(() => res(true)));
    s.listen(port, "127.0.0.1");
  });
}
/** Первый свободный порт начиная с start (start, start+1, …). */
async function pickPort(start) {
  for (let p = start; p < start + 50; p++) if (await portFree(p)) return p;
  return start;
}

// ── init ──
async function cmdInit(flags) {
  console.log(`\n${C.b}Nabu zero-config init${C.x} (repo: ${REPO_ROOT})\n`);
  mkdirSync(STATE_DIR, { recursive: true });

  // 0. Предусловия
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) die(`Нужен Node ≥22 (сейчас ${process.versions.node})`);
  ok(`Node ${process.versions.node}`);

  let mode = detectMode();
  // r3-C1: свежая установка (.env ещё нет → mode="none") — это ИМЕННО тот случай, ради
  // которого init существует. Nabu standalone-only: init всегда ведёт к standalone.
  if (mode !== "standalone") mode = "standalone";

  // 1. .env (только недостающие ключи; пароли генерируются; порты — свободные,
  //    чтобы не конфликтовать с уже работающими postgres/typedb/ollama на машине)
  if (mode === "standalone") {
    const prev = readEnvFile();
    const pgPass = prev.NABU_PG_PASSWORD || randomBytes(18).toString("base64url");
    const pgPort = prev.NABU_PG_PORT || (await pickPort(5433));
    const tdbHttp = prev.NABU_TYPEDB_HTTP_PORT || (await pickPort(8000));
    const tdbGrpc = prev.NABU_TYPEDB_GRPC_PORT || (await pickPort(1729));
    const ollamaPort = prev.NABU_OLLAMA_PORT || (has("ollama") ? 11434 : await pickPort(11434));
    if (String(tdbHttp) !== "8000") warn(`Порт 8000 занят (вероятно, ваш TypeDB) — стек Nabu займёт ${tdbHttp}`);
    const added = appendEnvKeys({
      NABU_MODE: "standalone",
      NABU_PG_PASSWORD: pgPass,
      NABU_PG_PORT: pgPort,
      NABU_TYPEDB_HTTP_PORT: tdbHttp,
      NABU_TYPEDB_GRPC_PORT: tdbGrpc,
      NABU_OLLAMA_PORT: ollamaPort,
      DATABASE_URL: `postgres://nabu:${pgPass}@127.0.0.1:${pgPort}/nabu?sslmode=disable`,
      TYPEDB_URL: `http://127.0.0.1:${tdbHttp}`,
      TYPEDB_DATABASE: "nabu",
      TYPEDB_USERNAME: "admin",
      TYPEDB_PASSWORD: "password",
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`,
      OLLAMA_EMBED_MODEL: EMBED_MODEL,
      NABU_NAMESPACE: "default",
      NABU_USER_ID: DEFAULT_USER_ID,
    });
    added.length ? ok(`.env: добавлены ключи ${added.join(", ")}`) : ok(".env: все ключи уже на месте (не перезаписываю)");
  }
  // Ключ vault-шифрования (P2): машинный, генерируется в ЛЮБОМ режиме, если отсутствует.
  const vaultAdded = appendEnvKeys({ NABU_VAULT_KEY: randomBytes(32).toString("base64url") });
  if (vaultAdded.length) warn("Создан NABU_VAULT_KEY (шифрование vault). СОХРАНИТЕ .env: потеря ключа = потеря vault-записей.");
  loadEnvIntoProcess();

  // 2. Docker-стек (standalone)
  const needOllamaContainer = !has("ollama");
  if (mode === "standalone") {
    if (!dockerAvailable()) die("Docker недоступен. Установите Docker (https://docs.docker.com/engine/install/) и повторите nabu init.");
    info("Поднимаю docker-стек (postgres+typedb" + (needOllamaContainer ? "+ollama" : "") + ")…");
    const up = sh("docker", composeArgs(["up", "-d", "--wait"], needOllamaContainer), { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
    if (up.code !== 0) die("docker compose up не удался (см. вывод выше)");
    ok("Инфраструктура запущена (127.0.0.1: pg=5433, typedb=8000/1729" + (needOllamaContainer ? ", ollama=11434" : "") + ")");

    // 2.5 Живые конфиги (r3-M1): посеять все шаблоны в ~/nabu/.nabu/config/, чтобы пользователь
  // редактировал ИХ (правки в репо ломали nabu update).
  for (const cf of ["schedule.json", "profiles.json", "integrations.json", "nabu.config.json"]) {
    liveConfig(cf);
  }
  info(`Конфиги пользователя: ${CONFIG_DIR} (репо хранит только шаблоны)`);

  // 3. Схемы Postgres (000 standalone bootstrap + 001..007, все идемпотентны)
    const schemaDir = join(REPO_ROOT, "schema", "postgres");
    const files = readdirSync(schemaDir).filter((f) => f.endsWith(".sql")).sort();
    // Свежий том: PG-entrypoint после healthcheck ещё секунды создаёт БД/перезапускается
    // ("database nabu does not exist" / "system is shutting down") — ретраим транзиенты.
    for (const f of files) {
      let r = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        r = spawnSync("docker", ["exec", "-i", "nabu-postgres", "psql", "-h", "127.0.0.1", "-U", "nabu", "-d", "nabu", "-v", "ON_ERROR_STOP=1", "-q"], {
          input: readFileSync(join(schemaDir, f)), encoding: "utf8",
        });
        if (r.status === 0) break;
        const transient = /does not exist|shutting down|starting up|Connection refused|could not connect/i.test(r.stderr || "");
        if (!transient || attempt === 5) break;
        info(`PG ещё стартует (попытка ${attempt}/5)…`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
      }
      if (r.status !== 0) die(`Схема ${f} не применилась: ${(r.stderr || "").slice(0, 800)}`);
      ok(`Схема применена: ${f}`);
    }

    // 4. TypeDB: база + схема (best-effort — при неудаче Nabu работает в Postgres-fallback)
    await ensureTypeDb();
  }

  // 5. Ollama + модель
  await ensureOllama(needOllamaContainer, flags.noModel);

  // Инвентаризация железа (по просьбе: init оценивает возможности машины под локальные модели).
  try {
    const hw = await import("./hardware.mjs");
    const inv = hw.inventory();
    info(`Железо: ${hw.describeHardware(inv)}`);
    const rec = hw.recommend(inv);
    if (rec.chat) info(`Локальный мозг (offline) — рекомендую ${rec.chat.name} (${hw.speedNote(inv, rec.chat)}). Выбор/установка: nabu models`);
    else info("Для локального мозга не хватает памяти — offline-режим будет ограничен. Каталог: nabu models");
  } catch { /* инвентаризация не критична */ }

  // 6. Сборка (если dist отсутствует)
  if (!existsSync(join(REPO_ROOT, "lib", "dist", "index.js"))) {
    info("Собираю (npm run build)…");
    const b = sh(NPM, ["run", "build"], { cwd: REPO_ROOT, stdio: ["ignore", "inherit", "inherit"] });
    if (b.code !== 0) die("npm run build не удался");
  }
  ok("Сборка на месте (lib/dist)");

  // 7. Расписание по умолчанию
  ensureScheduleFile();

  // 8. Smoke
  info("Smoke-тест (Postgres, Ollama, память, TypeDB)…");
  const smoke = sh(process.execPath, ["--env-file=" + ENV_PATH, join(REPO_ROOT, "lib", "dist", "smoke.js")], { cwd: REPO_ROOT });
  if (smoke.code === 0) { console.log(C.d + smoke.out.split("\n").slice(-12).join("\n") + C.x); ok("Smoke пройден"); }
  else warn("Smoke не прошёл (не блокирует): " + (smoke.errOut || smoke.out).slice(0, 400));

  console.log(`\n${C.g}Готово.${C.x} Дальше:\n  nabu start   — демон (расписание + веб-чат)\n  nabu chat    — открыть чат (http://127.0.0.1:${CHAT_PORT})\n  nabu status  — состояние\n`);
}

async function ensureTypeDb() {
  const env = readEnvFile();
  const base = (env.TYPEDB_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  try {
    const si = await fetch(`${base}/v1/signin`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: env.TYPEDB_USERNAME || "admin", password: env.TYPEDB_PASSWORD || "password" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!si.ok) throw new Error(`signin ${si.status}`);
    const { token } = await si.json();
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const dbName = env.TYPEDB_DATABASE || "nabu";
    const list = await fetch(`${base}/v1/databases`, { headers: auth, signal: AbortSignal.timeout(8000) });
    const names = JSON.stringify(await list.json().catch(() => ({})));
    if (!names.includes(`"${dbName}"`)) {
      const mk = await fetch(`${base}/v1/databases/${dbName}`, { method: "POST", headers: auth, signal: AbortSignal.timeout(15000) });
      if (!mk.ok) throw new Error(`create db ${mk.status}`);
      ok(`TypeDB: база '${dbName}' создана`);
    } else ok(`TypeDB: база '${dbName}' уже есть`);
    // Порядок применения ЯВНЫЙ (не алфавитный): 000_base (concept+concept-name) →
    // memory.tql (mention/participation/name/visibility/…) → 002_domain (зависит от memory.tql)
    // → остальные по алфавиту. define в 3.x аддитивен/идемпотентен.
    const tqlDir = join(REPO_ROOT, "schema", "typedb");
    const KNOWN_ORDER = ["000_standalone_base.tql", "memory.tql", "002_standalone_domain.tql"];
    const all = readdirSync(tqlDir).filter((x) => x.endsWith(".tql"));
    const ordered = [...KNOWN_ORDER.filter((f) => all.includes(f)), ...all.filter((f) => !KNOWN_ORDER.includes(f)).sort()];
    for (const f of ordered) {
      const q = await fetch(`${base}/v1/query`, {
        method: "POST", headers: auth,
        body: JSON.stringify({ databaseName: dbName, transactionType: "schema", query: readFileSync(join(tqlDir, f), "utf8") }),
        signal: AbortSignal.timeout(30000),
      });
      if (q.ok) ok(`TypeDB: схема применена (${f})`);
      else { warn(`TypeDB: схема ${f} не применилась (${q.status}: ${(await q.text().catch(() => "")).slice(0, 200)}) — граф в Postgres-fallback`); return; }
    }
  } catch (e) {
    warn(`TypeDB недоступен (${e.message}) — Nabu работает в Postgres-fallback (граф отключён)`);
  }
}

async function ensureOllama(containerMode, noModel) {
  const base = readEnvFile().OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const ping = async () => { try { return (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
  if (!(await ping())) {
    if (containerMode) { warn("Ollama-контейнер ещё поднимается…"); await new Promise((r) => setTimeout(r, 5000)); }
    else if (has("ollama")) {
      info("Запускаю локальный ollama serve (фоном)…");
      const fd = openSync(join(STATE_DIR, "ollama.log"), "a");
      spawn("ollama", ["serve"], { detached: true, stdio: ["ignore", fd, fd] }).unref();
      for (let i = 0; i < 20 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!(await ping())) return warn("Ollama недоступен — эмбеддинги не заработают, пока не поднимете его (ollama serve)");
  ok("Ollama доступен");
  if (noModel) return;
  const tags = await (await fetch(`${base}/api/tags`)).json().catch(() => ({ models: [] }));
  const model = readEnvFile().OLLAMA_EMBED_MODEL || EMBED_MODEL;
  if ((tags.models || []).some((m) => (m.name || "").startsWith(model.split(":")[0]))) return ok(`Модель ${model} уже установлена`);
  info(`Скачиваю модель ${model} (однократно, может занять время)…`);
  const res = await fetch(`${base}/api/pull`, { method: "POST", body: JSON.stringify({ name: model }) });
  if (!res.ok || !res.body) return warn(`Не удалось начать загрузку модели (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let last = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      try { const j = JSON.parse(line); if (j.status && j.status !== last) { process.stdout.write(`\r  ${j.status}${j.total ? ` ${(100 * (j.completed || 0) / j.total).toFixed(0)}%` : ""}   `); last = j.status; } } catch { /* ignore */ }
    }
  }
  console.log("");
  ok(`Модель ${model} готова`);
}

const DEFAULT_JOBS = [
  { name: "triage", prompt: "/nabu-triage", at: "08:30", everyDays: 1, enabled: false },
  { name: "consolidate", prompt: "/nabu-consolidate", at: "21:30", everyDays: 1, enabled: false },
  { name: "digest", prompt: "/nabu-digest неделя", at: "09:00", everyDays: 7, enabled: false },
  { name: "feedback", prompt: "/nabu-feedback", at: "19:00", everyDays: 3, enabled: false },
  { name: "scout", prompt: "/nabu-scout", at: "10:00", everyDays: 7, enabled: false },
  { name: "backup", internal: "backup", at: "03:30", everyDays: 1, enabled: false, push: false },
  { name: "chat-retention", internal: "chat-retention", at: "04:00", everyDays: 7, enabled: false, push: false, days: 180 },
  // Утренний брифинг: детерминированная сборка дня (погода/календарь/задачи/привычки/намерения)
  // БЕЗ Claude — быстро, бесплатно, надёжно. lat/lon — координаты для погоды (опционально).
  { name: "briefing", internal: "briefing", at: "08:00", everyDays: 1, enabled: false, push: true, lat: null, lon: null },
  // Напоминания: намерения (prospective) с наступившим сроком → push. Дёшево, без Claude.
  { name: "reminders", internal: "reminders", at: "09:30", everyDays: 1, enabled: false, push: true },
  // Гигиена памяти: протухшие намерения → expired, точные дубли фактов, истёкшая рабочая память.
  { name: "memory-hygiene", internal: "memory-hygiene", at: "05:00", everyDays: 30, enabled: false, push: true },
  // Самопроверка: deepChecks() → push ТОЛЬКО при предупреждениях.
  { name: "healthcheck", internal: "healthcheck", at: "07:00", everyDays: 7, enabled: false, push: true },
  // Нарратив глав жизни (Горизонт-1): ежемесячно рефлектор сводит эпизоды месяца в главу
  // автобиографии (save_narrative). Agent-задача — квота Claude, включать осознанно.
  { name: "life-narrative", at: "20:00", everyDays: 30, enabled: false, push: true,
    prompt: "Ты — reflector Nabu. Подними эпизоды и факты за последние 30 дней (recall + list_recent), сведи их в связную главу автобиографии пользователя: главные события, изменения, настроение периода, открытые нити. Сохрани nabu-memory.save_narrative({ period: '<YYYY-MM>', narrative }) и верни главу пользователю. Только реальные события из памяти — ничего не выдумывать; мало данных — честно короткая глава." },
  // Ритуалы масштаба (Горизонт-2): квартальный и годовой обзоры поверх еженедельного.
  { name: "quarterly-review", at: "19:00", everyDays: 90, enabled: false, push: true,
    prompt: "Квартальный обзор жизни: подними автобиографические главы (recall kinds autobiographical) и состояние целей/проектов за ~90 дней. Траектория: что выросло, что заглохло, какие цели пора пересмотреть или похоронить честно. 3 вопроса пользователю для переосмысления квартала. Сохрани главу save_narrative({period: '<YYYY-Qн>'}). Только реальные данные памяти." },
  { name: "yearly-review", at: "19:00", everyDays: 365, enabled: false, push: true,
    prompt: "Годовой обзор жизни: сведи главы автобиографии года в историю — арки, поворотные точки, кем пользователь становился. Что унести в следующий год, что оставить. Сохрани save_narrative({period: '<YYYY>'}). Тепло, честно, без пафоса; данные — только из памяти." },
  // Еженедельный обзор жизни (agent-задача, тратит квоту Claude — включать осознанно).
  { name: "weekly-review", at: "18:00", everyDays: 7, enabled: false, push: true,
    prompt: "Проведи еженедельный обзор жизни пользователя: подними память и текущее состояние (задачи/цели/привычки/метрики за 7 дней), сравни с прошлой неделей, отметь 2-3 победы и 1-2 узких места, задай один вопрос для рефлексии. Запиши итог эпизодом (remember_episode, private). Кратко, тепло, без давления — финальные выводы за пользователем." },
];

function ensureScheduleFile() {
  if (!existsSync(SCHEDULE_FILE)) {
    writeJson(SCHEDULE_FILE, {
      _readme: "Расписание задач демона. enabled:true включает. at=HH:MM, everyDays=минимум суток между запусками. Agent-задачи (prompt) тратят квоту Claude — включайте осознанно (nabu schedule enable <name>). internal-задачи (backup) — локальные, бесплатные. push:false отключает отправку итога в Telegram.",
      auto_update: false,
      jobs: DEFAULT_JOBS,
    });
    ok("Создано расписание по умолчанию: config/schedule.json (все задачи выключены)");
    return;
  }
  // Мягкая миграция: дописываем НОВЫЕ дефолтные задачи (выключенными), не трогая настроенные.
  const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
  const have = new Set((cfg.jobs || []).map((j) => j.name));
  const added = DEFAULT_JOBS.filter((j) => !have.has(j.name));
  if (added.length) {
    cfg.jobs = [...(cfg.jobs || []), ...added];
    writeJson(SCHEDULE_FILE, cfg);
    ok(`Расписание: добавлены новые задачи (выключены): ${added.map((j) => j.name).join(", ")}`);
  }
}

// ── демон ──
async function cmdDaemon() {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
  loadEnvIntoProcess();
  const log = (m) => appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${m}\n`);
  log(`daemon start pid=${process.pid}`);
  try { ensureScheduleFile(); } catch (e) { log(`schedule migrate: ${e.message}`); } // новые DEFAULT_JOBS доезжают после update без re-init
  let tgStop = null; // handle остановки TG-бота — используется в bye()

  // Встроенный веб-чат. Retry на EADDRINUSE: при self-restart (auto-update) старый демон
  // ещё держит порт ~секунду — раньше чат просто умирал до ручного рестарта.
  try {
    const { startChatServer } = await import("./chat-server.mjs");
    let lastErr = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const { url } = await startChatServer({ port: CHAT_PORT, repoRoot: REPO_ROOT, nabuHome: NABU_HOME });
        log(`chat server: ${url}${attempt > 1 ? ` (попытка ${attempt})` : ""}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (e && e.code === "EADDRINUSE") { await new Promise((r) => setTimeout(r, 1000)); continue; }
        break;
      }
    }
    if (lastErr) log(`chat server FAILED: ${lastErr.message}`);
  } catch (e) { log(`chat server FAILED: ${e.message}`); }

  // Telegram-бот (опционально: включается TELEGRAM_BOT_TOKEN в .env)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      // Гарантируем mcp-config даже если чат-сервер не стартанул (бот берёт его для headless claude).
      try {
        const { ensureMcpConfig } = await import("./chat-server.mjs");
        ensureMcpConfig(NABU_HOME, REPO_ROOT);
      } catch { /* не критично: бот проверит наличие файла сам */ }
      const { startTelegramBot } = await import("./telegram-bot.mjs");
      const bot = startTelegramBot({
        repoRoot: REPO_ROOT,
        nabuHome: NABU_HOME,
        log: (evt) => log(`tg: ${JSON.stringify(evt)}`),
      });
      tgStop = bot.stop; // bye() обязан звать stop(): иначе дети-процессы сиротеют при рестарте
      log("telegram bot: запущен (long-polling)");
    } catch (e) { log(`telegram bot FAILED: ${e.message}`); }
  }

  let lastPurge = 0, lastUpdateCheck = 0;
  const tick = async () => {
    const now = Date.now();
    // 1. Планировщик agent-задач
    try {
      const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
      const state = readJson(SCHEDULE_STATE, {});
      for (const job of cfg.jobs || []) {
        if (!job.enabled || !job.at) continue;
        if (!/^\d{1,2}:\d{2}$/.test(job.at)) { log(`scheduler: у задачи '${job.name}' некорректное at='${job.at}' (нужно HH:MM) — пропущена`); continue; }
        const [hh, mm] = job.at.split(":").map(Number);
        const todayAt = new Date(); todayAt.setHours(hh, mm, 0, 0);
        const last = state[job.name] || 0;
        const minGap = ((job.everyDays || 1) * proactivityMult(job.name) - 0.5) * 86_400_000;
        if (now >= todayAt.getTime() && last < todayAt.getTime() && now - last >= minGap) {
          state[job.name] = now; writeJson(SCHEDULE_STATE, state);
          if (job.internal === "backup") {
            log(`job start: ${job.name} (internal backup)`);
            cmdBackup({}, (m) => log(`backup: ${m}`))
              .then((r) => { if (r.failed.length) log(`backup: провалено — ${r.failed.join(", ")}`); })
              .catch((e) => log(`backup error: ${e.message}`));
          } else if (job.internal === "briefing") {
            log(`job start: ${job.name} (internal briefing)`);
            buildBriefing(job, log)
              .then((text) => {
                try {
                  const rf = join(STATE_DIR, "job-results.json");
                  const all = readJson(rf, {});
                  all[job.name] = { at: new Date().toISOString(), exit: 0, costUsd: 0, result: text.slice(0, 4000) };
                  writeJson(rf, all);
                } catch { /* */ }
                if (job.push !== false) pushToTelegram(text, log, job.name).catch((e) => log(`briefing push: ${e.message}`));
              })
              .catch((e) => log(`briefing error: ${e.message}`));
          } else if (job.internal === "reminders") {
            log(`job start: ${job.name} (internal reminders)`);
            (async () => {
              let deps = null;
              try {
                const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
                deps = lib.buildDeps();
                const due = (await deps.memory.listProspective()).filter((it) => it.triggerAt && Date.parse(it.triggerAt) <= Date.now());
                if (due.length && job.push !== false) {
                  const lines = due.slice(0, 10).map((it) => `  • ${String(it.intent).slice(0, 80)}`);
                  await pushToTelegram(`⏰ Напоминания (${due.length}):\n${lines.join("\n")}\n\nОтметить сделанным/отложить — скажите адъютанту.`, log, job.name);
                }
                log(`reminders: due=${due.length}`);
              } catch (e) { log(`reminders error: ${e.message}`); }
              finally { if (deps) await deps.pg.close().catch(() => { /* */ }); }
            })();
          } else if (job.internal === "memory-hygiene") {
            log(`job start: ${job.name} (internal hygiene)`);
            (async () => {
              let deps = null;
              try {
                const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
                deps = lib.buildDeps();
                const expired = await deps.memory.expireStaleProspective(job.staleDays ?? 30);
                const deduped = await deps.memory.dedupSemanticFacts();
                const purged = await deps.memory.purgeExpiredWorking?.() ?? 0;
                const msg = `🧹 Гигиена памяти: намерений истекло ${expired}, дублей фактов удалено ${deduped}, рабочей памяти вычищено ${purged}. Воспоминания не удалялись.`;
                log(msg);
                if (job.push !== false && (expired || deduped)) await pushToTelegram(msg, log);
              } catch (e) { log(`hygiene error: ${e.message}`); }
              finally { if (deps) await deps.pg.close().catch(() => { /* */ }); }
            })();
          } else if (job.internal === "healthcheck") {
            log(`job start: ${job.name} (internal healthcheck)`);
            deepChecks()
              .then((warns) => {
                log(`healthcheck: warnings=${warns.length}`);
                if (warns.length && job.push !== false) {
                  return pushToTelegram(`🩺 Nabu healthcheck — предупреждения:\n${warns.map((w) => "  • " + w).join("\n")}`, log);
                }
              })
              .catch((e) => log(`healthcheck error: ${e.message}`));
          } else if (job.internal === "chat-retention") {
            log(`job start: ${job.name} (internal, > ${job.days ?? 180}д)`);
            (async () => {
              let deps = null;
              try {
                const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
                deps = lib.buildDeps();
                const n = await deps.memory.purgeChatHistory(job.days ?? 180);
                log(`chat-retention: удалено ${n} сообщений истории`);
              } catch (e) { log(`chat-retention error: ${e.message}`); }
              finally { if (deps) await deps.pg.close().catch(() => { /* */ }); }
            })();
          } else if (job.prompt) {
            log(`job start: ${job.name} (${job.prompt})`);
            runClaudeJob(job, log);
          }
        }
      }
    } catch (e) { log(`scheduler error: ${e.message}`); }
    // 2. TTL-purge рабочей памяти (раз в час, бесплатно)
    if (now - lastPurge > 3_600_000) {
      lastPurge = now;
      let deps = null;
      try {
        const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
        deps = lib.buildDeps();
        const n = await deps.memory.purgeExpiredWorking();
        if (n) log(`purge: удалено ${n} истёкших working-записей`);
      } catch (e) { log(`purge error: ${e.message}`); }
      finally { if (deps) await deps.pg.close().catch(() => { /* пул не должен утечь */ }); }
    }
    // 3. Проверка обновлений (раз в сутки)
    if (now - lastUpdateCheck > 86_400_000) {
      lastUpdateCheck = now;
      try {
        sh("git", ["-C", REPO_ROOT, "fetch", "--quiet"]);
        const behind = Number(sh("git", ["-C", REPO_ROOT, "rev-list", "--count", "HEAD..@{u}"]).out || 0);
        writeJson(UPDATE_STATUS, { checkedAt: new Date().toISOString(), behind });
        if (behind > 0) {
          log(`update: доступно ${behind} коммит(ов)`);
          if (readJson(SCHEDULE_FILE, {}).auto_update) { log("auto_update=true → обновляюсь"); doUpdate(log, { inDaemon: true }); }
        }
      } catch (e) { log(`update check error: ${e.message}`); }
    }
  };
  await tick();
  const timer = setInterval(tick, 30_000);
  const bye = () => {
    clearInterval(timer);
    try { tgStop?.(); } catch { /* бот мог не стартовать */ }
    // Удаляем pidfile ТОЛЬКО если он всё ещё наш: при рестарте (update) новый демон уже
    // мог записать туда свой pid — иначе стирали бы чужой pidfile (гонка self-restart).
    try {
      if (Number(readFileSync(PID_FILE, "utf8").trim()) === process.pid) unlinkSync(PID_FILE);
    } catch { /* */ }
    log("daemon stop");
    process.exit(0);
  };
  process.on("SIGTERM", bye); process.on("SIGINT", bye);
}

function runClaudeJob(job, log) {
  const logPath = join(STATE_DIR, `job-${job.name}.log`);
  // Явный MCP-конфиг: headless claude не поднимает MCP-серверы плагина сам (см. chat-server).
  const mcpCfg = join(STATE_DIR, "mcp-config.json");
  // --output-format json: единый JSON с полем result — чтобы итог можно было запушить
  // пользователю (Telegram) и сохранить в job-results.json (проактивность, ROADMAP P0-3).
  const args = ["-p", job.prompt, "--output-format", "json", ...(existsSync(mcpCfg) ? ["--mcp-config", mcpCfg] : []), "--allowedTools", ALLOWED_TOOLS];
  const child = spawn(CLAUDE_BIN, args, {
    cwd: existsSync(NABU_HOME) ? NABU_HOME : REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env, windowsHide: true,
  });
  let out = "";
  let errTail = "";
  // spawn-ошибка (claude не в PATH) без обработчика РОНЯЛА демон — теперь лог + запись результата.
  child.on("error", (e) => {
    log(`job spawn error: ${job.name}: ${e.message}`);
    try {
      const rf = join(STATE_DIR, "job-results.json");
      const all = readJson(rf, {});
      all[job.name] = { at: new Date().toISOString(), exit: -1, costUsd: null, result: null, error: e.message };
      writeJson(rf, all);
    } catch { /* */ }
  });
  child.stdout.on("data", (d) => { out += d; if (out.length > 2_000_000) out = out.slice(-2_000_000); });
  child.stderr.on("data", (d) => { errTail = (errTail + d).slice(-2000); });
  const t0 = Date.now();
  child.on("exit", (code) => {
    appendFileSync(logPath, `\n[${new Date().toISOString()}] exit=${code} ms=${Date.now() - t0}\n${out}\n${errTail ? "stderr: " + errTail + "\n" : ""}`);
    log(`job done: ${job.name} exit=${code}`);
    let resultText = null;
    let costUsd = null;
    try {
      const j = JSON.parse(out.trim().split("\n").pop());
      resultText = typeof j.result === "string" ? j.result : null;
      costUsd = j.total_cost_usd ?? null;
    } catch { /* не-JSON вывод — просто нет пуша */ }
    // Итоги — в durable-файл (для UI/CLI) + push в Telegram (если настроен и не отключён у джоба)
    try {
      const rf = join(STATE_DIR, "job-results.json");
      const all = readJson(rf, {});
      all[job.name] = { at: new Date().toISOString(), exit: code, costUsd, result: resultText ? resultText.slice(0, 8000) : null };
      writeJson(rf, all);
    } catch { /* */ }
    if (resultText && job.push !== false) {
      pushToTelegram(`📋 ${job.name}\n\n${resultText}`, log, job.name).catch((e) => log(`push error: ${e.message}`));
    }
  });
}

/**
 * Проактивный push итога в привязанный Telegram-чат (тема «Адъютант», если есть).
 * Работает без модуля бота: токен из env + state-файл бота (boundChatId/topics).
 */
// ── Утренний брифинг: детерминированная сборка дня (internal-джоба "briefing") ──
// Каждая секция деградирует независимо: нет данных/сервиса — секция просто пропускается.
async function buildBriefing(job, log) {
  const parts = [];
  const today = new Date();
  parts.push(`🌅 Брифинг — ${today.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}`);

  // Погода (Open-Meteo напрямую, без ключа; координаты — в самой джобе schedule.json)
  if (job.lat != null && job.lon != null) {
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${job.lat}&longitude=${job.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
      const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        const j = await r.json();
        const cur = j.current?.temperature_2m;
        const max = j.daily?.temperature_2m_max?.[0];
        const min = j.daily?.temperature_2m_min?.[0];
        const rain = j.daily?.precipitation_probability_max?.[0];
        parts.push(`☀️ Погода: сейчас ${cur}°C, днём ${min}…${max}°C${rain != null ? `, осадки ${rain}%` : ""}`);
      }
    } catch (e) { log(`briefing weather: ${e.message}`); }
  }

  let lib = null;
  let deps = null;
  try {
    lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
    deps = lib.buildDeps();
  } catch (e) { log(`briefing lib: ${e.message}`); }

  // Календарь (ICS-источники из config/nabu.config.json, если модуль и конфиг есть)
  try {
    if (lib?.loadCalendars) {
      const cfg = readJson(liveConfig("nabu.config.json"), {});
      const sources = cfg?.calendar?.ics_sources ?? [];
      if (sources.length) {
        const { events } = await lib.loadCalendars(sources, { horizonDays: 1 });
        const dayStr = today.toISOString().slice(0, 10);
        const todays = events.filter((e) => String(e.start).slice(0, 10) === dayStr).slice(0, 8);
        if (todays.length) {
          parts.push("📅 Календарь:");
          for (const e of todays) {
            const t = e.allDay ? "весь день" : String(e.start).slice(11, 16);
            parts.push(`  • ${t} — ${e.summary}`);
          }
        }
      }
    }
  } catch (e) { log(`briefing calendar: ${e.message}`); }

  // Задачи · привычки · намерения (живое состояние из БД)
  if (deps) {
    try {
      const tasks = (await deps.domain.listTasks({})).filter((t) => !["done", "completed", "cancelled"].includes(String(t.status))).slice(0, 7);
      if (tasks.length) {
        parts.push(`✅ Задачи (${tasks.length} откр.):`);
        for (const t of tasks.slice(0, 5)) parts.push(`  • ${String(t.title ?? t.name ?? "").slice(0, 60)}`);
      }
    } catch (e) { log(`briefing tasks: ${e.message}`); }
    try {
      const habits = (await deps.domain.listHabits(true)).slice(0, 6);
      if (habits.length) parts.push(`🔁 Привычки: ${habits.map((h) => String(h.name ?? h.title ?? "").slice(0, 25)).join(" · ")}`);
    } catch (e) { log(`briefing habits: ${e.message}`); }
    try {
      const pros = (await deps.memory.listProspective()).slice(0, 5);
      if (pros.length) {
        parts.push("🎯 Намерения:");
        for (const it of pros) parts.push(`  • ${String(it.intent).slice(0, 70)}${it.triggerAt ? ` (${String(it.triggerAt).slice(0, 10)})` : ""}`);
      }
    } catch (e) { log(`briefing prospective: ${e.message}`); }
    try { await deps.pg.close(); } catch { /* */ }
  }

  if (parts.length === 1) parts.push("Данных для брифинга пока нет — настройте координаты/календарь/задачи.");
  parts.push("\nХорошего дня! Отвечайте в этот топик — я на связи.");
  return parts.join("\n");
}

const PROACTIVITY_FILE = () => join(STATE_DIR, "proactivity.json");

/** Обучаемая проактивность (Горизонт-2): множитель интервала per-джоба. */
function proactivityState() {
  return readJson(PROACTIVITY_FILE(), {});
}
function proactivityMult(jobName) {
  const p = proactivityState()[jobName];
  return Math.min(4, Math.max(1, Number(p?.mult) || 1));
}
/** Учёт отправленного push: 3 подряд без «👍» → интервал ×2 (cap ×4). Тихая забота. */
function recordProactivePush(jobName, log) {
  try {
    const st = proactivityState();
    const j = st[jobName] ?? { mult: 1, sinceOk: 0 };
    j.sinceOk = (j.sinceOk || 0) + 1;
    if (j.sinceOk >= 3 && j.mult < 4) {
      j.mult = Math.min(4, (j.mult || 1) * 2);
      j.sinceOk = 0;
      log(`proactivity: '${jobName}' без реакции 3 раза — интервал ×${j.mult}`);
    }
    st[jobName] = j;
    writeJson(PROACTIVITY_FILE(), st);
  } catch { /* best-effort */ }
}

async function pushToTelegram(text, log, jobName = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const st = readJson(join(STATE_DIR, "telegram-state.json"), null);
  const chatId = process.env.TELEGRAM_CHAT_ID || st?.boundChatId;
  if (!chatId) return;
  // Найти тему адъютанта (итоги — в основной диалог), иначе — без темы.
  let threadId = null;
  for (const [tid, t] of Object.entries(st?.topics ?? {})) {
    if (t?.role === "adjutant") { threadId = Number(tid); break; }
  }
  let sentOk = true;
  for (let i = 0; i < text.length; i += 4000) {
    const isLast = i + 4000 >= text.length;
    // Кнопки обратной связи — на последнем сегменте проактивного push'а:
    // 👍 сбрасывает backoff, 🔇 удваивает интервал (обрабатывает TG-бот, pro:<job>:ok|less).
    const keyboard = jobName && isLast
      ? { reply_markup: { inline_keyboard: [[
          { text: "👍 Полезно", callback_data: `pro:${jobName}:ok` },
          { text: "🔇 Реже", callback_data: `pro:${jobName}:less` },
        ]] } }
      : {};
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000), ...(threadId ? { message_thread_id: threadId } : {}), ...keyboard }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) { log(`push: telegram ${res.status}`); sentOk = false; break; }
  }
  // Учитываем только доставленные push'ы: сбой TG не должен раздувать backoff (r3-minor).
  if (jobName && sentOk) recordProactivePush(jobName, log);
}

function doUpdate(log = console.log, { inDaemon = false } = {}) {
  const wasRunning = safeDaemonPid();
  const pull = sh("git", ["-C", REPO_ROOT, "pull", "--ff-only"]);
  if (pull.code !== 0) {
    err(`git pull не удался: ${pull.errOut.slice(0, 300)}`);
    process.exitCode = 1; // r4-J2: провал апдейта не должен рапортовать успехом
    return;
  }
  if (/Already up to date|Уже обновлено/i.test(pull.out)) { ok("Уже последняя версия"); return; }
  info("Обновление получено → npm install && build…");
  sh(NPM, ["install", "--no-audit", "--no-fund"], { cwd: REPO_ROOT, stdio: ["ignore", "inherit", "inherit"] });
  const b = sh(NPM, ["run", "build"], { cwd: REPO_ROOT, stdio: ["ignore", "inherit", "inherit"] });
  if (b.code !== 0) return err("build после обновления не удался — откатитесь: git -C " + REPO_ROOT + " reset --hard HEAD@{1}");
  ok("Обновлено: " + sh("git", ["-C", REPO_ROOT, "log", "--oneline", "-1"]).out);
  if (inDaemon) {
    // Мы — сам демон: НЕ убиваем себя через cmdStop (гонка pidfile). Спавним замену
    // (она перепишет pidfile своим pid) и выходим; bye-guard не тронет чужой pidfile.
    log("update: рестарт демона (замена спавнится, текущий процесс выходит)");
    const fd = openSync(LOG_FILE, "a");
    spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
      detached: true, stdio: ["ignore", fd, fd], env: process.env, windowsHide: true,
    }).unref();
    closeSync(fd);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  if (wasRunning) {
    cmdStop();
    // Дождаться реальной смерти старого демона: SIGTERM асинхронен, а cmdStart при живом
    // pid отвечает «уже работает» — гонка оставляла систему БЕЗ демона вовсе.
    const deadline = Date.now() + 10_000;
    while (safeDaemonPid() && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // синхронный sleep 200мс
    }
    const still = safeDaemonPid();
    if (still) {
      warn(`Демон ${still} не завершился за 10с — SIGKILL`);
      try { process.kill(still, "SIGKILL"); } catch { /* */ }
      try { unlinkSync(PID_FILE); } catch { /* */ }
    }
    cmdStart();
  }
}

// ── управление демоном ──
function cmdStart() {
  mkdirSync(STATE_DIR, { recursive: true });
  if (safeDaemonPid()) return ok(`Демон уже работает (pid ${safeDaemonPid()}). Чат: http://127.0.0.1:${CHAT_PORT}`);
  // Поднять инфраструктуру, если standalone и docker есть
  if (detectMode() === "standalone" && dockerAvailable()) {
    const needOllama = !has("ollama");
    loadEnvIntoProcess();
    sh("docker", composeArgs(["up", "-d"], needOllama), { env: process.env });
  }
  const fd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "daemon"], {
    detached: true, stdio: ["ignore", fd, fd], env: process.env, windowsHide: true,
  });
  child.unref();
  ok(`Демон запущен (pid ${child.pid}). Чат: http://127.0.0.1:${CHAT_PORT} · лог: ${LOG_FILE}`);
}
function cmdStop(flags = {}) {
  const pid = safeDaemonPid();
  if (pid) { process.kill(pid, "SIGTERM"); ok(`Демон остановлен (pid ${pid})`); }
  else info("Демон не запущен");
  // --profile ollama всегда: иначе compose stop не остановит nabu-ollama, если он есть.
  if (flags.infra && dockerAvailable()) { loadEnvIntoProcess(); sh("docker", composeArgs(["stop"], true), { env: process.env }); ok("Инфраструктура остановлена (docker compose stop)"); }
}
async function cmdStatus() {
  const pid = safeDaemonPid();
  console.log(`\n${C.b}Nabu status${C.x}  (режим: ${detectMode()})`);
  console.log(`  Демон:     ${pid ? C.g + "работает (pid " + pid + ")" : C.r + "остановлен"}${C.x}`);
  console.log(`  Чат:       http://127.0.0.1:${CHAT_PORT}${pid ? "" : C.d + " (поднимется с демоном)" + C.x}`);
  if (dockerAvailable()) {
    loadEnvIntoProcess();
    const ps = sh("docker", composeArgs(["ps", "--format", "{{.Service}}\t{{.Status}}"], true), { env: process.env });
    for (const line of ps.out.split("\n").filter(Boolean)) console.log(`  Docker:    ${line.replace("\t", " — ")}`);
  } else console.log(`  Docker:    ${C.d}недоступен${C.x}`);
  const base = readEnvFile().OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const oll = await (async () => { try { return (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } })();
  console.log(`  Ollama:    ${oll ? C.g + "доступен" : C.y + "недоступен"}${C.x}`);
  const upd = readJson(UPDATE_STATUS, null);
  if (upd) console.log(`  Обновления: ${upd.behind > 0 ? C.y + "доступно " + upd.behind + " коммит(ов) → nabu update" : C.g + "актуально"}${C.x} ${C.d}(проверено ${upd.checkedAt})${C.x}`);
  const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
  const on = (cfg.jobs || []).filter((j) => j.enabled).map((j) => j.name);
  console.log(`  Расписание: ${on.length ? on.join(", ") : C.d + "все задачи выключены (nabu schedule enable <name>)" + C.x}\n`);
}
function cmdLogs(flags, rest) {
  // nabu logs            — демон (по умолчанию)
  // nabu logs --chat     — JSONL-лог обменов веб-чата
  // nabu logs --job <j>  — лог конкретной scheduled-задачи
  let file = LOG_FILE;
  if (flags.chat) file = join(STATE_DIR, "logs", "chat.jsonl");
  else if (flags.job) file = join(STATE_DIR, `job-${rest[0] || flags.job}.log`);
  if (!existsSync(file)) return info(`Лога пока нет: ${file}`);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  console.log(lines.slice(-(Number(flags.n) || 50)).join("\n"));
}

async function cmdStats() {
  loadEnvIntoProcess();
  const libPath = join(REPO_ROOT, "lib", "dist", "index.js");
  if (!existsSync(libPath)) die("Сначала соберите: npm run build");
  const lib = await import(libPath);
  const deps = lib.buildDeps();
  const o = await deps.dashboard.overview();
  const n = (v) => (v ?? 0).toLocaleString("ru-RU");
  console.log(`\n${C.b}Статистика Nabu${C.x}  ${C.d}${o.generatedAt}${o.status === "degraded" ? " (частично)" : ""}${C.x}`);
  if (o.memory) console.log(`  Память:   эпизоды ${n(o.memory.episodes)} (7д: ${n(o.memory.episodes7d)}, сегодня: ${n(o.memory.episodesToday)}) · факты ${n(o.memory.facts)} · нарративы ${n(o.memory.narratives)} · рабочая ${n(o.memory.workingActive)} · намерения ${n(o.memory.prospectivePending)}`);
  if (o.knowledge) console.log(`  Знания:   заметки ${o.knowledge.notes === null ? "н/д" : n(o.knowledge.notes)} · документы ${n(o.knowledge.documents)} · чанки ${n(o.knowledge.chunks)}`);
  console.log(`  Граф:     ${o.graph.available ? `концепты ${n(o.graph.concepts)} · связи ${n(o.graph.associations)}` : C.d + "TypeDB недоступен" + C.x}`);
  if (o.council) console.log(`  Совет:    совещания ${n(o.council.deliberations)} (открыто: ${n(o.council.open)}) · позиции ${n(o.council.positions)} · советы ${n(o.council.recommendations)} (применено: ${n(o.council.recommendationsApplied)}, ждут follow-up: ${n(o.council.followupsPending)})`);
  if (o.domains) console.log(`  Сферы:    проекты ${n(o.domains.projectsActive)} · задачи ${n(o.domains.tasksOpen)} (сегодня сделано: ${n(o.domains.tasksDoneToday)}) · цели ${n(o.domains.goalsActive)} · привычки ${n(o.domains.habitsActive)} · квесты ${n(o.domains.questsActive)} · XP ${n(o.domains.xpTotal)}`);
  if (o.system) console.log(`  Система:  задачи ${n(o.system.systemTasksOpen)} · предложения ${n(o.system.proposalsOpen)} · approvals ${n(o.system.approvalsPending)} · метрики эффективности ${n(o.system.effectivenessPoints)}`);
  if (o.daily?.length) {
    const spark = o.daily.map((d) => d.episodes + d.facts + d.chunks + d.metrics);
    const max = Math.max(...spark, 1);
    const bars = "▁▂▃▄▅▆▇█";
    console.log(`  14 дней:  ${spark.map((v) => bars[Math.min(7, Math.round((v / max) * 7))]).join("")}  ${C.d}(записи/день, max ${max})${C.x}`);
  }
  if (o.warnings?.length) console.log(`  ${C.y}Предупреждения: ${o.warnings.join("; ")}${C.x}`);
  console.log("");
  await deps.pg.close();
}
function cmdChat() {
  if (!safeDaemonPid()) cmdStart();
  const url = `http://127.0.0.1:${CHAT_PORT}`;
  try {
    if (IS_WIN) {
      // start — встроенная команда cmd, отдельного бинарника нет.
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      const opener = platform() === "darwin" ? "open" : "xdg-open";
      if (has(opener)) spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch { /* не критично — URL напечатан ниже */ }
  ok(`Чат: ${url}`);
}
function cmdSchedule(args) {
  ensureScheduleFile();
  const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
  const sub = args[0];
  if (sub === "enable" || sub === "disable") {
    const job = (cfg.jobs || []).find((j) => j.name === args[1]);
    if (!job) die(`Нет задачи '${args[1]}'. Есть: ${(cfg.jobs || []).map((j) => j.name).join(", ")}`);
    job.enabled = sub === "enable";
    writeJson(SCHEDULE_FILE, cfg);
    ok(`${job.name}: ${job.enabled ? "включена" : "выключена"}`);
  } else {
    for (const j of cfg.jobs || []) console.log(`  ${j.enabled ? C.g + "on " : C.d + "off"}${C.x} ${j.name.padEnd(12)} ${j.at} каждые ${j.everyDays}д  ${C.d}${j.internal ? "[internal:" + j.internal + "]" : j.prompt}${C.x}`);
    console.log(`  ${C.d}auto_update: ${cfg.auto_update ? "on" : "off"}${C.x}`);
  }
}
/** Глубокие проверки (doctor --deep и internal-джоба healthcheck). Возвращает warnings[]. */
async function deepChecks() {
  const warns = [];
  // 1. Место на диске (fs.statfsSync, Node ≥19)
  try {
    const { statfsSync } = await import("node:fs");
    const st = statfsSync(NABU_HOME);
    const freeGb = (st.bavail * st.bsize) / 1e9;
    if (freeGb < 5) warns.push(`Мало места на диске: ${freeGb.toFixed(1)} ГБ свободно`);
  } catch { /* платформа без statfs — пропуск */ }
  // 2. Размер БД и живость стека
  if (detectMode() === "standalone" && dockerAvailable()) {
    for (const c of ["nabu-postgres", "nabu-typedb"]) {
      const r = await shAsync("docker", ["inspect", "--format", "{{.State.Running}}", c], { windowsHide: true });
      if (r.code !== 0 || !r.out.includes("true")) warns.push(`Контейнер ${c} не запущен`);
    }
    const sz = await shAsync("docker", ["exec", "nabu-postgres", "psql", "-U", "nabu", "-d", "nabu", "-tAc", "select pg_database_size('nabu')"], { windowsHide: true });
    const bytes = Number(sz.out.trim());
    if (sz.code === 0 && bytes > 20e9) warns.push(`БД выросла до ${(bytes / 1e9).toFixed(1)} ГБ — проверьте ретенцию`);
  }
  // 3. Валидность расписания
  try {
    const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
    for (const j of cfg.jobs || []) {
      if (j.enabled && j.at && !/^\d{1,2}:\d{2}$/.test(j.at)) warns.push(`Задача '${j.name}': некорректное at='${j.at}'`);
      if (j.enabled && !j.internal && !j.prompt) warns.push(`Задача '${j.name}' включена, но без prompt/internal`);
    }
  } catch (e) { warns.push(`schedule.json не читается: ${e.message}`); }
  // 4. Ошибки в логе демона за 24ч
  try {
    const lf = join(STATE_DIR, "daemon.log");
    if (existsSync(lf)) {
      const dayAgo = Date.now() - 86_400_000;
      const lines = readFileSync(lf, "utf8").split("\n").slice(-2000);
      let errs = 0;
      for (const l of lines) {
        const m = /^\[([^\]]+)\]/.exec(l);
        if (m && Date.parse(m[1]) > dayAgo && /error|FAILED|провал/i.test(l)) errs++;
      }
      if (errs > 5) warns.push(`Ошибок в логе демона за 24ч: ${errs} (nabu logs)`);
    }
  } catch { /* */ }
  // 5. Свежесть бэкапа (если включён)
  try {
    const cfg = readJson(SCHEDULE_FILE, { jobs: [] });
    const bj = (cfg.jobs || []).find((j) => j.internal === "backup" && j.enabled);
    if (bj) {
      const dir = join(NABU_HOME, ".backups");
      const newest = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("pg-")).sort().pop() : null;
      const ageDays = newest ? (Date.now() - statSync(join(dir, newest)).mtimeMs) / 86_400_000 : Infinity;
      if (ageDays > (bj.everyDays || 1) * 2 + 1) warns.push(`Бэкап устарел: последний pg-дамп ${newest ? Math.round(ageDays) + " дн. назад" : "отсутствует"}`);
    }
  } catch { /* */ }
  return warns;
}

async function cmdDoctor(flags = {}) {
  console.log(`\n${C.b}Nabu doctor${C.x}`);
  const checks = [];
  const add = (name, pass, note = "") => { checks.push([name, pass, note]); (pass ? ok : warn)(`${name}${note ? " — " + note : ""}`); };
  add("Node ≥22", Number(process.versions.node.split(".")[0]) >= 22, process.versions.node);
  add("git", has("git"));
  add("docker", dockerAvailable(), dockerAvailable() ? "" : "нужен для standalone-режима");
  add("claude CLI", has("claude"), has("claude") ? "" : "нужен для чата и расписания");
  add(".env", existsSync(ENV_PATH), detectMode());
  add("Сборка lib/dist", existsSync(join(REPO_ROOT, "lib", "dist", "index.js")), existsSync(join(REPO_ROOT, "lib", "dist", "index.js")) ? "" : "npm run build");
  loadEnvIntoProcess();
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  let ollamaOk = false, modelOk = false;
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    ollamaOk = r.ok;
    if (r.ok) modelOk = ((await r.json()).models || []).some((m) => (m.name || "").startsWith((process.env.OLLAMA_EMBED_MODEL || EMBED_MODEL).split(":")[0]));
  } catch { /* */ }
  add("Ollama", ollamaOk); add("Модель эмбеддингов", modelOk, modelOk ? "" : "nabu init докачает");
  if (existsSync(join(REPO_ROOT, "lib", "dist", "smoke.js")) && existsSync(ENV_PATH)) {
    const smoke = sh(process.execPath, ["--env-file=" + ENV_PATH, join(REPO_ROOT, "lib", "dist", "smoke.js")], { cwd: REPO_ROOT });
    add("Smoke (БД+память)", smoke.code === 0, smoke.code === 0 ? "" : (smoke.errOut || smoke.out).split("\n")[0]?.slice(0, 120));
  }
  if (flags.deep) {
    info("Глубокие проверки…");
    const warns = await deepChecks();
    for (const w of warns) { warn(w); checks.push(["deep", false, w]); }
    if (!warns.length) ok("Глубокие проверки: чисто");
  }
  const bad = checks.filter(([, p]) => !p).length;
  console.log(bad ? `\n${C.y}Проблем: ${bad}${C.x}\n` : `\n${C.g}Всё в порядке.${C.x}\n`);
  process.exit(bad ? 1 : 0);
}
// ── Шифрование бэкапов (Горизонт-3): AES-256-GCM ключом NABU_VAULT_KEY ──
// Формат .enc: "NBK1" (4Б) + IV (12Б) + шифртекст + GCM-tag (16Б, в конце).
// Зашифрованный архив можно спокойно класть на чужие/доверенные узлы (rsync/Syncthing/облако):
// без ключа он нечитаем. Ключ — машинный секрет из .env; потеря ключа = потеря архива.
function backupKey() {
  const k = process.env.NABU_VAULT_KEY;
  if (!k) throw new Error("NABU_VAULT_KEY не задан (nabu init создаёт) — шифрование недоступно");
  const buf = Buffer.from(k, "base64url");
  if (buf.length !== 32) throw new Error("NABU_VAULT_KEY повреждён (нужно 32 байта base64url)");
  return buf;
}
async function encryptFileGcm(src) {
  try {
    return await encryptFileGcmInner(src);
  } catch (e) {
    e.artifact = src;
    throw e;
  }
}
async function encryptFileGcmInner(src) {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", backupKey(), iv);
  const dst = src + ".enc";
  const out = createWriteStream(dst);
  out.write(Buffer.concat([Buffer.from("NBK1"), iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  out.end(cipher.getAuthTag());
  await new Promise((res, rej) => { out.on("close", res); out.on("error", rej); });
  unlinkSync(src); // plaintext-архив удаляем — остаётся только .enc
  return dst;
}
async function cmdBackupDecrypt(args) {
  loadEnvIntoProcess();
  const src = args[0];
  if (!src || !existsSync(src)) { err(`Файл не найден: ${src ?? "(не указан)"}`); process.exitCode = 1; return; }
  const raw = readFileSync(resolve(src));
  if (raw.subarray(0, 4).toString() !== "NBK1") { err("Не формат NBK1 (nabu backup --encrypt)"); process.exitCode = 1; return; }
  const { createDecipheriv } = await import("node:crypto");
  const iv = raw.subarray(4, 16);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(16, raw.length - 16);
  const d = createDecipheriv("aes-256-gcm", backupKey(), iv);
  d.setAuthTag(tag);
  let plain;
  try { plain = Buffer.concat([d.update(ct), d.final()]); } catch { err("Расшифровка не удалась: неверный ключ или файл повреждён"); process.exitCode = 1; return; }
  const out = args[1] || resolve(src).replace(/\.enc$/, "");
  writeFileSync(out, plain);
  ok(`Расшифровано → ${out}`);
}

// ── backup (ROADMAP P0-4): pg_dump + TypeDB-том + workspace, ретенция 7 ──
async function cmdBackup(flags = {}, log = (m) => info(m)) {
  loadEnvIntoProcess();
  const outDir = flags.out ? resolve(String(flags.out)) : join(NABU_HOME, ".backups");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19) + "-" + process.pid;
  const made = [];
  const failed = [];
  const encQueue = []; // шифрование — после создания артефакта (--encrypt)
  const mode = detectMode();
  const containerExists = (name) => sh("docker", ["inspect", "--format", "{{.Name}}", name], { windowsHide: true }).code === 0;
  /** Артефакт засчитывается только валидным: провал/пустышка удаляется с диска. */
  const accept = (okFlag, dst, label, minBytes, errText = "") => {
    let size = 0;
    try { size = statSync(dst).size; } catch { /* нет файла */ }
    if (okFlag && size >= minBytes) {
      if (flags.encrypt) {
        encQueue.push(async () => {
          const enc = await encryptFileGcm(dst);
          const i = made.indexOf(dst);
          if (i >= 0) made[i] = enc;
          log(`${label} зашифрован → ${enc}`);
        });
      }
      made.push(dst);
      log(`${label} → ${dst}`);
      return;
    }
    try { unlinkSync(dst); } catch { /* */ }
    failed.push(label);
    warn(`${label}-бэкап не удался${size && size < minBytes ? ` (подозрительно мал: ${size}b)` : ""}${errText ? ": " + errText.slice(0, 200) : ""}`);
  };

  // 1. Postgres → pg-<ts>.sql.gz
  if (mode === "standalone" && dockerAvailable()) {
    if (!containerExists("nabu-postgres")) {
      failed.push("Postgres");
      warn("Postgres-бэкап: контейнер nabu-postgres не существует (nabu init)");
    } else {
      const dst = join(outDir, `pg-${ts}.sql.gz`);
      // Успех строго: exit-код известен И равен 0 И поток дописан. 'close' гарантирует
      // exitCode; ждём ОБА события (гонка finish-до-exit благословляла битый дамп).
      const okPg = await new Promise((res) => {
        const dump = spawn("docker", ["exec", "nabu-postgres", "pg_dump", "-U", "nabu", "-d", "nabu", "--no-owner"], { windowsHide: true });
        const gz = createGzip();
        const out = createWriteStream(dst);
        dump.stdout.pipe(gz).pipe(out);
        let errT = "";
        dump.stderr.on("data", (d) => { errT = (errT + d).slice(-400); });
        let exitCode = null;
        let flushed = false;
        let closed = false;
        const settle = () => { if (closed && flushed) res(exitCode === 0 ? "" : errT || `exit=${exitCode}`); };
        out.on("finish", () => { flushed = true; settle(); });
        out.on("error", () => { flushed = true; exitCode = exitCode ?? -1; settle(); });
        dump.on("error", (e) => { closed = true; flushed = true; exitCode = -1; errT = e.message; settle(); });
        dump.on("close", (code) => { exitCode = code ?? -1; closed = true; settle(); });
      });
      accept(okPg === "", dst, "Postgres", 200, okPg);
    }
  } else {
    warn("Postgres-бэкап пропущен (нет docker-стека и локального pg_dump)");
  }

  // 2. TypeDB: preflight контейнера (иначе docker run НЕЯВНО создаст пустой том и
  //    заархивирует пустоту как успех) → краткая остановка → tar тома → старт.
  if (mode === "standalone" && dockerAvailable()) {
    if (!containerExists("nabu-typedb")) {
      failed.push("TypeDB");
      warn("TypeDB-бэкап: контейнер nabu-typedb не существует — пропущен (том не создаём)");
    } else {
      const dst = join(outDir, `typedb-${ts}.tar.gz`);
      // --user: иначе архив root-owned и ретенция не сможет его удалить (EPERM).
      const userArg = !IS_WIN && typeof process.getuid === "function"
        ? ["--user", `${process.getuid()}:${process.getgid()}`]
        : [];
      await shAsync("docker", ["stop", "nabu-typedb"], { windowsHide: true });
      let r;
      try {
        r = await shAsync("docker", ["run", "--rm", ...userArg, "-v", "nabu_nabu-typedb:/data:ro", "-v", `${outDir}:/backup`, "alpine", "tar", "czf", `/backup/typedb-${ts}.tar.gz`, "-C", "/data", "."], { windowsHide: true });
      } finally {
        // R6-minor: гарантируем перезапуск TypeDB даже при падении tar — иначе контейнер остаётся off.
        await shAsync("docker", ["start", "nabu-typedb"], { windowsHide: true });
      }
      accept(r.code === 0, dst, "TypeDB", 500, r.errOut);
    }
  }

  // 3. Workspace (~/nabu) → workspace-<ts>.tar.gz. Excludes БЕЗ якоря "./" —
  //    bsdtar (macOS/Windows) не матчит "./"-паттерны, и архив заглатывал бы прошлые бэкапы.
  if (existsSync(NABU_HOME)) {
    const dst = join(outDir, `workspace-${ts}.tar.gz`);
    const r = await shAsync("tar", ["-czf", dst, "--exclude=.backups", "--exclude=.nabu/tmp", "-C", NABU_HOME, "."], { windowsHide: true });
    accept(r.code === 0, dst, "Workspace", 100, r.errOut);
  }

  // 3.5 Шифрование (--encrypt): plaintext-архивы заменяются на .enc
  for (const job of encQueue) {
    try { await job(); } catch (e) {
      failed.push("encrypt");
      // r3-M3: плейнтекст НЕ должен пережить сбой шифрования — пользователь просил
      // архив, безопасный для чужих узлов. Удаляем и plaintext, и частичный .enc.
      if (e && e.artifact) {
        for (const f of [e.artifact, e.artifact + ".enc"]) { try { unlinkSync(f); } catch { /* */ } }
        const i = made.indexOf(e.artifact);
        if (i >= 0) made.splice(i, 1);
      }
      warn(`Шифрование не удалось (${e.message}) — plaintext-архив УДАЛЁН, компонент помечен проваленным`);
    }
  }

  // 4. Ретенция: по 7 последних на каждый префикс
  for (const prefix of ["pg-", "typedb-", "workspace-"]) {
    const files = readdirSync(outDir).filter((f) => f.startsWith(prefix)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 7))) {
      try { unlinkSync(join(outDir, f)); } catch (e) { warn(`ретенция: не удалить ${f}: ${e.message}`); }
    }
  }

  if (failed.length === 0 && made.length) {
    ok(`Бэкап готов (${made.length} архив(а)) в ${outDir}. Восстановление: nabu restore <каталог>.`);
  } else if (made.length) {
    warn(`Бэкап ЧАСТИЧНЫЙ: готово ${made.length}, провалено: ${failed.join(", ")} (${outDir})`);
  } else {
    err("Бэкап не создал ни одного валидного архива");
  }
  return { made, failed };
}

// ── import-health: локальный импорт экспортов здоровья (Apple/Google Fit/generic CSV) ──
// Философия v0.17: файлы-экспорты вместо OAuth-API (Google Fit API закрыт; Huawei/Garmin —
// партнёрские программы). Всё парсится локально → metric_series/metric_values → analytics/health.
async function cmdImportHealth(args, flags) {
  loadEnvIntoProcess();
  const file = args[0];
  if (!file || !existsSync(file)) {
    err(`Файл не найден: ${file ?? "(не указан)"}. Использование: nabu import-health <export.xml|*.csv> [--source name]`);
    process.exitCode = 1;
    return;
  }
  const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
  if (!lib.detectFormat || !lib.parseAppleHealthStats || !lib.parseGoogleFitDaily || !lib.parseGenericCsv) {
    err("Модуль health-import не собран — выполните npm run build");
    process.exitCode = 1;
    return;
  }
  const content = readFileSync(resolve(file), "utf8");
  const fmt = flags.format || lib.detectFormat(content, file);
  if (!fmt) {
    err("Формат не распознан. Поддерживается: Apple Health export.xml, Google Takeout Fit CSV, generic CSV (date,metric,value[,unit]). См. docs/HEALTH_IMPORT.md");
    process.exitCode = 1;
    return;
  }
  info(`Формат: ${fmt}`);
  let points;
  if (fmt === "apple") {
    const r = lib.parseAppleHealthStats(content);
    points = r.points;
    const skipped = Object.entries(r.skippedTypes ?? {});
    if (skipped.length) info(`Пропущены типы: ${skipped.map(([k, v]) => `${k}×${v}`).slice(0, 6).join(", ")}${skipped.length > 6 ? "…" : ""}`);
  } else if (fmt === "google-fit") {
    points = lib.parseGoogleFitDaily(content);
  } else {
    points = lib.parseGenericCsv(content);
  }
  if (!points.length) { warn("Точек данных не найдено"); return; }
  info(`Точек: ${points.length}. Импорт…`);
  const deps = lib.buildDeps();
  try {
    const res = await deps.healthImport.importPoints(points, String(flags.source || fmt));
    ok(`Импортировано: ${res.inserted} (дубликатов пропущено: ${res.deduped}). Ряды: ${res.series.join(", ")}`);
    info("Дальше: тренды/прогнозы — nabu-analytics; динамика — в дашборде и у министра health.");
  } finally {
    await deps.pg.close().catch(() => { /* */ });
  }
}

// ── import-finance: локальный импорт банковских CSV-выписок (v0.17-7) ──
async function cmdImportFinance(args, flags) {
  loadEnvIntoProcess();
  const file = args[0];
  if (!file || !existsSync(file)) {
    err(`Файл не найден: ${file ?? "(не указан)"}. Использование: nabu import-finance <выписка.csv> [--source bank]`);
    process.exitCode = 1;
    return;
  }
  const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
  if (!lib.parseBankCsv) { err("Модуль finance-import не собран — npm run build"); process.exitCode = 1; return; }
  const { txs, warnings } = lib.parseBankCsv(readFileSync(resolve(file), "utf8"));
  if (warnings.length) warn(`Строк не разобрано: ${warnings.length}${warnings[0] ? ` (пример: ${String(warnings[0]).slice(0, 80)})` : ""}`);
  if (!txs.length) { err("Транзакций не найдено — проверьте формат (docs/FINANCE_IMPORT.md)"); process.exitCode = 1; return; }
  info(`Транзакций: ${txs.length}. Импорт…`);
  const deps = lib.buildDeps();
  try {
    const r = await deps.financeImport.importTransactions(txs, String(flags.source || "csv"));
    ok(`Импортировано: ${r.inserted} (дубликатов: ${r.deduped})`);
    const cats = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (cats.length) info(`По категориям: ${cats.map(([c, v]) => `${c} ${v}`).join(" · ")}`);
    const sum = await deps.financeImport.summary(30);
    info(`30 дней: расходы ${sum.spent}, доходы ${sum.income}, топ: ${sum.topCategories.map((t) => t.category).join(", ")}`);
  } finally { await deps.pg.close().catch(() => { /* */ }); }
}

// ── restore: корректное восстановление из бэкапа (r4: «gunzip|psql в живую БД» давал
// сотни конфликтов и частичную потерю — восстановление обязано быть командой) ──
async function cmdRestore(args, flags) {
  loadEnvIntoProcess();
  const dir = args[0];
  if (!dir || !existsSync(dir)) {
    err(`Каталог бэкапа не найден: ${dir ?? "(не указан)"}. Использование: nabu restore <каталог-с-архивами>`);
    process.exitCode = 1;
    return;
  }
  const pick = (prefix) => readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().pop();
  let pg = pick("pg-");
  let td = pick("typedb-");
  const ws = pick("workspace-");
  if (!pg && !td && !ws) { err("В каталоге нет архивов pg-*/typedb-*/workspace-*"); process.exitCode = 1; return; }

  console.log(`\n${C.b}nabu restore${C.x} — план:`);
  if (pg) console.log(`  • Postgres ← ${pg} (текущая БД будет ПОЛНОСТЬЮ заменена)`);
  if (td) console.log(`  • TypeDB ← ${td} (том будет ПОЛНОСТЬЮ заменён)`);
  if (ws) console.log(`  • Workspace ← ${ws} (файлы распакуются ПОВЕРХ ${NABU_HOME})`);
  console.log("");
  if (!(await confirm("ЗАМЕНИТЬ текущие данные содержимым бэкапа?", flags))) { info("Отменено"); return; }

  cmdStop({});
  const decryptIfEnc = async (name, tmpList) => {
    if (!name || !name.endsWith(".enc")) return name;
    info(`Расшифровываю ${name}…`);
    const raw = readFileSync(join(dir, name));
    if (raw.subarray(0, 4).toString() !== "NBK1") throw new Error(`${name}: не формат NBK1`);
    const { createDecipheriv } = await import("node:crypto");
    const d = createDecipheriv("aes-256-gcm", backupKey(), raw.subarray(4, 16));
    d.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([d.update(raw.subarray(16, raw.length - 16)), d.final()]);
    const out = name.replace(/\.enc$/, "");
    writeFileSync(join(dir, out), plain);
    tmpList.push(join(dir, out));
    return out;
  };
  const decryptedTmp = []; // r5-#1: расшифрованные архивы удаляем в конце (иначе плейнтекст остаётся)
  pg = await decryptIfEnc(pg, decryptedTmp);
  td = await decryptIfEnc(td, decryptedTmp);

  const failedR = [];
  // 1. Postgres: рвём коннекты → drop schema public cascade → заливаем дамп (он создаёт всё сам).
  if (pg) {
    if (!containerRunning("nabu-postgres")) { err("nabu-postgres не запущен — nabu init"); process.exitCode = 1; return; }
    info("Postgres: очистка и восстановление…");
    await shAsync("docker", ["exec", "nabu-postgres", "psql", "-h", "127.0.0.1", "-U", "nabu", "-d", "postgres", "-c",
      "select pg_terminate_backend(pid) from pg_stat_activity where datname='nabu' and pid<>pg_backend_pid()"], { windowsHide: true });
    const wipe = await shAsync("docker", ["exec", "nabu-postgres", "psql", "-h", "127.0.0.1", "-U", "nabu", "-d", "nabu", "-v", "ON_ERROR_STOP=1", "-c",
      "drop schema public cascade; create schema public;"], { windowsHide: true });
    if (wipe.code !== 0) { failedR.push("pg-wipe: " + wipe.errOut.slice(0, 150)); }
    else {
      const res = await new Promise((resDone) => {
        // ON_ERROR_STOP=1: psql падает с ненулевым кодом на ПЕРВОЙ ошибке (r5-#2 — раньше
        // успех определялся грепом усечённого stderr, ранние ошибки терялись).
        const gz = spawn("docker", ["exec", "-i", "nabu-postgres", "psql", "-h", "127.0.0.1", "-U", "nabu", "-d", "nabu", "-v", "ON_ERROR_STOP=1", "-q"], { windowsHide: true });
        let errT = "";
        gz.stderr.on("data", (d2) => { errT = (errT + d2).slice(-500); });
        gz.on("close", (code) => resDone({ code, errT }));
        gz.on("error", (e) => resDone({ code: -1, errT: e.message }));
        createReadStream(join(dir, pg)).pipe(createGunzip()).pipe(gz.stdin);
      });
      if (res.code === 0) ok(`Postgres восстановлен из ${pg}`);
      else failedR.push(`pg-restore (код ${res.code}: ${res.errT.slice(0, 150)})`);
    }
  }
  // 2. TypeDB: stop → wipe тома → untar → start.
  if (td) {
    info("TypeDB: замена тома…");
    await shAsync("docker", ["stop", "nabu-typedb"], { windowsHide: true });
    let r;
    try {
      r = await shAsync("docker", ["run", "--rm", "-v", "nabu_nabu-typedb:/data", "-v", `${resolve(dir)}:/backup:ro`, "alpine",
        "sh", "-c", `rm -rf /data/* && tar xzf /backup/${td} -C /data`], { windowsHide: true });
    } finally {
      // R6-minor: TypeDB перезапускается даже при сбое восстановления (не остаётся off).
      await shAsync("docker", ["start", "nabu-typedb"], { windowsHide: true });
    }
    r.code === 0 ? ok(`TypeDB восстановлен из ${td}`) : failedR.push("typedb: " + r.errOut.slice(0, 150));
  }
  // 3. Workspace: поверх NABU_HOME.
  if (ws) {
    const r = await shAsync("tar", ["-xzf", join(dir, ws), "-C", NABU_HOME], { windowsHide: true });
    r.code === 0 ? ok(`Workspace восстановлен из ${ws}`) : failedR.push("workspace: " + r.errOut.slice(0, 150));
  }
  for (const f of decryptedTmp) { try { unlinkSync(f); } catch { /* */ } } // r5-#1: стереть расшифрованные копии
  if (failedR.length) { err(`Восстановление ЧАСТИЧНОЕ: ${failedR.join(" · ")}`); process.exitCode = 1; }
  else ok("Восстановление завершено. Запустите: nabu start");
}
function containerRunning(name) {
  return sh("docker", ["inspect", "--format", "{{.State.Running}}", name], { windowsHide: true }).out.includes("true");
}
// ── models: инвентаризация железа + каталог локальных моделей + выбор/установка ──
async function cmdModels(args, flags) {
  loadEnvIntoProcess();
  const hw = await import("./hardware.mjs");
  const inv = hw.inventory();
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  let installed = new Set();
  try {
    const tags = await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })).json();
    installed = new Set((tags.models || []).map((m) => m.name));
  } catch { /* ollama не поднят — покажем каталог без отметок */ }

  console.log(`\n${C.b}Железо этой машины${C.x}\n  ${hw.describeHardware(inv)}`);
  const rec = hw.recommend(inv);
  console.log(`\n${C.b}Рекомендации под ваше железо${C.x}`);
  for (const role of ["chat", "embed", "vision"]) {
    const m = rec[role];
    const label = { chat: "мозг (локальный)", embed: "эмбеддинги", vision: "фото→память" }[role];
    console.log(`  ${label}: ${m ? C.g + m.name + C.x + " — " + hw.speedNote(inv, m) : C.y + "нет влезающей модели" + C.x}`);
  }

  const annotated = hw.annotateForHardware(inv);
  console.log(`\n${C.b}Каталог (ollama.com/models — сверяйте свежие релизы)${C.x}`);
  console.log("  роль    модель                          мин.ОЗУ  влезает  установлена  примечание");
  annotated.forEach((m, i) => {
    const mark = m.fits ? C.g + "да " + C.x : C.y + "нет" + C.x;
    const inst = [...installed].some((n) => n.startsWith(m.name.split(":")[0])) ? C.g + "✓" + C.x : " ";
    const speed = m.role === "chat" ? ` · ${hw.speedNote(inv, m)}` : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${m.role.padEnd(6)} ${m.name.padEnd(30)} ${String(m.ramFloorGb).padStart(4)}ГБ   ${mark}     ${inst}         ${m.note}${speed}`);
  });

  if (flags.list) return;

  // Выбор + установка
  const idxRaw = args[0] || (await promptLine(`\nНомер модели для установки (Enter — пропустить): `, flags));
  const idx = Number(idxRaw);
  if (!idx || idx < 1 || idx > annotated.length) { info("Установка не выбрана."); return; }
  const chosen = annotated[idx - 1];
  if (!chosen.fits && !(await confirm(`${chosen.name} требует ~${chosen.ramFloorGb}ГБ, у вас бюджет ${inv.budgetGb}ГБ — всё равно ставить?`, flags))) return;

  info(`Скачиваю ${chosen.name} (однократно)…`);
  const res = await fetch(`${base}/api/pull`, { method: "POST", body: JSON.stringify({ name: chosen.name }) });
  if (!res.ok || !res.body) { err(`Не удалось начать загрузку (${res.status}) — Ollama поднят?`); process.exitCode = 1; return; }
  try {
    await streamPull(res);
  } catch (e) {
    err(`Загрузка не удалась: ${String(e.message).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  ok(`${chosen.name} установлена.`);

  // Прописать в .env по роли
  const key = chosen.role === "chat" ? "NABU_LOCAL_LLM" : chosen.role === "vision" ? "NABU_VISION_MODEL" : "OLLAMA_EMBED_MODEL";
  if (await confirm(`Сделать ${chosen.name} моделью по умолчанию для роли '${chosen.role}' (${key})?`, { ...flags, yes: flags.yes })) {
    setEnvKey(key, chosen.name);
    ok(`${key}=${chosen.name} записано в .env`);
    if (chosen.role === "chat") info("Локальный мозг (offline-режим) теперь использует её. Проверка: node evals/runner.mjs --mode live --brain local");
  }
}

async function promptLine(q, flags) {
  if (flags.yes || !process.stdin.isTTY) return "";
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim();
  rl.close();
  return a;
}

async function streamPull(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let lastPct = -1;
  let pullError = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const j = JSON.parse(line);
        if (j.error) { pullError = j.error; }  // r5-#3: Ollama стримит error при HTTP 200
        if (j.total && j.completed) {
          const pct = Math.floor((j.completed / j.total) * 100);
          if (pct !== lastPct && pct % 10 === 0) { process.stdout.write(`\r  ${j.status || "загрузка"}: ${pct}%   `); lastPct = pct; }
        }
      } catch { /* */ }
    }
  }
  process.stdout.write("\n");
  if (pullError) throw new Error(pullError);
}

// ── reset: стереть ДАННЫЕ и state, сохранив установку ──
// Не трогает НИКОГДА: контент workspace (~/nabu/* — ваши заметки/md), ~/nabu/.backups,
// .env (пароли и NABU_VAULT_KEY — их потеря = потеря vault и доступа к бэкапам) без --hard.
async function cmdReset(flags = {}) {
  loadEnvIntoProcess();
  const mode = detectMode();
  const dry = !!flags.dryRun;
  const plan = [];
  plan.push("• остановить демон (и docker-стек)");
  if (mode === "standalone" && dockerAvailable()) {
    plan.push("• docker compose down -v — УДАЛИТ данные Postgres/TypeDB/Ollama-модели (тома nabu-*)");
    plan.push("  ⚠ вместе с ними — всю память, заметки в БД, историю чата, vault-записи");
  } else {
    plan.push(`• не инициализировано (nabu init) — чистится только локальный state`);
  }
  plan.push(`• удалить локальный state: ${STATE_DIR} (pid, логи, треды чата, telegram-state, расписание-state, job-results)`);
  if (flags.hard) plan.push(`• --hard: удалить ${ENV_PATH} (пароли, NABU_VAULT_KEY — vault в бэкапах станет нерасшифруемым!)`);
  plan.push(`• НЕ трогаются: контент workspace (${NABU_HOME}), бэкапы (${join(NABU_HOME, ".backups")})${flags.hard ? "" : ", .env"}`);

  console.log(`\n${C.b}nabu reset${C.x} — план:\n` + plan.join("\n") + "\n");
  if (dry) { info("--dry-run: ничего не сделано"); return; }
  if (!(await confirm("Стереть данные Nabu (установка останется)?", flags))) { info("Отменено"); return; }
  if (flags.hard && !(await confirm("--hard удалит .env с NABU_VAULT_KEY. Точно?", flags))) { info("Отменено"); return; }

  cmdStop({ });
  if (mode === "standalone" && dockerAvailable()) {
    const r = sh("docker", composeArgs(["down", "-v"], true), { env: process.env, windowsHide: true });
    r.code === 0 ? ok("Docker-стек и тома удалены") : warn(`compose down: ${r.errOut.slice(0, 200)}`);
  }
  rmrf(STATE_DIR) ? ok(`State удалён: ${STATE_DIR}`) : warn(`Не удалось удалить ${STATE_DIR}`);
  if (flags.hard) {
    rmrf(ENV_PATH) ? warn(`.env удалён (${ENV_PATH}) — ключи потеряны`) : warn("Не удалось удалить .env");
  }
  ok("Reset завершён. Заново: nabu init && nabu start");
}

// ── uninstall: полное удаление Nabu с машины ──
// Данные пользователя (workspace, .backups) сохраняются, если явно не попросили --purge-workspace.
async function cmdUninstall(flags = {}) {
  loadEnvIntoProcess();
  const mode = detectMode();
  const dry = !!flags.dryRun;
  const os = platform();
  const binLink = IS_WIN ? join(process.env.LOCALAPPDATA || "", "nabu") : join(homedir(), ".local", "bin", "nabu");
  const unit = join(homedir(), ".config", "systemd", "user", "nabu.service");
  const plist = join(homedir(), "Library", "LaunchAgents", "ai.nabu.daemon.plist");

  const plan = [];
  plan.push("• остановить демон");
  plan.push("• убрать автозапуск: " + (os === "linux" ? "systemd user unit" : os === "darwin" ? "launchd plist" : "задача планировщика NabuDaemon"));
  if (mode === "standalone" && dockerAvailable()) {
    plan.push("• docker compose down -v (контейнеры и тома nabu-*)");
    if (flags.images) plan.push("• --images: удалить образы pgvector/typedb/alpine/ollama (могут использоваться другими проектами!)");
  }
  plan.push(`• удалить CLI-обёртку: ${binLink}${IS_WIN ? " (правку PATH откатите вручную)" : ""}`);
  plan.push(`• удалить локальный state: ${STATE_DIR}`);
  if (flags.purgeWorkspace) plan.push(`• --purge-workspace: УДАЛИТЬ ВЕСЬ workspace ${NABU_HOME} (заметки, md, бэкапы — БЕЗВОЗВРАТНО)`);
  else plan.push(`• СОХРАНЯЮТСЯ: workspace ${NABU_HOME} (ваши файлы + .backups) и .env (ключи)`);
  plan.push(`• Репозиторий Nabu (${REPO_ROOT}) не удаляет сам себя — в конце напечатаю команду`);

  console.log(`\n${C.b}nabu uninstall${C.x} — план:\n` + plan.join("\n") + "\n");
  if (dry) { info("--dry-run: ничего не сделано"); return; }
  if (!(await confirm("Удалить Nabu с этой машины?", flags))) { info("Отменено"); return; }
  if (flags.purgeWorkspace && !(await confirm(`ВЕСЬ workspace ${NABU_HOME} будет удалён БЕЗВОЗВРАТНО (включая бэкапы). Точно?`, flags))) { info("Отменено"); return; }

  cmdStop({});

  // Автозапуск (best-effort по платформе)
  if (os === "linux" && has("systemctl")) {
    sh("systemctl", ["--user", "disable", "--now", "nabu.service"]);
    if (existsSync(unit)) { rmrf(unit); sh("systemctl", ["--user", "daemon-reload"]); ok("systemd unit удалён"); }
  } else if (os === "darwin") {
    if (existsSync(plist)) { sh("launchctl", ["unload", plist]); rmrf(plist); ok("launchd plist удалён"); }
  } else if (IS_WIN) {
    const r = sh("schtasks", ["/Delete", "/TN", "NabuDaemon", "/F"], { windowsHide: true });
    if (r.code === 0) ok("Задача планировщика удалена");
  }

  // Docker
  if (mode === "standalone" && dockerAvailable()) {
    const r = sh("docker", composeArgs(["down", "-v"], true), { env: process.env, windowsHide: true });
    r.code === 0 ? ok("Docker-стек и тома удалены") : warn(`compose down: ${r.errOut.slice(0, 200)}`);
    if (flags.images) {
      for (const img of ["pgvector/pgvector:pg17", "typedb/typedb:3.4.4", "alpine:latest", "ollama/ollama:latest"]) {
        sh("docker", ["rmi", img], { windowsHide: true });
      }
      info("Образы удалены (или были заняты другими контейнерами)");
    }
  }

  // CLI-обёртка
  if (existsSync(binLink)) {
    rmrf(binLink) ? ok(`CLI-обёртка удалена: ${binLink}`) : warn(`Не удалить ${binLink}`);
  }

  // State (+ опц. workspace)
  if (flags.purgeWorkspace) {
    rmrf(NABU_HOME) ? warn(`Workspace УДАЛЁН: ${NABU_HOME}`) : warn(`Не удалить ${NABU_HOME}`);
  } else {
    rmrf(STATE_DIR);
    ok(`State удалён; workspace сохранён: ${NABU_HOME}`);
  }

  console.log(`\n${C.g}Nabu удалён.${C.x} Остался только репозиторий:`);
  console.log(`  rm -rf "${REPO_ROOT}"${flags.purgeWorkspace ? "" : `\nWorkspace с вашими файлами: ${NABU_HOME}`}`);
}

function cmdInstallService() {
  const cliPath = fileURLToPath(import.meta.url);
  const os = platform();
  // r-deploy: сервис должен читать ТОТ ЖЕ .env, что и установка (иначе systemd берёт
  // REPO_ROOT/.env вместо деплойного — бот не стартует, БД не та). Захватываем текущий ENV_PATH.
  const envLine = `NABU_ENV_PATH=${ENV_PATH}`;
  // PATH сервиса: systemd/launchd дают минимальный PATH без ~/.local/bin и nvm → claude/ollama
  // не находятся, обмен падает ENOENT. Пробрасываем PATH установки + гарантируем ~/.local/bin.
  const svcPath = `${join(homedir(), ".local", "bin")}:${process.env.PATH || "/usr/local/bin:/usr/bin"}`;
  const pathLine = `PATH=${svcPath}`;

  if (os === "linux") {
    if (!has("systemctl")) die("Linux без systemd: запускайте `nabu start` вручную или через cron @reboot");
    const unitDir = join(homedir(), ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(join(unitDir, "nabu.service"), `[Unit]
Description=Nabu daemon (scheduler + chat)
After=network.target docker.service

[Service]
ExecStart=${process.execPath} ${cliPath} daemon
Restart=on-failure
Environment=NABU_HOME=${NABU_HOME}
Environment=${envLine}
Environment=${pathLine}

[Install]
WantedBy=default.target
`);
    sh("systemctl", ["--user", "daemon-reload"]);
    sh("systemctl", ["--user", "enable", "--now", "nabu.service"]);
    return ok("systemd user unit установлен и запущен: systemctl --user status nabu");
  }

  if (os === "darwin") {
    // launchd user agent (~/Library/LaunchAgents), автозапуск при логине.
    const dir = join(homedir(), "Library", "LaunchAgents");
    mkdirSync(dir, { recursive: true });
    const plist = join(dir, "ai.nabu.daemon.plist");
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.nabu.daemon</string>
  <key>ProgramArguments</key><array>
    <string>${process.execPath}</string>
    <string>${cliPath}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>NABU_HOME</key><string>${NABU_HOME}</string><key>NABU_ENV_PATH</key><string>${ENV_PATH}</string><key>PATH</key><string>${svcPath}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict></plist>
`);
    sh("launchctl", ["unload", plist]);
    const r = sh("launchctl", ["load", plist]);
    if (r.code !== 0) die(`launchctl load не удался: ${r.errOut.slice(0, 200)}`);
    return ok(`launchd agent установлен: ${plist} (launchctl list | grep nabu)`);
  }

  if (os === "win32") {
    // Task Scheduler: запуск демона при входе пользователя.
    const cmd = `cmd /c set NABU_HOME=${NABU_HOME}&& set NABU_ENV_PATH=${ENV_PATH}&& "${process.execPath}" "${cliPath}" daemon`;
    const r = sh("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/TN", "NabuDaemon", "/TR", cmd], { windowsHide: true });
    if (r.code !== 0) die(`schtasks не удался: ${(r.errOut || r.out).slice(0, 200)}`);
    return ok('Задача планировщика "NabuDaemon" создана (запуск при входе). Удаление: schtasks /Delete /TN NabuDaemon /F');
  }

  die(`install-service: платформа ${os} не поддерживается`);
}

// ── Индексация папки/архива в базу знаний (с прогрессом в терминале) ──
async function cmdIndex(rest, flags) {
  let target = rest[0];
  if (!target) die("nabu index <папка|архив.zip> [--domain=<тема> --library]\n  --library — как справочный источник (kind=library); иначе personal (о пользователе)");
  loadEnvIntoProcess();
  // ZIP → распаковать в ~/Nabu/imports/<имя>/ и индексировать её.
  if (/\.zip$/i.test(target)) {
    const name = target.replace(/.*\//, "").replace(/\.zip$/i, "");
    const dest = join(NABU_HOME, "imports", name);
    mkdirSync(dest, { recursive: true });
    info(`Распаковываю ${target} → ${dest}…`);
    const r = sh("unzip", ["-o", "-q", resolve(target), "-d", dest]);
    if (r.code !== 0) die(`unzip не удался: ${(r.errOut || r.out).slice(0, 200)}`);
    target = dest;
  }
  const lib = await import(pathToFileURL(join(REPO_ROOT, "lib", "dist", "index.js")).href);
  if (!lib.isUnderAllowedRoot(target)) die(`Папка вне песочницы (разрешено: ~ и $NABU_HOME). Задайте NABU_INDEX_ROOTS для расширения.`);
  const deps = lib.buildDeps();
  const kind = flags.library ? "library" : "personal";
  if (kind === "library" && !flags.domain) die("для --library укажите --domain=<тема>");
  info(`Индексирую ${target} (${kind}${flags.domain ? ", domain=" + flags.domain : ""})…`);
  let lastLine = 0;
  try {
    const res = await lib.indexFolder(deps.knowledge, target, {
      kind, domain: flags.domain, visibility: kind === "library" ? "default" : "private",
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastLine > 500 || p.done === p.total) { // не спамим терминал
          lastLine = now;
          process.stdout.write(`\r  ${p.done}/${p.total} файлов · ${p.chunks} чанков · ${p.skipped} пропущено   `);
        }
      },
    });
    process.stdout.write("\n");
    ok(`Готово: ${res.files} файлов → ${res.chunks} чанков в базу знаний (${res.skipped} пропущено${res.truncated ? `, усечено до ${5000} файлов` : ""}).`);
  } finally {
    await deps.pg?.close?.();
  }
}

// ── Библиотека знаний (Q2): reference-источники (книги/URL) отдельно от памяти о пользователе ──
async function cmdLibrary(rest, flags) {
  const sub = rest[0];
  loadEnvIntoProcess(); // env из ENV_PATH (~/Nabu/.env), НЕ репо-.env; не зовём lib.hydrateEnv (он читает репо)
  const lib = await import(pathToFileURL(join(REPO_ROOT, "lib", "dist", "index.js")).href);
  const deps = lib.buildDeps();
  try {
    if (sub === "add") {
      const src = rest[1];
      if (!src) die("nabu library add <файл|URL> --domain <тема> [--title <имя>]");
      const domain = flags.domain || die("укажите --domain (тема: psychology/law/uiux…)");
      let text, source, origin;
      if (/^https?:\/\//i.test(src)) {
        // SSRF-гард: не тянем внутренние/приватные хосты.
        const h = new URL(src).hostname.replace(/^\[|\]$/g, "").toLowerCase();
        if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) {
          die(`внутренний/приватный хост запрещён (SSRF): ${h}`);
        }
        info(`Загружаю ${src}…`);
        const r = await fetch(src, { redirect: "follow", headers: { "user-agent": "Nabu-library/1.0" }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) die(`HTTP ${r.status}`);
        const raw = (await r.text()).slice(0, 5_000_000);
        text = /text\/plain/.test(r.headers.get("content-type") || "")
          ? raw
          : raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
        source = src; origin = src;
      } else {
        const abs = resolve(src);
        text = readFileSync(abs, "utf8"); source = abs; origin = abs; // текстовые файлы; PDF/OCR — через адъютанта (MCP)
      }
      if (!text?.trim()) die("источник пуст");
      const n = await deps.knowledge.indexDocument(source, text, { kind: "library", visibility: "default", domain, title: flags.title || source, origin });
      ok(`В библиотеку (${domain}): «${flags.title || source}» — ${n} чанков`);
    } else if (sub === "list") {
      const items = await deps.knowledge.listSources({ kind: "library", domain: flags.domain });
      if (!items.length) { info("Библиотека пуста. Добавьте: nabu library add <файл|URL> --domain <тема>"); return; }
      for (const s of items) console.log(`  [${s.domain || "—"}] ${s.title || s.source}  ·  ${s.chunks} чанков`);
      ok(`Источников: ${items.length}`);
    } else if (sub === "search") {
      const q = rest.slice(1).join(" ");
      if (!q) die("nabu library search <запрос> [--domain <тема>]");
      const hits = await deps.knowledge.search(q, { topK: Number(flags.topK) || 6, kind: "library", domain: flags.domain });
      if (!hits.length) { info("Ничего не найдено."); return; }
      for (const h of hits) console.log(`  (${h.score.toFixed(2)}) [${h.domain || "—"}] ${(h.title || h.source)}\n    ${h.content.slice(0, 160).replace(/\n/g, " ")}…`);
      ok(`Найдено: ${hits.length}`);
    } else {
      console.log("nabu library add <файл|URL> --domain <тема> [--title <имя>]\nnabu library list [--domain <тема>]\nnabu library search <запрос> [--domain <тема>]");
    }
  } finally {
    await deps.pg?.close?.();
  }
}

// ── main ──
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("--")) || "help"; // флаги можно и до команды
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v ?? true]; }));
const rest = argv.filter((a) => !a.startsWith("--")).slice(1);
if (flags.profile) globalThis.__nabuProfileFlag = String(flags.profile);

const HELP = `
${C.b}nabu${C.x} — zero-config запуск Nabu (ИИ-Совет на Claude Code)

  nabu init [--no-model]             первичная настройка (docker, схемы, модель, smoke)
  nabu start | stop [--infra]        демон: расписание + TTL-purge + веб-чат
  nabu status | logs [--n=100]       состояние / хвост лога демона
  nabu logs --chat | --job <j>       JSONL-лог чата / лог задачи расписания
  nabu stats                         статистика (память/знания/граф/Совет/сферы/RPG)
  nabu backup [--out=dir]            бэкап: Postgres + TypeDB + workspace (ретенция 7)
  nabu chat                          открыть веб-чат (http://127.0.0.1:${CHAT_PORT})
  nabu schedule [enable|disable <j>] список/управление agent-задачами
  nabu update                        git pull → build → рестарт демона
  nabu stop | daemon                 остановить демон · запустить в форграунде
  nabu models [--list] [N]           инвентаризация железа + каталог локальных моделей, установка
  nabu doctor [--deep]               диагностика (+диск/БД/лог/бэкап/расписание)
  nabu profiles [add <имя>]          профили: список / создать (--profile=<имя> у любой команды)
  nabu version                       версия
  nabu install-service               автозапуск: systemd (Linux) · launchd (macOS) · Task Scheduler (Windows)
  nabu backup --encrypt              бэкап с AES-256-GCM (ключ NABU_VAULT_KEY); backup-decrypt <f.enc>
  nabu restore <каталог>             восстановление из бэкапа (pg+typedb+workspace, с подтверждением)
  nabu import-health <файл>          импорт экспорта здоровья (Apple/Google Fit/CSV) в метрики
  nabu import-finance <csv>          импорт банковской выписки (локальная категоризация)
  nabu reset [--hard] [--dry-run]    стереть данные/стейт (установка и workspace сохраняются)
  nabu uninstall [--purge-workspace] [--images] [--dry-run]  полное удаление Nabu
`;

switch (cmd) {
  case "init": await cmdInit(flags); break;
  case "start": cmdStart(); break;
  case "stop": cmdStop(flags); break;
  case "status": await cmdStatus(); break;
  case "logs": cmdLogs(flags, rest); break;
  case "backup-decrypt": await cmdBackupDecrypt(rest); break;
  case "restore": await cmdRestore(rest, flags); break;
  case "backup": {
    const r = await cmdBackup(flags);
    if (r.failed.length) process.exitCode = 1; // честный код выхода при частичном/полном провале
    break;
  }
  case "stats": await cmdStats(); break;
  case "chat": cmdChat(); break;
  case "daemon": await cmdDaemon(); break;
  case "update": doUpdate(); break;
  case "doctor": await cmdDoctor(flags); break;
  case "models": await cmdModels(rest, flags); break;
  case "profiles": {
    if (rest[0] === "add" && rest[1]) {
      loadEnvIntoProcess();
      const name = rest[1].toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!name) { err("Имя профиля: латиница/цифры/дефис"); break; }
      const pf = liveConfig("profiles.json");
      const cfg = readJson(pf, { profiles: {} });
      if (cfg.profiles?.[name]) { warn(`Профиль '${name}' уже существует`); break; }
      const lib = await import(join(REPO_ROOT, "lib", "dist", "index.js"));
      const deps = lib.buildDeps();
      try {
        // users в standalone-схеме минимальна (id, created_at) — default values достаточно.
        const u = await deps.pg.queryOne("insert into users default values returning id", []);
        cfg.profiles = cfg.profiles ?? {};
        cfg.profiles[name] = { namespace: `nabu-${name}`, user_id: u.id };
        writeJson(pf, cfg);
        ok(`Профиль '${name}' создан: namespace=nabu-${name}, user_id=${u.id.slice(0, 8)}…`);
        info(`Использование: nabu --profile=${name} <команда>; в веб-чате появится в селекторе.`);
      } catch (e) {
        err(`Не удалось создать профиль: ${String(e.message).slice(0, 200)}`);
        process.exitCode = 1;
      } finally { await deps.pg.close().catch(() => { /* */ }); }
      break;
    }
    const cfg = readJson(liveConfig("profiles.json"), null);
    if (!cfg?.profiles || !Object.keys(cfg.profiles).length) {
      info("Профили не настроены. Создайте config/profiles.json: {\"profiles\": {\"имя\": {\"namespace\": \"...\", \"user_id\": \"...\"}}}");
    } else {
      for (const [n, p] of Object.entries(cfg.profiles)) console.log(`  ${n}: namespace=${p.namespace ?? "—"} user=${(p.user_id ?? "—").slice(0, 8)}`);
      info("Использование: nabu --profile <имя> <команда> или NABU_PROFILE=<имя>");
    }
    break;
  }
  case "schedule": cmdSchedule(rest); break;
  case "install-service": cmdInstallService(); break;
  case "index": await cmdIndex(rest, flags); break;
  case "library": case "lib": await cmdLibrary(rest, flags); break;
  case "import-health": await cmdImportHealth(rest, flags); break;
  case "import-finance": await cmdImportFinance(rest, flags); break;
  case "reset": await cmdReset(flags); break;
  case "uninstall": await cmdUninstall(flags); break;
  case "version": console.log(readJson(join(REPO_ROOT, "package.json"), {}).version || "?"); break;
  default:
    if (cmd !== "help") { err(`Неизвестная команда: ${cmd}`); process.exitCode = 1; }
    console.log(HELP);
}
