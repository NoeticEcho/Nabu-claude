// web-auth.mjs — аутентификация веб-платформы (OlimpOS P2). Сессии + register/login/logout +
// резолвинг тенанта из session-cookie. Активна только при NABU_MULTITENANT=1 (интернет-инстанс);
// в дефолтном локальном режиме web остаётся на localhost-trust (этот модуль не в цепочке).
//
// Модель: пароль хешируется scrypt в lib/tenancy (без внешних зависимостей). Сессия — случайный
// токен → {userId} в памяти процесса (TTL). httpOnly cookie. При рестарте демона сессии теряются
// (пользователь перелогинивается) — приемлемо для одного инстанса.

import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const SESSION_TTL_MS = Number(process.env.NABU_SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30 дней
const COOKIE = "nabu_sess";

/** Ленивая загрузка lib (для tenancy + pg). Один pg-пул на процесс. */
let _libPg = null;
async function libPg(repoRoot) {
  if (!_libPg) {
    const lib = await import(pathToFileURL(join(repoRoot, "lib", "dist", "index.js")).href);
    lib.hydrateEnv?.();
    _libPg = { lib, pg: lib.buildDeps().pg };
  }
  return _libPg;
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sendJson(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(body);
}

/** Фабрика web-auth. secret — для подписи токена (HMAC), из NABU_SESSION_SECRET или производный. */
export function createWebAuth({ repoRoot, secret }) {
  const sessions = new Map(); // token -> { userId, exp }
  const sign = (tok) => createHmac("sha256", secret).update(tok).digest("base64url");
  const makeCookie = (value, maxAgeMs) =>
    `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}`;

  function issue(userId) {
    const tok = randomBytes(24).toString("base64url");
    sessions.set(tok, { userId, exp: Date.now() + SESSION_TTL_MS });
    return `${tok}.${sign(tok)}`; // токен + подпись
  }

  function verify(cookieVal) {
    if (!cookieVal || !cookieVal.includes(".")) return null;
    const [tok, sig] = cookieVal.split(".");
    const expected = sign(tok);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const s = sessions.get(tok);
    if (!s || s.exp < Date.now()) { sessions.delete(tok); return null; }
    return s.userId;
  }

  /** Резолвинг тенанта из cookie запроса → {namespace,userId} | null. Синхронно (по in-memory сессии). */
  function resolveTenant(req) {
    const userId = verify(parseCookies(req)[COOKIE]);
    return userId ? { namespace: `u:${userId}`, userId } : null;
  }

  /** Обработать /api/auth/* . Возвращает true, если запрос обработан. */
  async function handle(req, res, path, method, readBody) {
    if (!path.startsWith("/api/auth/")) return false;
    const { lib, pg } = await libPg(repoRoot);

    if (method === "POST" && path === "/api/auth/register") {
      let b; try { b = JSON.parse((await readBody()) || "{}"); } catch { return sendJson(res, 400, { error: "bad_json" }), true; }
      const { email, password, displayName } = b;
      if (!email || !password || String(password).length < 8) return sendJson(res, 400, { error: "email+пароль (≥8 символов) обязательны" }), true;
      try {
        const t = await lib.registerWebUser(pg, email, password, displayName);
        const token = issue(t.userId);
        return sendJson(res, 200, { ok: true, userId: t.userId }, { "set-cookie": makeCookie(token, SESSION_TTL_MS) }), true;
      } catch (e) { return sendJson(res, 409, { error: String(e?.message ?? e).slice(0, 120) }), true; }
    }

    if (method === "POST" && path === "/api/auth/login") {
      let b; try { b = JSON.parse((await readBody()) || "{}"); } catch { return sendJson(res, 400, { error: "bad_json" }), true; }
      const { email, password } = b;
      const t = email && password ? await lib.loginWebUser(pg, email, password) : null;
      if (!t) return sendJson(res, 401, { error: "неверный email или пароль" }), true;
      const token = issue(t.userId);
      return sendJson(res, 200, { ok: true, userId: t.userId }, { "set-cookie": makeCookie(token, SESSION_TTL_MS) }), true;
    }

    if (method === "POST" && path === "/api/auth/logout") {
      const cv = parseCookies(req)[COOKIE];
      if (cv?.includes(".")) sessions.delete(cv.split(".")[0]);
      return sendJson(res, 200, { ok: true }, { "set-cookie": `${COOKIE}=; HttpOnly; Path=/; Max-Age=0` }), true;
    }

    if (method === "GET" && path === "/api/auth/me") {
      const t = resolveTenant(req);
      return sendJson(res, t ? 200 : 401, t ? { userId: t.userId } : { error: "не аутентифицирован" }), true;
    }

    return sendJson(res, 404, { error: "unknown_auth_route" }), true;
  }

  return { handle, resolveTenant, enabled: process.env.NABU_MULTITENANT === "1" };
}
