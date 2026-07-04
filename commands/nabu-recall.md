---
description: Поиск по памяти — семантика, граф связей, база знаний, намерения.
argument-hint: <запрос>
---

# /nabu-recall

Найди в памяти релевантное `$ARGUMENTS` (напрямую через `nabu-memory.recall` или субагентом
`retriever` при сложном сборе). Источники:

- **Память** (`nabu-memory.recall`) — episodic + semantic + autobiographical по смыслу (pgvector).
- **База знаний** (`nabu-pipeline.search_knowledge`) — проиндексированные документы.
- **Граф связей** (`nabu-memory.graph_neighbors`) — ассоциированные концепты (если TypeDB доступен).
- **Намерения** (`nabu-memory.list_prospective`) — если запрос про планы/напоминания.

Верни top-k (`config.memory.retrieval_top_k`, по умолчанию 12), отсортированный по релевантности,
с указанием источника и оценки близости. private/vault обрабатываются локально.

**Только из памяти — ничего не выдумывать.** Если ничего не найдено — честно скажи, что данных нет.
