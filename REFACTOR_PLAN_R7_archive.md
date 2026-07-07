# REFACTOR_PLAN.md — Round 7 (2026-07-06)

План на основе `AUDIT.md` (R7). Порядок: **безопасность-гейты → стабильность демона → корректность
remote-эмбеддера → доки → minor**. Каждый шаг атомарен (оставляет проект рабочим), с отдельным
коммитом. После каждого шага: `npm run build` + `npm test` (+ `npm run test:hooks` где трогаем guard).

Не меняю публичные API/контракты без явной пометки. Не «улучшаю» попутно вне плана. Правило отката:
2–3 неудачные попытки починить шаг → откат, пометка `blocked`, переход дальше.

Легенда: 🟠 major · 🟡 minor.

---

## Блок A — Безопасность-гейты (первым)

### A1 🟠 Guard: закрыть обход через `xargs`  (G1)
- **Что**: в `guard-destructive.sh` добавить паттерн: команда содержит `xargs`/`parallel` + деструктив (`rm`, `rm -rf`, `shred`, `unlink`, `-delete`) → DENY, независимо от наличия цели в строке.
- **Файлы**: `scripts/hooks/guard-destructive.sh`; кейсы в `scripts/hooks/test-guard.sh`.
- **Проверка**: `find . | xargs rm -rf` → DENY (exit 2); `npm run test:hooks` зелёный.

### A2 🟠 Guard: `DELETE/UPDATE` без WHERE — убрать комментарии перед проверкой  (G2)
- **Что**: перед проверкой убрать SQL-комментарии (`--…`, `/*…*/`), разбить по `;`, для каждого `delete from`/`update` проверять `where` в этом же стейтменте; неуверенный парс → DENY (fail-closed).
- **Файлы**: `guard-destructive.sh`; кейсы (where-в-комменте, where-в-имени-таблицы → DENY; легитимный `… WHERE id=1` → ALLOW).
- **Проверка**: оба обхода из AUDIT → DENY, легитимный → ALLOW; `npm run test:hooks`.
- **Оговорка**: best-effort regex-гард (динамические имена `X=rm;$X` не покрыть — реальный энфорсер = approval). Дописать в шапку скрипта.

### A3 🟠 Evals: offline-фикстуры safety + CI-гейт  (N1, N5)
- **Что**: (1) фикстуры-реплеи `privacy` (11) + фикс `must_not_include`-матчера (`evals/runner.mjs`) — не считать SKIP за pass, учитывать отрицание. (2) crisis-фикстуры — отдельной итерацией с ручной вычиткой (safety-критично). (3) добавить fixture-гейт в CI.
- **Файлы**: `evals/fixtures/privacy/*.json`, `evals/runner.mjs`, `.github/workflows/ci.yml`.
- **Проверка**: `node evals/runner.mjs` — privacy не all-SKIP; CI-job проходит.
- **Требует решения**: см. вопрос 3 ниже.

### A4 🟡 `.env` права 0600  (Q3)
- **Что**: после записи `.env` — `chmodSync(path, 0o600)`.
- **Файлы**: `cli/nabu.mjs`.
- **Проверка**: `stat -c%a ~/Nabu/.env` = 600.

---

## Блок B — Стабильность демона (freeze + race)

Подход: тяжёлые `spawnSync`/`sh()` в процессе демона → async (`shAsync`/`spawn`+await).

### B1 🟠 Async update-check в tick()  (E1)
- `sh("git fetch")`/`rev-list` → `await shAsync`; не бить `git fetch` на первом тике.
- **Файлы**: `cli/nabu.mjs`. **Проверка**: демон отвечает без задержки; `update-status.json` обновляется.

### B2 🟠 Async установка Whisper  (E2)
- `ensureWhisper()`: `spawnSync uv venv/pip` → async `spawn`+await (промис `whisperInstalling` уже есть).
- **Файлы**: `cli/telegram-bot.mjs`. **Проверка**: во время установки демон отвечает в других топиках/веб.

### B3 🟠 Async self-update  (E4)
- `doUpdate(inDaemon)`: `npm install`/`build` через `shAsync`.
- **Файлы**: `cli/nabu.mjs`. **Проверка**: build; логика opt-in не сломана.

### B4 🟠 Async docker/backup + бинари  (E5)
- `dockerAvailable/containerExists/cmdBackup` (путь планировщика) + `pdftotext/tesseract/unzip` → async.
- **Файлы**: `cli/nabu.mjs`, `cli/telegram-bot.mjs`. **Проверка**: `nabu backup` из CLI работает.

### B5 🟠 Лок на claude-сессию роль-разговора  (E3)
- Per-`conversationId` async-мьютекс (in-memory, один процесс демона), сериализует `claude --resume` для одного conv (web+TG). Защита от двойной отправки в web.
- **Файлы**: `cli/claude-run.mjs` (хелпер), `cli/chat-server.mjs`, `cli/telegram-bot.mjs`.
- **Проверка**: два параллельных запроса в один conv → последовательно, история цела.

### B6 🟡 Guard второго демона + таймаут джоба  (G4, G5)
- `cmdDaemon` отказывает при живом PID; `runClaudeJob` — spawn с таймаутом+SIGKILL.
- **Файлы**: `cli/nabu.mjs`. **Проверка**: двойной `nabu daemon` → ошибка; зависший джоб убит.

---

## Блок C — Корректность на remote-эмбеддере

### C1 🟠 Ключ кэша domain-vecs = модель+dim+провайдер  (E6)
- В хэш кэша добавить модель/dim/провайдер → авто-инвалидация при смене.
- **Файлы**: `lib/src/domain-classify.ts`. **Проверка**: смена `NABU_EMBED_DIM`/модели → пересчёт (unit-тест хэша).

### C2 🟠 embedQuery принимает visibility запроса  (G3)
- `embedQuery(text, visibility='default')` → `assertPrivacy(visibility)`. Поиск по library(default) не требует ALLOW_REMOTE; приватная память — требует. Вызовы recall/knowledge.search передают фактический visibility.
- **Файлы**: `lib/src/embeddings.ts`, `lib/src/repositories/{memory,knowledge}.ts`. **Проверка**: на remote без ALLOW_REMOTE поиск по default работает, по private — отклоняется; unit-тест.
- **Требует решения**: вопрос 2 ниже.

---

## Блок D — Доки и комментарии

### D1 🟠 Skills-противоречие + числа  (S1,S4,S5,S6,S7,S8)
- ARCHITECTURE §6/plugin.json: «единственный skill» → «адъютант + 3 доменных пака». Числа: 73→74, 26→27, 47→59(+28), 34→39. Дополнить список слэш-команд.
- **Файлы**: `README.md`, `README.ru.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/LANDING.md`, `.claude-plugin/plugin.json`.

### D2 🟠 Раскрыть remote-embeddings + stale-комменты  (S2)
- README privacy: локально по умолчанию + опц. OpenAI-совместимый endpoint под `NABU_EMBED_ALLOW_REMOTE` (default-only в облако; vault не эмбеддится). Поправить комменты `memory.ts:2`, `memory-server:3,31`.
- **Файлы**: `README.md`, `README.ru.md`, `lib/src/repositories/memory.ts`, `mcp/memory-server/src/index.ts`.

### D3 🟠 Документировать nabu-onboard/tasks/library  (S3)
- **Файлы**: `CLAUDE.md`, `ARCHITECTURE.md`.

---

## Блок E — Minor: данные и чистка

### E1 🟡 Импорт: Google Fit heart-points, finance «1,000»  (E8,E9)
- Не мапить «Heart Points/Minutes» в heart_rate; `parseAmount` — эвристика тысяч/лог-warning.
- **Файлы**: `lib/src/health-import.ts`, `lib/src/finance-import.ts` + тесты.

### E2 🟡 Мелкие фиксы кода  (E7,E10,E11,G6,G8,G10,D4 + мёртвый код D1,D2)
- `clearTimeout` в hard-timeout; `logHabit` → реальный id; `readThreads` при порче — бэкап, не терять; `mcp-result.wrap` — `Promise.resolve().then`; `buildDeps` переиспользовать пул (кэш по DSN); `.env`-парсер `export `; убрать алиас MAX_AUDIO_BYTES; мёртвый код (`listByDomain`,`renderSalient`) — удалить или `@internal` (вопрос 4).
- **Файлы**: точечно. **Примечание**: пул (G8) — отдельный коммит.

### E3 🟡 Схема/скрипты гигиена  (N2,N3,Q4,Q5,Q6,G11,D3-guard)
- init-workspace убрать `shared_db_with_main_nabu`; синхронизировать дефолт whisper; `018_fk_indexes.sql` (аддитивно); коммент TQL-порядка; `016` DELETE в guard; экранировать `$job` в install-cron --remove; починить python-fallback в guard-web-privacy.
- **Файлы**: по списку. **Проверка**: миграции идемпотентны; `test:hooks`.

### E4 🟡 Копипаст мостов  (Q1,G9,Q7)
- Вынести `extractAssistantText`+нарезку в `claude-run.mjs`; лимит длины message перед spawn; графемно-безопасная нарезка.
- **Файлы**: `cli/claude-run.mjs`, `cli/chat-server.mjs`, `cli/telegram-bot.mjs`, `cli/nabu.mjs`.

---

## Порядок и контрольные точки
1. **A1–A4** → коммит на шаг; после A `test:hooks` обязателен.
2. **B1–B6** → по коммиту; после B ручной smoke демона.
3. **C1–C2** → по коммиту; unit-тесты.
4. **D1–D3** → 1–2 коммита.
5. **E1–E4** → тематические коммиты.
Итог — Этап 5: обновить AUDIT.md.

---

## ⛔ СТОП — жду подтверждения

Вопросы ДО правок:

1. **Объём фикса демона (Блок B)**: быстрые async-обёртки (минимально инвазивно) — ок? Или глубже (worker-процесс)? *Рекомендую async-обёртки.*
2. **Политика embedQuery (C2)**: разрешать поиск по `default`-базе на облачном эмбеддере без ALLOW_REMOTE (приватную память — только с opt-in)? *Рекомендую да — иначе на Jina/облаке поиск по библиотеке не работает.*
3. **Crisis-фикстуры (A3)**: сейчас — privacy-фикстуры + фикс матчера, а crisis отдельной итерацией с твоей вычиткой «золотых» ответов? *Рекомендую так (safety-критично).*
4. **Мёртвый код**: удалять `listByDomain`/`renderSalient` или оставить как точки расширения?
5. **Границы**: guard динамических имён (`X=rm`) не покрываем (предел regex, энфорсер = approval); crisis-номера (N4) — твоя верификация вне кода. Согласен?

Подтверди («делай по плану» + ответы 1–5) — начну с Блока A. Объём: **11 major + ~30 minor**; можно взять только major, или major+выбранные minor — скажи.
