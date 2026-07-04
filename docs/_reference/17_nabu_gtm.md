# NABU

*Go-to-Market и Beta-программа*  
*Стратегия выхода на рынок*  
*Позиционирование · Дистрибуция · Beta · Phased launch*  
*Версия 1.0*  

---

# 1. Назначение и контекст

Документ описывает стратегию выхода на рынок Nabu — путь от первой alpha-волны до общедоступного продукта с десятками тысяч платящих пользователей. Покрывает: позиционирование, целевую аудиторию, конкурентный анализ, фазированный запуск, beta-программу, дистрибуцию, контент-маркетинг, growth-loops.

Документ работает в связке с документом 16 (Монетизация) — pricing-стратегия и trial-механики уже там описаны. Здесь фокус на «как привлечь и удержать» (acquisition, activation, retention).

# 2. Стратегическое позиционирование

## 2.1. Категория

Nabu позиционируется в пересечении трёх категорий: Personal Knowledge Management (PKM), AI-assisted writing/thinking, Personal growth/therapy. Это пересечение даёт уникальное место, но и затрудняет communication — пользователи приходят с разных направлений.

## 2.2. Основная позиция

> Nabu — это AI-копилот вашей внутренней жизни. Личные знания, психологическая работа, проекты, привычки — в одном местe, под полным вашим контролем. Без слежки. Без vendor lock. Локально, когда нужно.

## 2.3. Wedge — узкое начальное позиционирование

Категория слишком широкая для начального запуска. Wedge сужает: «Nabu — это PKM-инструмент с встроенным AI, спроектированный для приватной работы со знанием». Чёткий enemy — Notion (cloud-only, привязка к платформе, слежка).

На wedge удобно строить контент-маркетинг, PR, ProductHunt, первичный SEO. Когда продукт укоренится — расширяться в therapy и life-management как «обнаруженные» возможности.

## 2.4. Differentiators (по убыванию значимости)

1. Privacy-first: категории видимости, локальный Ollama, vault E2E. Уникально на рынке PKM.
1. Native multi-agent AI: не «AI как бот в углу», а 44 специализированных агента, работающих над разными аспектами знания.
1. Local-first: ваши данные в Markdown на вашем устройстве. Уходите когда угодно, всё работает оффлайн.
1. Multi-platform: десктоп, мобильное приложение, web — одна подписка.
1. Therapy & psychology integration: КПТ-журналы, гештальт, IFS — нативно, а не через сторонние плагины.
1. Self-hosted option: для технически продвинутых — полностью под контролем.
1. Open-core: AGPL-3.0 на ядре, прозрачность кода.

## 2.5. Anti-differentiators (того, что мы НЕ делаем)

1. Не Notion-killer. Не пытаемся быть лучшей альтернативой Notion для команды — это другой продукт.
1. Не Apple Notes. Не пытаемся быть простым «note-taking».
1. Не ChatGPT-обёрткой. Мы не «чат с AI с заметками» — мы «работа со знанием с AI».
1. Не для всех. Если пользователь не задумывается о приватности — это не наша целевая.

# 3. Целевые аудитории (ICPs — Ideal Customer Profiles)

## 3.1. Первичная аудитория — Knowledge Worker с фокусом на личностный рост

| **Атрибут** | **Описание** |
| --- | --- |
| Возраст | 28–45 |
| Профессия | Software engineers, designers, founders, consultants, аналитики, исследователи |
| Доход | $70k+ (US) / €50k+ (EU) / эквивалент в РФ |
| Текущие инструменты | Notion, Obsidian, Logseq + блокнот; пробовали ChatGPT для размышлений |
| Pain | Информационная перегрузка, не системные размышления, чувство что 'мысли утекают', желание глубже понимать себя |
| Trigger | Burnout, life transition, terapy in progress, новое начинание (проект, переезд) |
| Где их искать | r/PKM, r/ObsidianMD, r/productivity, X (Twitter): продуктивность/PKM/AI-tools community, HackerNews |
| Willingness to pay | $15–30/мес |

## 3.2. Вторичная — самокоучи и self-improvement энтузиасты

| **Атрибут** | **Описание** |
| --- | --- |
| Возраст | 25–40 |
| Профессия | Разный фон, общее — серьёзный интерес к продуктивности и личностному росту |
| Доход | $50k+ |
| Текущие инструменты | Notion + Todoist/TickTick; habit trackers (Streaks, Habitify); journal apps (Day One, Reflectly) |
| Pain | Силы воли мало; не складывается в систему; AI казался помощью, но 'не запоминает мои настройки' |
| Trigger | Новый год, начало нового проекта, friend recommendation |
| Где их искать | Подкасты Tim Ferriss, Ali Abdaal, productivity YouTube; r/productivity, r/getdisciplined |
| Willingness to pay | $10–20/мес |

## 3.3. Третичная — researchers, PhD students, knowledge professionals

| **Атрибут** | **Описание** |
| --- | --- |
| Возраст | 25–55 |
| Профессия | Academic researchers, journalists, lawyers, consultants, исследователи в индустрии |
| Доход | Variable |
| Текущие инструменты | Obsidian + Zotero, Notion + Mendeley, RoamResearch |
| Pain | Цитирование, связь между идеями, литературные заметки. AI помогает суммировать, но не интегрируется в их workflow. |
| Trigger | Новое исследование, диссертация, написание книги/статей |
| Где их искать | Academic Twitter, Hypothesis.is community, r/AskAcademia |
| Willingness to pay | $15–40/мес (профессиональное использование) |

## 3.4. Не наша аудитория

1. Team productivity (мы B2C, не B2B на старте).
1. Студенты ищущие 'AI homework helper' (другой продукт).
1. Пользователи в поиске бесплатного навсегда без AI (Obsidian community remains theirs).
1. Технофобы — кривая обучения у нас выше, чем у Apple Notes.

# 4. Конкурентное позиционирование

| **Конкурент** | **Платящих** | **Их сильные стороны** | **Наша позиция против них** |
| --- | --- | --- | --- |
| Notion | ~5M paid | Универсальность, dashboard, базы данных, AI | Privacy-first, multi-agent, local-first; Notion не подходит для приватной работы |
| Obsidian (+ Sync) | ~250k paid | Local-first, экосистема плагинов, free | Native AI без сложности плагинов, multi-platform sync без отдельной подписки |
| Logseq + Pro | ~50k paid? | OSS, outliner, Roam-like | Менее открытый, но больше готовых функций; therapy/life management из коробки |
| Roam Research | ~20k paid | Бэклинки pioneer, outliner | Современная архитектура, AI-нативная, не «just notes» |
| Tana | ~10k paid? | AI-native PKM, structured | Privacy positioning, локальный Ollama; Tana — облачный |
| Mem.ai | ~20k paid | AI-first | Глубокая интеграция AI (44 агента vs Mem's универсальный), local-first |
| Reflect | ~10k paid? | Daily notes, minimalist, AI | Шире (life management, therapy), privacy-stronger |
| Heptabase | ~15k paid | Visual whiteboard PKM | Не whiteboard-категория; agent-driven knowledge work |
| Day One / Reflectly | Variable | Journaling specifically | Journaling — лишь один из режимов в Nabu; интегрирован с остальным знанием |
| ChatGPT + Custom Instructions | 200M+ | Зрелость моделей, бесплатно | Не PKM; не запоминает контекст между чатами; нет local-first |

> Главный конкурент стратегически — Obsidian. Та же ценностная база (local-first, открытость, ваши данные), но без AI-нативности. Mass-market конкурент — Notion. Эмоциональный конкурент — ChatGPT. Каждой группе пользователей нужен свой acquisition narrative.

# 5. Гипотеза «мягкого закрытого старта» — критический разбор

## 5.1. Что говорит гипотеза

Запустить продукт closed-beta, регистрация только по приглашениям. Создать FOMO, контролировать качество cohort, итерировать на feedback. Постепенно открывать.

## 5.2. Что в этой гипотезе правильно

1. Контроль качества первой волны: вы выбираете, кого пускать. Это позволяет собрать engaged, articulate, представительную аудиторию. Их feedback — золото.
1. Demand building: invite-only создаёт ощущение эксклюзивности и спроса. Работает для определённых категорий (Lobsters, Linear на старте, Manifest, Notion Calendar).
1. Снижение начальной нагрузки: меньше пользователей → меньше серверной нагрузки, проще обрабатывать инциденты, проще support.
1. Iteration speed: маленькая cohort даёт быстрый feedback loop.
1. Marketing momentum: каждое расширение beta — отдельный media-моment (Twitter wave).

## 5.3. Где гипотеза опасна для цели «десятки тысяч платящих за 18 мес»

1. Узкая воронка значит медленный набор пользователей. Если closed beta — это первые 6 месяцев, и в неё входит 5000 пользователей, при 5% paid-конверсии это 250 платящих. Далеко от target 20–50k за 18 мес. Нужна агрессивная фаза public expansion.
1. Эксклюзивность может перейти в гадкое восприятие («они не пускают»). Linear смогли это пережить; многие — нет.
1. FOMO работает, пока есть demand. Если waitlist не заполняется быстро — это негативный сигнал. На раннем рынке Nabu может оказаться, что demand нужно ещё строить.
1. Closed beta откладывает реальную проверку product-market-fit. Пока продукт в guarded saloon, всё «работает прекрасно». При открытии в public — рынок может оказаться меньше или другим.
1. Затягивание closed beta замораживает revenue. У вас нет MRR, а LLM-costs растут. Burn rate ≠ runway.
> Правильный вопрос — не «закрытая beta vs открытый запуск», а «как долго каждая фаза». Хорошая стратегия: closed phases быстрые (2–4 месяца суммарно), переход к public — agressive, monetization начинается с public beta.

## 5.4. Альтернатива: открытый запуск с дефолт-paywall

Контр-гипотеза: запустить открытую регистрацию сразу, но с дефолтной paid-only моделью. Free tier — позже.

Pros: revenue с дня 1; чистая когорта платящих; нет «толкования» free-tier пользователей.

Cons: барьер входа высокий; конкуренты предлагают free; trust ещё не накоплен — никто не заплатит за неизвестный продукт без опыта; органический рост труден.

Применимость к Nabu: низкая. Категория слишком конкурентна, без free никто не попробует.

## 5.5. Рекомендованная фазированность

См. §6 для детальной фазированности. Краткое резюме рекомендации: 5 фаз, общая длительность от первой alpha до GA — 6–9 месяцев. Closed phases вместе ≤ 4 месяцев.

# 6. Phased launch — рекомендованный план

## 6.1. Phase 0 — Stealth (текущая)

| **Длительность** | **До завершения Ph0–Ph1 (документ 02), оценочно 3–4 месяца после старта разработки** |
| --- | --- |
| Цель | Построить продукт, дойти до уровня alpha-готовности |
| Маркетинг | Минимальный. Landing с waitlist, твитты о процессе, прозрачность разработки |
| Пользователи | 0 (кроме команды) |
| Revenue | $0 |
| Главное | Не отвлекаться. Stealth — это работа, не marketing |

## 6.2. Phase 1 — Private alpha

| **Длительность** | **4–8 недель** |
| --- | --- |
| Количество | 50–150 пользователей |
| Critère pour entry | Active waitlist signup + manual review. Приоритет: PKM-power users, content creators (могут писать о продукте), целевые ICP |
| Цена | Бесплатно. Получают lifetime 50% off Pro/Pro Plus как благодарность |
| Канал общения | Closed Discord или Slack workspace + еженедельные office hours |
| Цель | Найти 10 hard product bugs, 5 missing-but-critical features, 30 testimonials, 5 product-led influencers |
| Exit criteria | ≥ 80% активны через 30 дней (retention test). ≥ 7 спонтанных рекомендаций от пользователей. ≥ 3 публичных recommendation. |

## 6.3. Phase 2 — Closed beta

| **Длительность** | **6–10 недель** |
| --- | --- |
| Количество | 2000–8000 пользователей |
| Critère pour entry | Invite-only через систему: (а) приглашение от alpha-пользователя (каждый alpha получает 10–20 invites), (б) waitlist priority (раннее регистрация на waitlist), (в) одобрение application form (мотивация, profile) |
| Цена | Бесплатно. Получают lifetime 25% off Pro/Pro Plus |
| Канал общения | Open Discord + GitHub Discussions для feedback |
| Цель | Stress-test инфраструктуры (10x от alpha). Найти 50% remaining critical bugs. Сформировать первый wave testimonials и case studies. Прокачать onboarding flow. |
| Exit criteria | ≥ 60% активны через 30 дней. P95 latency < SLO. Critical bug rate < 2 per week. NPS > 30. |

## 6.4. Phase 3 — Public beta (с включённой монетизацией)

| **Длительность** | **12–16 недель** |
| --- | --- |
| Количество | Цель 50–150k регистраций |
| Critère pour entry | Открытая регистрация. Free tier работает. |
| Цена | Полная тарифная сетка (см. документ 16). Первый месяц регистрации — Pro trial бесплатно (без card). |
| Канал общения | Open Discord + Help Center + email |
| Цель | Найти product-market fit. Достичь 1–3k платящих. Оптимизировать onboarding и activation. Запустить первый рост через органику. |
| Exit criteria | ≥ 1500 платящих стабильно. CAC < $80. Activation rate > 25%. Месячная gross retention > 80%. |

## 6.5. Phase 4 — General Availability + scaled growth

| **Длительность** | **Ongoing** |
| --- | --- |
| Цель | 10–50k платящих в horizon 12 мес после GA |
| Tactics | Paid acquisition, infl marketing, expansion в новые сегменты, Team launch (Phase 2 продукта) |
| Метрики | MRR growth, paid retention, NPS |

## 6.6. Timeline overview

```
T = 0: завершение Ph0–Ph1 разработки → Stealth done
T + 0: alpha invitations sent (50–150)
T + 6 weeks: alpha exit criteria check; начало closed beta
T + 14 weeks (~3.5 mo): closed beta exit; public beta launch
T + 26 weeks (~6 mo): public beta exit; GA
T + 18 mo: target 20–50k платящих
```

# 7. Beta-программа — механика

## 7.1. Waitlist

1. Email + опциональный профиль (имя, текущие инструменты, главная мотивация в 1 предложении).
1. После регистрации — autoresponder с timeline ожидания и просьбой поделиться (но не как условие).
1. Каждые 2–4 недели — короткое update-письмо: что строим, что показываем, sneak peek.
1. При выпуске invite — личное письмо с инструкциями входа.

## 7.2. Invitation system

1. Каждый alpha пользователь получает 10–20 invite tokens после 30 дней активного использования.
1. Каждый closed-beta — 3–5 invites после 30 дней активности.
1. Invite tokens — single-use, имеют expiry (60 дней).
1. Можно публично делиться invitation link в Twitter / соц-сетях — это органический рост.
1. Audit: видеть, кто кого пригласил (для отслеживания power inviters и для виральной модели роста).

## 7.3. Application form для closed beta (опционально)

Кратко: имя, профессия/контекст, текущие PKM-инструменты, что хочется получить от Nabu, как узнали, опционально — Twitter/блог/LinkedIn.

Цель — НЕ filtering (это создаст плохой signal: «они слишком разборчивы»). Цель — segmentation: для onboarding-emails можно адаптировать tone и feature focus.

## 7.4. Feedback loops

1. In-app: «👍/👎 + 1-3 предложения» на ключевых моментах (после первой заметки, после первого insight, и т. д.).
1. Discord: специальный канал #feedback, owner — основатель/founder. Скорость реакции ≤ 24 часа.
1. Еженедельные office hours для alpha (30–60 мин, голосом или в Discord). Открыто, можно задать любой вопрос.
1. In-app survey раз в 4 недели: 5–7 коротких вопросов (NPS, top features, top complaints).
1. Cancel-survey: при удалении/отмене — 2 короткие вопроса. Высокая reply-rate (пользователь уже принял решение, нет потерь от честного ответа).

## 7.5. Beta-перки (нон-financial)

1. Видимый «Beta Founder» бейдж в профиле и Discord.
1. Early access новых функций (за 2–4 недели до GA).
1. Прямой канал с командой.
1. Опционально: упоминание в about page как founder (с согласия).
1. Lifetime discount (50% для alpha, 25% для closed beta) — описано в документе 16.

# 8. Каналы дистрибуции

## 8.1. Сообщества и форумы (highest leverage в первые 6 мес)

| **Канал** | **Тактика** |
| --- | --- |
| r/ObsidianMD (160k+) | Не спам. Полезный технический контент о PKM-методах, иногда упоминание Nabu где органично. Долгая игра. |
| r/PKM (40k+) | Аналогично. Здесь любят инструменты, готовы пробовать. |
| r/productivity (1M+) | Шире аудитория, меньше depth. Хорошо для ProductHunt boost. |
| r/AskPsychology, r/CPTSD | Очень осторожно. Therapy room — sensitive позиция. Не продавать инструмент людям в crisis. Honest positioning. |
| HackerNews | Show HN при достижении ключевых вех. Качество > tactics — HN отвергает sales pitch. |
| ProductHunt | Major launch moment в Public Beta (Phase 3). До этого — не сжигать. |
| IndieHackers | Прозрачная история построения. Build-in-public posts. Engagement с другими founders. |
| lobste.rs | Если есть техническая глубина — например, статьи про local-first sync engine или TypeDB-интеграцию. |

## 8.2. Twitter/X

1. Founder-аккаунт — главный канал. Дневник разработки, скриншоты, мысли о PKM, AI-этике, privacy.
1. Build-in-public подход: показывать процесс, не финальный продукт.
1. Engagement с PKM-инфлюенсерами: Tiago Forte (Building a Second Brain), Nicole van der Hoeven, Bryan Jenks, Curtis McHale.
1. Хэштеги: #PKM, #BuildInPublic, #IndieHackers, #LocalFirst, #PrivacyTools.

## 8.3. Контент-маркетинг

Контентные pillars (последовательность тем для блога):

| **Pillar** | **Темы и угол** |
| --- | --- |
| Privacy в AI | Почему данные на терапии не должны идти в облако. Архитектурные подходы. Кейсы реальных утечек данных. |
| Local-first software | Почему это не nostalgia а технически верный путь. Manifesto-эссе. Технические глубокие материалы. |
| PKM evolution | От Zettelkasten до AI-augmented. История метода. Где AI помогает, где мешает. Конкретные техники. |
| AI-augmented thinking | Конкретные ментальные модели работы с AI-агентами. Не маркетинг — методология. |
| Therapy + AI ethics | Где AI помогает в personal therapy, где категорически нет. Disclaimers, professional consultation. |
| Build-in-public | Прозрачная разработка. Технические решения, mistakes. |

Частота: 1–2 серьёзные статьи в месяц. Качество важнее количества. SEO долгая игра — год работы для существенного органического трафика.

## 8.4. Influencer partnerships

1. Шорт-лист PKM/productivity YouTubers/блогеров (5–15 человек). Реалистичная конверсия — 30–50% откликнутся, 10–20% сделают серьёзный обзор.
1. Подход: long-form intro letter с показом продукта, lifetime access, без обязательств обзора. Дать ценность сначала.
1. НЕ платные обзоры (community sniff out paid promotion). Можно — free Pro Plus accounts.
1. Кандидаты: Ali Abdaal (productivity), Tiago Forte (BASB), Nicole van der Hoeven (Obsidian), Linking Your Thinking (Nick Milo), Curtis McHale.

## 8.5. SEO

1. Длинный путь — 12+ месяцев до значимого траффика.
1. Target keywords (на основе real search demand): «AI note taking», «obsidian alternative», «private AI assistant», «journaling AI», «PKM AI».
1. Long-tail сравнительные: «Nabu vs Notion», «Nabu vs Obsidian», «AI journal app private».
1. Technical SEO: быстрая landing, structured data, sitemap, canonical URLs.

## 8.6. Paid acquisition (Phase 4+)

1. Не запускать paid до stable conversion funnel из органики. Иначе сжигаешь деньги.
1. Когда запускать: после GA + 3 мес стабильной конверсии.
1. Каналы для теста: Google Search (high-intent keywords), Reddit ads (точная аудитория r/PKM, r/ObsidianMD), Twitter ads (PKM influencers' followers), YouTube pre-roll на productivity-каналах.
1. Изначальный бюджет: $5–10k/мес. Test → measure → kill what doesn't work.
1. Target CAC < $50–80 для устойчивой unit-экономики.

# 9. Запуск major moments

## 9.1. ProductHunt launch (Phase 3 — public beta)

1. Подготовка за 8–10 недель. Hunter (PH user with reputation) reached out — лучше через intro.
1. Day 0: 6 AM PST go live. Подготовлены 100+ контактов, готовых проголосовать в первые 4 часа.
1. Day 0 plan: full team active в comments весь день. Founder отвечает на каждый комментарий.
1. Goal: top 5 product of the day, ideally #1. Top 5 → ~3–7k visitors → ~300–700 signups.
1. Что готовится: 60-second demo video, 3–5 screenshots, full product description, гифки ключевых функций.
1. Cross-promote: Twitter, Discord, email-listу waitlist в Day 0.

## 9.2. Show HN (можно одновременно с ProductHunt или раздельно)

1. HN — высокоинтеллектуальная аудитория. Pitch — technical, не sales.
1. Тема в стиле: «Show HN: Nabu — local-first AI knowledge management with privacy-tiered routing».
1. Описание в комментарии: technical architecture, что уникального (privacy categories, local Ollama routing), open-source status, what's hard.
1. Готовиться к жёстким комментариям. Не защищаться. Слушать.
1. Front page → 2–10k visitors → 50–300 quality signups.

## 9.3. Build-in-public moments

1. Закрытие alpha → ретроспектива в Twitter thread.
1. Каждый major milestone (например, реализация полного синтеза документа) — short video.
1. Quarterly transparent report: пользователи, MRR (опционально), what we learned.

# 10. Email-последовательности

## 10.1. Onboarding (после signup)

| **День** | **Тип** | **Содержание** |
| --- | --- | --- |
| 0 | Welcome | Welcome email с одним call-to-action: «создайте первую заметку». Без длинных fluff. 1–2 параграфа. |
| 1 | First-value | «Вот что Nabu может сделать с вашими заметками» — пример с реальным flow. Encourage import of vault. |
| 3 | Discovery | Tutorial на отдельную функцию (Therapy room ИЛИ Linker — по сегменту). |
| 7 | Tip | Power-user tip на одну механику (например, frontmatter customization). |
| 14 | Story / testimonial | Кейс реального alpha-пользователя. Не сейлзи; human story. |
| 28 | Check-in | «Прошёл месяц — как вам?» с короткой опросом. Опционально — trial Pro предложение если используется активно. |

## 10.2. Activation-triggered

1. После создания первой заметки → congrats + suggestion того, как раскрыть AI-обработку.
1. После 10 заметок → unlock новой возможности (например, синтез паспорта проекта).
1. После 30 дней активности → trial Pro предложение (см. документ 16 §7.2).
1. После исчерпания credits → upgrade Pro предложение.

## 10.3. Retention / re-engagement

1. После 7 дней неактивности → «вот что нового / hint к open заметкам / digest» — не аggressive.
1. После 30 дней — последняя re-engagement попытка.
1. После 60 дней — soft sunset (data retained, account preserved, no more emails).

## 10.4. Periodic content (для opt-in newsletter)

1. Раз в 2 недели — короткий newsletter: один pattern thinking, one product update, one quote.
1. Не promotional. Polished content, который читают для удовольствия, не для скидок.

# 11. Referral mechanics

1. Простая программа: пригласи друга → если они становятся Pro, ты получаешь 1 месяц бесплатно. Friend получает 1 месяц trial Pro.
1. Дедуп защита: нельзя самому себе через alt-emails (требуется payment-method verification).
1. Максимум 12 free months за всю историю аккаунта (защита от подобрания).
1. Tracking: source attribution, conversion attribution.
1. Запуск referral — только в Phase 3 (public beta), когда уже есть платящие. Иначе нет revenue для покрытия referral rewards.

# 12. Sustainable growth strategy

## 12.1. Loops, не funnels

Customer acquisition через discrete funnels — медленный и дорогой. Customer growth через loops — устойчивый и масштабируемый.

Ключевые loops, заложенные в Nabu:

1. Content loop: пользователи создают knowledge → они расшаривают конкретные insights → их аудитория узнаёт о Nabu → переходит на landing → регистрируется.
1. Sharing loop: пользователь использует Document Synthesizer → получает паспорт проекта → шарит его с командой/клиентом → они задают «что это за инструмент» → конверсия.
1. Invite loop (только в alpha/beta phases): эксклюзивность → social signal → новые регистрации waitlist.
1. Therapy testimonial loop: люди делятся historiey улучшения mental health через journaling в Nabu (если хотят) → mental-health community discovers.
1. Open-source loop: developers see GitHub repo → contribute → become users → recommend.

## 12.2. Что НЕ работает long-term

1. Paid acquisition без strong organic — выкачивает деньги без устойчивости.
1. Influencer drops без followup — спайк регистраций, плохое retention.
1. PH/HN moments без подготовленной инфраструктуры — спайк → сбой → bad reputation.
1. Aggressive discount campaigns — приучают к скидкам, потом не платят полную цену.
