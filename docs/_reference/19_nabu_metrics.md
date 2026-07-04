# NABU

*Growth Metrics & Analytics Framework*  
*Что измерять, как, с какой privacy-моделью*  
*North Star · Funnel · Retention · Unit-экономика*  
*Версия 1.0*  

---

# 1. Назначение

Документ — нормативная основа аналитики и growth-метрик Nabu. Описывает: что измерять (метрики и их связь с бизнес-целями), как измерять (privacy-first аналитическая архитектура), кому показывать (dashboards по аудиториям), когда реагировать (alert-пороги), как проводить эксперименты (A/B testing methodology).

Документ — нормативный. Любая новая метрика, alert, dashboard должны соответствовать описанным здесь принципам.

# 2. Философия измерений

## 2.1. Принципы

1. Privacy-first. Мы строим продукт, который позиционируется как privacy-friendly. Соответственно — аналитика тоже privacy-friendly. Никакого Google Analytics 4. Никакого third-party tracking. Это не «nice to have» — это часть бренда.
1. Каждая метрика должна быть actionable. Если изменение метрики не приводит к действию — метрика бесполезна. Удалить.
1. Метрика — это не цифра, а гипотеза. Изменение метрики проверяет гипотезу о пользователе. «MAU вырос» — слишком общо; «MAU вырос за счёт мобильных users из EU» — гипотеза.
1. Метрики каскадируются. Output metrics (revenue) → Input metrics (что мы можем изменить). Фокус на input.
1. Cohort-based. Trend сам по себе обманчив. Cohort показывает реальное поведение.
1. Sample, не log everything. Для большинства метрик 1% sampling даёт ту же точность с 1/100 затрат.

## 2.2. Что мы НЕ измеряем

1. Время на каждой странице (privacy).
1. Heatmaps клика (privacy).
1. Содержимое заметок (никогда, ни в каком виде, для любых целей).
1. Конкретные search queries в нативном поиске (только агрегированную статистику).
1. Конкретные prompts to agents (только метаданные: agent name, latency, success/fail).
1. IP-адреса (хранятся не более 7 дней для security purposes, после анонимизации).
1. Device fingerprinting (только anonymous device IDs которые пользователь сам генерирует при first install).
> Nabu обещает privacy. Аналитика — это место, где это обещание либо выполняется, либо нарушается. Дешёвый GA-pixel убьёт credibility больше, чем что-либо другое.

# 3. North Star Metric

## 3.1. Что такое North Star

North Star — одна метрика, которая лучше всего отражает успех продукта в долгосрочной перспективе. Это не revenue (output) — это leading indicator поведения, которое приводит к revenue.

## 3.2. Кандидаты для Nabu

| **Кандидат** | **Pros / Cons** |
| --- | --- |
| WAU (Weekly Active Users) | Standard, понятно. Но слишком общо — не различает engaged user vs зашёл и закрыл. |
| Weekly Engaged Users (≥ 3 дня/неделю активны) | Лучше. Отделяет casual от real users. Хорошо коррелирует с paid conversion. |
| Weekly Notes Created | Тесно связано с product use. Но: 1 заметка может быть длинной/короткой; meaningful или нет. |
| Weekly Knowledge Actions | Composite: создание заметки + invokation агента + редактирование. Капитализирует богатство продукта. |
| Paid Active Users | Прямой revenue indicator. Но: lagging, не leading. |
| Activation Rate (% new users completing 'aha moment') | Excellent для ранней фазы. Но: не подходит как long-term North Star когда product зрелый. |

## 3.3. Рекомендация

> North Star Metric: Weekly Engaged Users = пользователи, активные ≥ 3 дня в неделю, создавшие ≥ 1 заметку и вызвавшие ≥ 1 агент за неделю.

Обоснование:

1. Engagement (≥ 3 дня) — отделяет casual от serious users. Casual не платят.
1. ≥ 1 заметка — продукт используется по назначению (PKM, не just curiosity browser).
1. ≥ 1 agent invocation — пользователь получает value от AI-слоя (наш ключевой differentiator).
1. Leading к revenue: исторически в B2C SaaS engaged users конвертируются в paid в 5–10× выше, чем casual.
1. Actionable: чтобы поднять WEU, нужно либо поднять activation, либо retention, либо engagement-depth. Каждое — отдельный workstream.

## 3.4. Целевые значения

| **Фаза** | **WEU target** | **Замечания** |
| --- | --- | --- |
| Phase 1 (private alpha) | 60–120 | 60% от 100–200 alpha users |
| Phase 2 (closed beta) | 1500–5000 | 60% от 2500–8000 beta users |
| Phase 3 (public beta exit) | 20k–50k | 40% от 50–150k registered (включая free) |
| Phase 4 (T+12 mo) | 100k–250k | Достижимо при правильной воронке |

# 4. Funnel метрики

## 4.1. Полная воронка

```
Visitor (landing page view)
  ↓ ~ 3% conversion
Waitlist signup (beta phase) / Registration (public)
  ↓ ~ 80% (verify email)
Email verified / account created
  ↓ ~ 60-70% complete onboarding
First note created
  ↓ ~ 40-50% within first session
First agent invocation (Aha moment)
  ↓ ~ 60% return on day 2-7
Week 1 engaged (3+ active days)
  ↓ ~ 50% 30-day retention
Month 1 active
  ↓ ~ 3-5% free-to-paid conversion
Paid customer (Pro / Pro Plus)
  ↓ varies
Long-term retained (90 days)
```

## 4.2. Ключевые friction-точки

Точки, где обычно теряется больше всего пользователей. Мониторить плотно.

| **Точка** | **Что отслеживать и почему** |
| --- | --- |
| Landing → Waitlist signup | Если конверсия < 2% — проблема с landing copy, visual или value-prop. Тестировать. |
| Email verification | Если < 75% verify email — проблема с email deliverability (spam) или со сложностью flow. |
| Onboarding completion | Если < 50% — onboarding слишком длинный или непонятный. Сократить. |
| First note creation | Если < 40% within first session — barrier слишком высокий. Пред-заполненные шаблоны, demo notes, или voice-first capture могут помочь. |
| Aha moment (first agent invocation) | Если первый agent не вызван в session 1 — пользователь не увидел AI value. Onboarding должен показать. |
| Day 2 retention | Самый критичный момент. Если < 50% возвращаются на day 2 — продукт не stick. Triggered emails / push notifications могут помочь. |
| Free → Paid | Тренируется через trial mechanics (см. документ 16 §7). |

## 4.3. Что измерять для каждого шага

1. Absolute count (новых на этом шаге за период).
1. Conversion rate (% от предыдущего шага).
1. Time to convert (median, p90 — сколько времени потребовалось).
1. Segmentation: by source (organic/referral/paid), device (mobile/desktop), geography.
1. Cohort: пользователи, зашедшие в одну неделю, имеют отдельные кривые.

# 5. Engagement-метрики

## 5.1. Активность

| **Метрика** | **Определение** |
| --- | --- |
| DAU | Daily Active Users — уникальные users с ≥ 1 действием за день |
| WAU | Weekly Active Users |
| MAU | Monthly Active Users |
| DAU/MAU ratio (stickiness) | Доля от MAU, активных ежедневно. Healthy benchmark: 20%+ for PKM tools |
| Sessions per user per week | Целевое: ≥ 3 для engaged |
| Session duration (median) | Целевое: 8–15 мин для focused work, не больше (длиннее = непродуктивный flow) |

## 5.2. Глубина использования

| **Метрика** | **Определение и интерпретация** |
| --- | --- |
| Notes created per active user per week | Median 3–10 для engaged. < 1 — passive user. |
| Agent invocations per active user per week | Healthy: 10–50. Low — pas использует AI слой. |
| Modules used (out of: notes, journals, habits, projects, therapy, RPG, research) | Эталон: 2–4 модуля для engaged user. Power user: 5–7. |
| Knowledge graph size (entities, links) | Возрастает со временем. Stagnation после 2 мес — bad signal. |
| Tags used | Дорастает до 20–50 для serious users; больше — chaos, активирует Taxonomy Curator. |

## 5.3. Качество AI-выходов

Это специфично для AI-продукта. Без качества AI весь продукт обесценивается.

| **Метрика** | **Определение** |
| --- | --- |
| Agent thumbs-up rate | Доля agent outputs, помеченных пользователем 👍 (из тех, что оценены) |
| Agent thumbs-down rate | Аналогично для 👎. Целевое: < 5% |
| Agent invocation completion rate | Доля вызовов, дошедших до видимого результата. < 95% — серверная или модель-проблема |
| Critic block rate | Доля agent outputs, заблокированных Critic. Высокий — другие agents галлюцинируют |
| Top complaints per agent (текстовый анализ feedback) | Periodic review — какой agent чаще всего критикуется и почему |

# 6. Retention-метрики

## 6.1. Принципы

1. Retention анализируется ВСЕГДА по cohort (по неделе регистрации/первого использования).
1. Simple percentage без cohort — обманчиво (растущий продукт «выглядит» как высокий retention, но это новички, не remembered users).
1. Smooth curve, не grouped. День-by-день, не «1st week / 2nd week».

## 6.2. Ключевые retention-точки

| **Точка** | **Целевое для Nabu** | **Замечания** |
| --- | --- | --- |
| Day 1 retention (next day return) | 55–70% | B2C SaaS benchmark |
| Day 7 retention | 35–50% | Половина выпала — это норма |
| Day 30 retention | 20–30% | Этот сегмент станет paid |
| Day 90 retention | 15–25% | Settled users |
| Day 180 retention | 12–20% | Long-term core |
| Day 365 retention | 8–15% | Если выше 10% — выдающийся продукт |

## 6.3. Paid retention

| **Метрика** | **Целевое** | **Замечания** |
| --- | --- | --- |
| Monthly gross churn | < 5% | Бенчмарк B2C SaaS |
| Annual gross churn | < 35% | Эквивалент monthly 5% |
| Monthly net revenue churn | < 3% | Учёт upgrades — компенсация cancels |
| Net revenue retention (NRR) | ≥ 100% | Health metric. Upgrades > churn |
| Reactivation rate (среди churned) | 8–15% | Через 60–90 дней могут вернуться |

## 6.4. Surface смерти когорты

Каждая cohort имеет ту точку, после которой почти никто не остался. Эта точка показывает «настоящую» пиковую retention для продукта.

Для PKM-продуктов эта точка часто — month 4–6 (после первого «вдохновения» начинается работа, для которой нужна disciplina). Если product достроен, чтобы помогать в этой фазе — retention curves flatten.

# 7. Revenue-метрики

## 7.1. Основные

| **Метрика** | **Определение** |
| --- | --- |
| MRR (Monthly Recurring Revenue) | Сумма всех месячных subscription revenue. Annual prepay делится на 12. |
| ARR (Annual Recurring Revenue) | MRR × 12. Используется для high-level reporting. |
| New MRR (per period) | MRR из новых платящих за период |
| Expansion MRR | Из upgrade-движений (Pro → Pro Plus, monthly → annual) |
| Contraction MRR | Из downgrades |
| Churned MRR | Из cancellations |
| Net New MRR | New + Expansion - Contraction - Churned |
| ARPU (Average Revenue Per User) | MRR / Paid users |

## 7.2. Unit-экономика

Полная модель — в документе 16 §6. Здесь — ключевые running metrics.

| **Метрика** | **Определение** |
| --- | --- |
| CAC (Customer Acquisition Cost) | Total marketing + sales spend / new paid customers. Сегментировать по каналу. |
| LTV (Lifetime Value) | ARPU × gross margin / monthly churn rate. Apex метрика. |
| LTV:CAC ratio | Целевое: ≥ 3:1. Запретить дорогой acquisition при ≤ 2:1. |
| Payback period | CAC / (ARPU × gross margin). Целевое: < 12 мес |
| Gross margin | Revenue - cost of goods sold (LLM, hosting, payment fees). Целевое: 65–75% |
| Magic Number ((New + Expansion ARR) / Sales+Marketing spend) | Целевое: > 0.75 (efficient growth), > 1.0 (excellent) |

# 8. Quality-метрики

## 8.1. NPS (Net Promoter Score)

1. Опрос раз в 30 дней for engaged users (NPS) — «would you recommend Nabu to a colleague?» 0–10.
1. NPS = % promoters (9–10) - % detractors (0–6).
1. Healthy NPS for SaaS: 30+. Excellent: 50+. Apple-class: 70+.
1. Сегментировать: по tier (Pro NPS должен быть выше Free), по cohort, по device.
1. Comments к NPS — gold для product roadmap.

## 8.2. Support-метрики

| **Метрика** | **Целевое** |
| --- | --- |
| Time to first response | < 24 ч для free, < 4 ч для paid |
| Time to resolution | Median < 48 ч |
| Tickets per active user per month | Целевое: < 0.05 (1 ticket на 20 users). Высокое — проблема в UX |
| Tickets by category | Top categories — guide product fix prioritization |
| CSAT (Customer Satisfaction) | Post-resolution survey: 'rate this support'. Целевое > 4.5/5 |

## 8.3. Reliability-метрики

Технические метрики (см. также документ 11 Security §8.4 и документ 12 Ops Runbook §8).

1. Uptime: целевое ≥ 99.9% для public services.
1. P95 latency для ключевых endpoint'ов (см. документ 10 §8).
1. Error rate < 0.1% для critical paths.
1. LLM provider success rate (per provider): целевое ≥ 99% — низкое влияет на user experience.

# 9. Privacy-respecting analytics архитектура

## 9.1. Технологический стек

| **Компонент** | **Выбор** |
| --- | --- |
| Landing page analytics | Plausible (cloud) ИЛИ Umami self-hosted. Cookieless, GDPR-compliant |
| Product analytics | PostHog self-hosted (open-source). Расширенный event tracking, funnel, cohort, retention из коробки |
| Error tracking | Sentry self-hosted (open-source версия) |
| Performance monitoring (APM) | OpenTelemetry → Tempo / Jaeger self-hosted |
| Metrics & alerts | Prometheus + Grafana |
| A/B testing | PostHog (умеет это; не нужен отдельный tool) |
| Email metrics | Plausible-style email tracking (через own pixel) или ничего |
| Запрещено | Google Analytics, Mixpanel cloud, Amplitude cloud, Hotjar, FullStory, Heap |

## 9.2. Структура event tracking

Все события — структурированные, не free-form. Один event schema на тип события.

Пример:

```
event: note.created
properties: {
  user_id: <anonymous_id>,
  source: 'web' | 'desktop' | 'mobile' | 'import' | 'api',
  visibility: 'default' | 'private' | 'vault',
  has_voice_input: boolean,
  duration_to_create_seconds: number,
}
// БЕЗ: содержимое заметки, заголовок, теги, мест
```

## 9.3. Принципы трекинга

1. Anonymous user_id (uuid v4), генерируется при first install/registration. Связан с auth user_id только через приватную mapping table, не доступную аналитике.
1. Никаких PII (email, имя, IP, fingerprint). Если технически нужно — anonymize до записи.
1. Геолокация — только country-level, через IP geolocation. IP сразу выбрасывается.
1. Device — только category (desktop/mobile/tablet) + browser engine. Без version-specific fingerprinting.
1. Retention в analytics DB — 365 дней. Старее — aggregate-only.
1. Право пользователя на удаление: при account delete — все analytics events этого user_id удаляются (см. документ 11 §10.2).

## 9.4. Opt-out

1. Settings → Privacy → 'Опт-аут из product analytics'. Полностью выключает events для этого user'а (даже anonymous).
1. Cookieless landing analytics — не требует opt-out (нет cookies = нет под GDPR).
1. Default: opt-in для anonymous product analytics — но это нужно communicate ясно.

# 10. Dashboards

Разные аудитории — разные дашборды. Не один универсальный, который никто не смотрит.

## 10.1. Founder / Team — Daily Pulse

Один-экранный morning brief. Видеть за 30 секунд.

1. Yesterday WAU, ΔWoW%.
1. Yesterday signups, ΔWoW%.
1. Yesterday new paid, MRR delta.
1. Errors / 5xx / failed agent invocations — список с counts.
1. Active alerts (если есть).
1. Mood: один summary score, e.g. green/yellow/red.

## 10.2. Product — Weekly Health

Еженедельный review для product decisions.

1. WEU trend, последние 12 недель.
1. Cohort retention (последние 8 cohort'ов, day 1/7/30 retention).
1. Funnel conversion — каждый шаг.
1. Per-agent: invocations, success rate, thumbs-up rate.
1. Top complaints (категории support tickets).
1. Feature usage: каких модулей не хватает.

## 10.3. Growth — Marketing & Acquisition

1. Visitors by source / medium / campaign.
1. Signup conversion per source.
1. Cost per signup, cost per paid (CAC) per channel.
1. LTV:CAC per cohort.
1. Content marketing: blog post views, time on post, conversion-from-post.
1. Social: Twitter engagement, Discord active users, GitHub stars.

## 10.4. Finance / Business — Monthly

1. MRR trend (12+ месяцев).
1. New MRR / Expansion / Contraction / Churned waterfall.
1. ARPU trend.
1. LLM costs, hosting costs, total COGS.
1. Gross margin trend.
1. Runway analysis (если применимо).

## 10.5. Community-facing — Public (опционально)

В духе «build in public» — некоторые метрики можно публиковать публично.

1. Total users, paid users (mid-range numbers).
1. Total notes created (агрегированный counter).
1. Uptime status (status page).
1. Latest release notes.
НЕ публиковать: detailed cohort retention, per-feature usage, customer LTV. Это конкурентная информация.

# 11. Alert thresholds

## 11.1. P0 alerts (immediate)

1. Uptime: 5xx error rate > 1% for 5 min.
1. Failed login rate > 10× normal (potential attack).
1. LLM provider total failure (all retries fail).
1. Database connection pool exhausted.
1. Disk > 95% usage.

## 11.2. P1 alerts (within 1 hour)

1. Daily signups -50% from 7-day average (something broke in signup flow).
1. Daily new paid -70% from 7-day average.
1. Cancel rate spike (z-score > 3) — something pissed people off.
1. Agent thumbs-down rate spike (per agent) — quality regression.
1. P95 latency > 2× SLO.

## 11.3. P2 alerts (within 1 day)

1. Weekly WAU declining > 5% (3-week trend).
1. Churn rate ↑ relative to historical.
1. Support ticket category surge (>2× normal for one category).
1. Cohort retention deviating from baseline (3rd-week retention -10% from cohort average).

## 11.4. Hygiene — не делать too many alerts

1. Alert fatigue убивает оперативную bдительность. Каждый new alert должен быть оправдан.
1. Alert должен иметь явный runbook («что делать, если сработал»).
1. Quarterly review всех alerts: какие срабатывают, кто реагирует, какие удалить.

# 12. A/B testing methodology

## 12.1. Когда A/B тестировать

1. Pricing changes (см. документ 16 §13).
1. Onboarding flow.
1. Landing page (см. документ 18 §19).
1. Email subject lines / send timing.
1. Feature roll-outs (постепенный rollout как тест).

## 12.2. Не A/B тестировать

1. Существующих платящих — без consent. Они платят за конкретный продукт.
1. Privacy/security policies (это compliance, не оптимизация).
1. Terapy mode (никаких экспериментов на mental health features).
1. Сразу 5+ переменных одновременно (multi-variate без proper design — шум, не сигнал).

## 12.3. Design

1. Hypothesis-driven. Каждый test — гипотеза с predicted outcome.
1. Sample size calculated upfront. Min 1000 users per arm для basic conversions.
1. Primary metric — один. Secondary можно отслеживать, но не decide on them.
1. Длительность теста — minimum 14 дней (учёт weekly patterns).
1. Statistical significance: p < 0.05 для go/no-go.
1. Effect size — практическая значимость не путать со статистической. Изменение 0.1% при N=10000 может быть «significant» но безразличным.

## 12.4. Анализ

1. По default — Bayesian, не frequentist (легче интерпретация: «вероятность что B > A»).
1. Сегментация: cмотреть результат по segments (mobile vs desktop, by country, by acquisition source). Иногда aggregate скрывает важное.
1. Negative results публиковать в team retrospective. Это ценные данные («мы думали X — оказалось не так»).
1. Не делать peeking (multiple looks без correction).

# 13. Cohort analysis

## 13.1. Какие cohort'ы вести

1. By week-of-signup — стандартный.
1. By acquisition source — Reddit cohort, HN cohort, ProductHunt cohort, referral cohort.
1. By landing variant — если активный A/B.
1. By onboarding completion — completed vs partial onboarding.
1. By first-week behavior (≥ 5 notes vs ≤ 1 note) — predictive of long-term engagement.

## 13.2. Что искать в cohort-данных

1. Improvement или degradation: новые cohort'ы retain better или worse?
1. Aha moment timing: какие пользователи остаются — те, кто что-то сделал в первые N часов/дней.
1. Channel quality: какие acquisition sources дают engaged users vs «зашёл и ушёл».
1. Onboarding impact: completed onboarding улучшает retention на сколько процентов?

# 14. Что измерять на каждой фазе запуска

## 14.1. Phase 1 — Private alpha

Главное: качественный feedback и продуктовая итерация. Количественное — менее важно (выборка мала).

1. WAU и WEU absolute count.
1. Per-feature usage matrix.
1. Bug reports (Discord + GitHub Issues).
1. Spontaneous feature requests.
1. Manual NPS quarterly.

## 14.2. Phase 2 — Closed beta

Главное: validation что продукт sсales и engagement держится.

1. Полная funnel-аналитика — настраивается в этой фазе.
1. Cohort retention day-by-day.
1. Activation rate per source.
1. Feedback structure formalize: NPS, in-app surveys.
1. Performance metrics (latency, error rate) под realistic load.

## 14.3. Phase 3 — Public beta

Главное: revenue mechanics + acquisition scalability.

1. Free-to-paid conversion.
1. CAC per channel.
1. Paid retention, churn analysis.
1. LTV:CAC.
1. All previous metrics — продолжают.

## 14.4. Phase 4 — GA + scaling

Главное: efficient growth, expanded segments, expansion revenue.

1. Net Revenue Retention (NRR).
1. Expansion MRR rate.
1. Payback period per cohort.
1. Channel saturation curves (какие каналы достигли ceiling).

# 15. Чек-лист готовности аналитики

Перед public-launch — этот checklist должен быть зелёный.

- PostHog (или эквивалент) self-hosted, работает, события поступают.
- Plausible (или эквивалент) на landing page, отслеживает основные events.
- Sentry поднят, captures errors из frontend и backend.
- OpenTelemetry traces текут в Tempo, ключевые operations instrumented.
- Prometheus собирает app + system metrics.
- Grafana dashboards настроены для 4 audience'ов (founder/product/growth/business).
- Все P0/P1 alerts настроены с runbook ссылками.
- Funnel events instrumented: visitor → signup → activation → engagement → paid.
- Cohort retention dashboard работает.
- NPS-trigger автоматизирован.
- Privacy compliance: no PII в analytics, opt-out flow работает, account-delete очищает analytics.
- Privacy promise публично documented (security/privacy pages).
- Документация: каждое event имеет documented schema.
- On-call rotation defined (даже если это founder solo).

# 16. Quarterly metrics review

Каждый квартал — формальная сессия review всех метрик.

1. Что мы измеряем — нужно ли продолжать?
1. Какие метрики мы НЕ измеряем — должны?
1. Alert hygiene: какие срабатывают зря?
1. Cohort trends: продукт улучшается или деградирует?
1. Hypothesis вывод: какие гипотезы подтвердились/опровергнуты?
1. New experiments backlog.
