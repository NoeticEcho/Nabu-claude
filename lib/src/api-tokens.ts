// api-tokens.ts — личные bearer-токены публичного API (Public API v1).
// Токен: `nabu_pat_<random>`, выдаётся один раз; в БД — только sha256-хеш (как креды в аудите R8).
// verifyToken резолвит активный токен в user_id (тенант) и обновляет last_used_at. Токены отзываемы.

import type { Postgres } from "./db/postgres.js";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export const API_TOKEN_PREFIX = "nabu_pat_";

/** sha256(token) в hex — то, что хранится и ищется в БД (сам токен не хранится). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Выдать новый токен пользователю. Возвращает ОТКРЫТЫЙ токен (показать один раз) + его id. */
export async function issueToken(pg: Postgres, userId: string, name?: string): Promise<{ token: string; id: string }> {
  const token = API_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const r = await pg.queryOne<{ id: string }>(
    "insert into api_token(user_id, token_hash, name) values ($1,$2,$3) returning id",
    [userId, hashToken(token), name ?? null],
  );
  return { token, id: r!.id };
}

/**
 * Проверить bearer-токен → { userId, tokenId } или null. Ищем по sha256-хешу среди активных
 * (revoked_at is null). Сравнение хеша — constant-time (защита от timing-атак по префиксу).
 * Обновляем last_used_at (best-effort). Возврат null → 401 в API-слое (fail-closed).
 */
export async function verifyToken(pg: Postgres, token: string | undefined): Promise<{ userId: string; tokenId: string } | null> {
  if (!token || !token.startsWith(API_TOKEN_PREFIX)) return null;
  const hash = hashToken(token);
  const row = await pg.queryOne<{ id: string; user_id: string; token_hash: string }>(
    "select id, user_id, token_hash from api_token where token_hash = $1 and revoked_at is null",
    [hash],
  );
  if (!row) return null;
  // Доп. constant-time сверка (индекс уже сузил до точного хеша, но не полагаемся только на =).
  const a = Buffer.from(hash), b = Buffer.from(row.token_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await pg.query("update api_token set last_used_at = now() where id = $1", [row.id]).catch(() => { /* best-effort */ });
  return { userId: row.user_id, tokenId: row.id };
}

/** Список токенов пользователя (без самих секретов — их нет в БД). */
export async function listTokens(pg: Postgres, userId: string): Promise<unknown[]> {
  return pg.query(
    "select id, name, created_at, last_used_at, revoked_at from api_token where user_id = $1 order by created_at desc",
    [userId],
  );
}

/** Отозвать токен (только свой). true, если что-то отозвано. */
export async function revokeToken(pg: Postgres, userId: string, tokenId: string): Promise<boolean> {
  const r = await pg.query(
    "update api_token set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id",
    [tokenId, userId],
  );
  return r.length > 0;
}
