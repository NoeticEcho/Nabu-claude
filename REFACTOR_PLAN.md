# REFACTOR_PLAN.md — раунд 2 (по AUDIT.md v0.13.0)

Порядок: **critical → major → minor**. Каждый шаг атомарен (typecheck + 34 unit + 47 guard
зелёные после каждого), коммитится отдельно. Контракты (`@nabu/lib` exports, имена MCP-tools,
форма `structuredContent`, существующие DDL-колонки, HTTP-роуты) не меняются.

**Проверка:** `npm run typecheck` · `npm test` · `npm run test:hooks` · `node --check cli/*` ·
таргет-тесты по шагам (эмпирика на живом/мёртвом стеке, стабы TG).

---

## Фаза 1 — CRITICAL

**Шаг 1 (2.3 + 2.7 + 2.8 + часть 1.3). Целостность backup.**
- pg: резолв на `child.on('close')` **и** flush потока; успех строго `code===0`; при провале —
  `unlinkSync(dst)`; sanity: размер > 200 байт.
- typedb: preflight `docker inspect nabu-typedb` (нет контейнера → skip с warn, том не создаём);
  alpine-run с `--user uid:gid` (чинит root-owned ретенцию 2.8).
- tar-excludes без `./`-якоря (`--exclude=.backups --exclude=.nabu/tmp`) — bsdtar-совместимо (2.7).
- Итог честный: `made`-компоненты + `failed`-компоненты; exit 1, если хоть один компонент провалился;
  сообщение «частично» вместо «готов».
- Файлы: `cli/nabu.mjs`. Проверка: **эмпирика** — мёртвый стек ⇒ exit≠0, артефактов не остаётся,
  stray-том не создаётся; живой стек ⇒ 3 валидных архива (pg >1КБ, typedb >10КБ), ретенция удаляет старые.

**Шаг 2 (2.1 + 2.2 + 2.4). Живучесть демона.**
- `runClaudeJob`: `child.on('error', …)` → лог + job-results с ошибкой (краш демона исключён).
- `doUpdate` CLI-путь: после `cmdStop()` — poll `pidAlive` до смерти (таймаут 10с, потом SIGKILL+warn),
  затем `cmdStart()`.
- Демон: `startChatServer` в retry-петле (5 попыток × 1с на EADDRINUSE) — auto-update больше не
  оставляет чат мёртвым.
- Файлы: `cli/nabu.mjs`. Проверка: unit-подобный стаб spawn-error; **живой цикл** `start → update
  (без изменений=noop) → стоп/старт-цикл вручную: демон жив, чат отвечает`.

**Шаг 3 (1.2 + 3.7). Vault-утечка actors/context/source.**
- `rememberEpisode` при vault: шифровать каждый элемент `actors[]`, `context` → `{"$vault": enc}`;
  `addFact` при vault: шифровать `source` (если задан). `listVaultRecent` — без изменений (читает event).
- Тесты: malformed-ciphertext (сегменты/пустой IV/порча tag → `tryDecrypt` не бросает,
  `decryptVault` бросает) + юнит на форму зашифрованных actors/context (без БД — через мок pg? нет:
  проверка литералов параметров через мок Postgres как в postgres.test.ts).
- Существующие vault-строки (только тестовые) не мигрируем — задокументировать в комменте.
- Файлы: `lib/src/repositories/memory.ts`, `lib/test/vault.test.ts`. Проверка: тесты + **живая
  эмпирика**: vault-эпизод ⇒ в БД actors/context нечитаемы.

**Шаг 4 (1.1 + 2.5 + 2.6 + 2.12). TG: конкурентность и жизненный цикл.**
- Per-topic очереди: `chains = Map<threadKey, Promise>`; `handleUpdate` диспатчит в цепочку топика
  (внутри топика — последовательно, между топиками — параллельно); poll-цикл не ждёт обработку
  (только команды-мутации state — быстрые, можно в общей цепочке "ctl").
- Трек живых детей (`Set`); `stop()`: abort + SIGKILL детей; **nabu.mjs сохраняет handle и зовёт
  `stop()` в `bye()`**.
- `sleep()`: снимать abort-listener при нормальном резолве.
- `editSeg`: любой провал edit (кроме "not modified") ⇒ `curMsgId=null` (следующий render перепошлёт).
- Файлы: `cli/telegram-bot.mjs`, `cli/nabu.mjs`. Проверка: стаб-смоук (существующий подход):
  два параллельных топика — оба отвечают interleaved; stop() убивает ребёнка; edit-fail ⇒ resend.
- Риск: самый инвазивный шаг. При >3 неудачных попытках — откат, blocked, остальное не зависит.

## Фаза 2 — MAJOR

**Шаг 5 (2.10 + 2.11 + 3.1 + 3.2 + 3.3 + 3.4 + 6.4). Веб-слой.**
- UI: при `state.streaming` клики по тредам/новый тред — заблокированы (dim + tooltip «дождитесь ответа»).
- `fullText`: если пришёл хоть один delta — игнорировать полные assistant-тексты (взаимоисключение).
- Host: пустой заголовок ⇒ 403 (default-deny).
- `/api/approvals/:id`: UUID-regex ⇒ иначе 404.
- `deleteThread` route: `await deleteMessages`.
- statsCache: negative-cache 5с при ошибке.
- Кнопка ⟳ шлёт `?fresh`.
- Файлы: `cli/chat-server.mjs`, `cli/ui/chat.html`. Проверка: chat-smoke (стаб /bin/false) +
  живой E2E один обмен + curl-матрица (Host пустой ⇒ 403; bad-uuid ⇒ 404).

**Шаг 6 (2.9 + 4.1). Инсталлеры.**
- `install.ps1`: `$LASTEXITCODE`-проверки после npm install/build (+ node cli init).
- Убрать `--yes` из обоих инсталлеров.
- Файлы: `scripts/install.ps1`, `scripts/install.sh`. Проверка: `bash -n`; PowerShell — ревью
  (pwsh недоступен локально — пометить как проверено-на-чтение).

**Шаг 7 (1.3 + 3.10 + 4.2). Честная документация семантик.**
- ZERO_CONFIG/комменты: джобы — at-most-once при рестарте демона (offset/stamp-before — намеренно),
  потолок результата 2МБ, судьба детей при stop.
- Файлы: docs + комменты в `cli/nabu.mjs`, `cli/telegram-bot.mjs`. Проверка: н/д (docs).

## Фаза 3 — MINOR (батчи)

**Шаг 8. TG-полировка:** transcript cap 30к символов (с честным «обрезано»); pip-хинт только для
transcribe-фазы; `pythonBin` ре-детект при провале (null не кэшировать навсегда); `loggedIgnored`
cap 100; `saveNote` → `deps.notes.add` (убрать raw-SQL дубль; title-слайс сохранить).
Файлы: `cli/telegram-bot.mjs`. Проверка: стаб-смоук.

**Шаг 9. Схемы 010 + lib-мелочи:** `010_hardening.sql`: CHECK на `claim_relations.relation`;
индекс `ix_notes_status(user_id, status)`; ретенция chat_message — метод
`purgeChatHistory(days=180)` в lib + недельный internal-джоб `chat-retention` (disabled по умолчанию);
`dashboard.user()` кэш; `update_note` description + предупреждение про title; not-found семантика
`update_note` → `degraded` (align c memory-server).
Файлы: `schema/postgres/010_hardening.sql`, `lib/src/repositories/{dashboard,memory или lib}`,
`mcp/pipeline-server`, `cli/nabu.mjs` (DEFAULT_JOBS). Проверка: применение 010 на живом стеке,
typecheck/тесты.

**Шаг 10. HELP/косметика:** `version` в HELP; (5.2 — оставить как note).

---

## Порядок и бюджет

| Фаза | Шаги | Оценка риска |
|---|---|---|
| 1 | 1–4 | Шаг 4 — инвазивный (правило 2–3 попыток → blocked) |
| 2 | 5–7 | низкий |
| 3 | 8–10 | низкий |

Каждый шаг = отдельный коммит. Версия по завершении: **0.13.1** (fix-only, без новых фич).

---

*СТОП. Жду подтверждения плана перед Этапом 4.*
