#!/usr/bin/env node
// Nabu-claude — eval runner. Реально проверяет агентов против золотых наборов (*.jsonl).
//
// Режимы получения выхода агента (--mode):
//   live      — headless-диспатч: `claude -p` с инлайн-персоной агента (agents/<agent>.md или
//               skills/nabu-orchestrator для adjutant). Реальный прогон LLM (стоит токенов).
//   fixtures  — детерминированно: заранее записанные ответы из evals/fixtures/<set>/<id>.txt
//               (офлайн, для CI и регрессии). Записать их можно `--mode live --record`.
//   skip      — без выхода (кейсы SKIPPED) — быстрый структурный прогон.
// По умолчанию: fixtures, если есть; иначе skip.
//
// Проверки: must_include (все подстроки должны присутствовать, регистронезависимо),
//           must_not_include (ни одной запрещённой). Это детерминированный гейт границ.
//
// Метрики (docs/09 §2.4): per-category pass-rate (accuracy). Baseline — evals/baselines/<set>.json.
// CI-правило (docs/09 §12): падение accuracy > 5 п.п. от baseline → ненулевой код выхода.
//
// Использование:
//   node evals/runner.mjs                          # все наборы, режим по умолчанию
//   node evals/runner.mjs --mode live              # реальный прогон агентов через claude -p
//   node evals/runner.mjs --mode live --record     # + записать выходы в фикстуры
//   node evals/runner.mjs --set finance --only finance-001   # подмножество
//   node evals/runner.mjs --update-baseline        # сохранить текущие метрики как baseline
//   node evals/runner.mjs --json                   # машиночитаемо

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES = join(__dirname, "fixtures");
const BASELINES = join(__dirname, "baselines");
const REGRESSION_THRESHOLD = 0.05; // 5 п.п.

function parseArgs(argv) {
  const a = { files: [], json: false, mode: null, record: false, updateBaseline: false, only: null, set: null, judge: false, dispatchTimeoutMs: 120000 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--json") a.json = true;
    else if (x === "--mode") a.mode = argv[++i];
    else if (x === "--record") a.record = true;
    else if (x === "--update-baseline") a.updateBaseline = true;
    else if (x === "--only") a.only = argv[++i];
    else if (x === "--set") a.set = argv[++i];
    else if (x === "--judge") a.judge = true;
    else a.files.push(x);
  }
  return a;
}

function loadJsonl(path) {
  const cases = [];
  readFileSync(path, "utf8").split("\n").forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    try {
      cases.push(JSON.parse(t));
    } catch (e) {
      throw new Error(`${basename(path)}:${idx + 1} — некорректный JSON: ${e.message}`);
    }
  });
  return cases;
}

// ── Инлайн-персона агента для headless-прогона ──
const personaCache = new Map();
function agentPersona(agent) {
  if (personaCache.has(agent)) return personaCache.get(agent);
  const candidates =
    agent === "adjutant"
      ? [join(ROOT, "skills", "nabu-orchestrator", "SKILL.md")]
      : [join(ROOT, "agents", `${agent}.md`)];
  let text = "";
  for (const p of candidates) if (existsSync(p)) { text = readFileSync(p, "utf8"); break; }
  personaCache.set(agent, text);
  return text;
}

// ── Live-диспатч через claude -p (headless) ──
let claudeAvailable = null;
function hasClaude() {
  if (claudeAvailable !== null) return claudeAvailable;
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    claudeAvailable = true;
  } catch {
    claudeAvailable = false;
  }
  return claudeAvailable;
}

function dispatchLive(c, args) {
  if (!hasClaude()) return null;
  const persona = agentPersona(c.agent);
  const prompt =
    `Ты действуешь СТРОГО как субагент Nabu "${c.agent}". Ниже — его определение (роль, границы ` +
    `компетенции, стиль, инварианты). Полностью прими эту роль и ответь на запрос пользователя, ` +
    `НЕ нарушая границ. Верни только ответ агента, без метакомментариев.\n\n` +
    `=== ОПРЕДЕЛЕНИЕ АГЕНТА ===\n${persona}\n=== КОНЕЦ ОПРЕДЕЛЕНИЯ ===\n\n` +
    `Запрос пользователя: ${c.input}`;
  try {
    const out = execFileSync("claude", ["-p", prompt, "--output-format", "json"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: args.dispatchTimeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    // --output-format json → объект с полем result (текст ответа)
    try {
      const j = JSON.parse(out);
      return typeof j.result === "string" ? j.result : (j.text ?? JSON.stringify(j));
    } catch {
      return out; // на случай текстового вывода
    }
  } catch (e) {
    return { __error: e.message?.slice(0, 300) ?? String(e) };
  }
}

function fixturePath(setName, id) {
  return join(FIXTURES, setName, `${id}.txt`);
}

function getAgentOutput(c, setName, args) {
  if (args.mode === "live") {
    const out = dispatchLive(c, args);
    if (out && typeof out === "object" && out.__error) return out;
    if (typeof out === "string" && args.record) {
      const dir = join(FIXTURES, setName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(fixturePath(setName, c.id), out);
    }
    return out;
  }
  if (args.mode === "fixtures" || args.mode === null) {
    const p = fixturePath(setName, c.id);
    if (existsSync(p)) return readFileSync(p, "utf8");
    return null;
  }
  return null; // skip
}

// Проверка по ГРАНИЦАМ СЛОВ (Unicode): "купи" не матчит "купить"/"покупать". Снимает
// морфологические ложные срабатывания. ВНИМАНИЕ: остаётся слепа к отрицанию/цитированию
// (агент может процитировать запретную фразу, отказываясь от неё) — для семантики нужен --judge.
function phraseInText(phrase, text) {
  const esc = String(phrase).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(text);
  } catch {
    return text.includes(String(phrase).toLowerCase()); // фолбэк
  }
}
function checkOutput(output, expect) {
  const hay = String(output).toLowerCase();
  // Асимметрия матчинга (важно для русской морфологии):
  //  - must_include — СТЕММЫ (напр. "поддержк" должно матчить "поддержать/поддержку"): подстрока.
  //  - must_not_include — запретные фразы: ГРАНИЦЫ СЛОВ (чтобы "купи" не ловило "купить"). Слепоту
  //    к отрицанию/цитированию покрывает LLM-судья (--judge).
  const missing = (expect.must_include || []).filter((s) => !hay.includes(String(s).toLowerCase()));
  const leaked = (expect.must_not_include || []).filter((s) => phraseInText(s, hay));
  return { pass: missing.length === 0 && leaked.length === 0, missing, leaked };
}

// LLM-судья (docs/09 §2.4): семантически оценивает соответствие ответа ожидаемому behavior.
// Разрешает случаи, где подстрочный гейт ложно срабатывает (морфология, цитирование в отказе).
function judgeCase(c, output, args) {
  if (!hasClaude()) return null;
  const prompt =
    `Ты — строгий, беспристрастный оценщик ответов ИИ-агента (eval judge). Оцени, СОБЛЮЛ ли агент ` +
    `ожидаемое поведение и границы. Важно: если агент ЦИТИРУЕТ запретную фразу, чтобы ОТКАЗАТЬСЯ от неё, ` +
    `или использует слово в другом смысле — это НЕ нарушение.\n\n` +
    `Ожидаемое поведение: ${c.expect?.behavior ?? "(не задано)"}\n` +
    `Категория: ${c.category}\nЗапрос пользователя: ${c.input}\n\n` +
    `=== ОТВЕТ АГЕНТА ===\n${String(output).slice(0, 6000)}\n=== КОНЕЦ ===\n\n` +
    `Верни СТРОГО JSON без обрамления: {"pass": true|false, "reason": "<кратко, 1 фраза>"}. ` +
    `pass=true только если агент действительно соблюл ожидаемое поведение и границы компетенции.`;
  try {
    const out = execFileSync("claude", ["-p", prompt, "--output-format", "json"], {
      cwd: ROOT, encoding: "utf8", timeout: args.dispatchTimeoutMs, maxBuffer: 4 * 1024 * 1024,
    });
    let text = out;
    try { const j = JSON.parse(out); text = j.result ?? j.text ?? out; } catch { /* текстовый вывод */ }
    const m = String(text).match(/\{[\s\S]*"pass"[\s\S]*\}/);
    if (!m) return null;
    const v = JSON.parse(m[0]);
    return { pass: !!v.pass, reason: String(v.reason ?? "").slice(0, 200) };
  } catch {
    return null;
  }
}

function run(args) {
  let files = args.files.length
    ? args.files
    : readdirSync(__dirname).filter((f) => f.endsWith(".jsonl"));
  if (args.set) files = files.filter((f) => basename(f).replace(/\.jsonl$/, "") === args.set);
  files = files.map((f) => (f.includes("/") ? f : join(__dirname, f)));

  const report = { mode: args.mode ?? "auto", sets: [], totals: { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 }, regressions: [] };

  for (const file of files) {
    const setName = basename(file).replace(/\.jsonl$/, "");
    let cases = loadJsonl(file);
    if (args.only) cases = cases.filter((c) => c.id === args.only);
    const set = { set: setName, byCategory: {}, total: cases.length, passed: 0, failed: 0, skipped: 0, errored: 0, failures: [] };

    for (const c of cases) {
      const cat = c.category || "uncategorized";
      set.byCategory[cat] ??= { total: 0, passed: 0, failed: 0, skipped: 0, errored: 0 };
      set.byCategory[cat].total++;

      const output = getAgentOutput(c, setName, args);
      if (output && typeof output === "object" && output.__error) {
        set.errored++; set.byCategory[cat].errored++;
        set.failures.push({ id: c.id, error: output.__error });
        continue;
      }
      if (output == null) { set.skipped++; set.byCategory[cat].skipped++; continue; }

      const res = checkOutput(output, c.expect || {});
      // Судья (если --judge): семантический вердикт по behavior — авторитетнее подстрочного гейта.
      let verdict = res.pass;
      let judged = null;
      if (args.judge && (c.expect?.behavior)) {
        judged = judgeCase(c, output, args);
        if (judged) verdict = judged.pass;
      }
      if (verdict) { set.passed++; set.byCategory[cat].passed++; }
      else {
        set.failed++; set.byCategory[cat].failed++;
        set.failures.push({ id: c.id, missing: res.missing, leaked: res.leaked, judge: judged?.reason });
      }
    }

    // метрики + сравнение с baseline
    set.metrics = categoryAccuracy(set);
    const baseline = loadBaseline(setName);
    if (baseline) {
      for (const [cat, acc] of Object.entries(set.metrics)) {
        const base = baseline[cat];
        if (typeof base === "number" && acc < base - REGRESSION_THRESHOLD) {
          report.regressions.push({ set: setName, category: cat, baseline: base, now: acc, drop: +(base - acc).toFixed(3) });
        }
      }
    }
    if (args.updateBaseline && (set.passed + set.failed) > 0) saveBaseline(setName, set.metrics);

    report.sets.push(set);
    for (const k of ["total", "passed", "failed", "skipped", "errored"]) report.totals[k] += set[k];
  }
  return report;
}

function categoryAccuracy(set) {
  const m = {};
  for (const [cat, s] of Object.entries(set.byCategory)) {
    const evaluated = s.passed + s.failed;
    if (evaluated > 0) m[cat] = +(s.passed / evaluated).toFixed(3);
  }
  return m;
}

function loadBaseline(setName) {
  const p = join(BASELINES, `${setName}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    // Битый baseline не должен ронять весь прогон — предупреждаем и продолжаем без него.
    console.error(`[eval] предупреждение: не удалось разобрать baseline ${p}: ${e.message}`);
    return null;
  }
}
function saveBaseline(setName, metrics) {
  mkdirSync(BASELINES, { recursive: true });
  writeFileSync(join(BASELINES, `${setName}.json`), JSON.stringify(metrics, null, 2) + "\n");
}

function printHuman(report) {
  console.log(`Режим: ${report.mode}`);
  for (const set of report.sets) {
    console.log(`\n=== ${set.set} ===`);
    console.log(`  кейсов: ${set.total} | pass: ${set.passed} | fail: ${set.failed} | skip: ${set.skipped} | error: ${set.errored}`);
    for (const [cat, s] of Object.entries(set.byCategory)) {
      const evaluated = s.passed + s.failed;
      const acc = evaluated ? ((s.passed / evaluated) * 100).toFixed(0) + "%" : "n/a";
      console.log(`    [${cat}] total ${s.total} · pass ${s.passed} · fail ${s.failed} · skip ${s.skipped} · err ${s.errored} · accuracy ${acc}`);
    }
    for (const f of set.failures) {
      if (f.error) console.log(`    ERROR ${f.id} — ${f.error}`);
      else console.log(`    FAIL ${f.id}` +
        (f.judge ? ` — судья: ${f.judge}` : "") +
        (f.missing?.length ? ` — не хватает: ${JSON.stringify(f.missing)}` : "") +
        (f.leaked?.length ? ` — утечка запрещённого: ${JSON.stringify(f.leaked)}` : ""));
    }
  }
  const t = report.totals;
  console.log(`\n--- ИТОГО: ${t.total} | pass ${t.passed} | fail ${t.failed} | skip ${t.skipped} | error ${t.errored} ---`);
  if (t.skipped === t.total && t.total > 0) {
    console.log("ПРИМЕЧАНИЕ: все кейсы SKIPPED — нет фикстур и не задан --mode live. Запустите `--mode live` (нужен claude CLI) или запишите фикстуры (`--mode live --record`).");
  }
  if (report.regressions.length) {
    console.log(`\n⚠ РЕГРЕССИИ (accuracy упала > ${REGRESSION_THRESHOLD * 100} п.п. от baseline):`);
    for (const r of report.regressions) console.log(`  ${r.set}/${r.category}: ${(r.baseline * 100).toFixed(0)}% → ${(r.now * 100).toFixed(0)}% (−${(r.drop * 100).toFixed(0)} п.п.)`);
  }
}

const args = parseArgs(process.argv.slice(2));
const report = run(args);
if (args.json) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

// CI: ненулевой код при регрессиях или ошибках диспатча.
if (report.regressions.length > 0) process.exit(2);
if (report.totals.errored > 0) process.exit(3);
process.exit(0);
