---
description: Прорецензировать community-PR (только комментарии; approve/merge — за людьми).
argument-hint: <номер PR>
---

# /nabu-review-pr

Проверь `config/nabu.config.json → commons`. Если `commons.enabled === false` — объясни, что
Commons выключен по умолчанию, и остановись. `repo = commons.repo` (формат `owner/name`).

1. **Достань PR**: `gh pr view <n> --repo <repo>` и `gh pr diff <n> --repo <repo>`.
2. **Ревью субагентами** `critic` + `software-dev`: корректность, инварианты безопасности
   (`SAFETY.md`), приватность, тесты. Каждое замечание должно ссылаться на `file:line` из диффа —
   без проверяемой привязки замечание не включаем.
3. **Критическая поверхность**: трогает ли PR guard-хуки, governance/approval, vault-crypto или
   инсталляторы → пометь «критическая поверхность — требует особого внимания мейнтейнера».
4. **Покажи пользователю** сведённые находки → `nabu-memory.request_approval({ riskClass:"external",
   action:"gh:pr-review" })` → дождись `approved`.
5. Опубликуй: `gh pr review <n> --comment --body ...` — структура:
   Вердикт (совещательный) / список находок с `file:line` / что проверяли.

**Никогда** `gh pr review --approve` и никакого merge: ревью носит совещательный характер,
approve/merge PR решают **только люди-мейнтейнеры**. Приватные данные наружу не уходят.
