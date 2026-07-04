#!/usr/bin/env node
// commons-tally.test.mjs — фикстур-тесты скоринга v2 Nabu Commons.
// Без фреймворка: `node scripts/commons-tally.test.mjs`. Exit 1 при первом провале.

import assert from "node:assert/strict";
import { computeRows, triage, tally } from "./commons-tally.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(String(err?.stack ?? err));
    process.exitCode = 1;
  }
}

// Хелперы для машинных блоков.
const evidenceBlock = ({ signals = "", version } = {}) =>
  `<!--nabu-evidence${version ? ` version="${version}"` : ""}${signals ? ` signals="${signals}"` : ""} period_days="30"-->`;
const nSignals = (n) => Array.from({ length: n }, (_, i) => `s${i}=1`).join(";");
const comment = (login, body) => ({ author: { login }, body });
const rowByNum = (rows, n) => rows.find((r) => r.number === n);

// --- 1. Взвешивание сигналов: signals=10 → w=2 → score = 2×2 = 4 -------------
test("signals=10 gives weight 2 (score = 4)", () => {
  const rows = computeRows([
    { number: 1, title: "perf", comments: [comment("alice", evidenceBlock({ signals: nSignals(10), version: "v0.9.0" }))] },
  ]);
  assert.equal(rowByNum(rows, 1).score, 4);
});

// Промежуточный вес: 2 сигнала → w=1.2 → score = 2×1.2 = 2.4
test("partial signals scale weight (2 signals → score 2.4)", () => {
  const rows = computeRows([
    { number: 1, title: "x", comments: [comment("alice", evidenceBlock({ signals: nSignals(2), version: "v1" }))] },
  ]);
  assert.equal(rowByNum(rows, 1).score, 2.4);
});

// Cap: сигналов больше SIGNAL_CAP — вес не превышает 2.
test("signals above cap stay at weight 2 (score 4)", () => {
  const rows = computeRows([
    { number: 1, title: "x", comments: [comment("alice", evidenceBlock({ signals: nSignals(50), version: "v1" }))] },
  ]);
  assert.equal(rowByNum(rows, 1).score, 4);
});

// --- 2. Дедуп по автору: берётся MAX-вес коммент, а не сумма -----------------
test("per-author dedup keeps max-weight comment", () => {
  const rows = computeRows([
    {
      number: 1,
      title: "x",
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(2), version: "v1" })), // w=1.2
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })), // w=2 (winner)
      ],
    },
  ]);
  const r = rowByNum(rows, 1);
  assert.equal(r.evidence, 1, "one distinct evidence author");
  assert.equal(r.score, 4, "score uses max weight (2), not sum");
});

// --- 3. Version diversity bonus: ≥2 разных версий → +1 -----------------------
test("version diversity adds +1", () => {
  const rows = computeRows([
    {
      number: 1,
      title: "same-version",
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })),
        comment("bob", evidenceBlock({ signals: nSignals(10), version: "v1" })),
      ],
    },
    {
      number: 2,
      title: "diverse",
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })),
        comment("bob", evidenceBlock({ signals: nSignals(10), version: "v2" })),
      ],
    },
  ]);
  assert.equal(rowByNum(rows, 1).score, 8, "two authors w=2 → 2×4, no bonus (single version)");
  assert.equal(rowByNum(rows, 2).score, 9, "same but two versions → +1 diversity bonus");
});

// Разные версии у ОДНОГО автора бонуса не дают (дедуп → одна версия).
test("same author across versions gives no diversity bonus", () => {
  const rows = computeRows([
    {
      number: 1,
      title: "x",
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })),
        comment("alice", evidenceBlock({ signals: nSignals(2), version: "v2" })),
      ],
    },
  ]);
  assert.equal(rowByNum(rows, 1).score, 4, "one author (max w=2), no cross-version bonus");
});

// --- 4. Обратная совместимость: evidence без signals → w=1 -------------------
test("legacy evidence without parsable signals weighs 1", () => {
  const rows = computeRows([
    { number: 1, title: "legacy", comments: [comment("alice", "<!--nabu-evidence-->")] },
    { number: 2, title: "empty-signals", comments: [comment("bob", evidenceBlock({ signals: "", version: "v1" }))] },
  ]);
  assert.equal(rowByNum(rows, 1).score, 2, "bare marker → w=1 → score 2");
  assert.equal(rowByNum(rows, 2).score, 2, "empty signals → w=1 → score 2");
});

test("thumbs add to evidence score", () => {
  const rows = computeRows([
    {
      number: 1,
      title: "x",
      reactionGroups: [{ content: "THUMBS_UP", users: { totalCount: 3 } }],
      comments: [comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" }))],
    },
  ]);
  assert.equal(rowByNum(rows, 1).score, 7, "3 👍 + 2×2");
});

// --- 5. Triage-корзины: new / ready / stale ---------------------------------
test("triage buckets: fresh, ready, stale", () => {
  const now = new Date("2026-07-04T00:00:00Z");
  const daysAgo = (d) => new Date(now.getTime() - d * 86_400_000).toISOString();
  const rows = computeRows([
    // #10: создан 2 дня назад → fresh; score мал.
    { number: 10, title: "fresh", createdAt: daysAgo(2) },
    // #20: score 8, 2 автора, без ready-for-dev, создан 30д назад → ready (не fresh, не stale).
    {
      number: 20,
      title: "ready",
      createdAt: daysAgo(30),
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })),
        comment("bob", evidenceBlock({ signals: nSignals(10), version: "v1" })),
      ],
    },
    // #21: тот же высокий score, но уже помечен ready-for-dev → НЕ в ready.
    {
      number: 21,
      title: "already-labeled",
      createdAt: daysAgo(30),
      labels: ["community-proposal", "ready-for-dev"],
      comments: [
        comment("alice", evidenceBlock({ signals: nSignals(10), version: "v1" })),
        comment("bob", evidenceBlock({ signals: nSignals(10), version: "v1" })),
      ],
    },
    // #30: создан 100д назад, score 1 (1 👍) → stale.
    { number: 30, title: "stale", createdAt: daysAgo(100), reactionGroups: [{ content: "THUMBS_UP", users: { totalCount: 1 } }] },
  ]);
  const { fresh, ready, stale } = triage(rows, now);
  assert.deepEqual(fresh.map((r) => r.number), [10], "only #10 is fresh");
  assert.deepEqual(ready.map((r) => r.number), [20], "only #20 ready (not the labeled #21)");
  assert.deepEqual(stale.map((r) => r.number), [30], "only #30 stale");
});

// --now даёт детерминированность: сдвигаем «сейчас» — корзины меняются.
test("triage honors provided now", () => {
  const rows = computeRows([{ number: 1, title: "x", createdAt: "2026-01-01T00:00:00Z" }]);
  // Через 3 дня после создания — fresh.
  const early = triage(rows, new Date("2026-01-04T00:00:00Z"));
  assert.deepEqual(early.fresh.map((r) => r.number), [1]);
  // Через 200 дней — уже stale (score 0 ≤ 1), не fresh.
  const late = triage(rows, new Date("2026-07-20T00:00:00Z"));
  assert.deepEqual(late.fresh.map((r) => r.number), []);
  assert.deepEqual(late.stale.map((r) => r.number), [1]);
});

// --- 6. Рендер: таблица над triage, секция мейнтейнера присутствует ----------
test("render places table above maintainer triage section", () => {
  const md = tally([{ number: 1, title: "x", createdAt: "2026-07-03T00:00:00Z" }], { now: new Date("2026-07-04T00:00:00Z") });
  const tableAt = md.indexOf("| # | Issue |");
  const triageAt = md.indexOf("## Для мейнтейнера");
  assert.ok(tableAt >= 0, "table present");
  assert.ok(triageAt >= 0, "triage section present");
  assert.ok(tableAt < triageAt, "table above triage");
  assert.ok(md.includes("🆕") && md.includes("🔥") && md.includes("💤"), "all three buckets rendered");
});

console.log(`\n${passed} passed`);
