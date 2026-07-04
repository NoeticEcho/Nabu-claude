---
description: Инициализировать рабочую директорию Nabu (~/nabu): git-репо, горнило/inbox, md-выход.
argument-hint: [путь (по умолчанию ~/nabu или $NABU_HOME)]
---

# /nabu-init

Инициализируй рабочую директорию Nabu (фича 7). Запусти idempotent-скрипт:

```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/init-workspace.sh
```
(если задан `$ARGUMENTS` — используй его как `NABU_HOME`; иначе `$NABU_HOME` или `~/nabu`).

Скрипт создаёт (безопасно повторно):
- git-репозиторий с первым коммитом;
- `00-inbox/` (**горнило** — сюда скидывается всё необработанное; `voice/` для аудио);
- `10-knowledge/{fleeting,literature,evergreen}` — знания по жизненному циклу;
- `20-domains/<9 сфер>` — выход по сферам жизни;
- `30-council/` решения, `40-projects/`, `50-digests/`, `60-metrics/`, `90-system/`;
- `.nabu/config.json` — конфиг workspace.

После init:
- покажи структуру и путь;
- если в горниле есть файлы — предложи `/nabu-index 00-inbox`;
- напомни: автокоммит после правок внутри workspace идёт автоматически (hook), приватное — локально.

Отключить авто-инициализацию на старте сессии: `NABU_NO_AUTOINIT=1`.
