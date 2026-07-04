// Юнит-тесты vault-шифрования (без БД): раундтрип, распознавание шифртекста, неверный ключ,
// заглушка tryDecrypt, отсутствие ключа. Ключ генерируем прямо в тесте (32 байта base64url).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Ключ должен быть задан ДО первого вызова шифрования; getVaultKey() читает env каждый раз.
const KEY_A = randomBytes(32).toString("base64url");
process.env.NABU_VAULT_KEY = KEY_A;

const { encryptVault, decryptVault, isVaultCiphertext, tryDecrypt } = await import("../dist/vault-crypto.js");

test("encrypt/decrypt roundtrip (ascii + unicode)", () => {
  for (const plain of ["hello vault", "медицина: анализ крови 2026", "emoji 🩺💊 and ☯ symbols"]) {
    const ct = encryptVault(plain);
    assert.notEqual(ct, plain);
    assert.ok(isVaultCiphertext(ct));
    assert.equal(decryptVault(ct), plain);
  }
});

test("ciphertext is randomized per call (unique iv)", () => {
  const a = encryptVault("same");
  const b = encryptVault("same");
  assert.notEqual(a, b);
  assert.equal(decryptVault(a), "same");
  assert.equal(decryptVault(b), "same");
});

test("isVaultCiphertext true only for enc:v1: prefix", () => {
  assert.ok(isVaultCiphertext(encryptVault("x")));
  assert.equal(isVaultCiphertext("plain text"), false);
  assert.equal(isVaultCiphertext("enc:v0:foo"), false);
  assert.equal(isVaultCiphertext(""), false);
});

test("decrypt with wrong key throws", () => {
  const ct = encryptVault("secret");
  const KEY_B = randomBytes(32).toString("base64url");
  process.env.NABU_VAULT_KEY = KEY_B; // другой ключ
  assert.throws(() => decryptVault(ct));
  process.env.NABU_VAULT_KEY = KEY_A; // вернуть корректный
  assert.equal(decryptVault(ct), "secret");
});

test("tryDecrypt returns placeholder on wrong key, never throws", () => {
  const ct = encryptVault("secret2");
  const KEY_B = randomBytes(32).toString("base64url");
  process.env.NABU_VAULT_KEY = KEY_B;
  const out = tryDecrypt(ct);
  assert.match(out, /vault: не расшифровать/);
  process.env.NABU_VAULT_KEY = KEY_A;
});

test("tryDecrypt passes through non-ciphertext unchanged", () => {
  assert.equal(tryDecrypt("just a note"), "just a note");
});

test("encryptVault throws when key missing", () => {
  delete process.env.NABU_VAULT_KEY;
  assert.throws(() => encryptVault("x"), /NABU_VAULT_KEY не задан/);
  process.env.NABU_VAULT_KEY = KEY_A;
});

test("getVaultKey rejects malformed key length", async () => {
  const { getVaultKey } = await import("../dist/vault-crypto.js");
  process.env.NABU_VAULT_KEY = Buffer.from("short").toString("base64url"); // != 32 байта
  assert.throws(() => getVaultKey(), /32 байта/);
  process.env.NABU_VAULT_KEY = KEY_A;
});

// ── Аудит r2 §3.7: устойчивость к malformed-шифртексту (крафтовый/повреждённый ввод) ──
test("malformed ciphertext: decryptVault бросает, tryDecrypt — никогда", () => {
  const cases = [
    "enc:v1:onlyone",                 // мало сегментов
    "enc:v1:a:b",                     // мало сегментов (после префикса 2 вместо 3)
    "enc:v1:::",                      // пустые сегменты (пустой IV)
    "enc:v1:AAAA:BBBB:CCCC",          // мусорные, но валидные base64url сегменты
  ];
  for (const c of cases) {
    assert.throws(() => decryptVault(c), Error, `decryptVault должен бросить на ${JSON.stringify(c)}`);
    const out = tryDecrypt(c);
    assert.equal(typeof out, "string", "tryDecrypt всегда строка");
    // либо заглушка, либо (теоретически) passthrough — но НИКОГДА не исключение
  }
});

test("tampered auth tag: расшифровка отвергается (GCM-целостность)", () => {
  const enc = encryptVault("целостность важна");
  const parts = enc.split(":");
  // портим tag: заменяем первый символ base64url на другой
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  const tampered = parts.join(":");
  assert.throws(() => decryptVault(tampered), Error, "порченый tag обязан отвергаться");
  assert.match(tryDecrypt(tampered), /vault: не расшифровать/);
});

test("tampered ciphertext body: отвергается", () => {
  const enc = encryptVault("тело тоже проверяется");
  const parts = enc.split(":");
  parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
  assert.throws(() => decryptVault(parts.join(":")), Error);
});
