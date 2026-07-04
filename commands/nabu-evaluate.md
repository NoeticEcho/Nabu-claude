---
description: Оценить эффективность агентов/промптов/скиллов/Совета и применить самообучение.
argument-hint: [target: agent-name | council | prompts | all]
---

# /nabu-evaluate

Запусти оценку и самообучение (фичи 12 + 8) для `$ARGUMENTS` (или `all`):

1. **Измерение** — субагент `effectiveness-evaluator`: прогон `evals/*.jsonl` (`node evals/runner.mjs`),
   судейство выходов по рубрикам agents/registry.json, учёт исходов/фидбэка → `nabu-improve.record_effectiveness`.
2. **Обучение** — субагент `nabu-learner`: по метрикам аккуратно подстраивает личность агентов с
   `evolves:true` (`evolve_personality`, шаг ≤±1, пороги honesty/kindness, лог), а уточнения промптов/
   скиллов оформляет как `improvement_proposal`; успешные приёмы → `add_procedure`.
3. **Ревью** — значимые изменения через `critic` и решение пользователя (`update_proposal`).

Честные оценки без завышения; только измеренные данные. Отчёт — в `90-system/evals/`. По расписанию
(ежедневно/еженедельно) — см. `/nabu-cron`.
