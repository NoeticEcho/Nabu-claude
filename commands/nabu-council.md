---
description: Созвать Совет (Agent Team) для коллегиального решения по многодоменному вопросу.
argument-hint: <вопрос или дилемма>
---

# /nabu-council

Созови Совет по `$ARGUMENTS` как **команду агентов** (см. `docs/TEAMS.md`). Адъютант (skill
`nabu-orchestrator`) ведёт совещание; `deliberation`-буфер (MCP `nabu-council`) — durable-запись.

1. `nabu-council.open_deliberation({ question })` → `deliberationId`.
2. Определи релевантные домены (не всех — только затронутых, ≤ `config.council.max_ministers_per_query`);
   подними общий контекст памяти (`nabu-memory.recall`).
3. **Team-режим** (флаг `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`): спавни министров тиммейтами +
   `council` + `critic`, передав вопрос + `deliberationId` + контекст. Министры обсуждают
   кросс-доменные конфликты напрямую (SendMessage) и пишут позиции `add_position`.
   **Fallback** (флаг выключен): те же министры через параллельный Task-диспатч, позиции в буфер.
4. Тиммейт `council`: `get_positions` → конфликты → синтез с trade-off'ами наружу (не усреднять) →
   `record_synthesis`.
5. Настоящий выбор → `decision-maker` (MCDA). Затем `critic` проверяет синтез.
6. Собери единый ответ, вынеси trade-off'ы; `close_deliberation`; запиши решение в память
   (`remember_episode`) и, если уместно, в `30-council/` рабочего workspace (md).

Соблюдать бюджет и SAFETY.md. Совет советует — финальное решение за пользователем. Высокорисковое
из синтеза — через approval.
