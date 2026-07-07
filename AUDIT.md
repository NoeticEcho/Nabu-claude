# AUDIT.md — Round 8 (2026-07-07)

**Фокус:** новый код **OlimpOS (P1–P7) + web-auth + управляющий UI + доки**, построенный в этой
сессии и ещё не проходивший аудит. Ядро (Совет/память/домен/hooks) прошло Round 7 (`AUDIT_R7_archive.md`)
— здесь по нему только лёгкая регрессия. Аудит выполнен 5 параллельными read-only субагентами по
подсистемам; тяжёлые находки (critical/major) перепроверены вручную чтением кода и прогоном.

Метод верификации: каждая критическая/major-находка подтверждена чтением фактического кода;
эксплуатируемость проверена (в т.ч. отвергнут один ложноположительный critical — см. F-NEG-1).

---

## Этап 1: Эталон (что приложение ДОЛЖНО делать)

1. Коллегиальный Совет в Claude Code: адъютант триажит → много-доменный запрос → 9 министров дают
   позиции → синтез с trade-off'ами → decision-maker (при выборе) → critic → ответ. Решение за пользователем.
2. Standalone локальный стек (Postgres+pgvector, TypeDB, Ollama в docker); `nabu` CLI/daemon
   (chat-server + telegram-bot + scheduler в одном процессе). Схема из основного Nabu — только аддитивно.
3. Память (7 типов/3 хранилища) + личность (числовые черты → директивы); Совет видит общую память пользователя.
4. **Приватность:** эмбеддинги только локально; `private`/`vault` не в облако/логи; медицина/финансы/
   отношения по умолчанию `private`; нет visibility → `private`.
5. Границы компетенции: информация/структура, не профсовет; кризис-детекция + wellbeing; не диагностировать.
6. Harness: высокорисковые действия (external/financial/destructive) — через approval вне модели; узкие tools; бюджеты.
7. Личность — не сознание; не притворяться человеком, не манипулировать; пороги honesty/kindness.
8. Не выдумывать факты о пользователе; нет данных → честно сказать.
9. Не ломать общую схему — аддитивно.
10. **OlimpOS (`NABU_MULTITENANT=1`):** изоляция по пользователю (личная память НИКОГДА не смешивается
    между users); web-auth (email/scrypt + TG deep-link); групповые чаты = проектные пространства с
    атрибуцией; agile-доски; docker-песочницы с approval-гейтом на git push; публикация spaces `/s/<slug>`;
    общий рынок агентов (`__commons__`). Дефолтный одно-пользовательский localhost-режим не меняется.

---

## Этап 2: Находки по категориям

Формат: `[severity] file:line — описание (сценарий отказа)`. Severity: **critical** (ломает жёсткий
инвариант, в первую очередь изоляцию тенантов) · **major** · **minor**.

### 0. CRITICAL

- **[critical] C1 — cli/telegram-bot.mjs:81-84 (потребление: 674-704).** `resolveTenantEnv` при любой
  ошибке pg возвращает `null` (комментарий: «работаем в дефолтном скоупе, не роняем обмен») — **fail-open**.
  На null-пути `runAgent`: `extraEnv=undefined` (ребёнок наследует `NABU_NAMESPACE`/`NABU_USER_ID`
  **владельца демона**), `cid=convId(role)` и `skey=sessionKey` — общие для всех. Сценарий: при
  `NABU_MULTITENANT=1` транзиентный сбой БД во время реплики User B → его сообщение исполняется в
  приватном пространстве владельца и в общей сессии → чтение/запись чужой личной памяти + возможный
  resume чужой claude-сессии (`resumeSessionId = sharedSession || state.sessions[skey]`). Нарушает
  инвариант #10 (личная память не смешивается). *(cat 2/3; подтверждено чтением кода.)*

### 1. Несоответствие задаче (spec ↔ код)

- **[minor] cli/telegram-bot.mjs:289** — устаревшая строка ошибки `"claude timed out after 10 minutes"`,
  тогда как таймаут по умолчанию 30 мин (`NABU_CLAUDE_TIMEOUT_MS`). Вводит в заблуждение логи.
- **[minor] schema/postgres/019_multitenancy.sql:8** — комментарий `pass_hash -- argon2id`, а реализация
  (`tenancy.ts:80`) — scrypt. Дрейф док/код (scrypt корректен, комментарий неверен).

### 2. Ошибки (баги, race, утечки, типизация)

- **[major] M2 — lib/src/tenancy.ts:127-133 (`claimLoginCode`), вызов: telegram-bot.mjs:541.** Код входа
  через Telegram НЕ одноразовый: `update tg_login_code set tg_user_id=$2 where code=$1` без проверок
  «не заявлен» и «не протух» (last-writer-wins). Сценарий: перехвативший deep-link код злоумышленник
  шлёт `/start nabu_<code>` и перепривязывает код к своему TG-аккаунту → веб логинится в чужой аккаунт
  (account confusion / session fixation).
- **[major] M3 — lib/src/tenancy.ts:171 (`publishSpace`).** `.catch(() => {})` глотает ВСЕ ошибки
  `update space`, а не только «нет строки для личного ns». Реальный сбой БД → сайт записан на диск, но
  `visibility` остаётся `private` и `slug` не сохранён → гарантия уникальности slug (строка 168) не
  durable (два пространства могут «опубликовать» один slug на диск); функция возвращает успех.
- **[major] M5 — lib/src/sandbox.ts:76.** Хард-таймаут `child.kill("SIGKILL")` убивает docker-CLI-клиент,
  а не контейнер (`docker run --rm` без имени/`docker kill`). Сценарий: зациклившаяся команда песочницы
  переживает `timeoutMs`, продолжая жечь CPU/RAM; `timedOut=true`, но контейнер жив.
- **[minor] lib/src/tenancy.ts:136-144 (`consumeLoginCode`)** — TOCTOU: read→TTL→resolve→delete неатомарны;
  два параллельных polls могут потребить один код (тот же пользователь — не кросс-тенант, но не «одноразово»).
- **[minor] lib/src/tenancy.ts:202-234 (`resolveGroupSpace`)** — если строка `space` есть, а `account_user`
  = null, guard (202) проваливается и на каждое сообщение вставляется НОВЫЙ синтетический user
  (`on conflict(namespace) do nothing` не бэкофиллит `account_user`) → churn orphan-строк, нестабильный
  group userId/сессия.
- **[minor] lib/src/agile.ts:103 (`sprintMetrics`)** — неожиданное значение `board_column` молча создаёт
  новый ключ в `byColumn` (нет whitelist), в отличие от `board()` (87), где клампится к `todo`. Несогласованность.
- **[minor] lib/src/registry.ts:36-46 (`seedBuiltinAgents`)** — `n++` на каждой итерации независимо от
  `on conflict do nothing` → возвращаемый счётчик завышает число реальных вставок.
- **[minor] lib/src/tenancy.ts:139** — TTL считается через `new Date(row.created_at)`; корректность зависит
  от того, что драйвер возвращает timestamptz со смещением (иначе TTL смещён). *(unverified — зависит от драйвера.)*

### 3. Gaps (валидация, права, необработанные пути)

- **[major] M1 — lib/src/registry.ts:49-54 (`shareAgent`), вызовы: chat-server.mjs:1007, olimpos-server:88.**
  Кросс-тенант запись (IDOR): `update ... where slug=$1 and visibility<>'builtin'` — **нет фильтра владельца**
  (`origin_user` используется только в `coalesce()` для SET). Сценарий: аутентифицированный User A вызывает
  `agent-share {slug:"приватный-агент-B"}` → приватный агент B становится `visibility='shared'` и виден всем
  в `listAgents(market=1)`. Сообщение «нет такого личного агента» подразумевает проверку, которой в SQL нет.
- **[major] M4 — lib/src/sandbox.ts:29-46 (`withinWorkdir`).** Symlink-traversal: realpath берётся только от
  корня workdir (`w`), но не от цели (`t`); `resolve()` не разворачивает symlink-компоненты. Сценарий:
  `sandbox_run` (легитимно исполняет код в контейнере, где `/work`↔host workdir) создаёт `ln -s /etc evil`,
  затем `sandbox_read_file("evil/passwd")` читает `/etc/passwd` на хосте или `sandbox_write_file` пишет вне
  песочницы — обход изоляции хоста. *(Предусловие: песочница включена.)*
- **[minor] lib/src/sitegen.ts:113** — `.svg`-ассеты копируются и отдаются с публичного origin как есть;
  SVG может нести inline-скрипт → stored XSS на `/s/<slug>/`. `renderMarkdown` экранирует, но ассеты — нет.
- **[minor] cli/web-auth.mjs:62-63** — session-cookie без атрибута `Secure` (только `HttpOnly; SameSite=Lax`).
  На интернет-инстансе токен может уйти по plaintext HTTP при downgrade.
- **[minor] cli/web-auth.mjs:92-131** — нет rate-limit/lockout на `/api/auth/login|register|telegram/poll`.
  scrypt замедляет, но попытки не ограничены → онлайн-брутфорс/флуд.
- **[minor] cli/chat-server.mjs:1002-1003 → agile.ts:60-71** — `task-move`/`task-estimate` не валидируют
  наличие `taskId` и `column ∈ BoardColumn`. Отсутствие `taskId` → `where id=undefined` → 500 (info-leak);
  чужой/несуществующий `taskId` обновляет 0 строк (корректно скоупится по `user_id`, **НЕ IDOR**), но
  эндпоинт возвращает `{ok:true}` — молчаливый «успех» для no-op. `column` пишется в `board_column` без проверки.
- **[minor] lib/src/agile.ts:54-65** — `addTaskToSprint`/`setTaskEpic`/`assignTask` скоупят задачу по
  `user_id`, но `sprintId`/`epicId`/`assigneeUser` пишутся без проверки принадлежности `uid()` (можно указать
  чужой sprint/epic id — кросс-тенант FK-ссылка, низкий импакт).
- **[minor] cli/chat-server.mjs:999 → domain.addTask** — `addTask` доверяет клиентскому `projectId` без
  проверки принадлежности тенанту (низкий импакт: доска фильтрует по `user_id`, чужой project_id не рендерится).
- **[minor] mcp/olimpos-server/src/index.ts:163-180** — `dockerAvailable()` проверяется ПОСЛЕ атомарного
  потребления approval → если docker недоступен, одноразовое одобрение сгорает до попытки push.
- **[minor] mcp/olimpos-server/src/index.ts:135,140,145** — `sandbox_git_status/commit/clone` не вызывают
  `dockerAvailable()` (в отличие от `sandbox_run`/`_push`) → при отсутствии docker `exit=-1` без внятного сообщения.
- **[minor] cli/telegram-bot.mjs:1169-1170** — много-тенантный chat-allow пускает ЛЮБУЮ группу/супергруппу
  без allowlist/проверки членства → добавивший бота в группу авто-провижинит проектное пространство и
  тратит квоту Claude (для публичного бота — неограниченный ресурс-провижининг).

### 4. Недоделки (TODO/FIXME, заглушки, хардкод)

- **[minor] cli/chat-server.mjs:1292** — хардкод-фолбэк HMAC-секрета `"nabu-dev-secret"`, если не заданы
  `NABU_SESSION_SECRET`/`NABU_VAULT_KEY`, без fail-closed в много-тенанте. Прямой forge невозможен (сессии
  хранятся в in-memory Map, HMAC — лишь tamper-check), но известный дефолт-секрет на интернет-инстансе — smell.
- Иных TODO/FIXME/заглушек/mock-данных в новом коде НЕ обнаружено (подтверждено grep'ом изменённых файлов).

### 5. Пустые функции / мёртвый код

- **[minor] lib/src/sitegen.ts:125** — dead code: `target` вычисляется (с логикой анти-traversal), но не
  используется; реальная проверка — по `full`/`rel`. Вводит в заблуждение (похоже, задуманный guard выпал).

### 6. Качество (дублирование, консистентность)

- **[minor] cli/chat-server.mjs:1009, cli/web-auth.mjs:100** — сырой текст внутренней ошибки клиенту
  (`String(e.message).slice(0,160)` / `.slice(0,120)`) → возможна утечка строк ошибок Postgres/схемы.
- **[minor] cli/ui/chat.html:2233,2266** — две интерполяции без `esc()`: `${t.estimate} SP`, `${a.usage_count}×`.
  Это числовые колонки БД (`Math.round`/счётчик), риск низкий; все строковые поля (в т.ч. кросс-тенант поля
  рынка) экранируются. *(unverified, что колонки могут быть не-числовыми.)*
- **[minor] cli/nabu.mjs:497-500** — startup orphan-kill матчит ЛЮБОЙ хостовый `claude`-процесс с флагами
  изоляции без проверки ppid/владельца → на мульти-демон-хосте рестарт одного демона убивает in-flight
  turns соседнего. *(Предусловие: несколько демонов на хосте — не штатная модель OlimpOS single-instance.)*
- **[minor] cli/telegram-bot.mjs:538-545 (`handleTgLogin`)** — хрупкая связка: полагается на побочный эффект
  `resolveTenantEnv` (ленивая инициализация `_tenantLibPg`), затем `void t`; при null по не-ошибке даёт
  «много-тенантный режим не готов» при живой БД.
- **[minor] lib/src/sandbox.ts:59** — контейнер без `--user`/`--read-only`: файлы в смонтированном workdir
  становятся root-owned на хосте; в связке с M4 — root-записи вне workdir.
- **[minor] schema/postgres/019:46** — commons-insert guard только `on conflict (id)`, но `mem_namespace.name`
  `unique not null` — предсуществующий `__commons__` под другим id даст unique-violation при повторе. *(unverified.)*
- **[minor] schema/postgres/020_spaces.sql:11** — `account_user` без `on delete` (NO ACTION), асимметрично с
  `owner_user ... on delete set null` строкой ниже. Безобидно для синтетических аккаунтов, но несогласованно.
- **[minor] lib/src/tenancy.ts:116/121** — константы TTL рассинхронены: cleanup удаляет `>15 мин`, а
  `LOGIN_CODE_TTL_MS`=10 мин → строки 10–15 мин висят, но отвергаются. Косметика.

### Ложноположительные (проверено, НЕ баг)

- **[F-NEG-1] cli/chat-server.mjs:20-27 (`safeSitePath`) + sitegen.ts:122 (`resolveSitePath`)** — субагенты
  отметили как **critical path-traversal** (slug `..`). **Перепроверено фактическим прогоном:** `path=url.pathname`
  из WHATWG `URL` **всегда** схлопывает реальные сегменты `..` (slug→null / путь переписан), а где `%2f`
  мешает нормализации — `safeSlug` вырезает `%`, оставляя безобидное литеральное имя (`..2f.nabu`) внутри
  sites-root; слэш не возрождается. `safeSlug` **никогда** не равен `..`. Роут `/s/` НЕ эксплуатируется.
  Остаётся лишь defense-in-depth: явно отвергать `.`/`..`-slug и убрать мёртвый `target` (см. cat 5) — **minor**.
- **Approval-гейт `sandbox_git_push`** — проверен: единственный атомарный `UPDATE ... SET used_at=now()
  WHERE used_at IS NULL AND status='approved' AND action=$3 AND namespace=$2 AND (expires_at IS NULL OR
  expires_at>now())` безопасен против двойного потребления; action namespace-scoped; модель не может выставить
  `approved`; вывод и аудит-лог маскируются `maskCreds`. **Корректно.**
- **IDOR на agile/domain id** — `AgileRepository`/`DomainRepository` фильтруют КАЖДЫЙ запрос по `user_id=uid()`;
  deps строятся per-session; чужой `taskId`/`projectId` матчит 0 строк. **Не брешь.**
- **HMAC `verify()` (web-auth.mjs:71-79)** — length-check до `timingSafeEqual`, пустые/битые cookie отвергаются;
  fresh-токен на каждый login (нет фиксации). **Корректно.**
- **`extraEnv`-merge (telegram-bot.mjs:260), `toolPolicy()` per-call, hard-block Bash/Edit/Workflow, auth-гейт
  `/api/*` при multitenant** — проверены, корректны. Миграции 019–023 — аддитивны, идемпотентны, FK-корректны.

---

## Сводка

| Severity | Кол-во | Находки |
|---|---|---|
| **critical** | 1 | C1 (fail-open резолвинг тенанта → cross-tenant утечка) |
| **major** | 5 | M1 shareAgent (кросс-тенант share) · M2 login-code не одноразовый · M3 publishSpace глушит ошибки · M4 sandbox symlink-traversal · M5 sandbox timeout не убивает контейнер |
| **minor** | ~24 | валидация/error-surface/hardening/косметика (см. категории) |
| ложнопол. | 2 | path-traversal `/s/` (не эксплуатируется); approval-гейт (корректен) |

**Общая оценка:** ядро (R7) и большинство инвариантов OlimpOS реализованы корректно — изоляция по
`user_id` в репозиториях, approval-гейт, auth-гейт, идемпотентные миграции проверены и держатся. Один
критический и пять major — **сконцентрированы на пути отказов и владения** (fail-open вместо fail-closed;
отсутствие проверки владельца при share; необоронённый symlink/таймаут песочницы). Все — точечные и
локальные, публичные API/контракты не затрагивают.

*Статус исправлений — Этап 5 (заполняется после рефакторинга). План — `REFACTOR_PLAN.md`.*
