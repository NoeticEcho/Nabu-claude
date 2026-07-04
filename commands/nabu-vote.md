---
description: Сопоставить открытые предложения Commons с локальными потребностями и проголосовать.
argument-hint: [фильтр/тема]
---

# /nabu-vote

Проверь `config/nabu.config.json → commons`. Если `commons.enabled === false` — объясни, что
Commons выключен по умолчанию, и остановись. `repo = commons.repo` (формат `owner/name`).

1. **Собери открытые предложения**:
   `gh issue list --repo <repo> --label community-proposal --state open --json number,title,body --limit 50`.
2. **Семантическое сопоставление** с локальными трениями/метриками/предложениями — субагенты
   `retriever` + `evaluator`. Считай релевантным только то, что реально болит у нас локально.
3. **Покажи таблицу**: «issue → почему релевантно нам → предлагаемый голос». Пользователь выбирает —
   это и есть разговор-согласие; всё равно залогируй раз на всю пачку:
   `nabu-memory.request_approval({ riskClass:"external", action:"gh:vote-batch" })`.
4. Для каждого одобренного:
   - реакция 👍: `gh api repos/<repo>/issues/<n>/reactions -f content='+1'`;
   - если есть локальное свидетельство — комментарий (`gh issue comment <n>`) с маркер-блоком:
```
<!--nabu-evidence version="<версия nabu>" signals="<агрегат>=<число>;<агрегат>=<число>"-->
```
(`signals` — пары name=value локальных подтверждений, напр. `friction_events=4;period_days=30`;
чем их больше (cap 10), тем выше вес голоса в tally v2 — см. docs/COMMONS.md)
     плюс 1-2 фразы агрегатов (никаких цитат заметок, никаких персональных данных).

Не голосуй за issue, нерелевантные локально — честный сигнал есть сила консенсуса.
Приватное (`private`/`vault`) наружу не уходит. Приём/merge предложений решают люди-мейнтейнеры.
