# Интеграция: 44 агента Nabu + Совет Nabu-claude

Nabu-claude переиспользует **все 44 агента** основного каталога Nabu (`agents/registry.json`) и
надстраивает над ними **Совет** доменных экспертов жизни. Это не два конкурирующих набора,
а два слоя одной системы. Полный список — в `agents/registry.json`.

## Два слоя

### Слой 1 — Конвейер Nabu (44 агента)
Это «как обрабатываются данные»: приём ввода → понимание → связывание → память → синтез →
терапия → привычки/проекты/метрики → исследования/геймификация/импорт. Эти агенты работают
с данными пользователя и наполняют память (граф, эмбеддинги, эпизоды). Слои и состав —
точно как в `agents/registry.json`.

### Слой 2 — Совет жизни (9 министров + функциональные)
Это «как принимаются решения по сферам жизни»: доменные министры (health, finance, …) дают
позиции, council синтезирует коллегиальное решение. Министры **не дублируют** конвейерных
агентов — они их **используют**.

## Как они связаны

Каждый министр опирается на релевантных агентов конвейера (поле `uses_nabu_agents` в реестре):

| Министр | Использует агентов Nabu |
|---|---|
| health | Affect Analyzer (10), CBT (24), Coach (28) |
| mind | Affect (10), терапевтические 24–28 |
| finance | Metrics (34), Forecaster (35), Anomaly (36) |
| work | Project Manager (31), PARA (33) |
| learning | Research (37), Claim Tracker (38), Argument Mapper (39), Insight/Hypothesis/Socratic (18–20) |
| relationships | Affect (10), Coach (28) |
| growth | Habit Architect (29), Streak (30), Quest (32), RPG GM (40) |
| lifestyle | PARA (33), Metrics (34) |
| admin | Project Manager (31), PARA (33), Triage (5) |

## Сведённые роли (не дублируются)

Несколько функциональных агентов Nabu-claude **совпадают** с агентами Nabu — используется один:

| Роль Nabu-claude | = агент Nabu |
|---|---|
| critic | Critic (#03) |
| retriever | Context Retriever (#17) |
| librarian | Librarian (#16) |
| entity-extractor | Entity Extractor (#08) |
| voice-transcriber | Transcriber (#06) |
| adjutant | надстроен над Conductor (#01) |

## Поток запроса (полный)

```
Запрос
 → adjutant (над Conductor #01) триаж
 → [конвейер Nabu при необходимости: Triage #05, Intent #11, Entity #08, Retriever #17…]
 → простой/единодоменный → ответ
 → многодоменный → council собирает позиции министров
      (министры используют свои агенты Nabu: Affect, Metrics, Research…)
   → синтез с trade-off'ами
   → decision-maker (#— функц.) при выборе
   → critic (#03) проверка
 → ответ + запись в память (Librarian #16, граф, эпизоды)
```

## Материализация в Claude Code (v0.5.0)

Все агенты agents/registry.json + Совет **материализованы** (поле `impl` в `agents/registry.json`):

- **Субагенты Claude Code** (`agents/<slug>.md`, 68 шт.) — всё, кроме адъютанта: 44 конвейерных
  агента (кроме #01), 9 министров, `council`/`decision-maker`/`critic`/`agent-creator`,
  память (`retriever`/`memory-keeper`/`entity-extractor`/`librarian`/`reflector`/`digest`/
  `voice-transcriber`), созидатели (`builder`+`entrepreneurship`/`software-dev`/`web-dev`/`copywriting`).
  Frontmatter `name`/`description`/`model` + системный промпт; изолированный контекст, параллельный
  Task-диспатч, помодельная маршрутизация (Haiku/Sonnet/Opus по `agents/registry.json``). Авто-обнаружение
  из `agents/` (рекурсивный скан `.md`; `agents/*.json` — профили личности, не пересекаются).
- **Единственный skill** — `nabu-orchestrator` (адъютант = Conductor #01). Работает в ОСНОВНОМ
  контексте: с ним общается пользователь, он триажит и диспатчит субагентов.

### Коллегиальное решение — Совет как Agent Team (v0.7.0)
Совет работает как **команда агентов** (`docs/TEAMS.md`): министры-тиммейты обсуждают кросс-доменные
конфликты напрямую (SendMessage) + общий task-list. Флаг `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
(opt-in). **Fallback** без флага — тот же протокол через параллельный Task-диспатч. В обоих режимах
`deliberation`-буфер (MCP `nabu-council`) — durable-запись: адъютант `open_deliberation` → собирает
команду министров + `council` + `critic` → министры пишут `add_position` (или отдают позицию lead'у) →
`council` синтезирует (`get_positions`→`record_synthesis`, trade-off'ы наружу) → `decision-maker`
(при выборе) → `critic` → ответ + память + (опц.) md в `30-council/` → `close_deliberation`.

Team-поведение **зашито в дефиниции**: `agents/<министр>.md`, `council.md`, `critic.md`,
`decision-maker.md` содержат секцию «Режим команды (Agent Teams)» (координация через SendMessage +
общий task-list; позиция всегда пишется в durable-буфер). Так тиммейт не деградирует до буфер-only;
при выключенных Teams та же секция описывает fallback.

### Кросс-доменные консультации (v0.14)
Любой агент может запросить экспертизу другого домена — не только адъютант/министры. Механика
двухрежимная, как Совет: в **Teams** — прямой SendMessage министру; в **fallback** — durable-буфер
`consult` (nabu-council: `request_consult`/`answer_consult`/`get_consult`/`list_consults`) с
релеем через адъютанта (протокол — SKILL.md §4.5, бюджет ≤2 релея). Схема — `011_consult.sql`.

Массовые/пакетные операции (разбор всего горнила, аудит всех сфер) — опциональные **workflow-ассеты**
(`workflows/`, SDK/CLI-only, не в плагине), напр. `inbox-triage.workflow.js`.

### Тяжёлые вычисления
Численные агенты (`forecaster`/`correlation-finder`/`anomaly-detector`/`metrics-tracker`) считают
через **TypeScript MCP `nabu-analytics`** (Holt linear прогноз, Pearson/Spearman/MI корреляция,
EWMA+z-score аномалии, агрегаты) — не python. Эмбеддинги — Ollama (локально); транскрипция —
whisper (локально, `scripts/transcribe.py`, аудио — не «численное»).

## Инструменты субагентов

Узкие типизированные операции — через MCP-серверы плагина (`nabu-memory`, `nabu-pipeline`,
`nabu-council`, `nabu-domain` для projects/tasks/goals/habits/quests/character_sheet/metric_*;
`nabu-pipeline` для sources/claims; граф — через lib/TypeDB HTTP). Веб — нативные WebFetch/WebSearch. Высокорисковое (write/external/
financial/destructive) — через `request_approval` + `log_action` (governance). Приватное
(private/vault) — только локально (Ollama/Qwen), никогда в облако/логи.

## Хардненинг и эксплуатация (v0.6.0)

- **Две оси изоляции** (standalone-БД): `mem_*`/`knowledge`/`deliberation`/governance — по
  `namespace`; доменные/аналитические таблицы (projects/habits/metric_*/…) — по `NABU_USER_ID`.
  Профили обязаны задавать ОБЕ оси (fail-closed, `nabu profiles add`). RLS не навешан
  (персональная локальная БД).
- **TTL памяти**: `nabu-memory.purge_expired_working` чистит истёкшую рабочую память; на чтении
  всё равно фильтруется по `expires_at`. Периодичность — через `/schedule` Claude Code или pg_cron.
- **Приватность по умолчанию**: episodic/semantic пишутся `private` по умолчанию; чувствительные
  домены (health/mind/finance/relationships) — `private` (config `high_risk_domains_private`).
- **Кризис-ресурсы**: `config/crisis_resources.json` — навигаторы + региональные линии с флагом
  `VERIFY_BEFORE_PRODUCTION` (SAFETY.md: верификация человеком/консультантом перед запуском).
- **Узкие tools субагентов (least-privilege, сделано)**: через `disallowedTools` (сохраняет MCP + Read).
  59 reasoning/memory-агентов — `disallowedTools: Write, Edit, Bash` (не пишут файлы/шелл; персистенция —
  через MCP; md-выход в workspace пишет адъютант). doc-writers (`document-synthesizer`, `argument-mapper`) —
  `Edit, Bash` (Write оставлен для файлового выхода). 7 build/web/eval-агентов (`software-dev`, `web-dev`,
  `builder`, `import-agent`, `capability-scout`, `research-assistant`, `effectiveness-evaluator`) — полный
  набор. MCP-доступ у всех сохранён (denylist не трогает MCP). Плюс: узкие MCP-tools, approval, critic.
- **vault**: сейчас обрабатывается как `private` (локально, без утечки), полноценное клиентское
  E2E-шифрование — отложенная доработка.

## Безопасность

Терапевтические агенты Nabu (#24–28) сохраняют все ограничения `agents/registry.json`/`SAFETY.md`:
private/Ollama, disclaimer, human review промптов, eval с психологом. Доменные министры
high-risk (health, mind, finance, relationships) наследуют границы компетенции из `SAFETY.md`.
Critic (#03) проверяет всё перед выдачей.
