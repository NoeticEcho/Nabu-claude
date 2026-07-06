// tenancy.ts — резолвинг тенанта (OlimpOS P1). Единственная точка создания/поиска пользователя и его
// личного пространства. Всё остальное получает готовые {userId, namespace} и скоупится через buildDeps.
//
// Личное пространство пользователя = mem_namespace с именем `u:<userId>`. Общий слой (агенты/скиллы/
// процедуры/агрегаты опыта) = COMMONS_NS. Изоляция: разные пользователи → разные namespace, личная
// память/знания/чаты не пересекаются (инвариант #1 платформы).

import type { Postgres } from "./db/postgres.js";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Well-known имя общего пространства (фиксированный UUID создаётся миграцией 019). */
export const COMMONS_NS = "__commons__";

export interface Tenant {
  userId: string;
  namespace: string; // имя личного пространства (`u:<userId>`)
}

/** Имя личного пространства пользователя. Стабильно и уникально по userId. */
export function personalNs(userId: string): string {
  return `u:${userId}`;
}

/**
 * Резолвинг тенанта по Telegram user id. Найдёт существующего или (при autoRegister) создаст нового:
 * user + личный mem_namespace + membership(owner) — атомарно. Возвращает {userId, namespace}.
 */
export async function resolveTenantByTelegram(
  pg: Postgres,
  tgUserId: number,
  opts: { displayName?: string; autoRegister?: boolean } = {},
): Promise<Tenant | null> {
  const existing = await pg.queryOne<{ id: string }>(
    "select id from users where tg_user_id = $1",
    [tgUserId],
  );
  if (existing) return { userId: existing.id, namespace: personalNs(existing.id) };
  if (opts.autoRegister === false) return null;
  return createTenant(pg, { tgUserId, displayName: opts.displayName });
}

/**
 * Резолвинг тенанта по id пользователя (web-сессия, P2). Пользователь уже аутентифицирован.
 */
export async function resolveTenantByUserId(pg: Postgres, userId: string): Promise<Tenant | null> {
  const u = await pg.queryOne<{ id: string }>("select id from users where id = $1 and status = 'active'", [userId]);
  return u ? { userId: u.id, namespace: personalNs(u.id) } : null;
}

/** Создать нового пользователя + личное пространство + membership. Атомарно. */
async function createTenant(
  pg: Postgres,
  fields: { tgUserId?: number; email?: string; passHash?: string; displayName?: string },
): Promise<Tenant> {
  return pg.tx(async (t) => {
    const u = await t.queryOne<{ id: string }>(
      "insert into users(tg_user_id, email, pass_hash, display_name) values ($1,$2,$3,$4) returning id",
      [fields.tgUserId ?? null, fields.email ?? null, fields.passHash ?? null, fields.displayName ?? null],
    );
    const userId = u!.id;
    const nsName = personalNs(userId);
    const ns = await t.queryOne<{ id: string }>(
      "insert into mem_namespace(name) values ($1) on conflict (name) do update set name = excluded.name returning id",
      [nsName],
    );
    await t.query("update users set personal_namespace = $2 where id = $1", [userId, ns!.id]);
    await t.query(
      "insert into membership(user_id, namespace, role) values ($1,$2,'owner') on conflict (user_id, namespace) do nothing",
      [userId, ns!.id],
    );
    return { userId, namespace: nsName };
  });
}

// ── Web-аутентификация (задел P2; хеш паролей на node:crypto scrypt, без внешних зависимостей) ──

/** Хеш пароля: scrypt с солью. Формат `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

/** Проверка пароля против хеша (constant-time). */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const dk = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

/** Регистрация web-пользователя email+пароль (P2). Возвращает тенанта или бросает при дубликате email. */
export async function registerWebUser(pg: Postgres, email: string, password: string, displayName?: string): Promise<Tenant> {
  const norm = email.trim().toLowerCase();
  const dup = await pg.queryOne<{ id: string }>("select id from users where email = $1", [norm]);
  if (dup) throw new Error("email уже зарегистрирован");
  return createTenant(pg, { email: norm, passHash: hashPassword(password), displayName });
}

/** Логин web-пользователя. Возвращает тенанта при успехе, иначе null. */
export async function loginWebUser(pg: Postgres, email: string, password: string): Promise<Tenant | null> {
  const norm = email.trim().toLowerCase();
  const u = await pg.queryOne<{ id: string; pass_hash: string | null }>(
    "select id, pass_hash from users where email = $1 and status = 'active'",
    [norm],
  );
  if (!u || !u.pass_hash || !verifyPassword(password, u.pass_hash)) return null;
  return { userId: u.id, namespace: personalNs(u.id) };
}
