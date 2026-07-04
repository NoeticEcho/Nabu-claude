# NABU

*Landing Page Specification*  
*Структура и копирайтинг главной страницы*  
*Phase 0 (waitlist) → Phase 3 (public beta) → Phase 4 (GA)*  
*Версия 1.0*  

---

# 1. Назначение и роль

Landing page — главная точка конверсии Nabu. От её эффективности зависит ROI всех маркетинговых усилий. Документ — техническое и содержательное руководство по построению.

Landing проходит три значимые конфигурации соответственно фазам запуска (документ 17):

- Phase 0–2 (stealth → closed beta): primary CTA = «join waitlist», нет pricing, акцент на «строим что-то особенное».
- Phase 3 (public beta): primary CTA = «sign up free», есть pricing, активная конверсия.
- Phase 4 (GA): тот же flow + добавление testimonials, case studies, метрик доверия (X users).

# 2. Цели и метрики landing page

1. Первичная цель: maximize sign-up rate (waitlist в beta фазах, full signup в public).
1. Вторичная цель: educate visitor о value-prop в 5 минут или меньше.
1. Третичная цель: SEO foundation для long-term organic acquisition.
Целевые метрики:

| **Метрика** | **Цель** | **Замечания** |
| --- | --- | --- |
| Bounce rate | < 50% | Высокий bounce = непонятен value-prop сразу |
| Time on page (средний) | > 90 сек | Visitor дочитывает до 50% страницы |
| Scroll depth median | > 60% | Доходит до features/use cases |
| Visitor → CTA click | > 10% | Хороший конверсионный funnel сверху |
| CTA click → signup completed | > 30% | Низкие friction в форме |
| Overall visitor → signup | > 3% | Composite индикатор. 3% — выше среднего по SaaS landing |
| Mobile conversion | ≥ 70% от desktop | Mobile users часто бросают; целевая близость desktop |

# 3. Информационная архитектура

Структура секций в порядке прокрутки. Каждая секция выполняет одну функцию; нет дублирования.

| **№** | **Секция** | **Функция** |
| --- | --- | --- |
| 1 | Hero | Захват внимания за 3 сек. Чёткий value prop + primary CTA. |
| 2 | Problem | Резонанс с pain пользователя. «Ага, это про меня». |
| 3 | Solution overview | Что Nabu делает, в 3–4 ключевых аспектах. Без overload. |
| 4 | How it works | Конкретная демонстрация workflow. Визуально. |
| 5 | Differentiators | Privacy-first, multi-agent, local-first — почему именно Nabu. |
| 6 | Use cases | 3–4 конкретных сценария: PKM, therapy, research, life management. |
| 7 | Trust / social proof | (Phase 3+) Testimonials, user count, press mentions. |
| 8 | Pricing | (Phase 3+) Tier table. В beta фазах — этой секции нет. |
| 9 | FAQ | Топ-10 вопросов. Anti-objection. |
| 10 | Final CTA | Повторение primary CTA с альтернативной формулировкой. |
| 11 | Footer | Links: docs, blog, GitHub, social, legal. |

# 4. Секция 1 — Hero

## 4.1. Структура

- Headline (H1): один sentence, до 60 знаков, главный value prop.
- Subheadline: один параграф, до 200 знаков, расширение.
- Primary CTA: одна кнопка.
- Secondary CTA: опционально (например, «watch demo» рядом с «sign up»).
- Visual: статичный mockup ИЛИ короткий silent loop (10–15 сек) демонстрирующий ключевой workflow.
- Trust indicator: одна короткая ноут (например, «Open source · Local-first · Privacy-tiered»).

## 4.2. Headline — варианты для A/B

Каждый headline тестировать против каждого. Рекомендуемые кандидаты (русский / английский варианты):

| **№** | **Headline (EN)** | **Headline (RU)** |
| --- | --- | --- |
| A | Your private AI companion for thinking and growing | AI-копилот вашей внутренней жизни |
| B | PKM that thinks with you. Privately. | Личные знания и AI. Без слежки. |
| C | An AI knowledge tool that respects your private thoughts | Knowledge-инструмент с AI, который уважает приватные мысли |
| D | Notion meets your therapist. Local-first. | Notion встречает вашего психолога. Local-first. |
| E | 44 AI agents working on your thinking. On your terms. | 44 AI-агента работают над вашим мышлением. На ваших условиях. |

Рекомендую как starter — вариант A или B. Они шире и менее провокационны. D и E — провокационнее, лучше работают для технической/PKM-нативной аудитории, но рискуют отпугнуть mass-market.

## 4.3. Subheadline — варианты

1. «Nabu — это система личной работы со знанием, в которой 44 специализированных AI-агента помогают вам мыслить, систематизировать опыт и расти. Без облака, когда вы того хотите. Без vendor lock — всегда.»
1. «44 AI agents help you turn scattered thoughts into structured knowledge, with privacy categories that put you in control of what reaches external models.»
1. «Personal knowledge management for thinking deeply, journaling honestly, and growing intentionally. Privacy-first, local-first, AGPL-licensed.»

## 4.4. CTA текст — варианты

- Phase 0–2: «Join the waitlist» / «Get early access»
- Phase 3+: «Start free» / «Try Nabu free» / «Create your account»
- НЕ использовать: «Sign up now», «Get started», «Learn more» (низкая конверсия — банально).

## 4.5. Visual — рекомендации

1. Не video с автоплеем со звуком (UX антипаттерн).
1. Silent loop 10–15 секунд: показывает один workflow (например, создание заметки → AI-обогащение → wikilinks → backlinks).
1. Альтернатива: статичный screenshot хорошо составленного интерфейса в hero, с подписями к ключевым элементам.
1. Аnimated GIF — допустимо, но размер ≤ 1 МБ (performance).
1. Dark mode по умолчанию — резонирует с целевой аудиторией (developers, design-conscious users).

## 4.6. Above the fold checklist

- Headline видим на mobile в landscape без скролла.
- CTA — высокий контраст, минимум 44×44 px touch target.
- Visual не блокирует чтение CTA.
- Trust indicator виден.

# 5. Секция 2 — Problem

## 5.1. Структура

3–4 коротких параграфа, каждый затрагивает один pain точку. Без bullet points — это размышление, не список.

## 5.2. Содержание (варианты)

Вариант с тоном размышления:

"Ваши мысли разбросаны по десятку приложений. Заметки в одном месте, дневник — в другом, задачи — в третьем. ChatGPT помогает с конкретным запросом, но забывает всё, как только закрываете окно."

"Notion работает, но всё уходит в облако. Obsidian приватный, но AI там — это плагины, каждый из которых отправляет ваш текст разным компаниям."

"Самые важные мысли — те, которые вы боитесь записать, — некуда деть."

Это работает потому, что: (а) конкретно описывает фрустрацию аудитории, (б) использует язык, который аудитория сама использует, (в) подводит к решению без прямого «вот наше решение».

# 6. Секция 3 — Solution overview

## 6.1. Структура

3–4 ключевых аспекта продукта. Не «список фич», а «как продукт решает проблему».

## 6.2. Содержание (макет блоков)

Каждый блок: иконка + headline + 2-3 предложения + опциональный link к подробностям.

| **Block 1** | **Один инструмент для всего, что у вас в голове

Заметки, дневник, проекты, привычки, цели, психологическая работа — в одной системе. AI понимает контекст между ними и помогает связывать.** |
| --- | --- |
| Block 2 | AI, который не подсматривает

Категории видимости: что-то идёт через облако, что-то — только через локальную модель, что-то — никогда не покидает ваше устройство. Вы решаете. |
| Block 3 | Ваши данные — это ваши данные

Markdown файлы. Локальное хранение. Полный экспорт в один клик. Open-source ядро. Уйдёте — заберёте всё. |
| Block 4 | 44 AI-агента работают с вашим мышлением

Каждый — со специализацией. От извлечения сущностей до синтеза целых документов. Не один универсальный бот, а команда. |

# 7. Секция 4 — How it works

Визуально-driven секция. Минимум текста, максимум показа.

## 7.1. Структура

Три-четыре шага workflow:

1. Step 1: «Создайте заметку — голосом, текстом, импортом vault». Визуал — quick capture UI.
1. Step 2: «AI обрабатывает: извлекает сущности, связывает с другими заметками, классифицирует». Визуал — flow agents → ноты.
1. Step 3: «Видите граф знаний и backlinks. Получаете insights в дайджестах». Визуал — graph view.
1. Step 4: «По мере необходимости — quest, привычка, journal, документ-синтез». Визуал — multi-mode UI.

## 7.2. Визуальная подача

- Animated scroll-driven illustration: при прокрутке каждый шаг анимируется.
- Альтернатива: 4 screenshots в grid, каждый со подписью.
- Альтернатива: один GIF showing full workflow (если умеете делать качественные).

# 8. Секция 5 — Differentiators

Здесь добавляем веса нашим уникальным преимуществам. Структура — каждый differentiator как отдельный блок с конкретной деталью, не лозунгом.

| **Privacy categories** | **Три уровня видимости: default (с облаком), private (только локальный Ollama), vault (E2E шифрование ключом, который только у вас). Терапевтические заметки автоматически private.** |
| --- | --- |
| Local-first | Markdown-файлы лежат на вашем устройстве. Работает оффлайн. Закроется компания — продукт продолжит работать. |
| Multi-platform | Web, macOS, Windows, Linux, iOS, Android. Одна подписка покрывает все устройства. |
| Multi-agent AI | 44 специализированных агента (а не один универсальный бот). Каждый — со своим фокусом, своей моделью, своими evals. И всё это explainable — вы видите, какой агент что сделал. |
| Therapy mode | КПТ-журналы, гештальт, IFS, DBT, ACT — нативно. Не плагин, не add-on. С отдельной приватной комнатой и явными disclaimers. |
| Open source core | AGPL-3.0. Можно self-host. Можно изучить код. Можно contribute. |

# 9. Секция 6 — Use cases

Конкретные сценарии. Каждый — короткое описание, скриншот, имя «архетип пользователя» (фиктивный или реальный с согласия).

## 9.1. Use case 1 — PKM для думающего профессионала

«Анна, продуктовый аналитик. 200+ заметок за полгода, граф знаний с 1500 связями. Использует Nabu для синтеза еженедельных дайджестов своих исследований; Document Synthesizer генерирует executive summaries для презентаций.»

## 9.2. Use case 2 — Personal therapy companion

«Михаил уже год в КПТ. Ведёт ABC-журнал в Nabu's Therapy room. Все записи помечены private — обрабатываются только локально. CBT Agent помогает идентифицировать когнитивные искажения; Coach Agent — отслеживать прогресс между сессиями.»

## 9.3. Use case 3 — Researcher и academic

«Елена работает над PhD по поведенческой экономике. Импортирует PDF статей через Research Assistant; Claim Tracker отслеживает поддерживающие/опровергающие источники её гипотез; Argument Mapper строит карту аргументов.»

## 9.4. Use case 4 — Self-improvement и life management

«Дмитрий ведёт 5 привычек, 12 текущих квестов, метрики настроения и сна. Quest Master разбивает его цели на атомарные действия; Anomaly Detector предупреждает о падении настроения. Character sheet показывает прогресс по 8 атрибутам.»

# 10. Секция 7 — Trust и social proof

В Phase 0–2 — этой секции нет (нет ещё trust-индикаторов). В Phase 3+ — заполняется по мере накопления.

## 10.1. Что показывать

1. «X+ users in private beta» (когда есть ≥ 500).
1. «Y notes processed daily» (когда есть ≥ 10k).
1. «Backed by Z investors» (если есть, и они известны).
1. Press mentions: лого изданий, которые написали о Nabu.
1. Тестмониалы: 3–5 текстовых отзывов от реальных пользователей с фото (с согласия).
1. Star count GitHub (когда ≥ 500).
1. Product Hunt бейдж (если был успешный launch).

## 10.2. Чего не делать

- Fake testimonials или stock photos с фейк именами. Аудитория замечает.
- Слишком расплывчатые testimonials («Great product!» от «Anna K.»). Конкретика > общие слова.
- «5/5 rating» без указания платформы.
- Inflate user count (показывает 100k → выглядит сомнительно).

# 11. Секция 8 — Pricing

В Phase 0–2 — секции нет. В Phase 3+ — компактная таблица из документа 16 §4.1.

## 11.1. Структура

1. Toggle Monthly/Annual вверху. Annual подсвечен (там 20% скидка).
1. 3–4 column grid: Free, Pro, Pro Plus (Team — позже).
1. Каждый столбец: name, price, 1-sentence positioning, 5–7 features, CTA button.
1. Pro выделен как «Most popular» — психологический anchor для центрального выбора.
1. Под таблицей — link на FAQ pricing-вопросы и notes («все цены без VAT/НДС», «refund в течение 14 дней», и т. д.).

## 11.2. Self-hosted упоминание

Под платными tier'ами — отдельный callout: «Или используйте self-hosted версию бесплатно. Полный код под AGPL-3.0 на GitHub.» Это снимает «они только за деньги» восприятие и привлекает technical аудиторию.

# 12. Секция 9 — FAQ

8–12 вопросов. Структура — accordion (collapsed by default). На каждый — короткий ответ.

## 12.1. Канонические FAQ

1. «Это безопасно для моих самых приватных мыслей?» — Да, и вот как: vault E2E + local-only обработка для private. Не верьте на слово, проверьте архитектуру в нашем security paper.
1. «Чем отличается от Notion с AI?» — Privacy-first, local-first, multi-agent, нет cloud lock-in. Notion — отлично для команд, Nabu — для глубокой личной работы.
1. «Чем отличается от Obsidian?» — Native AI без сложности плагинов, multi-platform sync без отдельной подписки, therapy modes и life management.
1. «Что если я хочу унести данные?» — Markdown в zip-архиве, один клик, всё что вы создали.
1. «Работает оффлайн?» — Да. Local-first. Synchronizes когда сеть появится.
1. «Что насчёт self-host?» — Полностью поддерживается. Open source AGPL-3.0. Документация в docs.
1. «Какие модели используются?» — Claude (Haiku, Sonnet, Opus), опционально Ollama локально, опционально OpenAI.
1. «Сколько стоит?» — См. pricing выше. Free tier есть навсегда.
1. «Я в России / СНГ — могу ли я платить?» — Да, через [details про платёжные методы для региона].
1. «Будет ли командный тариф?» — В разработке, planned Q3.
1. «Что насчёт интеграции с Apple Notes / Obsidian / Notion?» — Импорт из Obsidian/Logseq/Roam/Notion-export — поддерживается. Постоянная синхронизация — нет (это не наша задача).
1. «Кто это разрабатывает?» — [About us link с честной информацией о команде].

# 13. Секция 10 — Final CTA

Повторение primary CTA в более emotional формулировке.

Пример: «Готовы начать думать яснее?» + одна кнопка + дополнительный line: «Free tier навсегда. Без credit card.»

# 14. Секция 11 — Footer

1. Product: features, pricing, changelog, roadmap, FAQ, security.
1. Resources: docs, blog, guides, video tutorials.
1. Company: about, blog, careers (когда применимо), press kit.
1. Community: Discord, GitHub, Twitter/X, RSS feed.
1. Legal: Terms, Privacy, GDPR, Status.
1. Внизу — copyright, очень тонкая privacy-positioning ноут («Нет third-party tracking на этой странице»).

# 15. Visual design direction

## 15.1. Tone of design

1. Cерьёзный, но не серый. Чёткая типографика, generous whitespace.
1. НЕ playful (это не Apple Notes — это инструмент для глубокой работы).
1. НЕ overly minimalist (это не Apple Notes — у нас сложный продукт с глубиной).
1. Dark mode по умолчанию; light mode доступен через toggle. Память — sticky.
1. Цветовая палитра: один primary (тёплый dark blue, типа #1F3A5F), один accent (например, тёплый amber для CTA), много нейтрального серого, чёрный и белый для контраста.

## 15.2. Типографика

1. Heading: качественный sans-serif (Inter, Geist, Söhne). Не stock Google Font.
1. Body: что-то с хорошей читаемостью (Inter Body, или серифный для длинных текстов).
1. Code: моноширинный (Geist Mono, JetBrains Mono).
1. Размеры: H1 48–60px (mobile 32–40), H2 32–40, body 16–18px.
1. Line-height: body 1.6, headings 1.2.

## 15.3. Иллюстрации

1. Скриншоты — основной visual. Не stock photos.
1. Иконки — минималистичные, line-style (Lucide или собственный set).
1. Никаких 3D-рендеров, no «AI-generated faces», no abstract gradient blobs (cliché).

# 16. Conversion optimization

## 16.1. CTA placement

1. CTA выше fold (hero).
1. CTA после solution overview (когда visitor «уже понял»).
1. CTA в pricing section (когда применимо).
1. CTA в final section.
1. Sticky header с маленьким CTA при прокрутке (mobile-friendly).

## 16.2. Friction reduction

1. Sign-up form — минимум полей. Только email на старте. Profile собирается после.
1. Social login — Google, GitHub, Apple. Магия — single-click.
1. Magic link option — для тех, кто не любит пароли.
1. Captcha — только при риске abuse, не на каждой регистрации.

## 16.3. Doubt reduction

1. «No credit card required» рядом с CTA.
1. «Cancel anytime in one click» где упоминается оплата.
1. Security/privacy ссылки доступны.
1. Visible link к open-source repo (technical credibility).

# 17. Mobile responsiveness

## 17.1. Принципы

1. Mobile-first дизайн. Не «desktop, который сжимается».
1. Touch targets минимум 44×44px (Apple HIG) / 48dp (Material).
1. Текст ≥ 16px (предотвращает iOS auto-zoom).
1. Hero loads первым визуалом до full page render.
1. Hover states — НЕ полагаться на них; должны работать touch-only.

## 17.2. Breakpoints

| **Breakpoint** | **Размер** | **Layout** |
| --- | --- | --- |
| Mobile | ≤ 640px | Single column. CTA full-width. Иллюстрации stacked. |
| Tablet | 641–1024px | Single или 2-column в зависимости от секции. |
| Desktop | 1025–1440px | Full multi-column. |
| Wide | > 1440px | Контент ограничен max-width 1280px, центрирован. |

# 18. SEO foundation

## 18.1. Технический SEO

1. Page load (Largest Contentful Paint) < 2.5 сек.
1. Mobile-friendly (Google Search Console verify).
1. Canonical URL: одна каноническая версия (без trailing slash, https-only).
1. Sitemap.xml + robots.txt.
1. Structured data: Organization, WebSite, Product schemas через JSON-LD.
1. Open Graph + Twitter Card meta tags для shareability.
1. hreflang для multi-language версий (если есть).

## 18.2. On-page SEO

1. Title tag: ≤ 60 знаков, primary keyword + бренд. Например: «Nabu — AI knowledge management with privacy-first design».
1. Meta description: ≤ 160 знаков. Сильный hook.
1. H1: один на странице, совпадает с heading или близок.
1. Image alt текст для всех visuals.
1. Internal links — на /blog, /docs, /pricing.

## 18.3. Контент-SEO

1. Landing — фокус на brand keywords. Long-tail keywords — отдельные landing pages или blog posts.
1. Сравнительные страницы: /vs/notion, /vs/obsidian, /vs/logseq. Каждая — полноценный документ с pros/cons.
1. Use-case landing pages: /for/researchers, /for/therapy, /for/pkm. Полностью настроены под audience.

# 19. A/B testing framework

## 19.1. Что тестировать

- Hero headline (см. §4.2).
- CTA текст и цвет.
- Hero visual (mockup vs video vs animated).
- Pricing toggle (annual default vs monthly default).
- Решающие micro-copy («No credit card» vs «14-day money back»).

## 19.2. Как тестировать

- Использовать tool со server-side rendering (PostHog, Optimizely; не GA Optimize т.к. он мёртв).
- Минимум 1000 visitors per arm для статистической значимости.
- Один тест за раз — не комбинировать.
- Метрика — primary conversion (signup), не secondary (clicks).
- Длительность — минимум 14 дней (учёт weekly patterns).

# 20. Аналитика

## 20.1. Privacy-first analytics

1. НЕ использовать Google Analytics 4. Это противоречит позиционированию privacy-first и сожрёт credibility.
1. Использовать Plausible (cloud) или PostHog self-hosted, или Umami self-hosted.
1. Cookieless tracking предпочтительно. GDPR-compliant без cookie banner.
1. Никаких third-party скриптов от рекламных сетей на landing.

## 20.2. Что отслеживается

1. Page views, sessions, bounce rate, time on page.
1. Scroll depth tracking.
1. CTA click events (по позициям).
1. Form submission events (с attribution к source/medium/campaign).
1. UTM parameters сохраняются и пробрасываются в signup.

# 21. Performance budget

1. Total page size ≤ 500 KB (без видео; с видео — ≤ 2 MB).
1. LCP < 2.5 сек.
1. FID < 100 мс.
1. CLS < 0.1.
1. Time to Interactive < 3.5 сек.
1. Lighthouse score ≥ 90 на всех 4 категориях.

# 22. Implementation notes

1. Stack: Next.js 14+ (App Router), Tailwind CSS, deployment на Vercel или Cloudflare Pages.
1. Static generation для main landing (не SSR — слишком быстро меняется при interactivity).
1. Image optimization: next/image со WebP/AVIF.
1. Forms — через own API endpoint, не third-party services (privacy-positioning).
1. Сheckout (для Pro signup в Phase 3) — Stripe Checkout (hosted).
