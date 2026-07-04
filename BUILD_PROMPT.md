# Промпт для Claude Code: построй плагин Nabu-claude

> **ИСТОРИЧЕСКИЙ ДОКУМЕНТ (исходное ТЗ на сборку).** Nabu-claude уже реализован (v0.8.0).
> Актуальное состояние — в `README.md`, `ARCHITECTURE.md`, `AGENT_INTEGRATION.md`, `INSTALL.md`,
> `docs/TEAMS.md`. Ниже — первоначальный бриф; часть деталей (напр. «4 MCP-сервера» — сейчас 7)
> устарела и оставлена как есть для истории.

## РОЛЬ

Ты строишь **Nabu-claude** — отдельный проект-клиент: ИИ-«Совет» для всех сфер жизни
пользователя, работающий внутри Claude Code (мозг — подписка Max), с памятью и личностью
агентов в той же БД, что и основное приложение Nabu (Supabase + pgvector + TypeDB).

Дизайн harness следует agents-best-practices (установи как skill, см. ниже). Принцип:
**harness действует, модель предлагает; сначала MVP, расширение — по реальной потребности.**

## ГЛАВНОЕ ПРАВИЛО: СНАЧАЛА ПЛАН

Не пиши код в первом ответе. Сначала Этап 0, потом план, жди подтверждения.

---

## ЭТАП 0 — ПОНИМАНИЕ

1. Установи и прочитай skill **agents-best-practices**:
   `git clone https://github.com/DenisSergeevitch/agents-best-practices .claude/skills/agents-best-practices`
   Прочитай его `SKILL.md` и `references/` (особенно mvp-agent-blueprint, agentic-loop,
   tools-and-permissions, context-memory-compaction, security-evals-observability).
2. Прочитай: `ARCHITECTURE.md`, `LIFE_DOMAINS_RESEARCH.md`, `SAFETY.md`,
   `PERSONALITY_RENDERING.md`, `CLAUDE.md`.
3. Из контрактов основного Nabu: `docs/15` (Option Д), `docs/28` (wellbeing), `docs/07`
   (data model), `docs/09` (agent catalog).
4. **Проверь реальную БД основного Nabu** через Supabase/TypeDB MCP: какие таблицы уже
   есть, есть ли pgvector, есть ли таблицы памяти/личности/реестра агентов. НЕ дублируй —
   дополняй аддитивно только недостающее.
5. Проверь окружение: Supabase MCP, TypeDB MCP, Ollama (эмбеддинги), Python (Whisper, опц.).

Выдай **резюме** (≤ 2 страницы): что строим; что уже есть в БД и что нужно добавить;
что из окружения готово; открытые вопросы; предложения по упрощению. Жди подтверждения.

---

## ЧТО ПОСТРОИТЬ

Плагин `nabu-claude/` по структуре `ARCHITECTURE.md §6`:

- **Совет министров** (9 доменных агентов): health, mind, finance, work, learning,
  relationships, growth, lifestyle, admin. Каждый — SKILL.md + профиль личности +
  guardrails границ компетенции (`SAFETY.md`). Начни с канонических шаблонов
  (health, finance уже даны как образцы), остальные — по тому же образцу.
- **Функциональные агенты**: adjutant (orchestrator), council (коллегиальность),
  decision-maker, agent-creator, critic, конвейер памяти, voice-transcriber (опц.).
- **Команды**: `/nabu-index`, `/nabu-ask`, `/nabu-council`, `/nabu-decide`,
  `/nabu-new-agent`, `/nabu-recall`, `/nabu-consolidate`, `/nabu-voice`, `/nabu-agents`, `/nabu-review`.
- **MCP-серверы**: memory-server, pipeline-server, council-server, voice-server —
  узкие типизированные tools, структурированные результаты, approval для высокорисковых.
- **lib/**: порты, репозитории, типы (контракты Option Д), общая БД.
- **schema/**: только аддитивные таблицы (память агентов, личность, реестр, журнал
  совещаний), если их ещё нет в БД основного Nabu.
- **agents/registry.json**: реестр всех агентов и их компетенций.

## КОЛЛЕГИАЛЬНОЕ РЕШЕНИЕ (ключевая механика)

Реализуй протокол из `ARCHITECTURE.md §4`: adjutant триаж → при многодоменном запросе
council собирает структурированные позиции релевантных министров
(`{recommendation, rationale, risks, confidence, depends_on}`) → выявляет конфликты →
синтезирует с trade-off'ами → decision-maker при настоящем выборе → critic → ответ + запись.
Позиции собираются оркестратором (Task-суб-агенты или последовательно с записью в
`deliberation` через council-server). НЕ автономный рой — оркестрированная коллегиальность.

## AGENT-CREATOR (порождение агентов)

Реализуй agent-creator: при нехватке компетенции создаёт нового агента — роль, границы,
профиль личности, SKILL.md по канону, guardrails (включая границы компетенции для
высокорисковых доменов), регистрация в registry.json, eval-набор. Critic ревьюит до
активации. Новый агент получает узкие tools, не broad-доступ.

## ПАМЯТЬ И ЛИЧНОСТЬ

Память: 7 типов на 3 хранилищах (общая БД). Личность: числовые черты → директивы по
`PERSONALITY_RENDERING.md`. Все агенты Совета видят общую память пользователя.

## КОМАНДА /nabu-index

Анализ всех документов в папке: скан → для каждого entity-extractor → граф (TypeDB) +
эмбеддинги (pgvector) + эпизод/факт (Postgres) → база знаний, доступная Совету.
Приватное — локальные эмбеддинги. Прогресс в консоли.

---

## ЭТАП 1 — ПЛАН (после подтверждения)

Фазы (адаптируй): 1) фундамент (plugin.json, lib, проверка/дополнение схемы БД, registry).
2) память (memory-server, retriever) + `/nabu-index`. 3) адъютант + базовый ответ с памятью.
4) Совет министров (канон health/finance → остальные) + council-server + `/nabu-council`.
5) decision-maker + critic. 6) agent-creator + `/nabu-new-agent`. 7) консолидация, reflector.
8) голос (опц., неблокирующий). Для каждой фазы — что делаем, как проверяем, контрольная точка.

## ИНВАРИАНТЫ

- Границы компетенции (`SAFETY.md`): информация, не профессиональный совет; направлять к специалисту.
- Privacy (`docs/28`): private/vault только локально.
- Harness (best-practices): approval для высокорисковых; узкие tools; бюджеты циклов.
- Не выдумывать данные; личность — не сознание; Совет советует, не решает.
- Не ломать общую БД; дополнять аддитивно.
- Тяжёлые операции — локально, не через Claude.

## ПЕРВЫЙ ШАГ

Выполни Этап 0: установи agents-best-practices, прочитай документы, проверь БД и окружение
через MCP, выдай резюме и вопросы. НЕ пиши код. Жди подтверждения.
