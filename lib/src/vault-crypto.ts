// Vault-шифрование: ДО записи в БД (client-side E2E). Инвариант #2 — самый чувствительный
// уровень (медицина/финансы/отношения) не должен уходить в облако/логи даже как ciphertext
// с восстановимым ключом. Ключ NABU_VAULT_KEY живёт ТОЛЬКО на машине пользователя (nabu init
// его генерирует); сервер БД видит лишь шифртекст. Без ключа vault-запись невозможна, а чтение
// отдаёт заглушку вместо расшифровки. Алгоритм — AES-256-GCM (аутентифицированное шифрование).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12; // рекомендованная длина nonce для GCM

/**
 * Ключ из env NABU_VAULT_KEY (base64url, ровно 32 байта после декода). Возвращает null, если
 * переменная не задана. Бросает внятную ошибку, если ключ задан, но некорректной длины/формата.
 */
export function getVaultKey(): Buffer | null {
  const raw = process.env.NABU_VAULT_KEY;
  if (!raw) return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64url");
  } catch {
    throw new Error("NABU_VAULT_KEY некорректен — ожидается base64url-строка");
  }
  if (key.length !== 32) {
    throw new Error(
      `NABU_VAULT_KEY должен декодироваться в 32 байта, получено ${key.length}. Сгенерируйте ключ через nabu init.`,
    );
  }
  return key;
}

/**
 * Зашифровать plaintext перед записью в vault. Формат:
 * `enc:v1:<iv b64url>:<tag b64url>:<ct b64url>`. Бросает, если ключ не задан.
 */
export function encryptVault(plain: string): string {
  const key = getVaultKey();
  if (!key) {
    throw new Error("NABU_VAULT_KEY не задан — vault недоступен; nabu init генерирует ключ");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

/**
 * Расшифровать строку формата `enc:v1:...`. Бросает при неверном ключе, порче данных или
 * несоответствии формата.
 */
export function decryptVault(s: string): string {
  const key = getVaultKey();
  if (!key) {
    throw new Error("NABU_VAULT_KEY не задан — vault недоступен; nabu init генерирует ключ");
  }
  if (!isVaultCiphertext(s)) {
    throw new Error("Не vault-шифртекст (нет префикса enc:v1:)");
  }
  const parts = s.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Повреждённый vault-шифртекст: ожидается iv:tag:ct");
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  // При неверном ключе/порче GCM-проверка тега бросит здесь.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Является ли строка vault-шифртекстом (по префиксу формата). */
export function isVaultCiphertext(s: string): boolean {
  return s.startsWith(PREFIX);
}

/**
 * Безопасная расшифровка для отображения: как decryptVault, но НИКОГДА не бросает —
 * при отсутствии/неверном ключе или порче возвращает заглушку. Не-шифртекст отдаётся как есть
 * (обратная совместимость со старыми plaintext-записями vault до включения шифрования).
 */
export function tryDecrypt(s: string): string {
  if (!isVaultCiphertext(s)) return s;
  try {
    return decryptVault(s);
  } catch {
    return "[vault: не расшифровать — нет/неверный ключ]";
  }
}
