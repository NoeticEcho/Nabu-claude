# Установка Nabu-claude

Nabu-claude **реализован** (v0.9.0): плагин Claude Code + 7 MCP-серверов + 68 субагентов +
skill-оркестратор + CLI `nabu` (демон, веб-чат, расписание).

## Быстрый путь — zero-config (рекомендуется)

```bash
curl -fsSL https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.sh | bash
nabu start && nabu chat
```

Установщик сам: проверит git/Node≥22/Docker/claude → клонирует → соберёт → слинкует `nabu` →
`nabu init` (поднимет pgvector+TypeDB[+Ollama] в docker на свободных портах, сгенерирует `.env`,
применит схемы, докачает embedding-модель, прогонит smoke). Детали и режимы (standalone/shared) —
`docs/ZERO_CONFIG.md`. Ручной путь ниже — для установки к общей БД основного Nabu.

## Ручной путь (shared-режим к общей БД)

## Предусловия
- **Claude Code** + подписка **Claude Max**. Node **≥22**.
- Доступ к **той же БД**, что у основного Nabu: Supabase (с pgvector) + TypeDB. MCP-серверы
  Supabase и TypeDB подключены (`.mcp.json`).
- **Ollama** локально: `ollama pull nomic-embed-text-v2-moe` (приватные эмбеддинги, 768-dim).
- **Python 3** (опц., для голоса): `pip install faster-whisper`.

## Шаги
1. **`.env`** — скопировать из `.env.example` (`cp .env.example .env`) и заполнить:
   - Обязательно: `DATABASE_URL` (общий Supabase).
   - TypeDB: `TYPEDB_URL`, `TYPEDB_DATABASE`, `TYPEDB_USERNAME`, `TYPEDB_PASSWORD` (иначе — Postgres-fallback).
   - Ollama: `OLLAMA_BASE_URL`, `OLLAMA_EMBED_MODEL`.
   - Изоляция: `NABU_NAMESPACE` (для `mem_*`), `NABU_USER_ID` (uuid из `public.users` — ОБЯЗАТЕЛЬНО
     в многопользовательской БД; иначе доступ к доменным данным fail-closed).
   - Опц. тюнинг: `NABU_PG_POOL_MAX` (по умолч. 3), `NABU_PG_SSL_STRICT` (1 = строгая TLS-проверка),
     `NABU_EMBED_TIMEOUT_MS` (30000), `NABU_INDEX_ROOTS` (allow-list корней индексации через `:`),
     `NABU_MAX_AUDIO_BYTES` (лимит аудио для транскрипции).
2. **Сборка**: `npm install && npm run build` — собирает `lib/` + 7 MCP-серверов.
3. **Схемы** (аддитивно, только недостающее — не ломая основную БД): применить через Supabase/TypeDB MCP
   `schema/postgres/*.sql` (001–007) и `schema/typedb/memory.tql`. Все DDL — `IF NOT EXISTS`.
4. **Agent Teams** (рекомендуется — Совет работает командой). В `~/.claude/settings.json` или
   `.claude/settings.json` проекта:
   ```json
   { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }, "teammateMode": "in-process" }
   ```
   Без флага Совет работает в fallback (тот же протокол через `deliberation`-буфер). См. `docs/TEAMS.md`.
5. **Подключить плагин** через маркетплейс (`.claude-plugin/marketplace.json`) или локально.
6. **Проверка подключений**: `npm run smoke` (Postgres + Ollama + запись/чтение памяти + мягко TypeDB).
7. **Проверка работы**:
   ```
   /nabu-index ./data        # построить базу знаний
   /nabu-ask <вопрос>        # адъютант с памятью
   /nabu-council <дилемма>   # коллегиальное решение (командой при включённых Teams)
   /nabu-new-agent <роль>    # создать агента
   /nabu-agents              # реестр агентов
   ```

## Тесты и проверки
- `npm test` — юнит-тесты (stats, personality/guardrails, Postgres.tx, chunk/tql/vector).
- `npm run test:hooks` — регрессия guard-хука (деструктивные команды).
- `npm run test:db` — интеграционные тесты против живой БД (нужен `.env`).
- `npm run eval` / `eval:live` — оценка субагентов (fixture-replay / live с judge).

## Замечания
- Схема БД — из основного Nabu; дополнения только аддитивные (инвариант #9).
- Размерность вектора (768) — под `nomic-embed-text-v2-moe`; сменишь модель — обнови схему/конфиг.
- TypeQL версионно-зависим — сверить с TypeDB 3.x.
- Голос — неблокирующее дополнение (`voice_transcription: optional_non_blocking`).
- Высокорисковые домены (здоровье/финансы/психика/отношения) — информация, не профсовет
  (`SAFETY.md`); `private` по умолчанию, `vault` не отдаётся модели без явного запроса.
- Кризисные ресурсы (`config/crisis_resources.json`) — верифицировать номера линий до продакшена (docs/28 §10).
