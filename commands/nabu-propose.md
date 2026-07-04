---
description: Синтезировать локальное предложение по улучшению; опционально поделиться в Commons (--share).
argument-hint: [тема] [--share]
---

# /nabu-propose

Проверь `config/nabu.config.json → commons`. Если `commons.enabled === false` — объясни, что
Commons выключен по умолчанию (федеративное само-улучшение, включается вручную), и остановись.
`repo = commons.repo` (формат `owner/name`, placeholder до релиза).

1. **Собери локальные свидетельства**: `nabu-improve.list_proposals`, эффективность
   (`nabu-improve.get_effectiveness`), агрегаты в стиле `/nabu-metrics`, недавние трения из памяти
   (`nabu-memory.recall`). Только счётчики/проценты — НИКАКИХ цитат заметок.
2. **Черновик** — субагент `reflector`/`evaluator`, структура:
   Проблема / Локальные свидетельства (только агрегаты) / Предлагаемое изменение / Ожидаемый эффект / Категория.
3. Сохрани локально: `nabu-improve.add_proposal({ title, body, category })`.

Если `$ARGUMENTS` содержит `--share`:
4. **Дубликаты**: `gh search issues --repo <repo> --match title,body "<keywords>" --label community-proposal`.
   Есть близкое совпадение → предложи **проголосовать** за него (см. `/nabu-vote`), а не плодить дубль.
5. Иначе: privacy-scrub субагентом `critic` (только агрегаты, никаких персональных данных) →
   покажи пользователю ТОЧНЫЙ финальный текст issue → `nabu-memory.request_approval({ riskClass:"external",
   action:"gh:issue-create" })` → дождись `approved` →
   `gh issue create --repo <repo> --title ... --label community-proposal --body-file <tmp>`.

Тело issue обязано заканчиваться машинным блоком:
```
<!--nabu-proposal
version: <nabu version>
category: <feature|fix|perf|docs|agent|integration>
evidence: {"signals": <n>, "period_days": <n>}
-->
```

Приватные данные (`private`/`vault`) наружу не уходят — только агрегаты. Merge/приём предложений
решают люди-мейнтейнеры; инстанс ничего не подтверждает и не сливает сам.
