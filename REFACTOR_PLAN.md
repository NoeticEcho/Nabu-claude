# REFACTOR_PLAN.md — Round 8 (2026-07-07)

На основе `AUDIT.md` (R8). Порядок: сначала **critical** (ломает изоляцию), затем **major**, затем
сгруппированные **minor**. Каждый шаг атомарен (проект остаётся рабочим), с отдельным коммитом.
После каждого шага: `npx tsc -b` (typecheck/build) + `npm test` (87 unit) + целевой тест шага.

Легенда проверки: **B**=build/tsc · **T**=npm test · **+**=новый целевой тест/прогон.

---

## CRITICAL

### Шаг 1 — Fail-closed резолвинг тенанта (C1)
**Проблема:** в много-тенанте сбой резолвинга → реплика исполняется в scope владельца демона + общая сессия.
**Что меняю:**
- `cli/telegram-bot.mjs`: `resolveTenantEnv` — различать «легитимно нет тенанта» (одно-польз. режим) и
  «ошибка/не удалось в multitenant». В `runAgent`: если `process.env.NABU_MULTITENANT==="1"` и `tenant` пуст —
  **отказать в обмене** (ответить пользователю понятной ошибкой, не спавнить claude, не трогать общие cid/skey).
  В одно-польз. режиме поведение прежнее (null → дефолтный скоуп — это корректно).
- Тот же гейт применить к `/start`-login-пути (`handleTgLogin`) и к chat-allow, где уместно.
**Файлы:** `cli/telegram-bot.mjs`.
**Проверка:** B, T + **новый тест** `test/tenant-failclosed.mjs`: при `NABU_MULTITENANT=1` и брошенной ошибке
резолвинга — обмен отклонён, `extraEnv`/`cid`/`skey` не деградируют к общим; при выключенном флаге — прежнее поведение.

---

## MAJOR

### Шаг 2 — `shareAgent` только для владельца (M1)
**Что меняю:** `lib/src/registry.ts:shareAgent` — добавить `and origin_user=$2` в WHERE (builtin уже исключён).
Приватный агент без `origin_user` становится не-шарабельным (fail-closed) — приемлемо.
**Файлы:** `lib/src/registry.ts`.
**Проверка:** B, T + **тест**: User A не может шарить агента B (0 строк, `false`); шарит своего (`true`).

### Шаг 3 — Login-код одноразовый и с TTL (M2)
**Что меняю:** `lib/src/tenancy.ts:claimLoginCode` — `update ... set tg_user_id=$2 where code=$1 and
tg_user_id is null and created_at > now() - interval '10 minutes' returning code`; `false` при 0 строк.
**Файлы:** `lib/src/tenancy.ts`.
**Проверка:** B, T + **тест**: повторный claim → `false`; протухший → `false`; свежий незаявленный → `true`.

### Шаг 4 — `publishSpace` не глушит ошибки (M3)
**Что меняю:** `lib/src/tenancy.ts:publishSpace` — заменить `.catch(()=>{})` на проверку `rowCount`:
если 0 строк обновлено — это личное пространство без `space`-строки (ок, тихо); реальную ошибку БД —
**пробрасывать** (не возвращать успех). Порядок: сначала застолбить slug/публикацию в БД, затем `generateSite`
(чтобы при конфликте slug не писать файлы зря) — если это не усложнит; иначе минимально: не проглатывать ошибку.
**Файлы:** `lib/src/tenancy.ts`.
**Проверка:** B, T + **тест**: успешная публикация помечает `visibility='public'`+slug; смоделированная ошибка
БД пробрасывается, а не «успех».

### Шаг 5 — Sandbox: убивать контейнер по таймауту (M5)
**Что меняю:** `lib/src/sandbox.ts:runInSandbox` — запускать `docker run --name nabu-sbx-<rand>` и по таймауту
делать `docker kill`/`rm -f <name>` вместо `child.kill` (который бьёт только клиент). Имя — из счётчика+prefix
(без `Math.random`/`Date.now`, они запрещены в этой среде — использовать `randomUUID` из node:crypto).
**Файлы:** `lib/src/sandbox.ts`.
**Проверка:** B, T + **прогон** (если docker доступен): команда `sleep 600` с `timeoutMs=3000` → контейнер
реально исчезает (`docker ps` без него) в пределах ~секунд после таймаута.

### Шаг 6 — Sandbox: закрыть symlink-traversal (M4)
**Что меняю:** `lib/src/sandbox.ts:withinWorkdir` (+ `writeSandboxFile`/`readSandboxFile`) — проверять
containment по `realpath` РОДИТЕЛЬСКОЙ директории цели (для write — существующего предка; для read — самой цели,
если существует), а не только корня. Отвергать, если реальный путь вне `realpath(workdir)`.
**Файлы:** `lib/src/sandbox.ts`.
**Проверка:** B, T + **тест** `test/sandbox-traversal.mjs`: symlink `evil -> /etc` внутри workdir →
`readSandboxFile("evil/passwd")` и `writeSandboxFile("evil/x", …)` отвергаются; обычные пути внутри — работают.

---

## MINOR (сгруппировано в атомарные батчи)

### Шаг 7 — Sandbox/olimpos hardening (minor-батч песочницы)
**Что меняю:**
- `mcp/olimpos-server/src/index.ts`: применить `maskCreds` к выводу `sandbox_git_clone` (утечка токена);
  проверять `dockerAvailable()` в `sandbox_git_status/commit/clone`; перенести `dockerAvailable()` в
  `sandbox_git_push` ДО потребления approval (не жечь одобрение при отсутствии docker).
- `lib/src/sandbox.ts`: запускать контейнер с `--user`(non-root) и по возможности `--read-only` + tmpfs
  (не ломая запись в `/work`).
**Файлы:** `mcp/olimpos-server/src/index.ts`, `lib/src/sandbox.ts`.
**Проверка:** B, T + греп `maskCreds` в clone; ручной прогон push при выключенном docker (approval не сгорает).

### Шаг 8 — sitegen/чат-сервер: defense-in-depth путей и SVG (minor-батч сайтов)
**Что меняю:**
- `lib/src/sitegen.ts`: явно отвергать slug `.`/`..`/пустой; удалить мёртвый `target` (cat 5).
- `cli/chat-server.mjs:safeSitePath`: явно отвергать `safeSlug ∈ {".",".."}` (хотя не эксплуатируется — F-NEG-1).
- SVG-ассеты публичных spaces отдавать с `Content-Type: text/plain` (или документировать риск) — не как `image/svg+xml`.
**Файлы:** `lib/src/sitegen.ts`, `cli/chat-server.mjs`.
**Проверка:** B, T + **тест**: `resolveSitePath(root,"..",…)`→null; `generateSite` со slug `..`→ошибка.

### Шаг 9 — Web-auth hardening (minor-батч аутентификации)
**Что меняю:**
- `cli/web-auth.mjs`: cookie-атрибут `Secure` при `NABU_MULTITENANT=1`; простой in-memory rate-limit
  (N попыток/окно) на `login`/`register`/`telegram/poll`.
- `cli/chat-server.mjs`: fail-closed/warn при дефолтном `"nabu-dev-secret"` в много-тенанте (лог-предупреждение
  на старте, не молчаливый дефолт).
**Файлы:** `cli/web-auth.mjs`, `cli/chat-server.mjs`.
**Проверка:** B, T + **тест**: >N логинов подряд → 429; cookie содержит `Secure` при флаге.

### Шаг 10 — Валидация эндпоинтов и error-surface (minor-батч API)
**Что меняю:**
- `cli/chat-server.mjs` (`/api/olimpos/*`): валидировать `taskId` (наличие) и `column ∈ {todo,doing,review,done}`
  до вызова; не отдавать сырой текст внутренней ошибки (обобщённое сообщение + лог детали на сервер).
- `lib/src/agile.ts`: `sprintMetrics` — клампить неизвестную `board_column` как в `board()`.
- `cli/ui/chat.html`: обернуть числовые интерполяции (`estimate`, `usage_count`) в `esc()` для единообразия.
**Файлы:** `cli/chat-server.mjs`, `lib/src/agile.ts`, `cli/ui/chat.html`.
**Проверка:** B, T + **тест**: `task-move` без `taskId`→400 (не 500); неверный `column`→400.

### Шаг 11 — Косметика и консистентность (minor-батч)
**Что меняю:**
- `cli/telegram-bot.mjs:289`: строку таймаута сделать динамической (`CHILD_TIMEOUT_MS`/60000 мин).
- `lib/src/registry.ts:seedBuiltinAgents`: считать реально вставленные (`returning`/rowCount), не `n++`.
- `lib/src/tenancy.ts`: синхронизировать константы TTL cleanup (15) и `LOGIN_CODE_TTL_MS` (10).
- `schema/postgres/019`: поправить комментарий `argon2id`→`scrypt`.
- `lib/src/tenancy.ts:resolveGroupSpace`: бэкофиллить `account_user` при существующей space-строке с null
  (устранить churn orphan-user) — если правка локальна и безопасна; иначе пометить и оставить.
**Файлы:** как перечислено.
**Проверка:** B, T.

---

## Осознанно ВНЕ объёма (с причиной)

- **Группа-allowlist / membership-гейт (telegram-bot.mjs:1169)** — продуктовое решение (кто может создавать
  проектные пространства публичным ботом), а не баг; требует твоего решения по политике. Помечу в AUDIT §5.
- **orphan-kill ppid-фильтр (nabu.mjs:497)** — актуально лишь для мульти-демон-хоста (не модель OlimpOS
  single-instance); правка рискует усложнить надёжный kill сирот. Оставляю, если не подтвердишь мульти-демон.
- **consumeLoginCode атомарность (TOCTOU)** — тот же пользователь, не кросс-тенант; закрою заодно в Шаге 3,
  если тривиально (single-statement claim+consume), иначе оставлю minor.
- **timestamptz-драйвер TTL (tenancy.ts:139)** — зависит от формата драйвера; проверю при Шаге 3, правлю только при подтверждении.

---

## Порядок и остановки

Шаги 1→6 — критично/major, строго последовательно. Шаги 7→11 — minor-батчи, каждый самодостаточен.
Если шаг ломает тесты и не чинится за 2–3 попытки — откат, пометка `blocked` здесь, переход к следующему.
Итог — Этап 5: обновлю `AUDIT.md` (что исправлено/осталось/риски на твоё решение).
