# LAUNCH.md — комплект запуска (GitHub + Product Hunt)

Рабочий документ мейнтейнера. Не для конечных пользователей.

## 0. Pre-flight чек-лист (перед `git push` в публичный репозиторий)

- [ ] Создать репозиторий `github.com/noeticecho/nabu-claude`, ветка по умолчанию `master`.
- [ ] **Заменить `noeticecho`** во всех файлах: `grep -rl "noeticecho" --include="*.md" --include="*.sh" --include="*.ps1" .`
      (README.md, README.ru.md, scripts/install.sh, scripts/install.ps1, SECURITY.md, docs/*).
- [ ] `scripts/install.sh` / `install.ps1`: заменить плейсхолдер `NABU_REPO` на реальный URL.
- [ ] Прогнать локально: `npm ci && npm run build && npm test && npm run test:hooks`.
- [ ] Свежая машина/VM: `bash scripts/install.sh` end-to-end (главная демо-гарантия).
- [ ] Убедиться, что CI зелёный на первом пуше (badge подхватится сам).
- [ ] Тег релиза: `git tag v1.0.0 && git push --tags`; GitHub Release с выжимкой из CHANGELOG.
- [ ] В настройках репо: включить Issues, Discussions (Q&A), Security advisories.
- [ ] Скриншоты/GIF (см. §3) — залить в `docs/media/` и вставить в README hero.

Примечание: старый Supabase `project_ref` остаётся в истории git — это публичный
идентификатор (не секрет; доступ защищён ключами/RLS). Если хочется убрать и из
истории — `git filter-repo` ДО публикации; иначе не трогать.

## 1. Product Hunt — тексты

**Name:** Nabu — Personal AI Council

**Tagline (60 симв., варианты):**
1. `Your lifelong AI council — private, local, on your Claude plan`
2. `A council of AI ministers that remembers your whole life`
3. `Life-OS on Claude Code: memory, council, privacy — all local`

**Description (~260 симв.):**
> Nabu is a council of specialised AI agents for every life domain — health, money,
> work, relationships. Lifelong memory in local Postgres+TypeDB, E2E-encrypted vault,
> Telegram & web clients, human-approved actions. Runs on the Claude subscription you
> already have. Open source, one-command install.

**Topics:** Artificial Intelligence · Productivity · Privacy · Open Source · Bots

**First comment (maker, черновик):**
> Hi PH! 👋 I built Nabu because every AI assistant I tried forgot me the next day.
> Nabu is different by architecture:
> • it's a *council* — 9 domain ministers debate your hard questions and show trade-offs;
> • it *remembers* — 7 memory types in local Postgres/pgvector + a TypeDB knowledge graph;
> • it's *private* — everything runs in local Docker, embeddings are local, the vault tier
>   is AES-256-GCM encrypted and never even gets embeddings;
> • it *asks before acting* — risky actions wait for a human button press;
> • and it costs nothing extra — the brain is Claude Code on the plan you already have.
> One command installs everything (`curl … | bash`). Web chat + Telegram (with local
> voice transcription). UI is Russian-first today — English is the top roadmap item,
> and contributions are very welcome. Ask me anything!

**FAQ-заготовки:**
- *Why Claude Code and not an API?* — No per-token costs, the agent harness (subagents,
  MCP, permissions) comes for free, and users already have the subscription.
- *Is my data sent anywhere?* — Reasoning happens via your Claude session (same trust as
  using Claude). Storage, embeddings, transcription, vault decryption — strictly local.
- *English UI?* — Roadmap #1 after launch; architecture is locale-ready (all strings in
  two files: chat.html + agent prompts).
- *Windows/macOS?* — Yes: installers for both, launchd/Task Scheduler autostart.
- *What if TypeDB/Ollama break?* — Everything degrades gracefully to Postgres-only;
  `nabu doctor` diagnoses.

## 2. Позиционирование (для всех площадок)

Одна фраза: **«Совет ИИ-министров с памятью на всю жизнь — локально и приватно, на вашей подписке Claude».**

Три кита (не менять формулировки, они выверены):
1. **Council, not chatbot** — коллегиальность с честными trade-off'ами.
2. **Memory, locally** — 7 видов памяти + граф, всё в docker-томах пользователя.
3. **Human-in-the-loop** — approvals кнопкой, vault-шифрование, границы компетенции.

Анти-обещания (говорить прямо): не заменяет врача/юриста/финсоветника; Telegram-канал —
транзит через серверы Telegram (выбор пользователя); UI пока русскоязычный.

## 3. Медиа-чек-лист

- [ ] GIF: `nabu init` от нуля до «Smoke пройден» (ускоренный).
- [ ] Скрин: веб-чат с ответом Совета (тёмный, с tool-индикаторами).
- [ ] Скрин: дашборд статистики (карточки + динамика).
- [ ] Скрин: Telegram-форум с темами министров + голосовое → расшифровка.
- [ ] Скрин: approval-кнопки (веб или TG) — «модель не может одобрить сама себя».
- [ ] Лого: `cli/ui/…/icon.svg` уже есть (тёмный градиент «N») — экспорт 240×240 PNG для PH.

## 4. День запуска

- [ ] PH: запуск 00:01 PT; maker-комментарий сразу; отвечать на всё в первые 4 часа.
- [ ] Пост в X/Telegram-каналах с GIF установки.
- [ ] Закрепить в репо issue «Roadmap & English UI» для голосования.
- [ ] Мониторить `nabu doctor`-отчёты в issues; горячие фиксы — сразу (CI защищает).

## 5. После запуска (первая неделя)

- [ ] Разобрать фидбэк → ROADMAP.
- [ ] English UI (строки chat.html + системные промпты агентов) — issue с планом.
- [ ] Публичная демо-запись (5 мин: init → чат → Совет → vault → approval).

> **Лендинг:** `docs/LANDING.md` — маркетинговая страница (PAS/JTBD/differentiation); заменить `noeticecho` вместе с остальными плейсхолдерами перед публикацией.
