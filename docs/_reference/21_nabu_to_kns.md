# NABU → KNS

*Evolution Plan*  
*От Nabu Core к KNS surface*  
*Component mapping, brand strategy, фазирование, техническая реализация*  
*Версия 1.0*  

---

# 1. Назначение

Документ — конкретный план эволюции от текущей Nabu-разработки к запуску KNS как alternative surface на том же движке. Это реализация Constellation Model из документа 20.

Покрытие: что общего, что различается, какой UI/UX строим, какой бренд формируем, в какой последовательности, какие принимаем технические решения.

> Главный принцип: KNS — это не fork Nabu, не отдельное приложение, не другой продукт. Это альтернативный режим работы того же движка с другим брендом, UI и pricing. Технически — один backend, один кодовый base, разные frontend-обёртки.

# 2. Стратегические решения

## 2.1. Когда запускать KNS surface

KNS surface — НЕ запускается параллельно с Nabu surface. Запуск только после достижения чётких triggers.

| **Trigger** | **Значение** |
| --- | --- |
| Nabu surface достиг PMF | ≥ 5000 платящих пользователей, MRR ≥ $50k, retention day-30 ≥ 25% |
| Стабильная команда | Не менее 8 человек в команде (или ⅔ Aperant-роботов работают стабильно) |
| Финансовая безопасность | Runway ≥ 12 месяцев независимо от KNS |
| Архитектурная зрелость | Опция Д контракты соблюдаются. Можно построить второй surface без переписывания Layer 1. |

Realistic timeline: KNS public beta — не ранее T+15 месяцев от старта Nabu Phase 0. Это значит — после прохождения Phase 3 Public Beta Nabu (документ 17 §6).

## 2.2. Бренд-стратегия

### Два бренда, одна компания

Nabu и KNS — два consumer-facing бренда одной компании. Аналогии: Facebook и Instagram (одна компания, два продукта); Adobe и Behance; OpenAI и ChatGPT.

| **Атрибут** | **Nabu** | **KNS / Noetic Echo** |
| --- | --- | --- |
| Brand personality | Серьёзный, профессиональный, intellectual, тёплый | Мистический, поэтический, narrative-driven, эстетический |
| Tagline (примерный) | AI-копилот вашей внутренней жизни | RealRPG для исследования сознания |
| Visual style | Минимализм, dark mode, generous whitespace, Inter typography | Glitch-art, неон, sacred geometry, дополнительная типография |
| Target ICPs | Knowledge workers 28-45, researchers, professionals | Геймеры-интеллектуалы 20-40, творческие, психонавты |
| Pricing | $15/$30/мес | $9.99/мес единый или freemium с косметикой |
| Marketing tone | Build-in-public, technical depth, privacy advocacy | ARG, viral cards, sacred mystery, community-as-art |
| Channels | HN, lobste.rs, r/PKM, Twitter (technical) | Discord, TikTok, Reddit (gaming/ARG), Twitter (creative) |
| Где общее | Privacy-first promise, local-first architecture, multi-platform, open-core, AGPL |

### Cross-promotion modes

1. **Nabu users могут попробовать KNS** через настройки: «Enable KNS mode for therapeutic features» — alternative skin для Therapy room + Journals.
1. **KNS users могут получить Nabu features** через upgrade: «Get full PKM features» — открывает полный Nabu interface для тех же данных.
1. **Не автоматическая cross-pollination** — пользователь явно выбирает.
1. **Данные общие** — один аккаунт, одни заметки. Просто разные «зеркала», через которые смотришь.

### Disclosure strategy

Прозрачность: на landing Nabu и KNS — упоминание о том, что это products одной компании, ссылка на «другой surface, если интересно». Не скрываем, но и не путаем.

## 2.3. Pricing-стратегия

Pricing tiers Nabu и KNS могут отличаться, но не противоречить.

|  | **Nabu pricing (из документа 16)** | **KNS pricing (рекомендация)** |
| --- | --- | --- |
| Free | Cloud free + 100 AI-credits | Free с базовыми Cards и Rituals; 50 AI-credits/мес |
| Mid tier | Pro $15/mo, $144/yr | Адепт KNS $9.99/mo, $59.99/yr — соответствует KNS strategic doc |
| High tier | Pro Plus $30/mo, $288/yr | Магистр KNS $19.99/mo (премиум cards, advanced rituals, доступ к редким Amarant stories) |
| Self-host | AGPL free | Self-host KNS не предлагается (UX/narrative требует hosted environment) |
| Cosmetics | Не основной revenue stream | Лавка Алхимика: cosmetic items $1-10, темы Domain, наборы рун |

### Cross-product subscriptions

1. **Bundle Pro**: $20/mo даёт доступ к Nabu Pro И KNS Адепт (вместо $15 + $10 = $25 раздельно). Стимулирует cross-product engagement.
1. **Bundle Plus**: $40/mo для Pro Plus + Магистр (вместо $30 + $20 = $50 раздельно).
1. **Annual bundle discount**: 20% off, как с individual продуктами.
> Финансовая логика: пользователи, использующие оба surface, более sticky и имеют higher LTV. Bundle с discount стимулирует cross-usage, не теряя слишком много в ARPU.

# 3. Component mapping: KNS поверх Nabu Core

Каждая KNS-feature реализуется через конкретные компоненты Nabu. Это и есть «один движок» в practice.

## 3.1. Карты Эмоций (Noetic Echo)

### Что это

Пользователь описывает состояние → система генерирует уникальную карту с изображением, поэтическим названием и интерпретацией.

### Как реализовано через Nabu

1. **Input**: пользователь пишет текст в специальный режим Journal с тегом #noetic_echo или через KNS UI.
1. **Pipeline**: запись проходит обычный conveyor Nabu (Conductor → Triage → ... → Critic) с дополнительным агентом 'noetic_echo_synthesizer'.
1. **Noetic Echo Synthesizer** (новый агент, документ 09 список расширяется до агента #45):
- Input: текст состояния, история подобных карт пользователя
- Output: { title, interpretation, image_prompt, rarity_score, archetype, tags }
- Model: Claude Sonnet 4.6 для text, Stable Diffusion / FLUX для image
- Storage: Карта — это специальный тип Note в Nabu (type: 'noetic_card') + объект в S3 (изображение) + метаданные в Postgres
1. **Visualization**: KNS surface показывает карту как красивый artifact. Nabu surface показывает её как обычную заметку с прикреплённой картинкой.

### Rarity system

Карта получает rarity (Common / Uncommon / Rare / Mythic) на основе:

- Depth of input (длина и сложность текста)
- Originality (semantic distance от других карт пользователя через pgvector)
- Emotional intensity (output Affect Analyzer #10)
- Element of randomness (5-10% — иначе не вирально)

## 3.2. Ментальные Ритуалы (ПИРы)

### Что это

«Заклинания» для работы с состояниями: дыхательные упражнения, визуализации, рефлексивные техники.

### Как реализовано через Nabu

1. **Ритуал** = wrapper над одним или несколькими Nabu agents с конкретным protocol-флоу.
1. Хранение: ритуалы — это template objects в специальной таблице rituals (id, title, runa_symbol, type, agent_chain, narrative_template).
1. Каждый ритуал имеет 'agent_chain' — последовательность вызовов конкретных Nabu-агентов с конкретными промптами.
Пример: «Ритуал Дыхания Феникса» (для тревоги)

```
ritual.dyhanie_feniksa = {
  title: 'Дыхание Феникса',
  runa: 'phoenix.svg',
  steps: [
    { type: 'breathing', pattern: '4-7-8', duration: 120 },
    { type: 'agent_call', agent: 'cbt-agent', preset: 'anxiety_reframe' },
    { type: 'journal_prompt', template: 'phoenix_reflection' },
    { type: 'agent_call', agent: 'coach-agent', preset: 'integration' }
  ]
}
```

В Nabu surface это выглядит как «Therapy session with CBT protocol». В KNS surface — как «выполнение Ритуала Дыхания Феникса с появлением руны и мистической анимацией».

## 3.3. Kira — AI-наставник

### Как реализована

1. Kira — это **alternate persona configuration** для Coach Agent (Nabu #28) + Conductor (Nabu #1) с конкретным system prompt и tone-of-voice.
1. Memory layer Kira = Long-term Vector DB (pgvector) с фактами о пользователе. Те же entities/links из Nabu's TypeDB ontology, просто Kira имеет доступ к части их и интерпретирует через свою personality lens.
1. Crisis detection — общая для Nabu и KNS (документ 11 §4).
1. Persona switch: в Nabu surface AI говорит как professional copilot. В KNS surface — как Kira (Мудрец-Провокатор).

### Switching personas

1. Persona не привязана к user-account, а к **surface** (Nabu / KNS).
1. Если пользователь работает с одним и тем же journal entry через Nabu surface — видит professional analysis. Через KNS surface — видит mystical interpretation от Киры.
1. Это не fake — это две стилистические интерпретации одного и того же analytical output.

## 3.4. Amarant — терапевтические истории

### Как реализован

1. Amarant = Document Synthesizer (Nabu #22) с template-набором 'therapeutic_story_*'.
1. Шаблоны историй (из загруженных материалов фреймворка): Обыденный Мир → Зов → Тень → Наставник → Ордалия → Возвращение.
1. Storage: каждая generated story — это специальный type Note ('therapeutic_story') в Nabu.
1. **Доступность**: только из KNS surface (не показывается в Nabu surface, потому что Nabu позиционируется как 'serious therapy adjunct', а Amarant — как 'mystical narrative tool').

### Safety constraints

1. **Только private/vault visibility** (документ 11). Локальный Ollama, не cloud.
1. **Обязательный disclaimer** в каждой истории: «Эта история — творческий нарративный инструмент, не замена терапии».
1. **Crisis detection** перед генерацией: если есть признаки кризиса — история не генерируется, показывается helpline.
1. **Не предлагается автоматически** — только по explicit user request («Расскажи мне историю»).
1. **Frequency cap** — не более 1 истории в день (защита от parasocial engagement).

## 3.5. Резонанс (XP) и геймификация

### Как реализован

1. Резонанс = XP-система RPG Game Master (Nabu #40).
1. Different scaling: в Nabu surface RPG-слой опционален и сдержан. В KNS surface — central UI element, narrative-driven.
1. Дома (гильдии) = Team-план Phase 2 (документ 16), но с narrative skin: 'Дом Странников', 'Дом Зеркал', и т. п.
1. Теневые Пути = Quest Master (#32) + дополнительные templates для quest-chains, посвящённых работе с тенью.

## 3.6. Калибровка (онбординг KNS)

### Как реализована

1. Это специальный onboarding flow на KNS surface, заменяющий стандартный Nabu onboarding.
1. Метафорические вопросы → ответы кладутся как Note entries → агенты Nabu (Entity, Domain, Affect, Intent) обрабатывают как обычно → получаются initial archetype и domain preferences.
1. Output онбординга — заполненный profile (archetype, domain weights), который customизирует tone of voice Киры.

## 3.7. Сводная таблица соответствий

| **KNS feature** | **Nabu component** | **KNS-specific layer** |
| --- | --- | --- |
| Карта Эмоций | Affect Analyzer + Image gen + Note type | Visual presentation, rarity system, sharing |
| Ментальный Ритуал | Agent chains + Therapy Agents | Narrative wrapping, runa visuals |
| Kira | Coach Agent + persona prompt | Tone of voice, memory presentation |
| Amarant | Document Synthesizer with templates | Story library, mythological framing |
| Резонанс / XP | RPG Game Master | Visual progression UI |
| Дома | Team plan (deferred) | Narrative skin, collective quests |
| Калибровка | Onboarding flow | Metaphorical questions, archetype assignment |
| Теневые Пути | Quest Master + templates | Mythological quest narrative |
| Атлас Состояний | Notes collection view | Card-based visual layout |
| Темный Гороскоп | Insight Agent с астрологическим template | Weekly forecast presentation |

# 4. Технические решения

## 4.1. Архитектурный подход

Дополнительные слои поверх Nabu Core:

```
apps/
├── api/                    — общий backend для Nabu и KNS
├── worker/                 — общий
├── web-nabu/               — Nabu web frontend (Next.js)
├── web-kns/                — KNS web frontend (Next.js, separate brand)
├── desktop-nabu/           — Nabu Tauri wrapper
├── desktop-kns/            — KNS Tauri wrapper
├── mobile-nabu/            — Nabu mobile
└── mobile-kns/             — KNS mobile
```

```
packages/
├── core/                   — общая бизнес-логика
├── agents/                 — общие 44 + 5 KNS-specific (Noetic Echo Synth, etc.)
├── db/                     — общая схема
├── ui-base/                — общие компоненты (forms, inputs, etc.)
├── ui-nabu/                — Nabu-specific UI компоненты
├── ui-kns/                 — KNS-specific UI компоненты (Cards, Runa, etc.)
├── theme-nabu/             — design tokens Nabu (минимализм)
├── theme-kns/              — design tokens KNS (мистицизм)
├── kns-features/           — KNS-specific бизнес-логика (rituals, rarity, etc.)
└── ... (остальное общее)
```

## 4.2. Database design

1. Один Postgres, одна схема. Дополнительные таблицы для KNS-specific: rituals, ritual_completions, card_rarity_metadata, ammurant_stories, archetypes_calibration.
1. Surface tracking в user profile: { active_surface: 'nabu' | 'kns' }. Не блокирует доступ ко второму surface, но определяет default UI.
1. Surface-specific UI preferences: { nabu_dark_mode: true, kns_chosen_archetype: 'wanderer', ... }.

## 4.3. API design

1. Один OpenAPI spec (документ 08), но с tags 'nabu', 'kns', 'shared'.
1. KNS-specific эндпоинты: /v1/kns/cards/*, /v1/kns/rituals/*, /v1/kns/stories/*, /v1/kns/houses/*.
1. Authentication — общая для обоих. Session может определять surface (но пользователь может переключаться).

## 4.4. Agent layer extensions

К существующим 44 агентам (документ 09) добавляются 5 KNS-specific:

| **№** | **Имя** | **Назначение** |
| --- | --- | --- |
| 45 | Noetic Echo Synthesizer | Генерирует Карту Эмоций: title, interpretation, image_prompt, rarity, archetype |
| 46 | Ritual Orchestrator | Управляет выполнением ментального ритуала: последовательность шагов, integration с другими agents, narrative wrapping |
| 47 | Therapeutic Story Generator (Amarant) | Wrapper над Document Synthesizer с template-набором; safety guards |
| 48 | Archetype Classifier | Определяет архетип пользователя на основе калибровки (Wanderer / Witness / Glitchmage / etc.) |
| 49 | Lore Keeper | Поддерживает narrative consistency: чтобы Kira не противоречила себе в разных сессиях, чтобы quest chains были консистентны |

## 4.5. Расширение Опции Д для KNS

Контракты Опции Д (документ 15) расширяются:

1. **Surface-agnostic agents**: все агенты, включая KNS-specific, должны работать без знания о том, какой surface их вызывает.
1. **Persona — это конфигурация, не код**: Kira-persona = config + prompts. Загружается из конфига, не зашита в agent.ts.
1. **Ritual definitions — это data, не код**: ритуалы хранятся как JSON, не как hardcoded TS-функции.
1. **Theme — это design tokens**: KNS-визуал — это CSS-переменные, не отдельные компоненты. Один UI lib с двумя theme presets.

# 5. Фазирование запуска KNS

## 5.1. Phase A — Internal preparation (Months 1-3 после Nabu public beta)

1. Документация KNS architecture (этот документ + детализация).
1. Доменное имя, бренд, basic landing для KNS waitlist.
1. Запуск ARG-кампании «Шепот Киры» для сбора первой аудитории (как в KNS strategic doc §3.2).
1. Discord server для KNS-community.
1. Никакой разработки KNS-specific features. Фокус — Nabu public beta растёт.

## 5.2. Phase B — Foundation (Months 4-6)

1. Разработка KNS-specific agents (45-49).
1. Разработка KNS web frontend (новый домен, новый UI).
1. Карты Эмоций — первая core feature, полностью работающая.
1. Калибровка — onboarding flow.
1. Kira persona configuration ready.
1. Параллельно: Nabu surface продолжает расти, никакого замедления.

## 5.3. Phase C — Closed Alpha KNS (Months 7-8)

1. 50-150 invitees из waitlist + Discord.
1. Только Карты Эмоций + Kira chat + Калибровка.
1. Lifetime 50% off Магистр KNS как награда.
1. Iterative feedback, refinement of Kira persona.

## 5.4. Phase D — Closed Beta KNS (Months 9-11)

1. 2000-5000 пользователей, invite-only через alpha-приглашения и Discord.
1. Добавлены: Ритуалы (5-7 базовых), Атлас Состояний, Резонанс, базовые Темный Гороскоп.
1. Первые публикации в Twitter/TikTok красивых карт (виральный потенциал).

## 5.5. Phase E — Public Beta KNS (Month 12+)

1. Открытая регистрация на KNS.
1. Включена монетизация: Free, Адепт ($9.99), Магистр ($19.99).
1. Bundle Pro/Plus с Nabu активны.
1. ProductHunt launch KNS как отдельный продукт (хотя backend общий).
1. Маркетинг: ARG-кампании, инфлюенсеры в gaming/psychology, viral Card challenges.

## 5.6. Phase F — Полная интеграция (Month 15+)

1. Добавлены: Amarant terapeuticheskih historii, Теневые Пути.
1. Дома (гильдии) — bridge между Nabu Team plan и KNS guilds.
1. Cross-promotion полностью активна.
1. Метрики: какой surface превалирует, где больше revenue, где больше retention.
> Критическая дисциплина: ни одна KNS feature не разрабатывается, пока Nabu public beta не достигла своих exit criteria (документ 17 §6.4). KNS — это второй продукт, не параллельный.

# 6. Маркетинг и community

## 6.1. Разделение audience

Стратегия из KNS strategic doc (раздел 2) применима, но адаптирована: KNS-маркетинг не пытается заместить Nabu-маркетинг, а дополняет, целясь в другие audiences.

### Nabu marketing audiences

- PKM-power users (r/ObsidianMD, r/PKM)
- Knowledge workers (professionals на Twitter, LinkedIn)
- Privacy advocates (HN, lobste.rs)
- Researchers (academic Twitter)

### KNS marketing audiences

- Geek culture (Reddit gaming, fantasy, sci-fi communities)
- Creative explorers (TikTok productivity/spirituality, Instagram aesthetic)
- ARG community (r/ARG, специализированные Discord-сервера)
- Therapy-tech enthusiasts (mental health Twitter с интересом к gamification)
- Self-improvement community (с интересом к non-traditional подходам)

## 6.2. Контент-маркетинг KNS

Контент-стратегия (повторяющая KNS strategic doc §2.5):

| **Контент** | **Канал** | **Цель** |
| --- | --- | --- |
| «Сны Киры» (лор-фрагменты) | Блог, Telegram | Углубление вселенной |
| Виральные карты эмоций (демо) | TikTok, Instagram | Виральность, awareness |
| ARG-загадки | Twitter, Discord | Сбор core community |
| Разбор механик | YouTube, блог | Объяснение ценности |
| Подкаст «Голоса Ноэзиса» | Spotify, Apple Podcasts | Атмосфера, depth |

## 6.3. Конкретные виральные механики

1. **Card sharing**: каждая карта может быть расшарена в соцсети. Иногда содержит «зашифрованное послание Киры» для других пользователей, которые сканируют.
1. **Weekly Symbol**: каждую неделю — новый «Символ Недели» с глобальным ритуалом всего community. Виральный hook.
1. **Dark Horoscope KNS**: еженедельные прогнозы по архетипам, генерируемые AI. Высокий виральный потенциал.
1. **House quests**: коллективные квесты для домов с глобальной leaderboard.

## 6.4. Cross-product marketing

1. Nabu users получают опциональный announcement о запуске KNS («Now available: a new surface for your data, designed for creative exploration»).
1. KNS users получают опциональный announcement о Nabu («Power user mode now available»).
1. Bundle pricing visible в обоих surfaces.
1. Никакого spam — opt-out always available.

# 7. Этические соображения

## 7.1. Дополнительные риски KNS surface

KNS positioning несёт specific риски, которых нет у Nabu:

1. **Parasocial relationships с AI**: Kira — это charismatic AI persona, спроектированная для эмоциональной привязанности. Это сильнее, чем generic chatbot. Риск что пользователи начнут полагаться на Kira как на замену человеческих отношений.
1. **Mystical framing привлекает vulnerable users**: люди в кризисе ищут «магических решений». KNS positioning может привлекать их сильнее, чем serious Nabu.
1. **Эмоциональный материал для коллекционирования** (Карты Эмоций): есть риск гедонистического подхода к собственным emotions — «надо чувствовать что-то редкое, чтобы получить редкую карту».
1. **Gamification глубоких переживаний** ('Теневые Пути' как quests): риск превращения serious psychological work в shallow gameplay.
1. **ARG-маркетинг с пользователями в кризисе**: vulnerable people могут серьёзно «купиться» на ARG-narrative, не понимая что это маркетинг.

## 7.2. Митигации

1. **Жёсткий Crisis Detection**: на каждом input, на каждом шаге ритуала. Чувствительность выше, чем в Nabu.
1. **Disclaimer везде**: Kira — это AI, не психолог. Это явно и часто.
1. **Rate limits на Amarant stories**: 1 в день максимум. Защита от parasocial spiral.
1. **Healthy use mechanics**: уведомления о здоровом использовании ('Вы провели 2 часа в KNS сегодня. Возможно, время отвлечься?').
1. **Не gamifying suffering**: квесты не дают rewards за «более глубокие страдания». Резонанс растёт от reflection и practice, не от intensity emotion.
1. **ARG-маркетинг с осторожностью**: не использовать elements, которые играют на тревогу или paranoia.
1. **Onboarding screening**: при онбординге опрашиваются basic well-being indicators. При маркерах current crisis — user направляется к professional resources, не глубже в KNS.
1. **External ethics review**: до public launch — независимый аудит с привлечением психолога-консультанта.
> KNS — этически более рискованный продукт, чем Nabu. Это не повод его не запускать, но повод запускать дисциплинированно, с явными safeguards и регулярными external audits.

# 8. Resource implications

## 8.1. Какие дополнительные ресурсы нужны для KNS surface

| **Категория** | **Дополнительные ресурсы** |
| --- | --- |
| Разработка (AI-команда + Aperant) | Phase B-C: дополнительный workstream на 6 месяцев. ~3000 человеко-часов AI-work + human review. |
| Дизайн | Полная KNS visual identity: logo, colorscheme, illustration system для карт, runa-set. ~$15-30k для freelance designer. |
| AI image generation | Stable Diffusion / FLUX fine-tuning под KNS-aesthetic для карт. ~$5-10k initial + $0.001-0.005 per card. |
| Контент | Лор-документы, story templates для Amarant (50+ initial), 5-10 базовых ритуалов с описаниями. ~$10-20k для writer. |
| Marketing | ARG-кампания: ~$5-15k на launch (контент, разработчики ARG-инфраструктуры). Influencer outreach: ~$10-20k. |
| Community management | Дополнительный Discord, ARG-проводник. ~10-20 hours/week дополнительной работы. |
| Legal | Updated ToS/Privacy для two-surface model. Ethics audit. ~$5-10k. |
| Total дополнительно | ~$50-100k для launch + ongoing operational |

## 8.2. Когда инвестировать

Инвестировать в KNS Phase A-B нужно начинать тогда, когда:

- Nabu MRR ≥ $50k/мес стабильно ≥ 3 месяцев.
- Runway ≥ 18 месяцев на текущем burn rate.
- Команда стабильна, есть запас bandwidth.
- Нет critical bugs или scaling issues в Nabu, требующих fire-fighting.
> Если эти условия не выполнены — KNS откладывается. Преждевременный запуск KNS убьёт Nabu (распыление ресурсов) без гарантий успеха собственного запуска.

# 9. Метрики успеха KNS surface

## 9.1. Первичные метрики

| **Метрика** | **Цель T+6 mo (после public launch)** | **Замечания** |
| --- | --- | --- |
| KNS registered users | 30-80k | Из них 60-70% получат своё первое Card-experience |
| KNS paying (Адепт + Магистр) | 1500-4000 | Free-to-paid 4-5% — выше Nabu из-за виральности |
| Cards generated total | 300k+ | В среднем 4-6 cards per active user |
| Cards shared in social media | 10k+ | Виральность check |
| Bundle subscriptions (Nabu+KNS) | 20% of either | Cross-product engagement |
| Discord community size | 5000+ | Стержень бренда |

## 9.2. Метрики риска

| **Risk indicator** | **Threshold** | **Действие при превышении** |
| --- | --- | --- |
| Nabu MRR падение из-за каннибализации | > 10% drop in 3 mo | Пересмотр позиционирования; возможно — закрытие KNS |
| Crisis-detection-triggers / 1000 sessions | > 5 | Усиление safety, review onboarding |
| Daily active hours per user (proxy для addiction) | > 3 часа median | Healthy use mechanics, education content |
| Negative reviews mentioning 'addiction' or 'unhealthy' | > 5% | Внешний ethics audit |
| Amarant story complaints | any serious one | Immediate review, pause feature, expert consultation |

# 10. Резюме

Резюме плана эволюции Nabu → KNS:

1. **KNS — не отдельный продукт**. Это alternative surface на том же движке. Бренды разные, бизнес-логика общая.
1. **Сначала Nabu PMF**, потом KNS. Никакой параллельной разработки до достижения Nabu exit criteria.
1. **Component mapping показывает**: 80% KNS-features = существующие Nabu agents + UI layer.
1. **Дополнительная разработка**: 5 KNS-specific agents (#45-49), KNS frontend (separate brand), KNS-specific theme и UI components.
1. **Phasing**: 6 фаз от internal preparation до полной интеграции, общая длительность ~15 месяцев после Nabu public beta.
1. **Этический риск выше** Nabu из-за mystical/gamified positioning. Требует специфических safeguards.
1. **Resource investment**: $50-100k для launch + ongoing.
1. **Kill criteria явные**: если KNS канибализирует Nabu или показывает ethical issues — закрытие.
> KNS как surface над Nabu — это рациональная reuse существующих инвестиций для достижения дополнительной аудитории. Запущенный преждевременно или плохо — он убивает Nabu. Запущенный с дисциплиной — удваивает TAM компании при ~30% дополнительных затрат.
