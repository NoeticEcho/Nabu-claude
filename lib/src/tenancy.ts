// tenancy.ts — резолвинг тенанта (OlimpOS P1). Единственная точка создания/поиска пользователя и его
// личного пространства. Всё остальное получает готовые {userId, namespace} и скоупится через buildDeps.
//
// Личное пространство пользователя = mem_namespace с именем `u:<userId>`. Общий слой (агенты/скиллы/
// процедуры/агрегаты опыта) = COMMONS_NS. Изоляция: разные пользователи → разные namespace, личная
// память/знания/чаты не пересекаются (инвариант #1 платформы).

import type { Postgres } from "./db/postgres.js";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { generateSite } from "./sitegen.js";
import { join } from "node:path";

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

// ── Вход через Telegram (deep-link, OlimpOS P2) ──

const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;

/** Создать одноразовый код входа. Веб отдаёт deep-link t.me/<bot>?start=<code>. */
export async function createLoginCode(pg: Postgres): Promise<string> {
  const code = randomBytes(9).toString("base64url"); // ~12 симв
  // чистка протухших (согласовано с LOGIN_CODE_TTL_MS, а не хардкод 15 мин — AUDIT R8)
  await pg.query("delete from tg_login_code where created_at < now() - ($1 || ' milliseconds')::interval", [String(LOGIN_CODE_TTL_MS)]);
  await pg.query("insert into tg_login_code(code) values ($1)", [code]);
  return code;
}

/**
 * Бот привязывает свой tg_user_id к коду (после /start <code>). Создаёт тенанта, если нужно.
 * ОДНОРАЗОВО и с TTL (AUDIT R8 M2): claim проходит ТОЛЬКО если код ещё не заявлен (`tg_user_id is null`)
 * и не протух. Иначе — перехвативший deep-link код мог бы перепривязать его к своему аккаунту
 * (account confusion / session fixation). Проверка «не заявлен» атомарна в самом UPDATE.
 */
export async function claimLoginCode(pg: Postgres, code: string, tgUserId: number, displayName?: string): Promise<boolean> {
  await resolveTenantByTelegram(pg, tgUserId, { displayName }); // гарантируем аккаунт
  const r = await pg.query(
    `update tg_login_code set tg_user_id = $2
     where code = $1 and tg_user_id is null
       and created_at > now() - ($3 || ' milliseconds')::interval
     returning code`,
    [code, tgUserId, String(LOGIN_CODE_TTL_MS)],
  );
  return r.length > 0;
}

/** Веб опрашивает код: если привязан ботом и не протух — вернуть тенанта и погасить код. */
export async function consumeLoginCode(pg: Postgres, code: string): Promise<Tenant | null> {
  const row = await pg.queryOne<{ tg_user_id: string | null; created_at: string }>("select tg_user_id, created_at from tg_login_code where code = $1", [code]);
  if (!row) return null;
  if (Date.now() - new Date(row.created_at).getTime() > LOGIN_CODE_TTL_MS) { await pg.query("delete from tg_login_code where code=$1", [code]); return null; }
  if (row.tg_user_id == null) return null; // ещё не подтверждён
  const t = await resolveTenantByTelegram(pg, Number(row.tg_user_id), {});
  await pg.query("delete from tg_login_code where code=$1", [code]); // одноразовый
  return t;
}

// ── Пространства проектов/команд (OlimpOS P3) ──

export interface SpaceTenant {
  namespace: string;   // имя пространства проекта (`g:<chatId>` или `p:<uuid>`)
  userId: string;      // синтетический аккаунт проекта (для доменного скоупа: tasks/projects)
  spaceId: string;     // = namespace uuid
}

/**
 * Опубликовать space как публичный сайт (OlimpOS P6): сгенерировать статику из srcDir в
 * sitesRoot/<slug> и пометить space public со slug. Доступен по URL /s/<slug>. slug санитизируется.
 */
export async function publishSpace(
  pg: Postgres,
  namespaceId: string,
  slug: string,
  srcDir: string,
  sitesRoot: string,
  opts: { title?: string } = {},
): Promise<{ slug: string; pages: number; url: string }> {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase().slice(0, 60);
  if (!safe) throw new Error("пустой slug");
  const taken = await pg.queryOne<{ namespace: string }>("select namespace from space where slug = $1 and namespace <> $2", [safe, namespaceId]);
  if (taken) throw new Error(`slug '${safe}' уже занят другим пространством`);
  const r = generateSite(srcDir, join(sitesRoot, safe), { title: opts.title });
  // AUDIT R8 M3: НЕ глушим ошибки. 0 обновлённых строк = у личного пространства нет строки `space`
  // (ожидаемо, тихо); реальная ошибка БД теперь пробрасывается наружу, а не выдаётся за успех
  // (иначе сайт писался бы на диск, а visibility/slug не сохранялись — гарантия уникальности slug не durable).
  await pg.query(
    "update space set slug = $2, visibility = 'public', updated_at = now() where namespace = $1 returning namespace",
    [namespaceId, safe],
  );
  return { slug: safe, pages: r.pages, url: `/s/${safe}/` };
}

/** Снять публикацию (space снова приватный; файлы можно удалить вызывающему). */
export async function unpublishSpace(pg: Postgres, namespaceId: string): Promise<void> {
  await pg.query("update space set visibility = 'private', updated_at = now() where namespace = $1", [namespaceId]);
}

/** Добавить пользователя в пространство (idempotent). */
export async function addMember(pg: Postgres, namespaceId: string, userId: string, role: "owner" | "member" | "viewer" = "member"): Promise<void> {
  await pg.query(
    "insert into membership(user_id, namespace, role) values ($1,$2,$3) on conflict (user_id, namespace) do update set role = excluded.role",
    [userId, namespaceId, role],
  );
}

/**
 * Резолвинг проектного пространства группового Telegram-чата. Find-or-create: пространство +
 * синтетический аккаунт проекта + space-строка + membership создателя. Все реплики группы скоупятся
 * к проекту (общая память/задачи), НЕ к личным пространствам участников.
 */
export async function resolveGroupSpace(
  pg: Postgres,
  tgChatId: number,
  opts: { name?: string; creatorTgId?: number } = {},
): Promise<SpaceTenant> {
  const existing = await pg.queryOne<{ namespace: string; account_user: string }>(
    "select s.namespace, s.account_user from space s where s.tg_chat_id = $1",
    [tgChatId],
  );
  if (existing && existing.account_user) {
    const nsName = await pg.queryOne<{ name: string }>("select name from mem_namespace where id = $1", [existing.namespace]);
    return { namespace: nsName!.name, userId: existing.account_user, spaceId: existing.namespace };
  }
  // создаём проектное пространство (creator резолвим ВНЕ tx, чтобы не вложить транзакции)
  let creatorUserId: string | null = null;
  if (opts.creatorTgId) {
    const c = await resolveTenantByTelegram(pg, opts.creatorTgId, {});
    creatorUserId = c?.userId ?? null;
  }
  return pg.tx(async (t) => {
    // синтетический аккаунт проекта
    const acc = await t.queryOne<{ id: string }>(
      "insert into users(display_name, status) values ($1,'active') returning id",
      [opts.name ?? "Проект"],
    );
    const accId = acc!.id;
    const nsName = `g:${tgChatId}`;
    const ns = await t.queryOne<{ id: string }>(
      "insert into mem_namespace(name) values ($1) on conflict (name) do update set name = excluded.name returning id",
      [nsName],
    );
    const nsId = ns!.id;
    await t.query("update users set personal_namespace = $2 where id = $1", [accId, nsId]);
    await t.query(
      "insert into space(namespace, kind, name, account_user, owner_user, tg_chat_id) values ($1,'project',$2,$3,$4,$5) on conflict (namespace) do nothing",
      [nsId, opts.name ?? "Проект", accId, creatorUserId, tgChatId],
    );
    // membership: аккаунт проекта (owner) + человек-создатель (member)
    await t.query("insert into membership(user_id, namespace, role) values ($1,$2,'owner') on conflict do nothing", [accId, nsId]);
    if (creatorUserId) await t.query("insert into membership(user_id, namespace, role) values ($1,$2,'member') on conflict do nothing", [creatorUserId, nsId]);
    return { namespace: nsName, userId: accId, spaceId: nsId };
  });
}
