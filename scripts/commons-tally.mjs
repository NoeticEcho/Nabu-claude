#!/usr/bin/env node
// commons-tally.mjs — детерминированный подсчёт приоритетов Nabu Commons (docs/COMMONS.md).
// Вход: JSON от `gh issue list --label community-proposal --state open
//   --json number,title,reactionGroups,comments,labels,createdAt` (файл-аргумент или stdin).
// Выход (stdout): docs/COMMUNITY_PRIORITIES.md — таблица + авто-triage для мейнтейнера.
// Никакого ИИ: скрипт обязан быть воспроизводимым любым участником локально.
//
// Скоринг v2 (advisory! финальное решение — за человеком-мейнтейнером):
//   Каждый evidence-коммент несёт машинный блок <!--nabu-evidence signals="a=..;b=.." version=..-->.
//   Вес по подтверждённости:   w = 1 + min(1, signals / SIGNAL_CAP)   → эффективно 1..2.
//     signals — число агрегатных сигналов (пар name=value) у инстанса; локальные подтверждения.
//     Cap на SIGNAL_CAP не даёт «надуть» вес одним комментом с сотней сигналов.
//     Legacy-комменты без парсимых signals → signals=0 → w=1 (обратная совместимость).
//   Один автор = один голос: по каждому автору берём его MAX-вес коммент (анти-спам).
//   score = 👍 + EVIDENCE_MULT × Σ w(по авторам).
//   Version diversity: если evidence-авторы охватывают ≥ DIVERSITY_MIN_VERSIONS разных
//     версий nabu → score += DIVERSITY_BONUS (сигнал воспроизводится в разных версиях).
//
// Auto-triage (секция «Для мейнтейнера»): три списка-подсказки —
//   🆕 новые за NEW_DAYS дней · 🔥 готовы к ready-for-dev (score≥READY_SCORE и
//   ≥READY_MIN_AUTHORS evidence-авторов, без метки ready-for-dev) · 💤 кандидаты на
//   закрытие (старше STALE_DAYS дней и score≤STALE_SCORE). Всё — только advisory.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EVIDENCE_MARK = "<!--nabu-evidence";

// --- Константы скоринга (см. шапку) -----------------------------------------
const SIGNAL_CAP = 10; // при скольких сигналах вес выходит на максимум (w=2)
const EVIDENCE_MULT = 2; // множитель вклада взвешенных evidence в score
const DIVERSITY_MIN_VERSIONS = 2; // сколько разных версий даёт бонус
const DIVERSITY_BONUS = 1; // прибавка score за версионное разнообразие
// --- Константы triage --------------------------------------------------------
const NEW_DAYS = 7; // окно «новых» предложений
const READY_SCORE = 5; // порог score для ready-for-dev
const READY_MIN_AUTHORS = 2; // минимум различных evidence-авторов для ready-for-dev
const STALE_DAYS = 90; // возраст «кандидата на закрытие»
const STALE_SCORE = 1; // потолок score «кандидата на закрытие»

const DAY_MS = 86_400_000;
const round2 = (n) => Math.round(n * 100) / 100;

function thumbs(issue) {
  for (const g of issue.reactionGroups ?? []) {
    if (g.content === "THUMBS_UP") return g.users?.totalCount ?? 0;
  }
  return 0;
}

// Парсит машинный блок evidence из тела коммента. null — если это не evidence.
// Legacy-блок без атрибута signals → signals=0, weight=1.
function parseEvidence(body) {
  if (!body.includes(EVIDENCE_MARK)) return null;
  const block = /<!--nabu-evidence\b([^]*?)-->/.exec(body);
  const attrs = block ? block[1] : "";
  const version = (/version="([^"]*)"/.exec(attrs) ?? [])[1] || null;
  const signalsRaw = (/signals="([^"]*)"/.exec(attrs) ?? [])[1] ?? "";
  const signals = signalsRaw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.includes("=")).length;
  const weight = 1 + Math.min(1, signals / SIGNAL_CAP);
  return { version, signals, weight };
}

// Агрегат evidence по issue: один автор = его max-вес коммент.
// authors — число различных evidence-авторов; sumWeight — Σ max-весов; versions — set версий.
function evidenceStats(issue) {
  const perAuthor = new Map(); // author -> { weight, version }
  let anon = 0;
  for (const c of issue.comments ?? []) {
    const body = typeof c === "string" ? c : (c.body ?? "");
    const ev = parseEvidence(body);
    if (!ev) continue;
    const author = typeof c === "object" ? (c.author?.login ?? `#${anon++}`) : `#${anon++}`;
    const prev = perAuthor.get(author);
    if (!prev || ev.weight > prev.weight) perAuthor.set(author, ev);
  }
  let sumWeight = 0;
  const versions = new Set();
  for (const { weight, version } of perAuthor.values()) {
    sumWeight += weight;
    if (version) versions.add(version);
  }
  return { authors: perAuthor.size, sumWeight, versions };
}

function category(issue) {
  const m = /category:\s*(\w+)/.exec(issue.body ?? "");
  if (m) return m[1];
  const lbl = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)).find((n) => n !== "community-proposal");
  return lbl ?? "—";
}

function labelsOf(issue) {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
}

export function computeRows(issues) {
  if (!Array.isArray(issues)) throw new Error("ожидался JSON-массив issues");
  const rows = issues.map((i) => {
    const ev = evidenceStats(i);
    let score = thumbs(i) + EVIDENCE_MULT * ev.sumWeight;
    if (ev.versions.size >= DIVERSITY_MIN_VERSIONS) score += DIVERSITY_BONUS;
    return {
      number: i.number,
      title: String(i.title ?? "").slice(0, 80),
      thumbs: thumbs(i),
      evidence: ev.authors, // число различных evidence-авторов
      versions: ev.versions.size,
      category: category(i),
      labels: labelsOf(i),
      createdAt: (i.createdAt ?? "").slice(0, 10),
      createdAtRaw: i.createdAt ?? "",
      score: round2(score),
    };
  });
  // стабильная сортировка: score ↓, затем старшинство (раньше создан — выше), затем номер
  rows.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
  return rows;
}

// Возраст в днях относительно now; NaN для отсутствующих/битых дат.
function ageDays(createdAtRaw, now) {
  if (!createdAtRaw) return NaN;
  return (now.getTime() - new Date(createdAtRaw).getTime()) / DAY_MS;
}

export function triage(rows, now) {
  const fresh = rows.filter((r) => {
    const age = ageDays(r.createdAtRaw, now);
    return Number.isFinite(age) && age <= NEW_DAYS;
  });
  const ready = rows.filter(
    (r) => r.score >= READY_SCORE && r.evidence >= READY_MIN_AUTHORS && !r.labels.includes("ready-for-dev"),
  );
  const stale = rows.filter((r) => {
    const age = ageDays(r.createdAtRaw, now);
    return Number.isFinite(age) && age >= STALE_DAYS && r.score <= STALE_SCORE;
  });
  return { fresh, ready, stale };
}

function escapeMd(s) {
  return s.replace(/\|/g, "\\|");
}

function bullet(r) {
  return `- #${r.number} ${escapeMd(r.title)} (${r.score})`;
}

function triageList(title, items) {
  if (items.length === 0) return [title, "_нет_", ""];
  return [title, ...items.map(bullet), ""];
}

export function render(rows, { now = new Date() } = {}) {
  const nowStr = now.toISOString().slice(0, 10);
  const { fresh, ready, stale } = triage(rows, now);
  const out = [
    "# Приоритеты сообщества Nabu (авто-tally)",
    "",
    `Обновлено: ${nowStr} · issues: ${rows.length} · скоринг v2: 👍 + 2×Σвес(evidence) + diversity (см. docs/COMMONS.md).`,
    "Файл генерируется еженедельно workflow'ом commons-tally — не редактировать вручную.",
    "",
    "| # | Issue | Категория | 👍 | Evidence | Score |",
    "|---|---|---|---|---|---|",
    ...rows.map((r, idx) => `| ${idx + 1} | #${r.number} ${escapeMd(r.title)} | ${r.category} | ${r.thumbs} | ${r.evidence} | **${r.score}** |`),
    "",
    rows.length === 0 ? "_Открытых предложений нет._\n" : "",
    "## Для мейнтейнера",
    "",
    "Авто-triage — только подсказки; решает человек-мейнтейнер (см. docs/COMMONS.md).",
    "",
    ...triageList(`### 🆕 Новые за ${NEW_DAYS} дней`, fresh),
    ...triageList(`### 🔥 Готовы к ready-for-dev (score ≥ ${READY_SCORE}, ≥${READY_MIN_AUTHORS} evidence-авторов)`, ready),
    ...triageList(`### 💤 Кандидаты на закрытие (старше ${STALE_DAYS} дней, score ≤ ${STALE_SCORE})`, stale),
  ];
  return out.join("\n").trimEnd() + "\n";
}

export function tally(issues, opts = {}) {
  return render(computeRows(issues), opts);
}

function main() {
  const args = process.argv.slice(2);
  const nowArg = args.find((a) => a.startsWith("--now="));
  const now = nowArg ? new Date(nowArg.slice("--now=".length)) : new Date();
  const src = args.find((a) => !a.startsWith("--"));
  const raw = src ? readFileSync(src, "utf8") : readFileSync(0, "utf8");
  const issues = JSON.parse(raw);
  process.stdout.write(tally(issues, { now }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
