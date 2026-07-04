# REFACTOR_PLAN.md — раунд 3 (по AUDIT.md v1.0.0)

Порядок: critical → major → minor. Каждый шаг атомарен (typecheck + 70 unit + 47 guard зелёные),
отдельный коммит. Контракты (имена MCP-tools, HTTP-роуты, форматы файлов .enc/NBK1, схемы —
только аддитивно) не меняются, кроме явно указанного в шагах. Итог — **v1.0.1** (bugfix-релиз,
push в опубликованный репозиторий).

**Проверка на каждом шаге:** `npm run typecheck` · `npm test` · `npm run test:hooks` ·
`node --check cli/*` + таргет-эмпирика шага. Финал — полный E2E: **свежая установка с нуля**
(без .env!) → chat-обмен → профильный цикл → backup --encrypt.

---

## Фаза 1 — CRITICAL (продукт сломан)

**Ш1 (C2). Веб-чат: TDZ.** Перенести блок `threadProfile/profEnv` выше первого использования.
Файл: chat-server.mjs. Проверка: live-обмен `/api/chat` (стаб claude) → text/done приходят;
затем реальный обмен.

**Ш2 (C1). Свежая установка.** `cmdInit`: отсутствие `.env`/DATABASE_URL = **standalone по
определению** (mode="none" остаётся только для reset/status-семантики «не инициализировано»);
bootstrap выполняется всегда при init. Файл: nabu.mjs. Проверка: **E2E с нуля** — пустой env-путь
→ init → DATABASE_URL сгенерирован, стек поднят, 13 схем, smoke зелёный.

**Ш3 (C3). Профили fail-closed.** Валидация во всех трёх точках загрузки (applyProfile,
chat profilesConfig-использования, buildDeps): профиль обязан задавать **и namespace, и user_id**
— иначе отказ с понятной ошибкой (не тихий fallback). + `nabu profiles add <имя>` — создаёт
строку users в БД и дописывает валидный профиль в конфиг (устраняет ручную UUID-магию).
Обновить _readme и docs. Файлы: nabu.mjs, chat-server.mjs, lib/index.ts, docs. Проверка:
живьём — неполный профиль отклонён везде; `profiles add anna` → изоляция задач/заметок
подтверждена в ОБЕ стороны.

**Ш4 (C4+M9). Standalone-миграция контента.** Скриптовая правка 28 agents/*.md: «Supabase MCP
(таблицы …)» → «nabu-domain (list_/add_/log_-tools)» единой формулировкой; AGENT_INTEGRATION:117
дочистить; marketplace.json — новая карточка (standalone, 73 агента, актуальное описание).
Проверка: grep-чистота (0 живых Supabase-инструкций вне исторических/спек-доков), все упомянутые
tools существуют (переиспользовать проверку a3-product).

## Фаза 2 — MAJOR

**Ш5 (M1). Пользовательский стейт — из git.** Живые конфиги переезжают в `NABU_HOME/.nabu/config/`:
`schedule.json`, `profiles.json`, `integrations.json`, `nabu.config.json` читаются оттуда;
в репо остаются **шаблоны** (первый запуск сеет копию; существующие правки мигрируются init'ом).
Все readers (nabu.mjs, chat-server, connect-server, domain-server list_calendar, доки)
→ единый resolver (env NABU_CONFIG_DIR переопределяет; lib loadConfig — та же логика). Проверка:
`schedule enable` → `git status` чист; `nabu update` (noop-pull) проходит; все tools читают правки.

**Ш6 (M2). Демон не фризится.** cmdBackup: typedb/workspace-шаги и deepChecks-docker-вызовы →
async (`spawn`+await), event-loop свободен. Проверка: latency-проба чата во время `nabu backup`
на живом стеке (<1с ответ /api/threads).

**Ш7 (M3+minors бэкапа). Шифрование честное.** catch encryptFileGcm → unlink плейнтекста + failed;
ts бэкапа + `-<pid>`. Проверка: инъекция сбоя (битый ключ) → плейнтекста нет, exit 1.

**Ш8 (M4+M7+фин-minors). Финансы.** tx_hash += порядковый номер среди идентичных строк файла
(реимпорт того же файла — идемпотентен, «два кофе» — оба живут); `summary()` группирует по
валютам (основная + список остальных); warning парсера перечисляет поддержанные форматы дат.
Старые строки БД остаются валидными (соль меняет только новые хэши — аддитивно). Проверка:
фикстура два-кофе → 2 insert; реимпорт → 0; мультивалютная фикстура → раздельные суммы.

**Ш9 (M5+M6). Connect-защита.** trigger_webhook: атомарное потребление approval
(`update … set used_at=now() where id=… and status='approved' and used_at is null and
(expires_at is null or expires_at>now()) returning`; схема 013: `used_at` аддитивно) — one-use +
expiry; `redirect:"manual"` в call_connector и trigger_webhook (3xx → честный degraded).
Проверка: живой цикл — второй вызов с тем же approval отклонён; redirect-стенд → degraded.

**Ш10 (M10–M13+клиент-minors). Клиенты.** deleteMessages(profile треда); stats: профильный путь
не пишет shared negative-cache; hook: идемпотентность фиксируется после успешной записи;
proactivity: uniq tmp (pid+uuid) у обоих писателей (lost-update принимаем, задокументировать);
quickAddTask — локальная дата (не UTC); offline: подавить предшествующий error-event при
активном фолбэке. Проверка: curl-матрица + стаб-смоуки бота.

**Ш11 (M8). ICS EXDATE.** Нормализация сравнения: если любая сторона date-форма — сравнивать
по календарному дню; TZID-EXDATE — как локаль (симметрично DTSTART). +2 юнит-теста. Проверка:
tests (воспроизведённый кейс — зелёный).

## Фаза 3 — MINOR (батчи)

**Ш12. cli-полировка:** guard import-health на реально используемые экспорты; recordProactivePush
только при успешной отправке; сообщения «none»-режима → «не инициализировано (nabu init)»;
удалить `--local` из HELP/доков; HELP дополнить stop/daemon/backup-decrypt; release-prep —
исключить сам себя из замены; предупреждение при `--profile` с общим STATE_DIR.
**Ш13. lib-полировка:** комментарий Apple-парсера честный (+заметка про лимит строки V8);
naive-datetime → локаль; health-CSV — та же ordinal-соль, что Ш8.
**Ш14. Продукт-полировка:** README 34→70 unit; выровнять счётчики агентов (70+/73);
удалить мёртвый `data_sources`; пометка в docs/26 «(историческая спека — в v1.0 Supabase нет)»;
UI: подпись у селектора профиля «для новых разговоров и статистики».

---

## Порядок, риски, бюджет

| Фаза | Шаги | Риск |
|---|---|---|
| 1 | 1–4 | Ш2 меняет семантику detectMode — прогнать fresh-E2E и existing-E2E |
| 2 | 5–11 | Ш5 самый инвазивный (пути конфигов) — миграция обязана быть идемпотентной; blocked-правило 2–3 попыток |
| 3 | 12–14 | низкий |

Версия: **v1.0.1**, push + GitHub Release (bugfix). Этап 5 — обновление AUDIT.md итогами.

---

*СТОП. Жду подтверждения плана перед Этапом 4.*
