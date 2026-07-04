# NABU CODEX v2

*Sensor Technology Analysis*  
*Тач-плёнка под бумагой как альтернатива gooseneck-камере*  
*Revised concept, обновлённый Phase 1 (Nabu Slate), обновлённый Phase 2*  
*Версия 1.0 — пересмотр документов 23-24*  

---

# 1. Назначение

Документ — анализ альтернативной concept architecture для Nabu Codex: вместо gooseneck-arm с камерой использовать гибкую тач-плёнку под обычным листом бумаги. Документ пересматривает ключевые технические и стратегические решения из документов 23 (Концепция) и 24 (Design Brief).

Решение значимо. Оно меняет: BOM, form factor, конкурентный анализ, Phase 1 product definition, времена разработки, стратегию ручки, retention dynamics.

> Прямая оценка: это лучший подход, чем gooseneck+камера. Технически проще, дешевле, точнее, требует меньше энергии, имеет established supply chain. Это меняет несколько компонентов стратегии Nabu Codex в правильном направлении.

# 2. Резюме и рекомендация

## 2.1. Главные выводы

1. **Технология sensing-under-paper — proven**: Wacom Bamboo Slate, Moleskine Smart Writing Set, Royole RoWrite, Neo Smartpen — все используют вариации. Рынок принял.
1. **Точность выше, чем у camera+OCR**: stroke data (97-98% accuracy) против image OCR (85-92%).
1. **Энергопотребление меньше в десятки раз**: EMR sensor + Bluetooth LE = недели работы. Camera + image processing = часы.
1. **Mechanical simplicity огромная**: можно убрать gooseneck arm как primary capture mechanism. Дизайн elegantly тоньше.
1. **Established supply chain**: Wacom уже license EMR technology, ODM партнёры в Шенжене знают эту категорию.
1. **Compromise — специальная ручка**: для best accuracy (EMR) нужна passive pen, не любая ballpoint. Mitigation: premium pen as brand artifact, не commodity.

## 2.2. Рекомендация

> Принять revised concept. Phase 1 переопределить как **Nabu Slate** ($99-179) — EMR sensor pad + premium pen + leather folder + Nabu app. Phase 2 (Full Codex) — кожаный блокнот с интегрированным EMR sensor + e-ink на back cover, БЕЗ gooseneck. Camera становится optional Phase 3 accessory для capturing diagrams/sketches/external paper. Гибкая запись будет основной — UX significantly cleaner.

# 3. Технологии sensing-under-paper

Четыре основные технологии. Каждая со своими trade-offs. Краткий обзор перед углублённым сравнением.

## 3.1. Wacom EMR (Electromagnetic Resonance)

**Как работает**: тонкая sensor board под бумагой содержит coil grid. Pen — passive (без батареи), содержит resonance circuit. Sensor board emits low-power EM field, pen резонирует и возвращает signal обратно с координатами и pressure level.

**Кто использует**: Wacom Bamboo Slate/Folio, Wacom Intuos Pro, Samsung S Pen, многие e-ink writers с stylus support.

| **Параметр** | **Значение** |
| --- | --- |
| Точность | 0.1mm (industry-leading) |
| Pressure sensitivity | 4096 levels (Wacom standard) |
| Tilt sensitivity | Да (более новые версии) |
| Hover detection | Да (на 5-10mm) |
| Pen battery | Не нужна (passive) |
| Sensor battery в режиме standby | Месяцы |
| Sensor battery в активной работе | 10-30 часов |
| Толщина sensor board | 1-3 mm (можно сделать ~0.5 mm с компромиссом) |
| Гибкость | Limited — обычно жёсткая плата (хотя есть semi-flex варианты) |
| Через бумагу | До 5-7 листов нормальной бумаги (~0.5 mm) |
| BOM cost | Sensor board A5: $25-45. Pen: $15-40 (OEM cost) |
| Лицензирование | Wacom лицензирует Wacom Feel IT через Wacom EMR. Есть OEM альтернативы (Synaptics, N-trig) |

## 3.2. FSR (Force-Sensing Resistor) Matrix

**Как работает**: матрица force-sensitive resistors под бумагой. Когда пользователь нажимает ручкой через бумагу, FSR в этом месте меняет сопротивление. Система определяет coordinates по тому, какой FSR активен.

**Кто использует**: ранние графические планшеты, некоторые drum pads, специализированные solutions.

| **Параметр** | **Значение** |
| --- | --- |
| Точность | Зависит от resolution. Дешёвая 10×10 grid = ~15mm. Высокого class 100×100 = ~1.5mm |
| Pressure sensitivity | Да, но coarse |
| Pen requirements | Любая ручка работает (просто давление) |
| Required force | Significant (1-2 Newton). Лёгкое письмо может не регистрироваться |
| Battery | Только для controller |
| Толщина | Обычно 1-2 mm, гибкая |
| Гибкость | Высокая (полностью flex sheet possible) |
| Многоточечность | Limited |
| BOM cost | Cheap version (low res): $10-25. High res: $40-80 |

**Verdict для Nabu**: too coarse для handwriting recognition. Уверенно работает для simple gestures, но letters/cursive — challenge. Skip.

## 3.3. Piezoelectric Film

**Как работает**: гибкая плёнка из piezoelectric материала (PVDF) генерирует electric charge proportional to applied pressure. Multiple ions/electrodes mapped как grid.

**Кто использует**: Royole RoWrite (косвенно), некоторые music apps, force-touch sensors.

| **Параметр** | **Значение** |
| --- | --- |
| Точность | Средняя — 2-5mm typical |
| Pressure sensitivity | Хорошая (analog, не discrete levels) |
| Pen requirements | Любая ручка |
| Required force | Light to moderate |
| Battery | Только для controller |
| Толщина | Менее 0.5 mm (полностью flex) |
| Гибкость | Очень высокая |
| BOM cost | $30-70 для A5 size |
| Long-term reliability | Несколько вопросов — material fatigue со временем |

**Verdict для Nabu**: интересный compromise. Любая ручка, гибкая плёнка, разумная точность. Но: established supply chain слабее EMR; long-term reliability less proven; handwriting recognition будет слабее vector data.

## 3.4. Capacitive sensing

**Как работает**: capacitive sensor matrix реагирует на проводящие объекты (например, finger or stylus). Бумага — изолятор, поэтому давление через бумагу плохо проходит.

**Verdict для Nabu**: **не работает через бумагу.** Skip.

## 3.5. Сводное сравнение

| **Tech** | **Точность** | **Любая ручка?** | **Гибкость** | **BOM (A5)** | **Recommendation** |
| --- | --- | --- | --- | --- | --- |
| Wacom EMR | 0.1mm | ❌ | Limited | $40-85 | **Primary** — best for handwriting |
| FSR matrix | 1.5-15mm | ✓ | High | $10-80 | Skip — too coarse for cursive |
| Piezo film | 2-5mm | ✓ | Very high | $30-70 | Backup option, если EMR не подходит |
| Capacitive | n/a | n/a | n/a | n/a | Не работает через бумагу |

> Финальная рекомендация по технологии: **Wacom EMR + специальная passive pen**. Это что используют все successful продукты в категории (Wacom Bamboo, Moleskine Smart, Samsung S Pen). Точность optimal, energy lowest, supply chain established, premium aesthetic возможен.

# 4. Стратегия специальной ручки

EMR требует passive pen. Это compromise — пользователь не может использовать любую ручку. Однако, это можно превратить из minus в plus.

## 4.1. Что значит «специальная passive pen»

1. Внутри — простая resonance circuit (coil + capacitor). Без battery, без electronics.
1. Снаружи — может выглядеть как любая ручка. Premium design без compromises.
1. Refillable ink (стандартные ballpoint refills D1 или Parker style).
1. Никакой зарядки, никаких индикаторов, никакого Bluetooth pairing.
1. Себестоимость OEM: $15-40 для good quality. Retail accessory: $50-80.

## 4.2. Дизайн ручки как brand artifact

Большинство smart-pen решений (Wacom, Moleskine, Royole) — это generic-looking ручки. Нет премиум-ощущения. Это opportunity.

Дизайн направление для Nabu Pen:

- **Кожаное обмотанное body** или solid brass с patina — premium feel
- **Тяжесть** — well-balanced, серьёзная (как Lamy 2000 или Faber-Castell premium)
- **Replaceable ink refill** — стандартные D1 mini refills (доступны в любом stationery store)
- **Минимальный logo** — discreet, engraved, не printed
- **Magnetic park** — встроенный в leather folder Codex для secure storage

## 4.3. Multiple pen options

Pen line как accessory range (Phase 2+):

| **Pen** | **Цена** | **Material** | **Positioning** |
| --- | --- | --- | --- |
| Nabu Pen Classic | $59 | Brass + leather wrap | Default included with Codex |
| Nabu Pen Light | $49 | Aluminum + soft-touch | For users preferring lighter weight |
| Nabu Pen Sterling | $129 | Sterling silver | Premium accessory |
| Nabu Pen Damascus | $249 | Damascus steel | Limited edition (Phase 2.5) |
| Replacement refills (pack of 5) | $15 | D1 standard ink | Recurring accessory revenue |

## 4.4. «Loses-the-pen» проблема

Это реальная проблема (Wacom user feedback). Mitigations:

1. Magnetic park slot в leather folder (Codex always has its pen)
1. Pen tied with leather cord to folder (optional)
1. Affordable replacement at $50-60 (not catastrophic)
1. Pen can be ordered with phone tap (NFC tag in pen → orders via Nabu app)
1. Multiple pens included with Codex (2 pens) — backup always available
> Pen становится first-class accessory product. Не commodity. Может generate ongoing revenue (refills + premium upgrades) и быть marketing artifact.

# 5. Revised Phase 1 — Nabu Slate

## 5.1. Концепция

Phase 1 product теперь — **Nabu Slate**: minimal companion device, который держит лист обычной бумаги (или small notebook) и captures handwriting через EMR sensor под paper. Pairs с Nabu app on phone.

## 5.2. Form factor

1. **Размер**: A5+ (240×170mm — slightly larger than paper для holder bezel)
1. **Толщина**: 6-9 mm (тонкий)
1. **Вес**: 280-380g
1. **Construction**: thin metallic frame, leather wrap exterior, EMR sensor + battery + Bluetooth internal
1. **Paper holding**: spring-loaded clip at top + magnetic strips along edges (paper stays flat)
1. **Paper compatible**: любая стандартная бумага up to 0.3mm thickness (most notepad pages)
1. **Up to 5-7 sheets at once** (multi-page notebooks work fine)

## 5.3. Hardware specs

| **Компонент** | **Спецификация** |
| --- | --- |
| EMR sensor | Wacom EMR licensed or OEM equivalent. A5 size. |
| Bluetooth | 5.2 LE для stroke data streaming |
| Battery | 1000-1500 mAh LiPo (3-4 weeks active use) |
| Charging | USB-C (10-15 watt fast charging, full charge in 1 hour) |
| Storage | Local 1GB flash для offline strokes buffer |
| MCU | Nordic nRF52840 or similar (ARM Cortex-M4) |
| Indicator | Single subtle LED — battery/pairing status |
| Buttons | Single power button + force-press wakeup |
| Pen storage | Magnetic slot along right side |
| Cable | Нет (полностью wireless) |

## 5.4. Material и дизайн

1. **Exterior**: premium leather wrap (cognac, midnight black, forest green — same colors as full Codex)
1. **Frame**: machined aluminum (anodized matching color)
1. **Top edge**: brass clip holder for paper
1. **Bottom edge**: USB-C charge port + single power button
1. **Logo**: discreet Nabu wordmark embossed on back

## 5.5. BOM and pricing

| **Component** | **Cost (USD)** | **Notes** |
| --- | --- | --- |
| EMR sensor board (A5) | $30-50 | Licensed or OEM |
| Premium leather wrap | $15-30 |  |
| Aluminum frame | $8-15 | CNC machined |
| Brass paper clip | $3-7 |  |
| MCU + electronics | $8-15 |  |
| Battery + BMS | $10-15 |  |
| Bluetooth module | $3-5 | Может быть integrated в MCU |
| USB-C port + cabling | $2-4 |  |
| Magnetic strips для paper hold | $2-4 |  |
| Premium pen (включена) | $15-25 | OEM cost |
| Assembly + miscellaneous | $10-20 |  |
| Packaging | $10-15 | Premium box experience |
| **BOM total** | **$116-205** |  |
| Manufacturing overhead (20%) | $23-41 |  |
| **Effective cost per unit** | **$139-246** |  |
| **Retail price (Kickstarter)** | $249-349 | Early bird tiers |
| **Retail price (DTC)** | $299-449 | Standard |
| **Retail price (channel)** | $399-599 | Through retail partners |

## 5.6. Сравнение с предыдущим Phase 1 (gooseneck companion)

| **Aspect** | **Previous (gooseneck camera)** | **Revised (EMR sensor)** |
| --- | --- | --- |
| BOM cost | $80-150 | $116-205 (with pen) |
| Development cost | $1-2M | $0.8-1.5M (simpler) |
| Time to market | 12-18 months | 9-14 months (simpler tech) |
| Battery life | 8-12 hours | 3-4 weeks |
| Mechanical complexity | High (gooseneck mechanism) | Low (flat slate) |
| Accuracy of capture | 85-92% (image OCR) | 97-98% (stroke data) |
| UX complexity | Camera positioning concerns | None — just write |
| Light dependency | Yes (LED + ambient) | No |
| Weight | 350-500g | 280-380g |
| Retail price target | $299-499 | $249-449 |

> По каждому measurable axis revised Phase 1 wins. Меньше cost, меньше development, меньше время, лучше accuracy, лучше battery, проще UX. Это явно лучший подход.

# 6. Revised Phase 2 — Full Codex

## 6.1. Изменённая концепция

Phase 2 Codex теперь — кожаный блокнот с интегрированными:

1. EMR sensor под paper insert (как Phase 1 Slate, но built-in)
1. E-ink touchscreen на back cover (для Nabu interface, browsing notes, AI chat)
1. LTE + WiFi для standalone connectivity
1. Local Nabu client с meaningful AI capabilities (NPU-accelerated small models)
1. Premium pen with magnetic park
1. **БЕЗ** gooseneck, **БЕЗ** primary camera, **БЕЗ** pico projector

## 6.2. Form factor

1. **Закрытый размер**: 220×155×15-18mm (significantly thinner than gooseneck version)
1. **Вес**: 500-650g
1. **Open flat**: 180° comfortable writing position
1. **Paper insert**: spring-loaded mechanism, replaceable. Stone paper 80-120 sheets
1. **E-ink on back cover**: 7.8" display visible when device open
1. **Pen storage**: magnetic slot along spine

## 6.3. Revised BOM для Full Codex

| **Component** | **Cost (USD)** | **Notes** |
| --- | --- | --- |
| Premium leather binding | $30-80 | Same as before |
| Stone paper insert (80-120 sheets) | $15-30 | Same |
| Brass clasps + details | $5-15 | Same |
| EMR sensor (A5, integrated) | $30-50 | **New** — replaces gooseneck |
| E-ink 7.8" touchscreen | $80-130 | Slightly smaller than previously planned |
| Rockchip RK3588 + 8GB RAM + 64GB storage | $80-120 | Same |
| LTE Cat 4 module | $30-50 | Same |
| WiFi 6 + BT 5 | $10-15 | Same |
| Battery 4000mAh | $20-30 | Smaller — no gooseneck draw |
| MCU + supporting electronics | $15-25 |  |
| PCB + assembly | $25-50 | Simpler без gooseneck |
| Microphone array | $5-10 | Для voice optional |
| Premium pen (included) | $15-25 | Same as Slate |
| Cables, magnets, mechanical | $8-15 |  |
| Premium packaging | $15-30 |  |
| **BOM (с gooseneck removed)** | **$383-678** | vs prev $481-871 |
| **Savings vs prev concept** | **~$98-193 per unit** |  |
| Manufacturing overhead (25%) | $96-170 |  |
| **Effective cost per unit** | **$479-848** |  |
| **Retail price (DTC)** | $1199-1599 | Down from $1250-1750 |
| **Retail price (channel)** | $1499-1999 | Down from $1750-2450 |

## 6.4. Сравнение Phase 2 versions

| **Aspect** | **Previous (with gooseneck)** | **Revised (with EMR)** |
| --- | --- | --- |
| BOM range | $481-871 | $383-678 |
| Form factor thickness | 20-25mm | 15-18mm |
| Weight | 600-750g | 500-650g |
| Battery life | 6-12 hours | 12-30 hours |
| Mechanical complexity | Very high | Moderate |
| Development cost | $5-10M | $3.5-7M |
| Time to market | 24-36 months | 20-30 months |
| Retail price (DTC) | $1250-1750 | $1199-1599 |
| Margins (3.5× BOM) | 30-40% | 35-45% |
| Capture accuracy | 85-92% | 97-98% |
| Use case for sketches | Native via camera | Via optional camera accessory (Phase 3) |

> Revised Phase 2 — это более достижимый продукт. Меньше capital, меньше времени, лучше economics, simpler engineering. Главное trade-off: capture sketches/diagrams требует add-on accessory. Это разумно для majority use cases.

# 7. Updated competitive landscape

## 7.1. Прямые конкуренты revised concept

| **Product** | **Price** | **Tech** | **Сравнение с Nabu Slate/Codex** |
| --- | --- | --- | --- |
| Wacom Bamboo Slate | $130-180 | EMR + paper holder | Direct competitor. Generic look. No AI integration. Wacom Inkspace app — basic. Subscription required для cloud features. |
| Wacom Bamboo Folio | $180-230 | EMR + leather portfolio | Closer to our concept aesthetically. Same software limitations. |
| Moleskine Smart Writing Set | $200-250 | Pen+ with IR camera + special paper | Premium positioning. Uses Moleskine paper (proprietary). Pen has battery. |
| Royole RoWrite 2 | $130-180 | Piezo film + pen with pressure sensor | Works with any paper. Pen has battery. Slightly cheaper. |
| Neo Smartpen Dimo | $170 | IR pen + special Ncode paper | Special paper requirement annoying. Good accuracy. |
| iSKN Repaper | $170-200 | Magnetic ring + slate | Targeted at artists. Different use case. |
| NUboard Smart Tablet | $110-150 | Touch capacitive (no pen) | Different segment — children/students. |
| Sony DPT-CP1 | $600 | E-ink writer | Different category — full reader, not paper-based. |
| ReMarkable 2 / Paper Pro | $300-600 | E-ink writer | Different category — replaces paper, not augments it. |

## 7.2. Where Nabu Slate differentiates

Технология commodity. Differentiation должно прийти от software и positioning.

1. **Local-first privacy**: Wacom Inkspace, Moleskine Notes, Neo Lab — все cloud-first с vendor lock. Nabu — local-first, экспорт в Markdown в любой момент.
1. **AI-agent integration**: Wacom Inkspace в лучшем case — basic transcription. Nabu's 44 агента обрабатывают handwriting через entity extraction, linker, knowledge graph integration.
1. **Privacy categories**: уникально для Nabu — therapy entries автоматически идут только через local Ollama, не в cloud.
1. **Premium pen design**: большинство конкурентов имеют generic pens. Nabu Pen — accessory с brand-defining design.
1. **Multi-product ecosystem**: Slate бесшовно работает с Nabu app, web, и в future Codex. Wacom Slate работает только с Wacom apps.

## 7.3. Что от конкурентов нужно учитывать

- **Wacom EMR licensing**: рассмотреть direct licensing или OEM от Wacom-партнёров. Может быть proprietary в России — потребует exploration.
- **Royole показал**: можно использовать piezo film с любой ручкой за $130. Это floor цены для функционального продукта.
- **Moleskine premium positioning** при $200 — proven рынок для premium тіра.
- **Generic-looking competitors** дают opportunity differentiate через design.

# 8. UX implications

## 8.1. Что становится лучше

1. **No camera positioning**: пользователь просто пишет, ничего не настраивает
1. **No light required**: работает в темноте, в кафе, в постели
1. **Instant recognition**: stroke data immediately processable, нет шага OCR с задержкой
1. **Pressure sensitivity**: можно различать thick/thin strokes (для каллиграфии, sketches)
1. **Reliable through paper**: 5-7 страниц блокнота normaly, latest page detected
1. **Long battery life**: weeks not hours — премиум feel («don't worry about charging»)
1. **Bluetooth pairing reliability**: BLE более robust than WiFi для small data

## 8.2. Что становится сложнее

1. **Pen dependency**: использовать обычную ручку = no capture. Это shift mental model для users
1. **Pen replacement cost**: lose-the-pen = $50 replacement. Some Wacom users complaint
1. **Sketch capture**: drawings with marker, pencil, или multiple colors — не captured (only pen strokes detected). Решение через optional camera Phase 3
1. **Multi-color writing**: невозможно (pen = one ink color)
1. **Existing notes capture**: если у пользователя is notebook full of pre-existing handwriting — Slate не help. Решение: phone camera через Nabu app

## 8.3. Specific workflow examples

### 8.3.1. Утренний journal entry

Пользователь открывает Nabu Slate, кладёт лист бумаги (или свой блокнот) под clip, берёт pen. Пишет 2 page journal entry. Slate captures каждый stroke. Через Bluetooth strokes доходят до Nabu app on phone. AI обрабатывает text → entity extraction, mood analysis, suggests links to past entries. Через 30 секунд после finishing — пользователь видит enriched note в app.

### 8.3.2. Therapy room session

Пользователь использует Slate с paper marked как «private» в Nabu app. Stroke data передаётся через Bluetooth прямо в local processing (через Nabu app, который route через local Ollama). Никогда не отправляется в cloud. Обрабатывается CBT-агентом локально. Insights shown в app. Privacy fully maintained.

### 8.3.3. Meeting notes

В meeting пользователь пишет notes в обычном A5 spiral notebook. Под notebook кладёт Nabu Slate (clip держит блокнот). Notes сразу appear в Nabu. После meeting — agents автоматически extract action items, link to relevant projects, propose follow-ups.

# 9. What's lost vs camera approach

Honest assessment что нельзя сделать с EMR-only approach.

## 9.1. Capture других ручек / маркеров / pencils

EMR detects only EMR-pen. Если пользователь предпочитает fountain pen, mechanical pencil, marker — strokes не captured.

**Mitigation**:

1. Большинство users соглашаются использовать specific pen для smart-notebook UX
1. Premium pen options сomeчают this acceptable
1. **Optional Phase 3 accessory**: clip-on camera attachment для capturing non-EMR writing

## 9.2. Capture drawings, sketches, diagrams

EMR captures strokes — but без color, без cross-hatching textures, без brush dynamics.

**Mitigation**:

1. Most Nabu use cases — text journaling, not artistic
1. For users with sketch needs — Phase 3 camera accessory или mobile phone capture
1. In Codex Phase 2 — optional flip-out mini camera in spine area? Add-on $50-100, optional

## 9.3. Capture existing written-elsewhere content

Если пользователь wants to digitize old notebook full of writing — Slate doesn't help.

**Mitigation**:

1. Nabu mobile app camera-based scanning (already in spec FR-7004)
1. Это standard feature любого PKM app, expected, не competitive disadvantage

## 9.4. Multi-color highlighting

EMR pen — one color. Highlighters / multi-pen workflows не natively supported.

**Mitigation**:

1. Digital highlighting / colored tags после capture (в Nabu app)
1. Use sticky notes or marginalia notation system, captured as text
1. Premium accessory: secondary highlight pen with different ID (EMR resonator at different frequency) — sophisticated but possible

## 9.5. Что compensates losses

Вышеуказанные losses — relevant для 5-15% of users (artists, multi-pen enthusiasts, scrapbookers). Gains apply к 100% users. Trade-off heavily favorable.

# 10. Updated phased roadmap

## 10.1. Phase 0 — Validation (now)

1. Renders нового concept (см. §12 для updated image generation prompts)
1. User research: "Would you buy Nabu Slate at $249-449?"
1. Hardware partner exploration: Wacom EMR licensing options, ODM partners в Шенжене с EMR experience
1. Cost: $30-60k

## 10.2. Phase 1 — Nabu Slate (Year 2 после Nabu PMF)

1. **Product**: EMR sensor pad + premium pen + leather folder. No e-ink, no LTE. Pairs with Nabu app on phone/desktop.
1. **Price**: $249-449 (range based on materials tier)
1. **Development**: $0.8-1.5M, 9-14 months
1. **Manufacturing**: ODM partnership in Asia (multiple options exist)
1. **Launch**: Kickstarter or limited pre-order через Nabu community, потом retail
1. **Target**: 3000-7000 units Year 1

## 10.3. Phase 2 — Nabu Codex (Year 3-4)

1. **Product**: Full premium leather notebook with integrated EMR sensor, e-ink touchscreen, LTE, local Nabu client, premium pen
1. **Price**: $1199-1599 DTC
1. **Development**: $3.5-7M, 20-30 months
1. **Target**: 5000-10000 units Year 1

## 10.4. Phase 2.5 — Limited Edition Codex

1. Same as previous strategy: 100-500 units, exotic materials, $3000-5000

## 10.5. Phase 3 — Camera Accessory (Year 4-5, if demand)

1. **Product**: Clip-on camera attachment для Codex (или Slate) для capturing non-EMR writing, sketches, external paper
1. **Price**: $99-199 accessory
1. **Development**: $0.5-1M, 6-12 months
1. **Activation trigger**: ≥15% of Codex/Slate users explicitly request это feature

## 10.6. Phase 3 — Codex Lite (Year 5-7)

1. Cost-reduced variant Codex — without LTE, smaller e-ink, simpler materials
1. **Price**: $499-799
1. **Target mass market**

## 10.7. Total funding requirements (revised)

| **Phase** | **Capital** | **Source** |
| --- | --- | --- |
| Phase 0 — Validation | $30-60k | Internal cash flow |
| Phase 1 — Slate | $0.8-1.5M | Crowdfunding + small VC |
| Phase 2 — Codex | $3.5-7M | Series B |
| Phase 2.5 — LE | Within Phase 2 |  |
| Phase 3 — Camera accessory | $0.5-1M | Cash flow |
| Phase 3 — Lite | $2-4M | Cash flow + debt |
| **Total over 5-7 years** | **$7-14M** | **Reduced from $10-17M previous estimate** |

# 11. Updated naming считерации

## 11.1. Phase 1 product naming

Previous: "Nabu Codex Scanner" или "Nabu Quill". Now product changed — давайте пересмотрим.

| **Candidate** | **Assessment** |
| --- | --- |
| **Nabu Slate** | Direct, functional. Slate как surface for writing. Easy to pronounce. **Top pick.** |
| Nabu Tablet | Confusing (associated с iPad-style tablets) |
| Nabu Pad | Generic. Like ThinkPad. OK but уступает Slate. |
| Nabu Scribe | Aесthetically nice. Bit too on-the-nose. |
| Nabu Folio | Conflicts с premium notebook category. Reserve для future. |
| Nabu Vellum | Too obscure для mass market. |

> Рекомендация: **Nabu Slate** для Phase 1, **Nabu Codex** для Phase 2 (Full notebook). Линейка: Nabu Slate (slate companion) → Nabu Codex (full notebook) → Nabu Codex Lite (mass market). Pen aksessuары: Nabu Pen Classic / Light / Sterling / Damascus.

# 12. Updated image generation prompts

Документ 24 содержит промпты для concept с gooseneck. Они нуждаются в обновлении под revised concept. Здесь — updated prompts для главных shots.

## 12.1. Nabu Slate — Hero Shot

```
Premium thin smart writing slate, leather-wrapped exterior in deep cognac brown, A5 size, sitting on dark walnut desk. The slate is approximately 8mm thick. A sheet of cream-colored paper is held in place by a brass clip at the top. A premium-looking pen (brass body with leather wrap) lies in a magnetic side slot. Subtle minimalist branding embossed on the back, barely visible. Soft window light from left side, professional commercial product photography, museum quality, sharp focus on leather and brass details, shallow depth of field, no fake brand logos --ar 4:3 --style raw --v 6 --s 100
```

## 12.2. Nabu Slate — In Use

```
A person's hand writing in a small notebook placed on top of a premium leather-wrapped smart slate. The slate is barely visible underneath, just a hint of leather edge showing. The hand holds an elegant brass-and-leather pen. Cozy café atmosphere in background, slightly blurred. Warm afternoon light from window. The setup looks natural — the slate doesn't dominate, it's a quiet companion. Editorial photography style for design magazine. No faces, focus on hands and tactile experience. --ar 3:2 --style raw --v 6 --s 100
```

## 12.3. Nabu Codex — Hero Shot (revised)

```
Premium leather journal in cognac brown, A5 size, lying open flat at 180 degrees on a wooden desk. The left page is cream stone paper. The right side, which is the inside of the back cover, contains an integrated e-ink display in a brushed bronze bezel showing minimal interface. A brass-and-leather premium pen rests in a magnetic slot along the spine. The book is elegantly thin (15-18mm thick). Soft natural daylight from above. Professional product photography, sharp focus on materials, shallow background blur, no fake logos --ar 16:9 --style raw --v 6 --s 100
```

## 12.4. Pen Lineup

```
Three premium pens displayed in row on dark velvet surface: from left to right, a brass-and-leather pen (cognac wrap), an aluminum minimalist pen (silver finish), and a sterling silver pen with subtle engraving. All pens are similar size, balanced, weighty appearance. Each pen has a Nabu wordmark discretely placed. Studio lighting with single dramatic light from upper right creating subtle highlights. Professional luxury accessory photography, jewel-like presentation --ar 16:9 --style raw --v 6 --s 150
```

## 12.5. Slate Open Showing Tech

```
Cutaway technical illustration of premium leather smart slate, showing layered construction from top to bottom: leather exterior wrap, thin aluminum frame, paper sheet held by brass clip at top, EMR sensor layer (subtle visualization of grid lines), MCU and battery compartment below sensor. Style is half technical-illustration, half product photography. Educational but elegant. Clean white background. Slight isometric perspective. --ar 16:9 --style raw --v 6 --s 80
```

## 12.6. Lifestyle — Working Session

```
A person sitting at a wooden desk in a sun-drenched home office. On the desk: a Nabu Slate (the leather slim slate) holding a notebook, a coffee mug, a vintage paperback, a smartphone slightly to the side showing what appears to be a journaling app interface. The person is writing in the notebook with focus. View from slightly behind, over shoulder. Warm golden afternoon light. Editorial photography for productivity magazine. Aspirational but achievable feel. No tech-overload mood — this is calm productive aesthetic. --ar 3:2 --style raw --v 6 --s 100
```

# 13. Hybrid future — adding camera back-optionally

Документ 23 предлагал gooseneck camera as primary. Revised concept removes camera as primary. Однако, camera может вернуться как optional Phase 3 accessory.

## 13.1. Optional Phase 3 Camera Accessory

**Product**: clip-on camera module that attaches to top of Codex (или Slate) when needed. Активируется когда:

- Capturing pre-existing handwriting from external notebooks
- Sketches and drawings что не EMR pen может сделать
- Photos of objects, references, mixed media
- Documentation шагов какого-то процесса (e.g., recipes, experiments)

## 13.2. Form factor

1. Small clip-on module, ~40×25×15mm
1. Attaches via magnetic / pogo pin connection to Codex/Slate
1. 8-12MP camera + LED ring
1. Adjustable angle (small hinge)
1. Powered by main device (no separate battery)
1. **Price**: $99-149 accessory
1. **Development**: $0.5-1M Phase 3

## 13.3. Why это лучше как accessory чем integrated

1. Most users don't need it — оставляет основной product тонким и elegant
1. Costs не bundled — лишь те, кто хочет, платит
1. Can be improved separately (camera upgrade releases) без обновления main device
1. Modular design = customer customization
> Camera возвращается, но как opt-in accessory для нишевых use cases, не как mandatory tech making device thick and complex. Это win-win.

# 14. Резюме изменений в стратегии Nabu Codex

## 14.1. Что меняется по сравнению с документами 23-24

| **Aspect** | **Documents 23-24** | **Revised (этот документ)** |
| --- | --- | --- |
| Primary capture tech | Gooseneck camera + OCR | EMR sensor под paper |
| Phase 1 name | Nabu Codex Scanner / Quill | **Nabu Slate** |
| Phase 1 price | $299-499 | $249-449 |
| Phase 1 development time | 12-18 months | 9-14 months |
| Phase 2 form factor | 20-25mm thick | 15-18mm thick (gooseneck removed) |
| Phase 2 price (DTC) | $1250-1750 | $1199-1599 |
| Total funding (5-7y) | $10-17M | $7-14M |
| Capture accuracy | 85-92% | 97-98% |
| Battery life (Phase 2) | 6-12 hours | 12-30 hours |
| Pen requirement | Any pen | EMR pen required (positive: premium accessory) |
| Sketch/diagram capture | Native via camera | Via optional Phase 3 camera accessory |

## 14.2. Что НЕ меняется

1. Стратегический approach phased (Phase 0 → 1 → 2 → 2.5 → 3)
1. Timing requirements: Nabu PMF до hardware investment
1. Premium positioning и pricing tier
1. Materials и aesthetic направление (leather, brass, stone paper)
1. Nameing: Nabu Codex для full device
1. Limited Edition strategy (Phase 2.5)
1. Codex Lite strategy для mass market (Phase 3)

## 14.3. Implications для документов 20-24

1. **Документ 20 (Constellation Strategy)**: не затронут. Constellation model остаётся правильной.
1. **Документ 21 (Nabu → KNS Evolution)**: не затронут.
1. **Документ 22 (Final System Vision)**: не затронут.
1. **Документ 23 (Nabu Codex Concept)**: разделы 5 (Технический анализ), 6 (BOM), 7 (Options), 10 (Roadmap) — superseded этим документом. Главные strategic выводы (timing, business case) остаются valid.
1. **Документ 24 (Design Brief & Image Prompts)**: design philosophy остаётся valid. Image prompts требуют update — gooseneck не показывать в renders. Updated prompts в §12 этого документа.

# 15. Next steps

## 15.1. Если решение accept revised concept

1. **Update документации**: создать revised version of doc 23 (или принять doc 25 as canonical для technical strategy)
1. **Generate новые renders** используя prompts из §12
1. **Hardware partner exploration**: Wacom EMR licensing, OEM альтернативы (Synaptics, Novatek). Initial conversations $0 — просто email outreach
1. **User research updated questions**: «Would you buy Nabu Slate (EMR pad + premium pen + leather folder) at $299 for capturing your handwriting to Nabu?»
1. **Pen design exploration**: research luxury pen manufacturers (Italian, German, Japanese) для potential OEM partnerships. Lamy, Faber-Castell, Pilot — все могут OEM premium pen body для EMR resonator

## 15.2. Если хочется hybrid (EMR + optional camera)

1. Это feasible для Phase 2, но adds complexity
1. Better approach: EMR в Phase 1-2, camera as Phase 3 accessory
1. Avoids feature creep at launch

## 15.3. Если хочется оставить gooseneck (original concept)

1. Это legitimate choice если есть strong reasoning beyond convenience
1. **Когда gooseneck-camera имеет смысл**: если main differentiator — capturing existing/random paper sources, multi-pen workflows, sketch-heavy users
1. **Но**: для main use case (journaling, knowledge work, therapy) — EMR strictly better
1. Compromise: small flip-out camera в spine area as backup, главный capture через EMR. Best of both worlds, но adds complexity и cost
> Главный takeaway: предложенная идея (тач-плёнка под бумагой) — это better path для Nabu Codex. Технология proven, экономика лучше, UX cleaner, time to market сокращён. Это улучшение оригинальной концепции, не компромисс. Принять как новый baseline для Phase 1-2 разработки.
