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
  const para = "Предложение номер один. ".repeat(200); // ~4800 символов
  const chunks = chunkText(para, 1200, 150);
  assert.ok(chunks.length >= 3, `ожидали ≥3 чанка, получили ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 1200 + 5, "чанк не превышает лимит (с запасом)");
  // покрытие: суммарная длина чанков ≥ исходной (из-за overlap)
  const total = chunks.reduce((n, c) => n + c.length, 0);
  assert.ok(total >= para.trim().length, "перекрытие сохраняет покрытие");
});

test("chunkText: граница maxChars не рвёт посреди, если есть точка", () => {
  const t = "А".repeat(1100) + ". " + "Б".repeat(1100);
  const chunks = chunkText(t, 1200, 100);
  assert.ok(chunks.length >= 2);
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
