---
description: Запустить ресёрчер само-улучшения Nabu — найти зоны роста и предложить улучшения.
argument-hint: [фокус: agents | prompts | workflow | council | процессы]
---

# /nabu-research

Запусти субагент `nabu-researcher` (фича 9) для `$ARGUMENTS` (или по всей системе). Он:
1. Соберёт данные: `nabu-improve.get_effectiveness`, `list_proposals` (не дублировать), `evals/`,
   исходы Совета, `nabu-memory.recall`, `list_system_tasks`.
2. Найдёт зоны роста, верифицирует гипотезы на данных (act→verify→correct).
3. Оформит предложения `nabu-improve.add_proposal` (+ план в `system_task`, отчёт в `90-system/proposals/`).

Предлагает, НЕ внедряет: принятие — через `critic` и решение пользователя (`update_proposal`).
Высокорисковое — через approval. По расписанию — см. `/nabu-cron` (еженедельно). Только из данных.
