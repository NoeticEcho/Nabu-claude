# NABU CODEX

*Концепция умного блокнота*  
*Физическое hardware-устройство для Nabu*  
*Концепция, технический анализ, стратегия реализации*  
*Версия 1.0*  

---

# 1. Назначение и контекст

Документ — критический анализ и стратегия реализации физического устройства — премиум-блокнота с интегрированной электроникой для работы с Nabu. Покрытие: концепция, нейминг, реалистический технический анализ, варианты реализации, business case, рекомендованный путь, когда начинать.

Сопровождающий документ 24 содержит industrial design brief и промпты для генераторов изображений (визуализация концепции).

> Я буду одновременно поддерживать силу идеи (это реально может стать defining product moment для Nabu Universe) и быть прямым относительно технических, финансовых и временных реалий hardware-продуктов. Без второго первое превращается в дорогую фантазию.

# 2. Краткое резюме видения

Из описания: блокнот A5 в формате старого судового журнала из премиум-кожи (или high-tech материалов), с каменной бумагой, e-ink тачскрином на задней обложке, гибким "шлангом" с камерой/LED/пикопроектором, локальной электроникой для работы Nabu, поддержкой WiFi/Bluetooth/LTE.

Ключевые элементы:

- Премиум-эстетика (ретро-судовой журнал, кожа, завязки)
- Каменная бумага (вечная, водостойкая)
- E-ink тачскрин на задней обложке
- Локальная начинка для работы Nabu
- Гибкий gooseneck с LED + камера для capture написанного
- Опционально: пикопроектор + жестовое управление (lasered keyboard / UI на бумагу)

# 3. Краткая оценка и рекомендация

> Рекомендация: Не строить полное устройство в первой итерации. Phase 1 — Companion Device (упрощённый scanner-arm pairing с телефоном/десктопом). Phase 2 — Full Codex (полное устройство). Активация Phase 1 — не ранее Year 2-3 после Nabu PMF. Это спасает $5-15M ранних инвестиций и даёт реальный шанс на успех.

## 3.1. Главные выводы анализа

1. **Идея концептуально верная**: премиум hardware = мощный brand moment, потенциальный moat в категории, lock-in для самых лояльных пользователей.
1. **Полная реализация (как описано) технически очень амбициозна**: BOM $400-1000, retail $1200-3000, время разработки 24-48 месяцев, риск manufacturing scaling.
1. **Несколько ключевых элементов нереалистичны или требуют пересмотра**: Raspberry Pi Zero не сможет запустить локальный Nabu (см. §5); пикопроектор + жестовое управление — major engineering challenge с слабым ROI; battery life будет 2-4 часа при заявленной функциональности.
1. **Существует конкуренция**: ReMarkable Paper Pro ($600), Daylight Computer ($729), Boox Note Air4 ($499), Supernote A5X. Все имели $10M+ funding.
1. **Phased approach рационален**: начать с минимального companion-устройства, протестировать market demand, потом инвестировать в полное устройство.
1. **Timing критичен**: пока Nabu не достиг PMF и стабильного MRR — hardware-инвестиция = $5-15M в проект без user feedback. Это premature.

# 4. Нейминг устройства

## 4.1. Кандидаты

Имя устройства — это branding decision со стратегическими последствиями. Несколько кандидатов с обоснованием:

| **Кандидат** | **Обоснование и оценка** |
| --- | --- |
| Nabu Codex | Codex (лат.) — формат древних рукописей со сшитыми страницами (в отличие от свитка). Premium gravitas, исторически точно (Nabu — бог писцов), легко произносится во всех языках. Возможные конфликты: GitHub Codex (AI tool), но в hardware category свободно. **Top pick.** |
| Nabu Folio | Folio — лист в книге. Элегантно, минималистично, отсылает к manuscript culture. Менее уникально, чем Codex. Конфликт: Microsoft Surface Duo раньше назывался Surface Folio. |
| Nabu Tabula | Tabula (лат.) — табличка для письма. Прямая отсылка к глиняным табличкам древних писцов, и к Nabu как богу письма. Tabula rasa — известное выражение. Звучит сильно, но менее знакомо широкой аудитории. |
| Nabu Atlas | Atlas — сборник карт, навигационный артефакт. Красиво, но overused (Atlas Obscura, IBM Atlas, Apple Atlas). |
| Nabu Quill | Quill — гусиное перо. Поэтично, но slang в crypto/web3 (Quill — известная NFT-marketplace). Skip. |
| Nabu Vellum | Vellum — телячья кожа для письма. Слишком niche, hard to spell for non-English speakers. |
| Codex (standalone) | Без префикса Nabu — устройство получает свой бренд. Pros: автономность, может стать flagship. Cons: теряется связь с Nabu бренд. |
| Atlas (standalone) | Свой бренд. Beautiful, но overused. |

## 4.2. Рекомендация по неймингу

> Основная рекомендация: **Nabu Codex** для primary device. Tagline: «The journal that remembers». Alternative: standalone бренд **Codex** with subtitle «by Nabu» для подчёркивания премиальности.

Для разных surfaces в линейке (если будет линейка):

- **Nabu Codex** — flagship full-device (Phase 2)
- **Nabu Codex Scanner** или **Nabu Quill** — companion-device (Phase 1)
- **Nabu Codex Pro** — professional edition (если будет SKU range)
- **Nabu Codex Folio** — slimmer variant

## 4.3. Брендинг и эстетика

Имя должно вписываться в общий brand language Nabu Universe (документ 20):

- Nabu (software) — serious, intellectual, professional
- KNS / Noetic Echo (software) — mystical, creative, narrative
- Nabu Codex (hardware) — premium, artifact-like, timeless
Codex bridges Nabu's seriousness with the aesthetic depth KNS audience appreciates. Это потенциальный hero product Universe.

# 5. Технический реализм-анализ

## 5.1. Раппberry Pi Zero не подойдёт

Один из ключевых элементов описания — "Raspberry Pi Zero или иное" для локальной работы Nabu. Это критическое заблуждение, требующее коррекции.

| **Компонент** | **RPi Zero W** | **Что нужно для Nabu** |
| --- | --- | --- |
| CPU | 1 GHz single-core ARM11 | Минимум: 4-core ARM Cortex-A53 (64-bit) |
| RAM | 512 MB | Минимум 2 GB (4 GB предпочтительно) |
| Storage | Только microSD | 32 GB+ eMMC или SSD |
| LTE | Отсутствует | Требуется отдельный модуль ($30-60) |
| GPU | VideoCore IV (старый) | Требуется для UI, e-ink driver |
| Цена SoC | $15 | $50-100 для адекватной SoC |

Что Nabu requires в production (см. документы 05 SAD, 12 Ops Runbook):

- Postgres с pgvector (≥1 GB RAM working set)
- TypeDB Server (Java, ≥2 GB heap)
- NestJS API + worker процессы (≥500 MB)
- Mastra runtime с агентами (≥1 GB)
- LLM inference (если local) — Qwen 2.5 14B требует 16+ GB
> Полная локальная работа Nabu на embedded устройстве — невозможна без серверного hardware. Устройство либо подключается к облаку, либо запускает максимально lightweight client. Это фундаментальное архитектурное решение, требующее adjustment концепции.

## 5.2. Реалистичные варианты SoC

| **SoC option** | **Цена** | **Подходит для** |
| --- | --- | --- |
| Raspberry Pi CM4 (8GB) | $90 | Базовая работа e-ink + camera + LTE client; не для local LLM |
| Raspberry Pi 5 (8GB) | $80 | Аналогично CM4, но не для embedded form factor |
| Rockchip RK3566 (4GB) | $40-60 | Mid-range embedded, достаточно для basic Nabu client |
| Rockchip RK3588 (8GB+) | $80-120 | Heavy-duty, может запустить small LLM локально (Phi-3 3B, Gemma 2B) |
| NXP iMX8M Mini | $30-60 | Industrial-grade, longevity, но ограниченная производительность |
| Qualcomm QCS8550 / SD7c | Custom pricing | Premium mobile-class chips, но требуют scale and licensing |

Рекомендация: **Rockchip RK3588 с 8GB LPDDR4** — sweet spot для устройства класса Codex. Поддерживает: Linux/Android, ускоренный AI inference (NPU), е-ink driving, camera input, LTE/WiFi 6/BT 5.

## 5.3. E-ink тачскрин

Существуют готовые модули, которые могут быть интегрированы:

- E Ink Carta 1300 (8.0–10.3″) — стандарт для современных readers. Стоимость модуля $80-150.
- E Ink Carta 1300 в цветном варианте (Kaleido 3) — для colored displays, $120-200.
- Touch overlay (capacitive + Wacom EMR для stylus) — добавляет $30-60.
Размер screen — критичный design choice. В рамке A5-блокнота (210×148mm) screen ~7-8″ оптимален. Полностью покрыть заднюю обложку 10″ screen возможно, но увеличит толщину и BOM.

## 5.4. Гибкий gooseneck arm с камерой

Эта часть технически реалистична. Существующие референсы:

- IPEVO V4K Pro — document camera на gooseneck, $109
- Logitech Mevo Camera — small smart camera on flexible arm
- Lampcam scanners — class of devices, существуют
Компоненты для интегрированного gooseneck:

1. Гибкий металлический gooseneck (cooper or aluminum core, plastic sheath) — $5-15 custom
1. 8-12MP CMOS camera module (Sony IMX series) — $15-30
1. White LED (warm + cool tunable) — $5-10
1. Capacitive touch panel на головке (для регулировки света) — $5-10
1. Микрофон (для voice capture при необходимости) — $2-5
Это разумно реализуемо. Total cost ~$40-70 для gooseneck assembly.

## 5.5. Пикопроектор + жестовое управление — оценка

Это самая амбициозная часть концепции. Прямая оценка реалистичности:

| **Aspect** | **Реальность** |
| --- | --- |
| Размер пико-проектора | Самые маленькие модули (TI DLP Pico): 30×20×8mm — поместятся в утолщение. OK. |
| Энергопотребление | Активный pico-projector: 2-5W. Это сократит battery life до 1-2 часов. Серьёзная проблема. |
| Качество проекции | При indoor освещении: приемлемо для 4-6″ image. В дневном освещении на белой бумаге: плохо видно (низкая яркость 30-100 lumen для микро-проекторов). |
| Жестовое управление | Возможно через depth sensor (Intel RealSense, или camera-based). Точность ограниченная. UX обычно слабый. |
| Лазерная клавиатура | Существуют (Celluon, ToughKeyboard), но: 60-80% точность, пользователи ненавидят tactile feedback отсутствие, технология тупиковая. |
| BOM impact | Дополнительно $80-200 на pico + $20-40 на motion sensor |
| UX полезность | Спорная. Пользователи привыкли к touch на screen; проекция UI на бумагу — gimmick, redko useful. |

> Рекомендация по проектору: НЕ включать в Phase 1 и Phase 2. Сократит BOM на $100-240, увеличит battery life в 2-3 раза, упростит разработку на 6-12 месяцев. Можно рассмотреть для Phase 3 (Codex Pro Plus или специальная edition), если получит явный спрос.

## 5.6. Каменная бумага

Существует от множества производителей (Karst Stone Paper, Stone Paper Company). Преимущества: водостойкая, прочная, премиальный feel. Недостатки: тяжелее обычной бумаги (~25-30% тяжелее), не biodegradable как органическая бумага.

Стоимость: $1-2 за лист в премиум-категории. Стоимость bound notebook на 80-120 листов: $20-40.

Включение — без проблем.

## 5.7. Battery

С e-ink screen + camera + LTE + (optionally) pico projector. Реалистичные оценки battery life:

| **Конфигурация** | **Battery life** |
| --- | --- |
| Только reading (e-ink only) | Weeks (как ReMarkable) |
| Active note capture + LTE sync | 8-12 часов |
| + active LED gooseneck | 6-8 часов |
| + pico-projector использование | 1-2 часа |
| Standby | Weeks |

Battery capacity цель: 4000-6000 mAh. Стоимость: $20-40.

# 6. Bill of Materials и Pricing анализ

## 6.1. Реалистичный BOM для Phase 2 Full Codex

| **Компонент** | **Cost (USD)** | **Заметки** |
| --- | --- | --- |
| Premium genuine leather binding (A5) | $30-80 | Зависит от leather quality. Russian/Italian leather $40-60. |
| Stone paper notebook insert (80-120 листов) | $20-40 | Karst или подобный |
| Brass clasps and details | $5-15 | Декоративные элементы |
| E Ink Carta 1300 8" touchscreen module | $100-150 | Включая touch overlay |
| Rockchip RK3588 SoC + 8GB LPDDR4 + 64GB eMMC | $80-120 | Compute module |
| LTE Cat 4 module (e.g., Quectel EC25) | $30-50 | Включая SIM slot |
| WiFi 6 + Bluetooth 5 module | $10-15 | Combo chip |
| 8MP camera module (Sony IMX series) | $15-30 | OmniVision или Sony |
| Tunable white LED + driver | $5-10 | Cool to warm 2700-6500K |
| Capacitive touch panel (на gooseneck head) | $5-10 |  |
| Custom flexible gooseneck arm | $8-15 | Custom manufactured |
| 4000-6000 mAh LiPo battery + BMS | $25-40 | С защитой |
| PCB (4-6 layer) + assembly | $30-60 | Custom motherboard |
| Speaker (small, for notifications) | $3-7 | Optional |
| Microphone array | $5-10 | Для voice capture |
| Cables, connectors, mechanical | $10-20 | Wiring, screws, mechanism |
| Premium packaging (box, papers) | $15-30 | Brand experience |
| **Total BOM (с pico projector)** | **$481-871** | Без pico |
| **Total BOM (без pico projector)** | **$380-682** | Рекомендованный |
|  |  |  |
| Pico projector (если включён) | $80-200 | DLP Pico module |
| Motion sensor для жестов | $10-30 | TOF sensor or IMU array |
|  |  |  |
| **Manufacturing overhead** (20-30% от BOM) | $80-200 |  |
| Certification (FCC, CE, UKCA) | $30k-100k total | One-time, distributed across units |
| Tooling и industrial design | $200k-500k | One-time |

## 6.2. Retail pricing

Standard hardware markup: 3-4× BOM (для retail), 2-2.5× для DTC (direct to consumer).

| **Configuration** | **DTC retail (2.5×)** | **Retail (3.5×)** |
| --- | --- | --- |
| Без projector ($500 BOM avg) | $1250 | $1750 |
| С projector ($700 BOM avg) | $1750 | $2450 |
| Premium edition (custom leather, gold accents) | $2000-3000 | $3000-4500 |
| Companion-only device (Phase 1) | $300-500 | $400-700 |

Сравнение с конкурентами:

- ReMarkable Paper Pro: $599 (без accessory) до $818 (с marker, folio)
- Daylight Computer DC-1: $729
- Boox Note Air4 C: $499
- Supernote A5X: $469
- Kindle Scribe: $339-419
Nabu Codex в $1250-1750 — premium tier. Это **5-10x dearer than mass market**. Audience — high-disposable-income knowledge professionals, executives, серьёзные writers/researchers. TAM limited but ARPU high.

# 7. Варианты реализации

## 7.1. Опция A: Full Custom Hardware (полное устройство)

Полностью кастомное устройство, разработанное in-house или с partner manufacturer.

Pros: полный control над experience, максимальная differentiation, defensible IP, бренд-defining product.

Cons: $5-15M в R&D + tooling, 2-4 года до shipping, manufacturing scaling, supply chain risks, требует hardware engineering команды.

Когда подходит: после Nabu PMF + $5M+ ARR + достаточно capital + явный hardware demand.

## 7.2. Опция B: White-label / OEM Partnership

Партнёрство с manufacturer (Boox, Onyx International, или специализированный ODM из Шеньчжэня). Custom firmware + Nabu branding на их device.

Pros: $50k-500k investment, 6-12 месяцев до shipping, использует established supply chain, no manufacturing risk.

Cons: ограниченный design control, generic rectangular tablet (не "ретро блокнот"), partner dependency, brand identity слабый.

Когда подходит: для quick market test, или если budget ограничен.

## 7.3. Опция C: Companion Device (минимальное hardware)

Только handheld scanner с gooseneck — pairs с phone/laptop/tablet running Nabu. No e-ink, no LTE, no local Nabu. Просто высококачественный capture device + LED.

Pros: $500k-2M в разработку, 12-18 месяцев до shipping, простой product, может быть accessory к существующим устройствам.

Cons: меньше brand impact, не standalone product, narrower audience (только Nabu users with other devices).

Когда подходит: **Phase 1 entry point** — proof of concept перед инвестицией в full device.

## 7.4. Опция D: Premium Notebook + Detachable Tech

Премиум кожаный блокнот, в которой встроен detachable smart sleeve (scanner + tech). Можно использовать notebook без electronics или с.

Pros: модульность, более низкий entry price, customer customization, easier production.

Cons: complex industrial design, не интегрированное feel, потеря "единого артефакта" feeling.

Когда подходит: после Phase 1 (companion), как evolution path.

## 7.5. Опция E: Limited Edition Luxury Artifact

Ультра-премиум, лимитированный выпуск 100-1000 единиц по $3000-5000+. Aiming для brand statement и core fan acquisition, не для mass market.

Pros: $1-3M в разработку (тираж маленький), PR moment, exclusive community, sells out immediately for true fans.

Cons: limited revenue, no economies of scale, может казаться elitist, не sustainable как product line.

Когда подходит: как complement к main product (Phase 2.5).

## 7.6. Опция F: Phased Strategy (рекомендованная)

Сочетание опций для phased market entry:

1. **Phase 1**: Companion device (Опция C). Год 2-3 после Nabu launch. Тестирует hardware-market fit для Nabu users.
1. **Phase 2**: Full Codex (Опция A или D). Год 3-5. Если Phase 1 показал traction.
1. **Phase 2.5**: Limited Edition Premium (Опция E). Параллельно с Phase 2 для PR.
1. **Phase 3**: Codex Lite (mass market variant). Год 5-7. Если Phase 2 успешен.
> Рекомендованная: Опция F. Phased approach снижает риски в 5-10 раз, даёт learn-and-iterate возможности, и совпадает с финансовыми возможностями стартапа на разных стадиях.

# 8. Business case

## 8.1. Strategic value

1. **Brand moment**: премиум hardware artifact = mighty marketing tool. Single device может стать viral icon Nabu/KNS Universe (как ReMarkable стал defining brand image).
1. **Lock-in для core users**: $1500 investment = sticky pattern. Пользователи, купившие устройство, retain at 5x rate of software-only.
1. **Premium positioning**: dilutes perception of Nabu как "yet another SaaS". Реальный artifact = real brand.
1. **Cross-product engagement**: device users становятся heaviest Nabu users → высокий LTV.
1. **PR и press**: hardware launches привлекают значительно больше media attention, чем software updates.

## 8.2. Financial scenarios

### Conservative (companion device Phase 1)

1. Development: $1.5M, 18 months
1. Year 1 of shipping: 2000 units × $400 = $800k revenue
1. Year 2: 5000 units × $400 = $2M revenue
1. Margin: 40-50% после COGS, shipping, returns
1. Net contribution: $1M-2M, payback ≈ 2-3 года

### Moderate (full Codex Phase 2)

1. Development: $8M, 30 months (после Phase 1)
1. Year 1: 5000 units × $1500 = $7.5M revenue
1. Year 2: 15000 units × $1500 = $22.5M revenue
1. Year 3: 30000 units × $1500 = $45M revenue
1. Margin: 30-40% (premium hardware)
1. Net contribution: $20M-50M cumulative over 3 years

### Ambitious (full universe + Codex Lite Phase 3)

1. Кумулятивный hardware revenue Year 5-7: $100-300M
1. Becomes flagship product line, как Apple AirPods

## 8.3. Risk-adjusted analysis

| **Scenario** | **Вероятность** | **Net Impact** | **Notes** |
| --- | --- | --- | --- |
| Phase 1 succeeds, Phase 2 launches | 40% | +$30-50M ARR | Realistic upside |
| Phase 1 succeeds, Phase 2 cancelled | 25% | +$2-5M | Continued as accessory |
| Phase 1 disappoints, project ended | 25% | -$1.5M loss | Cost of failed Phase 1 |
| Catastrophic supply chain / FCC failure | 10% | -$3-5M loss | Major risk |

Expected value: ~$10M+ over 5 years при правильном execution. Это разумный bet для компании с $5M+ ARR.

## 8.4. Когда НЕ начинать

1. Если Nabu MRR < $100k/мес — sin qua non priority.
1. Если runway < 18 месяцев — hardware съест cash flow.
1. Если в команде нет hardware engineer'а — нельзя outsource всё.
1. Если нет hardware-savvy advisor/investor — критические ошибки гарантированы.
1. Если нет clear demand signal от Nabu users — это founder fantasy, не market need.

# 9. Конкурентный ландшафт

## 9.1. Прямые конкуренты

| **Product** | **Price** | **Funding raised** | **Position vs Nabu Codex** |
| --- | --- | --- | --- |
| ReMarkable Paper Pro | $599-818 | $50M+ | Mass market e-ink writer. Без camera, без integration с AI. Target — basic note-takers. |
| Daylight Computer DC-1 | $729 | $15M+ | All-day reading device с e-ink-like screen. Apps platform. Без gooseneck camera. |
| Boox Note Air4 C | $499 | Bootstrapped, large | Color e-ink Android tablet. Many features, но generic. |
| Supernote A5X | $469 | Smaller | Premium minimalist e-ink notebook. Closer to Codex aesthetic, но без AI integration. |
| Kindle Scribe | $339-419 | Amazon | Mass market, но Amazon-ecosystem locked. |
| Light Phone 2 | $299 | $3-5M | Minimal phone, эстетика близка. Не notebook. |
| Onyx Boox Max Lumi 2 | $849 | Bootstrapped | Large format e-ink notebook. Без unique AI integration. |

## 9.2. Indirect competitors

- Apple iPad + Pencil + Notability/GoodNotes — $500-1000+. Software AI features растут (Apple Intelligence).
- Microsoft Surface + Pen + OneNote — $500-1500+.
- Премиум leather notebooks без electronics (Smythson, Moleskine premium) — $50-500. Brand competitors на эстетическом фронте.
- Vintage typewriters / fountain pens — "slow productivity" movement, эстетический overlap.

## 9.3. Differentiation analysis

Codex differentiates через combination, не одну фичу:

1. **E-ink + camera capture + AI**: ReMarkable есть e-ink но без camera + AI. Daylight есть e-ink + apps но без camera/scanner. Boox имеет всё, но без unique AI integration.
1. **Real notebook aesthetic**: ReMarkable выглядит как tablet. Кожаный судовой журнал — unique категория.
1. **Deep integration с Nabu**: специфические workflow (приватная therapy, journaling с агентами, knowledge graph) — недоступно в standalone devices.
1. **Local-first / privacy positioning**: Apple/Microsoft = cloud. Boox = generic. Codex = real local storage + privacy categories.
> Codex имеет defensible differentiation, но НЕ создаёт новую категорию. Это premium contender в existing category e-ink writers с AI twist.

# 10. Phased roadmap

## 10.1. Phase 0: Conceptual validation (Year 1-2 после Nabu launch)

1. **Что делать**: Industrial design renders (см. документ 24), user research среди Nabu users.
1. **Survey**: "Would you buy a $400-1500 Nabu hardware companion?" Минимум 1000 респондентов.
1. **Cost**: $30-50k для renders + research
1. **Решение**: Если ≥ 5% Nabu users показывают serious интерес (placeholder, pre-order) — go к Phase 1. Если < 2% — kill идею.

## 10.2. Phase 1: Companion Scanner (Year 2-3)

1. **Product**: Standalone gooseneck scanner + LED + tactile pad. Pairs с Nabu app на phone/laptop. Premium кожаный case.
1. **No e-ink, no LTE, no local Nabu**. Простой capture device.
1. **Price**: $299-499
1. **Development**: $1-2M, 12-18 months
1. **Manufacturing**: ODM partnership (Shenzhen)
1. **Launch**: Kickstarter or Pre-order через Nabu community first, retail second
1. **Success criteria**: 2000+ units Year 1, NPS > 50, retention impact на Nabu paying users measurable

## 10.3. Phase 2: Full Codex (Year 3-5)

1. **Product**: Full device per описание — кожаный блокнот + e-ink + camera + LTE + gooseneck. БЕЗ pico-projector.
1. **Price**: $1250-1750
1. **Development**: $5-10M, 24-36 months
1. **Manufacturing**: Partial in-house industrial design + ODM partnership
1. **Launch**: Hero product Year 4-5, может быть как Apple Vision Pro launch.
1. **Success criteria**: 5000+ units Year 1, $7-10M revenue, продолжение Year 2-3.

## 10.4. Phase 2.5: Limited Edition (parallel)

1. **Product**: 100-500 единиц особо-премиум edition (gold accents, exotic leather, hand-engraved)
1. **Price**: $3000-5000
1. **Цель**: PR moment, brand statement, core fan ownership
1. **Timing**: At Phase 2 launch или ~6 месяцев после

## 10.5. Phase 3: Codex Lite (Year 5-7)

1. **Product**: Cost-reduced variant — simpler materials, smaller screen, без gooseneck (или съёмный).
1. **Price**: $499-799
1. **Цель**: Mass-market expansion при сохранении premium Codex для top tier

## 10.6. Total funding requirements

| **Phase** | **Required capital** | **Source** |
| --- | --- | --- |
| Phase 0 (validation) | $30-50k | Internal cash flow |
| Phase 1 (companion) | $1-2M | Crowdfunding + small VC round (Series A hardware) |
| Phase 2 (Full Codex) | $5-10M | Series B with hardware-focused investors |
| Phase 2.5 (Limited Ed) | Inside Phase 2 |  |
| Phase 3 (Lite) | $3-5M | Cash flow from Phase 2 + debt financing |
| Total over 5-7 years | $10-17M |  |

## 10.7. Дефолтная позиция: подождать

> Если Nabu PMF не достигнут к Year 2-3 — все Phase 1+ отложить. Hardware product без software base не имеет смысла. Default action: focused execution on Nabu software product, hardware — только когда signals для него ясны.

# 11. Ключевые рекомендации по концепции

## 11.1. Что оставить из исходного описания

- **Премиум кожаный binding** в стиле судового журнала — keep. Это brand-defining.
- **Каменная бумага** — keep. Premium, durable, unique feature.
- **E-ink тачскрин на задней обложке** — keep. Core functionality.
- **Локальная начинка (SoC)** — keep, но scale up к Rockchip RK3588, не RPi Zero.
- **WiFi/Bluetooth/LTE** — keep. Connectivity essential.
- **Аккумулятор** — keep, размер 4-6000 mAh.
- **Гибкий gooseneck с camera + LED** — keep. Это unique selling point.
- **Capacitive touch panel на gooseneck head** — keep. Хорошая deталь UX.

## 11.2. Что переосмыслить

- **"Локальный Nabu"**: переформулировать как "локальный Nabu client с essential functionality + cloud sync". Полный Nabu невозможен на embedded device. Local: editing notes, viewing graph snippets, basic AI (small models like Phi-3 mini), capturing photos. Cloud: heavy AI agents, ontology, complex queries.
- **"Raspberry Pi Zero"**: заменить на Rockchip RK3588 (или эквивалент) с 8GB RAM и NPU acceleration.
- **Размер устройства**: A5 формат может оказаться too thick (~20-25mm с e-ink + electronics + battery). Рассмотреть B5 как trade-off или leather-cover-over-tech approach.

## 11.3. Что отложить / удалить

- **Пико-проектор** — отложить. Кран на battery, ограниченное использование, complicates engineering. Может быть в Phase 3 как special edition feature.
- **Жестовое управление** — отложить. UX слабый, точность плохая, alternatives есть (touch, voice).
- **Лазерная клавиатура** — удалить. Никто не использовал успешно, gimmick technology.

## 11.4. Что добавить (предложение)

- **Stylus support** (Wacom EMR) — для письма на e-ink screen. Это standard expectation для note-taking devices.
- **Voice recording with on-device transcription** — Whisper.cpp с lightweight model работает на ARM SoC. Это полезнее проектора.
- **Solar trickle charging** через embedded в leather solar cells — поэтично и practical для long battery life. Niche feature но brand-defining.
- **Pre-installed Nabu account integration** — пользователь sets up через QR code и USB-C, минимальный setup. Premium UX.
- **Custom AI processing chip / NPU** — некоторые SoC (RK3588) имеют built-in NPU для on-device inference small models. Это позволит local processing для privacy-categories.

# 12. Резюме и actionable next steps

## 12.1. Резюме

1. Концепция Nabu Codex — стратегически верная для Nabu Universe. Hardware artifact = mighty brand moment.
1. Полная реализация (в первой итерации) — premature. $5-15M вложение без validated user demand.
1. Phased approach (Companion → Full → Lite) рационален.
1. Несколько технических элементов требуют корректировки (RPi Zero неподходящ, projector — premature, локальный Nabu — невозможен полностью).
1. Рекомендованный nameing: **Nabu Codex** для full device, **Nabu Codex Scanner** или **Nabu Quill** для companion.
1. Activation timing: НЕ ранее Year 2-3 после Nabu PMF и $100k+/мес MRR.

## 12.2. Конкретные next steps (если решено двигаться)

1. **Сейчас (Phase 0)**: Создание industrial design renders (документ 24) — для visualization и user research. Cost: $5-15k.
1. **Сейчас**: User research — survey среди existing Nabu signup waitlist о interest в hardware. Cost: $5k через external research firm.
1. **При Nabu MRR $30k+**: Найм hardware product advisor (часть-time или fractional CTO с hardware experience). $3-10k/мес.
1. **При Nabu MRR $100k+**: Активация Phase 1 — companion device. Recruiting hardware engineer, ODM partner exploration.
1. **При Phase 1 success**: Поднятие dedicated hardware funding round для Phase 2.

## 12.3. Конкретные next steps (если решено НЕ двигаться сейчас)

1. Документ остаётся как vision artifact для future reference.
1. Industrial design renders создаются (документ 24) — для PR и community engagement, без commitment к разработке.
1. Concept упоминается в Nabu marketing materials как "future possibility" — создаёт anticipation.
1. Revisit decision quarterly. Триггер для re-activation: ≥ 10% of Nabu paying users показывают активный interest.
> Главная истина hardware-продуктов: они выглядят волшебно в концепции и оказываются капец сложными в реальности. Каждая hardware company, которая успешно запустилась — потратила в 2-3 раза больше, чем планировала. Это не повод не делать. Это повод делать с холодной головой и в правильное время.

Дополнение: документ 24 содержит детальный industrial design brief, материалы, эстетику, и промпты для генераторов изображений (Midjourney, DALL-E 3, Flux, Stable Diffusion) для создания концепт-рендеров устройства. Эти renders могут использоваться для community engagement, investor pitches, internal design alignment.
