// Юнит-тесты чистых RPG/XP-функций (без БД): уровни на границах, xp-до-следующего,
// маппинг доменов, суммы за задачи и форма листа персонажа.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XP_ATTRS,
  attrLevel,
  overallLevel,
  xpToNext,
  domainToAttribute,
  taskXp,
  characterSummary,
  QUALITATIVE_CAP,
} from "../dist/index.js";

test("attrLevel: границы уровней атрибута (divisor 50)", () => {
  assert.equal(attrLevel(0), 0, "0 → уровень 0");
  assert.equal(attrLevel(49), 0, "49 → ещё 0");
  assert.equal(attrLevel(50), 1, "50 → уровень 1");
  assert.equal(attrLevel(199), 1, "199 → ещё 1");
  assert.equal(attrLevel(200), 2, "200 → уровень 2");
  assert.equal(attrLevel(450), 3, "450 → уровень 3");
});

test("attrLevel: отрицательное/мусор не роняет (пол 0)", () => {
  assert.equal(attrLevel(-100), 0);
});

test("overallLevel: границы общего уровня (divisor 100)", () => {
  assert.equal(overallLevel(0), 0, "0 → 0");
  assert.equal(overallLevel(99), 0, "99 → ещё 0");
  assert.equal(overallLevel(100), 1, "100 → уровень 1");
  assert.equal(overallLevel(400), 2, "400 → уровень 2");
  assert.equal(overallLevel(900), 3, "900 → уровень 3");
});

test("xpToNext: атрибут — сколько до следующего уровня", () => {
  assert.equal(xpToNext(0, "attribute"), 50, "с 0 до ур.1 нужно 50");
  assert.equal(xpToNext(50, "attribute"), 150, "с 50 (ур.1) до ур.2 (200) — 150");
  assert.equal(xpToNext(200, "attribute"), 250, "с 200 (ур.2) до ур.3 (450) — 250");
});

test("xpToNext: общий уровень и дефолт формулы = attribute", () => {
  assert.equal(xpToNext(0, "overall"), 100, "с 0 до общего ур.1 — 100");
  assert.equal(xpToNext(100, "overall"), 300, "с 100 (ур.1) до ур.2 (400) — 300");
  assert.equal(xpToNext(0), 50, "по умолчанию — формула атрибута");
});

test("domainToAttribute: сферы жизни → атрибут", () => {
  assert.equal(domainToAttribute("health"), "vitality");
  assert.equal(domainToAttribute("work"), "discipline");
  assert.equal(domainToAttribute("learning"), "intellect");
  assert.equal(domainToAttribute("finance"), "wealth");
  assert.equal(domainToAttribute("relationships"), "sociality");
  assert.equal(domainToAttribute("growth"), "resilience");
  assert.equal(domainToAttribute("mind"), "wisdom");
  assert.equal(domainToAttribute("creative"), "creativity");
});

test("domainToAttribute: регистр/пробелы и дефолт → discipline", () => {
  assert.equal(domainToAttribute("  Health "), "vitality");
  assert.equal(domainToAttribute(undefined), "discipline");
  assert.equal(domainToAttribute(""), "discipline");
  assert.equal(domainToAttribute("нечто-неизвестное"), "discipline");
});

test("taskXp: веса приоритетов", () => {
  assert.equal(taskXp("high"), 15);
  assert.equal(taskXp("normal"), 10);
  assert.equal(taskXp("low"), 5);
  assert.equal(taskXp(undefined), 10, "нет приоритета → normal");
  assert.equal(taskXp("weird"), 10, "неизвестный → normal");
});

test("characterSummary: форма и вычисленные уровни", () => {
  const sheet = {
    intellect_xp: 200, // ур.2
    wisdom_xp: 50, // ур.1
    creativity_xp: 0,
    discipline_xp: 0,
    vitality_xp: 0,
    resilience_xp: 0,
    sociality_xp: 0,
    wealth_xp: 0,
  };
  const s = characterSummary(sheet);
  assert.equal(s.total, 250, "сумма всех xp");
  assert.equal(s.level, overallLevel(250), "общий уровень из суммы");
  assert.equal(s.attrs.length, XP_ATTRS.length, "по атрибуту на каждый из 8");
  assert.ok(typeof s.toNext === "number", "есть xp-до-следующего общего");

  const intellect = s.attrs.find((a) => a.name === "intellect");
  assert.ok(intellect, "intellect присутствует");
  assert.deepEqual(
    { xp: intellect.xp, level: intellect.level },
    { xp: 200, level: 2 },
    "intellect: 200 xp → ур.2",
  );
  // каждый атрибут отдаёт документированную форму
  for (const a of s.attrs) {
    assert.deepEqual(Object.keys(a).sort(), ["level", "name", "toNext", "xp"]);
  }
});

test("characterSummary: пустой/отсутствующий лист → нули", () => {
  const s = characterSummary(null);
  assert.equal(s.total, 0);
  assert.equal(s.level, 0);
  assert.equal(s.attrs.length, 8);
  assert.ok(s.attrs.every((a) => a.xp === 0 && a.level === 0));
});

test("QUALITATIVE_CAP: потолок качественного начисления объявлен", () => {
  assert.equal(QUALITATIVE_CAP, 25);
});
