// Юнит-тесты чистых утилит lib (без БД): chunkText, tqlString, toVectorLiteral.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText, tqlString, toVectorLiteral } from "../dist/index.js";

test("chunkText: короткий текст → один чанк", () => {
  assert.deepEqual(chunkText("короткая заметка"), ["короткая заметка"]);
});

test("chunkText: пустое / только пробелы → []", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\t  "), []);
});

test("chunkText: длинный текст → несколько чанков с перекрытием", () => {
  const para = Array.from({ length: 200 }, (_, i) => `Это предложение номер ${i} с уникальным содержанием.`).join(" ");
  const chunks = chunkText(para, 1200, 150);
  assert.ok(chunks.length >= 3, `ожидали ≥3 чанка, получили ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 1200 + 150 + 5, "чанк не превышает maxChars+overlap");
  // покрытие: каждое предложение исходника присутствует хотя бы в одном чанке
  const joined = chunks.join(" ");
  for (let i = 0; i < 200; i++) assert.ok(joined.includes(`номер ${i} `), `предложение ${i} потеряно`);
});

test("chunkText: граница maxChars не рвёт посреди, если есть точка", () => {
  const t = "А".repeat(1100) + ". " + "Б".repeat(1100);
  const chunks = chunkText(t, 1200, 100);
  assert.ok(chunks.length >= 2);
});

test("chunkText: не разрезает предложения посреди", () => {
  const text = Array.from({ length: 60 }, (_, i) => `Это предложение номер ${i} про важную идею и её развитие.`).join(" ");
  const chunks = chunkText(text, 300, 40);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(/[.!?\u2026]$/.test(c.trim()), `чанк обрывается не на конце предложения: ...${c.trim().slice(-30)}`);
});

test("tqlString: экранирует кавычки и обратный слэш", () => {
  assert.equal(tqlString('abc'), '"abc"');
  assert.equal(tqlString('say "hi"'), '"say \\"hi\\""');
  assert.equal(tqlString("path\\x"), '"path\\\\x"');
  assert.equal(tqlString("a\nb"), '"a\\nb"');
  assert.equal(tqlString("a\tb"), '"a\\tb"');
});

test("toVectorLiteral: формат pgvector-литерала", () => {
  assert.equal(toVectorLiteral([0.1, 0.2, 0.3]), "[0.1,0.2,0.3]");
  assert.equal(toVectorLiteral([]), "[]");
});
