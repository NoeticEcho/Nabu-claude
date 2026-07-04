---
description: Выбрать готовое к разработке community-issue и реализовать его (PR; merge — за людьми).
argument-hint: [номер issue или тема]
---

# /nabu-contribute

Проверь `config/nabu.config.json → commons`. Если `commons.enabled === false` — объясни, что
Commons выключен по умолчанию, и остановись. `repo = commons.repo` (формат `owner/name`).

1. **Список задач**: `gh issue list --repo <repo> --label ready-for-dev --state open --json number,title,body`.
   Отсей уже взятые (есть комментарий с `<!--nabu-claim`). Сопоставь с локальной компетенцией; пользователь выбирает.
2. **Заявка (claim)**: покажи текст → `nabu-memory.request_approval({ riskClass:"external", action:"gh:claim" })`
   → `gh issue comment <n> --body "<!--nabu-claim version:<v>--> ..."`.
3. **Реализация**: fork/branch `commons/<issue>-<slug>`. Сначала план, потом код (правила репо).
   Дисциплина: `npm run typecheck` / `test` / `test:hooks` зелёные, guard-хуки соблюдены,
   без изменений API сверх рамок issue.
4. **PR**: `gh pr create` (approval, action `gh:pr-create`), шаблон:
   что / зачем / тесты / результаты eval + `Closes #<n>` + машинный блок:
   `<!--nabu-contribution issue:<n> version:<v>-->`.

Если реализация буксует (2-3 неудачных попытки) — честно сними заявку комментарием (un-claim),
не оставляй issue заблокированным.

Merge PR решают **только люди-мейнтейнеры** — инстанс никогда не подтверждает и не сливает свой PR сам.
Приватные данные (`private`/`vault`) в код и PR не попадают.
