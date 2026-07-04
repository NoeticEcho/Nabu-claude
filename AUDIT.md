# AUDIT.md — Аудит кодовой базы Nabu (раунд 2)

**Дата:** 2026-07-03 · **Версия:** 0.13.0 · **Фокус:** слой v0.9–0.13 (cli/, vault/notes/dashboard,
новые схемы, инсталлеры, CI), не проходивший целостного аудита. Раунд 1 (v0.8.0, lib+mcp core) —
в истории git (`bd0a230…12e635a`); его исправления перепроверены выборочно.

**Метод:** 4 параллельных глубоких ревью (telegram-bot · nabu.mjs+инсталлеры+CI ·
chat-server+chat.html · lib-new+mcp-new+schemas) + личная верификация с **эмпирическими
воспроизведениями** (backup на мёртвом стеке, npm ci dry-run, оверлап-гипотезы).

**Baseline:** build 0 ошибок · 34 unit ✓ · 47 guard ✓ · CI-конфиг валиден (`npm ci` в sync).

**Сводка:** critical/high: **5** · major/medium: **11** · minor: **~22**.

---

## 1. Несоответствие задаче (spec mismatch)

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|1.1|`cli/telegram-bot.mjs:776-794`|**critical**|**Poll-starvation.** Цикл long-poll обрабатывает апдейты строго последовательно с полным `await`; следующий `getUpdates` — только после дренажа пачки. Один claude-обмен (до 10 мин) **замораживает все топики**: вопрос министру блокирует адъютанта, сохранение заметок, `/status` и даже **approvals-кнопки**. Подрывает саму идею форума «параллельных» министров (эталон §4). Fix: per-topic очереди (`Map sessionKey→chain`), poll-насос независим.|
|1.2|`lib/src/repositories/memory.ts:42-56`|**critical**|**Vault-утечка (инвариант #6).** `rememberEpisode` шифрует только `event`; `actors[]` (имена людей!) и `context` (jsonb: места/источники/ссылки) для vault-эпизодов пишутся **плейнтекстом**. Недокументированно. Также `addFact.source` — плейнтекст (medium, тот же фикс).|
|1.3|`cli/nabu.mjs:354-377`|medium|Семантика джобов не соответствует «расписание надёжно»: стамп времени ДО запуска + non-detached дети → при stop/auto-update ребёнок осиротевает/убивается, результат теряется, повтор — только через everyDays. Не задокументировано.|

## 2. Ошибки (bugs, races, утечки)

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|2.1|`cli/nabu.mjs:506` (doUpdate CLI-путь)|**critical**|**`nabu update` может оставить систему без демона:** `cmdStop()` шлёт SIGTERM и возвращается мгновенно → `cmdStart()` видит ещё живой pid → «уже работает», не спавнит → старый демон обрабатывает SIGTERM и умирает → **никого**. Fix: дождаться смерти pid (poll с таймаутом) перед стартом.|
|2.2|`cli/nabu.mjs:427-455`|**critical**|**Краш демона при отсутствии claude:** у ребёнка `runClaudeJob` нет `on('error')` — spawn-ошибка (claude не в PATH; doctor это допускает) = unhandled `error` event → демон падает при первом включённом джобе.|
|2.3|`cli/nabu.mjs:657-667`|**critical**|**Backup: гонка благословляет битый дамп.** `out.on('finish')` может сработать до `exit` ребёнка → `exitCode===null` трактуется как успех (`\|\| null`). Частичный/пустой `.sql.gz` попадает в `made` и ретенцию. **Кластер провал-пути воспроизведён эмпирически** (стек выключен): пустой 20-байтовый `pg-*.gz` остаётся на диске; `docker run -v nabu_nabu-typedb…` **неявно создаёт пустой том** и тарит пустоту как успех (архив = 1 запись `./`); итог — «✓ Бэкап готов (2 архива)». Fix: resolve на `close`+flush, успех только `code===0`, unlink артефакта при провале, preflight «контейнер существует», sanity-check размера, честный ненулевой exit.|
|2.4|`cli/nabu.mjs:494-503` + `329-333`|major|**Auto-update убивает веб-чат:** замена спавнится, старый умирает через 500мс → новый демон биндит :4517, пока порт занят → EADDRINUSE → «chat server FAILED», **ретрая нет** → чат мёртв до ручного рестарта (TG-бот выживает). Fix: retry-bind с backoff.|
|2.5|`cli/telegram-bot.mjs:801-806` + `cli/nabu.mjs:344`|major|`stop()` бота никогда не вызывается: **nabu.mjs выбрасывает возвращённый handle**; abort-сигнал не передаётся в `runClaude`/`runTranscribe`, дети не трекаются → осиротевшие claude/whisper-процессы при auto-update-рестарте. Fix: сохранить handle, звать в `bye()`, трекать/убивать детей.|
|2.6|`cli/telegram-bot.mjs:129-134`|major|Утечка слушателей: `sleep()` вешает `{once:true}`-listener на **долгоживущий** `abort.signal` и не снимает при нормальном резолве таймера → накопление на каждый backoff → `MaxListenersExceededWarning`. Fix: `removeEventListener` в resolve-пути.|
|2.7|`cli/nabu.mjs:687`|major|**tar-переносимость:** `--exclude=./.backups` — GNU-семантика; bsdtar (macOS дефолт, Windows tar.exe) паттерн не матчит → **workspace-архив заглатывает все предыдущие бэкапы** — снежный ком (ретенция хранит 7 всё более гигантских таров). Fix: паттерны без `./` (+оба варианта).|
|2.8|`cli/nabu.mjs:679/692-696`|major|TypeDB-архивы создаются **root-owned** (alpine-контейнер) → `unlinkSync` ретенции получает EPERM (проглочен) → старые архивы копятся бесконечно. Fix: `--user $(id -u):$(id -g)` у alpine-run.|
|2.9|`scripts/install.ps1:60-61`|major|`$ErrorActionPreference="Stop"` **не ловит** exit-коды нативных exe: провал `npm install`/`npm run build` игнорируется → пишется `nabu.cmd`, мутируется PATH, запускается init на битом дереве. Fix: проверять `$LASTEXITCODE` после каждого npm.|
|2.10|`cli/ui/chat.html:742-765,825-858`|major|**selectThread без guard'а стриминга:** переключение треда во время ответа — in-flight `streamSse` пишет в объект старого треда, `refreshLastAssistant` читает НОВЫЙ тред; ответ треда A исчезает из UI и не сохраняется в его localStorage (серверная история спасает при перезаходе). Fix: блокировать переключение при `state.streaming` (или abort fetch).|
|2.11|`cli/chat-server.mjs:388-403`|major (латентный)|fullText-дубль: пути `assistant` и `stream_event/delta` ОБА аппендят; безопасно лишь потому, что `--include-partial-messages` не передаётся. Включение флага = каждый токен дважды (и в БД, и на экран). Fix: взаимоисключить пути.|
|2.12|`cli/telegram-bot.mjs:360-365`|medium|Пользователь удалил стрим-сообщение → каждый `editMessageText` падает («message to edit not found» — не «not modified») → стрим виснет; короткий ответ без overflow **теряется** (`sentAny=true`, фолбэка нет). Fix: при провале edit — обнулить `curMsgId` (следующий render перепошлёт).|

## 3. Gaps (edge cases, валидация, права)

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|3.1|`cli/chat-server.mjs:571-575`|minor→major|Пустой/отсутствующий Host обходит анти-rebinding-проверку (`hostHdr && …`). Браузеры Host шлют всегда — практическая эксплуатация сомнительна, но default-deny дешевле.|
|3.2|`cli/chat-server.mjs:723-738`|minor|Не-UUID в `/api/approvals/:id` → pg-ошибка каста → 500 вместо 404. Валидировать форму.|
|3.3|`cli/chat-server.mjs:649`|minor|`deleteMessages` fire-and-forget: тред удалён из файла, а строки `chat_message` при сбое БД остаются сиротами навсегда.|
|3.4|`cli/chat-server.mjs:741-754`|minor|statsCache пишется только при успехе → при аварии БД каждый `/api/stats` заново гоняет import/connect (стампид). Нужен negative-cache.|
|3.5|`schema/postgres/009_chat_history.sql`|minor|Нет ретенции `chat_message` — растёт вечно (в отличие от working_memory с TTL).|
|3.6|`schema/postgres/008…:83`|minor|`claim_relations.relation` без CHECK (`supports\|contradicts\|neutral` только в комменте) — несогласовано с 009, где CHECK есть.|
|3.7|`lib/test/vault.test.ts`|medium|Не покрыт malformed-ciphertext: `enc:v1:a:b` (сегменты), пустой IV, порча tag — сейчас всё уходит в catch `tryDecrypt`, но ничто это не пиннит.|
|3.8|`cli/telegram-bot.mjs:173/552`|minor|Транскрипт без кэпа как один argv → многочасовая запись может упереться в ARG_MAX (E2BIG) с generic-ошибкой.|
|3.9|`cli/telegram-bot.mjs:741-767`|minor|Текст, начинающийся с `/`, в топике министра → «Неизвестная команда»; контентом не отправить.|
|3.10|`cli/telegram-bot.mjs:789`|minor|Offset персистится ДО обработки (anti-poison — правильно), но следствие «at-most-once, ответ может пропасть при рестарте» не задокументировано.|
|3.11|`mcp/pipeline-server…:246-263`|minor|Описание `update_note` не воспроизводит предупреждение «title — плейнтекст, не класть секреты» → triage может тихо вынести секрет в открытую колонку.|

## 4. Недоделки / конфигурируемость

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|4.1|`install.sh:117` / `install.ps1:79`|minor|`nabu init --yes` — мёртвый флаг (init не читает); подразумевает несуществующий контракт подавления промптов.|
|4.2|`cli/nabu.mjs:432/441`|minor|2MB tail-slice результата джоба: >2MB result → тихий no-push. Задокументировать потолок.|
|4.3|`cli/telegram-bot.mjs:559-571`|minor|`pythonBin` кэширует `null` навсегда — python, поставленный после старта демона, не подхватится до рестарта.|
|4.4|`cli/telegram-bot.mjs:647-678`|minor|Хинт `pip install faster-whisper` приклеен ко ВСЕМ голосовым провалам, включая сетевые getFile/download.|

## 5. Пустые функции / мёртвый код / дублирование

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|5.1|`cli/telegram-bot.mjs:480-502`|minor|`saveNote` — raw SQL + собственная копия fail-closed user-резолюции; `NotesRepository.add` появился позже и не используется. Дублирование.|
|5.2|`lib/src/vault-crypto.ts:20-24`|note|try/catch вокруг `Buffer.from(base64url)` мёртв (не бросает); ловит только length-проверка (работает).|
|5.3|`cli/telegram-bot.mjs:276,759`|minor|`loggedIgnored` Set растёт неограниченно при спаме чужими чатами.|

## 6. Качество / консистентность

| # | Файл:строка | Серьёзность | Проблема |
|---|---|---|---|
|6.1|`pipeline update_note` vs `memory update_system_task`|minor|Разные not-found-семантики: `fail` vs `degraded` для одинаковой ситуации.|
|6.2|`lib/src/repositories/dashboard.ts:53-58`|minor|`user()` не кэширует (в отличие от nsId/NotesRepository) → до 3 лишних запросов на overview.|
|6.3|`schema 008:27`|minor|Индексы notes не покрывают фильтр по status и сорт по created_at (персональный масштаб — терпимо).|
|6.4|`cli/ui/chat.html:970` vs server `?fresh`|minor|Кнопка ⟳ не шлёт `?fresh` — серверный bypass недостижим из UI.|
|6.5|`cli/nabu.mjs` HELP|minor|`version` не задокументирован; `--yes` см. 4.1.|

---

## Verified-clean (подозрения, снятые с доказательствами)

- **Стримеры между топиками не пересекаются** (следствие текущей сериализации — учесть при фиксе 1.1).
- **runClaude onText vs finish(result.text)** — один аккумулятор, `committed`-offset исключает дубль; **fullText-дубль на текущих флагах не проявляется** (дельты не эмитятся; живая история чистая).
- **Контракт pushToTelegram ↔ state бота** — форма/путь/atomic-rename совпадают; string/number chatId безвреден.
- **Privacy-логи** — все `log(` в боте/чате проверены: контента нет (только метаданные).
- **XSS/SQL/инъекции** — escape-then-regex + ``-сентинел; server-данные только через textContent; все запросы параметризованы; argv-spawn без shell.
- **Планировщик** — same-day double-fire невозможен; ретенция-slice корректна (ISO-сортировка); KNOWN_ORDER покрывает все .tql.
- **Vault-ядро** — AES-GCM корректен (IV/tag/длина ключа), `enc:v1:` парс устойчив, крафтовый `enc:v1:garbage` в non-vault не роняет списки, recall не возвращает vault даже при явном запросе (embedding null), `getContentDecrypted` user-scoped + deleted_at.
- **Sandbox индексации, compose-профили во всех вызовах, checkout-детекция обоих инсталлеров, `npm ci` в sync (dry-run 0), `manifest.purpose` корректен, IPv6-Host матчится, double-finish/sendBtn-гварды на месте.**

---

*План — `REFACTOR_PLAN.md` (раунд 2). Ниже — итог выполнения (Этап 5).*

---

# Итог рефакторинга (раунд 2, 2026-07-03, v0.13.1)

10 шагов плана выполнены полностью (8 коммитов). **Регрессия после:** typecheck ✓ · 37 unit ✓ ·
47 guard ✓ · cli/installers syntax ✓. Ключевые фиксы верифицированы **эмпирически**.

## ✅ Исправлено (все 5 critical)

- **1.1 Poll-starvation TG** → per-topic promise-цепочки: внутри топика последовательно (resume
  цел), между топиками параллельно, callback-и на своей быстрой цепочке. *Проверено смоуками:
  два топика отвечают с разницей 3мс; внутри топика — последовательно (gap 3.1с).*
- **1.2 Vault-утечка** → actors[] шифруются поэлементно, context → `{"$vault": enc}`,
  fact.source шифруется. *Проверено вживую: в БД только `enc:v1:`, grep плейнтекста пуст;
  `list_vault` читает.* +3 теста malformed/tampered-ciphertext (37 unit).
- **2.1 `nabu update` без демона** → ожидание смерти pid (10с → SIGKILL) перед стартом.
  *Проверено циклом stop→wait→start: демон жив, чат 200.*
- **2.2 Краш демона без claude** → `child.on('error')` + запись в job-results.
- **2.3 Backup-ложь** → успех строго `close`+flush+`code===0`; провальные/мелкие артефакты
  удаляются; preflight контейнеров (stray-том больше не создаётся); tar-excludes без `./`
  (bsdtar); alpine `--user` (ретенция может удалять); честный `{made,failed}` + exit 1.
  *Проверено оба пути: мёртвый стек — exit 1, только workspace, без мусора; живой — 3 валидных
  архива, typedb 81КБ user-owned.*

## ✅ Major/medium

2.4 retry-bind чата (auto-update больше не оставляет чат мёртвым) · 2.5 `stop()` бота
подключён в `bye()`, дети трекаются и убиваются (*proc-проверка 1→0*) · 2.6 sleep-listener
снимается · 2.7/2.8 в бэкап-фиксе · 2.9 `install.ps1` `$LASTEXITCODE` · 2.10 guard
переключения тредов при стриме · 2.11 fullText-взаимоисключение (sawDelta) · 2.12 edit-fail
→ resend · 3.1 Host default-deny (*HTTP/1.0 без Host → 403*) · 3.2 UUID→404 · 3.3 await
cascade · 3.4 negative-cache · 3.7 тесты шифртекста · 1.3/3.10/4.2 семантики задокументированы.

## ✅ Minor

3.5 ретенция `chat_message` (метод + weekly-джоб, *проверено: 200-дневное удалено, свежее
осталось*) · 3.6 CHECK на relation (*инвалид отвергается*) · 3.8 кэп транскрипта 30к ·
3.9 — см. «осталось» · 3.11 title-предупреждение в tool-описании · 4.1 `--yes` удалён ·
4.3 python re-detect · 4.4 pip-хинт только к transcribe · 5.1 `saveNote`→NotesRepository ·
5.3 cap loggedIgnored · 6.1 not-found→degraded · 6.2 кэш user() · 6.3 индексы (010) ·
6.4 `?fresh` из UI · 6.5 HELP.

## Найдено и исправлено ПО ХОДУ (не из аудита)

- Первая реализация трекинга детей ссылалась на переменную замыкания из модульных функций
  (`children is not defined`) — поймано смоуком, реестр поднят на уровень модуля.

## ⏳ Осталось (осознанно)

- **3.9** («/» в топике министра неотправимо контентом) — намеренная семантика команд;
  обход: начать сообщение не с `/`. Не фикс, а документируемое поведение.
- **5.2** (мёртвый try/catch в vault-crypto) — безвреден, note.
- Замечания аудиторов класса «info» (ordering user/assistant в истории — гарантирован
  практикой; tools-строки не восстанавливаются кросс-девайс — принято).

## ⚠️ Требуют вашего решения (без изменений с раунда 1)

1. Governance self-approval — закрыт продуктово (кнопки web/TG), структурная гарантия
   (внеконтекстный ключ) — опционально.
2. Кризисные ресурсы `verified:false` — человеческая верификация до продакшена.
3. `install.ps1` проверен только чтением (pwsh недоступен локально) — прогнать на Windows
   до релиза (пункт LAUNCH-чек-листа).
