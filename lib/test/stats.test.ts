// Юнит-тесты чистой статистики (node:test, без БД). Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as stats from "../dist/stats.js";

test("mean/variance/std/median/quantile", () => {
  assert.equal(stats.mean([2, 4, 6]), 4);
  assert.ok(Number.isNaN(stats.mean([])), "mean([])→NaN");
  assert.equal(stats.median([1, 2, 3]), 2);
  assert.equal(stats.median([1, 2, 3, 4]), 2.5);
  assert.equal(stats.quantile([1, 2, 3, 4], 0), 1);
  assert.equal(stats.quantile([1, 2, 3, 4], 1), 4);
  assert.equal(stats.variance([5, 5, 5]), 0);
  // Выборочная дисперсия (n−1): sum sq dev=32, /7 ≈4.5714, std≈2.138.
  assert.ok(Math.abs(stats.std([2, 4, 4, 4, 5, 5, 7, 9]) - Math.sqrt(32 / 7)) < 1e-9);
});

test("pearson: perfect, inverse, zero-variance, small-n", () => {
  assert.ok(Math.abs(stats.pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
  assert.ok(Math.abs(stats.pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-9);
  assert.ok(Number.isNaN(stats.pearson([1, 1, 1], [1, 2, 3])), "zero variance → NaN");
  assert.ok(Number.isNaN(stats.pearson([1, 2], [1, 2])), "n<3 → NaN");
});

test("spearman: monotonic non-linear = 1", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [1, 4, 9, 16, 25]; // монотонно возрастает
  assert.ok(Math.abs(stats.spearman(x, y) - 1) < 1e-9);
});

test("corrPValue: guards", () => {
  assert.ok(Number.isNaN(stats.corrPValue(1, 10)), "|r|>=1 → NaN");
  assert.ok(Number.isNaN(stats.corrPValue(0.5, 3)), "n<4 → NaN");
  const p = stats.corrPValue(0.9, 30);
  assert.ok(p >= 0 && p <= 1);
});

test("mutualInformation: guards + range", () => {
  assert.ok(Number.isNaN(stats.mutualInformation([1, 2], [1, 2])), "n<8 → NaN");
  const x = Array.from({ length: 40 }, (_, i) => i);
  const mi = stats.mutualInformation(x, x); // идентичные ряды → высокая MI
  assert.ok(mi >= 0 && mi <= 1);
  assert.ok(mi > 0.5, "identical series should have high normalized MI");
});

test("forecast: insufficient data + holt trend + CI ordering", () => {
  const few = stats.forecast([1, 2], 3);
  assert.equal(few.method, "insufficient-data");
  assert.equal(few.points.length, 3);

  const up = stats.forecast([1, 2, 3, 4, 5, 6], 3);
  assert.equal(up.method, "holt-linear");
  assert.equal(up.points.length, 3);
  assert.ok((up.points[0] as stats.ForecastPoint).value > 6, "растущий тренд продолжается");
  for (const p of up.points) {
    assert.ok(p.ciLow <= p.value && p.value <= p.ciHigh, "CI охватывает прогноз");
  }
  assert.ok(up.confidence >= 0 && up.confidence <= 1);
});

test("detectAnomalies: catches an injected spike, ignores flat", () => {
  const base = Array.from({ length: 20 }, (_, i) => ({ t: i * 86_400_000, v: 5 + Math.sin(i) * 0.2 }));
  base[15] = { t: 15 * 86_400_000, v: 50 }; // выброс
  const a = stats.detectAnomalies(base, 3);
  assert.ok(a.some((x) => x.index === 15 && x.kind === "spike"), "поймал всплеск idx15");

  const flat = Array.from({ length: 10 }, (_, i) => ({ t: i * 86_400_000, v: 7 }));
  assert.equal(stats.detectAnomalies(flat, 3).length, 0, "плоский ряд — без аномалий");
  assert.equal(stats.detectAnomalies([{ t: 0, v: 1 }], 3).length, 0, "n<5 — пусто");
});

test("aggregate: empty → NaN, normal values", () => {
  const empty = stats.aggregate([]);
  assert.equal(empty.count, 0);
  assert.ok(Number.isNaN(empty.mean));
  const agg = stats.aggregate([1, 2, 3, 4]);
  assert.equal(agg.count, 4);
  assert.equal(agg.sum, 10);
  assert.equal(agg.mean, 2.5);
  assert.equal(agg.min, 1);
  assert.equal(agg.max, 4);
});

test("aggregate/binIndices: large array does not overflow stack", () => {
  const big = Array.from({ length: 200_000 }, (_, i) => (i % 100));
  const agg = stats.aggregate(big); // не должно бросать RangeError
  assert.equal(agg.count, 200_000);
  assert.ok(agg.min === 0 && agg.max === 99);
  const x = big.slice(0, 50_000);
  assert.ok(stats.mutualInformation(x, x) >= 0); // binIndices на большом массиве
});

test("alignByDay: pairs same-day buckets", () => {
  const day = 86_400_000;
  const a = [{ t: 0, v: 1 }, { t: 100, v: 3 }, { t: day, v: 10 }];
  const b = [{ t: 200, v: 2 }, { t: day + 5, v: 20 }];
  const { x, y } = stats.alignByDay(a, b);
  assert.equal(x.length, 2);
  assert.deepEqual(x, [2, 10]); // день0 среднее (1,3)=2; день1=10
  assert.deepEqual(y, [2, 20]);
});
