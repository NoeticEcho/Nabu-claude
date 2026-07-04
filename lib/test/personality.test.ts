// Юнит-тесты рендеринга личности (node:test, без БД). Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTraits, renderSalient, renderPersonalityBlock, applyGuardrails, ETHICAL_INVARIANTS } from "../dist/personality.js";

const highEmpathy = { empathy: 9, analytical: 9, directness: 9, honesty: 10, kindness: 9, verbosity: 2, humor: 1, risk_tolerance: 2 };
const lowEmpathy = { empathy: 1, analytical: 2, directness: 1, honesty: 10, kindness: 5, verbosity: 8, humor: 7, risk_tolerance: 9 };

test("renderTraits: возвращает директиву на каждую из 15 черт", () => {
  const d = renderTraits(highEmpathy);
  assert.ok(d.length >= 15, `ожидалось ≥15 директив, получено ${d.length}`);
  assert.ok(d.some((s) => /empathy/.test(s)));
  assert.ok(d.some((s) => /honesty/.test(s)));
});

test("renderTraits: высокие/низкие значения дают разные директивы", () => {
  const hi = renderTraits(highEmpathy).find((s) => s.startsWith("empathy"))!;
  const lo = renderTraits(lowEmpathy).find((s) => s.startsWith("empathy"))!;
  assert.notEqual(hi, lo);
  assert.match(hi, /понимани|поддержк|мягк/i);
  assert.match(lo, /факт/i);
});

test("renderTraits: honesty всегда упоминает порог ≥8", () => {
  const d = renderTraits({ honesty: 10 }).find((s) => s.startsWith("honesty"))!;
  assert.match(d, /≥8|порог/);
});

test("renderSalient: только выраженные черты, компактно", () => {
  const s = renderSalient(highEmpathy);
  assert.ok(s.length > 0 && s.length < 15, "salient короче полного набора");
  assert.ok(s.some((x) => /эмпатичн/i.test(x)));
  assert.ok(s.some((x) => /честн/i.test(x)), "honesty всегда включён");
  // средние значения (5) не должны попадать как «выраженные»
  const mid = renderSalient({ empathy: 5, analytical: 5, directness: 5, honesty: 10 });
  assert.ok(!mid.some((x) => /эмпатичн|фокус на фактах/i.test(x)), "средняя empathy не выражена");
});

test("renderPersonalityBlock: содержит директивы + этические инварианты", () => {
  const block = renderPersonalityBlock("finance", highEmpathy);
  assert.match(block, /finance/);
  for (const inv of ETHICAL_INVARIANTS) {
    assert.ok(block.includes(inv), `блок должен включать инвариант: ${inv}`);
  }
  assert.match(block, /не притворя/i);
});

test("ETHICAL_INVARIANTS: непусты и включают ключевые запреты", () => {
  assert.ok(ETHICAL_INVARIANTS.length >= 4);
  assert.ok(ETHICAL_INVARIANTS.some((s) => /манипул/i.test(s)));
  assert.ok(ETHICAL_INVARIANTS.some((s) => /человек/i.test(s)));
});

test("applyGuardrails: honesty поднимается до пола ≥8, даже если в профиле ниже", () => {
  assert.equal(applyGuardrails({ honesty: 2 }).honesty, 8);
  assert.equal(applyGuardrails({ honesty: 10 }).honesty, 10);
  // профильный min_honesty строже дефолта
  assert.equal(applyGuardrails({ honesty: 8 }, { min_honesty: 9 }).honesty, 9);
  // kindness — только если задан min_kindness
  assert.equal(applyGuardrails({ kindness: 1 }, { min_kindness: 4 }).kindness, 4);
  assert.equal(applyGuardrails({ kindness: 1 }).kindness, 1);
});

test("applyGuardrails: отсутствующая honesty не материализуется (рендер сам дефолтит на 10)", () => {
  assert.equal(applyGuardrails({ empathy: 5 }).honesty, undefined);
  // сквозная проверка: рендер профиля с низкой honesty всё равно даёт директиву ≥8
  const block = renderPersonalityBlock("t", applyGuardrails({ honesty: 1 }));
  assert.ok(/honesty \(8/.test(block), "honesty поднята до 8 в директиве");
});
