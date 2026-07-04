# NABU CODEX

*Industrial Design Brief*  
*Промпты для генераторов изображений*  
*Midjourney · DALL-E 3 · Flux · Stable Diffusion · Ideogram · Recraft*  
*Версия 1.0*  

---

# 1. Назначение

Документ — industrial design brief для устройства Nabu Codex (концепция в документе 23) и набор промптов для генерации концепт-рендеров. Промпты — production-ready, можно копировать в Midjourney, DALL-E 3, Flux/Stable Diffusion, Ideogram, Recraft.

Использование рендеров: visualization для investor pitches, community engagement в Discord, internal design alignment, PR materials, validation user research (показ потенциальным customers для measure interest).

Все промпты тестировались концептуально на consistency. Реальные результаты потребуют итерации (это нормально для AI-image generation).

> Один важный совет до того, как начнёте генерировать: AI-генераторы часто галлюцинируют hardware details (странные screws, неправильные proportions, fake brand logos). Используйте получаемые images как vision direction для human industrial designer, не как final spec. Это mood, не blueprint.

# 2. Industrial Design Brief

## 2.1. Эстетическое направление

Core mood: премиум артефакт, который мог бы существовать в two еpoхах одновременно — старая европейская manuscript culture (15-19 век) и refined modern minimalism (Apple, Bang & Olufsen, Punkt). Это не "steampunk" и не "futurism". Это "timeless".

Референсы для эстетики:

- **Smythson Panama notebooks** — британский luxury stationery, premium leather binding
- **Vintage maritime logbooks** — морские судовые журналы 19 века с brass clasps
- **Moleskine premium leather collection** — modern interpretation of journaling tradition
- **ReMarkable Paper Pro** — modern e-ink writing aesthetic
- **Punkt MP02** — minimalist Swiss design, без digital noise
- **Daylight Computer DC-1** — soft tactile tech feel
- **Apple Notes book** (прототипы) — refined modern presentation
- **Hermès Ulysse notebook** — luxury craftsmanship
- **Bang & Olufsen Beosound** — concealed technology в premium materials
- **Lego Architecture series** — refined minimalism at scale

## 2.2. Материалы и финиши

| **Зона** | **Материалы и финиши** |
| --- | --- |
| Обложка (внешняя) | Premium natural leather (Italian vegetable-tanned full-grain). Толщина 2-2.5mm. Цвета: deep cognac brown, midnight black, oxblood, forest green. Текстура — slightly pebbled, develops patina with use. |
| Обложка (внутренняя поверхность) | Soft suede lining или дополнительный leather slightly contrasting color. Под e-ink screen — protective bezel из бумажно-композитного материала или soft-touch elastomer. |
| Завязки | Waxed cotton cord (10mm thickness), tied at side. Альтернатива: thin leather strap with brass clasp. |
| Каркас/spine | Reinforced leather over composite внутренний frame. Pружинный binding mechanism для замены paper inserts. |
| Бумага | Stone paper (Karst-equivalent, 120-140 gsm). 80-120 листов A5. Off-white tint (не bleached white) — easier on eyes. |
| E-ink screen bezel | Brushed anodized aluminum thin frame (deep bronze or warm graphite), либо leather-wrapped seamlessly into binding. |
| Brass accents | Real brass (не plated): hinge fittings, gooseneck base attachment, USB-C port surround, side button. Develops natural patina. |
| Gooseneck arm | Outer sheath — full-grain leather wrapped over flexible metal core. Length 200-280mm. Diameter 8-10mm. |
| Gooseneck head (camera+LED housing) | Solid machined aluminum, soft-touch coated в matching цвет обложки. Subtle Nabu logo etched, не printed. |
| Buttons/controls | Minimal — power button (capacitive в leather), volume rocker (avoided если можно — only essential controls). |
| Underside / bottom | Smooth leather, без обозначений (или discrete signature). Possible: serial number в Roman numerals для premium aesthetic. |

## 2.3. Цветовая палитра

Три core color schemes для launch:

| **Edition** | **Цвета** | **Аудитория** |
| --- | --- | --- |
| Sailor's Log (default) | Deep cognac leather + brass accents + warm cream paper + bronze bezel | Maritime/journaling aesthetic, classical |
| Midnight Reader | Midnight black leather + warm graphite accents + warm cream paper + dark bronze bezel | Modern minimalist, urban |
| Forest Wanderer | Forest green leather + brass accents + off-white paper + bronze bezel | Natural, outdoor-inspired |

Limited edition (Phase 2.5): oxblood red, exotic leathers (croco, ostrich), hand-engraved brass.

## 2.4. Эргономика

1. **Размер закрытый**: 220×155×25mm (A5 + thickness)
1. **Вес**: 600-750g (с full equipment). Это heavier than ReMarkable (403g), но reflects premium materials
1. **Открытие**: 180° flat opening для comfortable writing. No spring resistance.
1. **E-ink screen position**: на задней обложке (когда открыт — справа от пользователя для правшей, левый layout для левшей через app setting)
1. **Gooseneck base attachment**: в верхней части spine (центр top edge), не сбоку — даёт maximum freedom positioning над paper
1. **Gooseneck при закрытии**: lays внутри special channel в spine, не торчит наружу. Pulls out с smooth tactile click.
1. **Charging port**: USB-C, на нижнем edge spine. Magnetic alternative — desirable but $$
1. **Camera position when writing**: head positioned 200-250mm above paper at 45-60° angle, viewing entire page from one side

## 2.5. Typography & graphical language

1. **Nabu logo**: minimalist wordmark, классическая serif (например, custom версия Italian Stone Serif или Sabon). Embossed в leather, не printed.
1. **E-ink UI typography**: humanist serif для long-form reading (PT Serif, Source Serif), clean sans-serif для UI elements (Inter, Söhne).
1. **Iconography**: line icons, 1.5pt stroke, minimal. Tarot/medieval manuscript influences для symbols (e.g., ritual icons если KNS mode).
1. **Reference style**: think "premium scientific instrument from 1920s", не "modern tech gadget".

## 2.6. Packaging

Premium unboxing experience. Cost target: $15-25 per unit.

1. Внешний box — minimal Kraft cardboard или soft-touch matte black, embossed Nabu wordmark, no images.
1. Inside reveal layer — papered insert holding device suspended (foam замаскированный).
1. Accessory compartment — Smith-paper envelope с: USB-C cable (braided), quick start card (letterpress!), warranty card (parchment-style stock), microfiber cloth (для e-ink).
1. Inside lid — printed manifesto или quote (small, handwritten-style). Personalization opportunity.
1. Smell: leather + slight cedar/sandalwood note (если возможно при packaging). Brand sensory experience.

# 3. Общие принципы для всех промптов

## 3.1. Стилевые директивы (use across all generators)

- **Photorealistic product photography** — основной стиль, не cartoon / illustration
- **Studio lighting** — soft key + fill + rim, не harsh shadows
- **Shallow depth of field** — subject sharp, background soft blur
- **Neutral background** — warm white или soft gradient, иногда контекстуальный desk
- **Premium materials emphasis** — leather grain, brass patina, metallic finish visible
- **No people unless lifestyle shot** — keep focus on product
- **Professional commercial aesthetic** — Apple/B&O quality bar

## 3.2. Что НЕ генерировать (negative directives)

- **No fake brand logos** — Apple, Google, etc. (generate without recognizable IP)
- **No cartoonish elements** — это product, не toy
- **No futuristic gimmicks** — holographics, neon, sci-fi
- **No human hands holding device** в hero shots (только в lifestyle shots)
- **No text on screen** в большинстве shots (e-ink images often render badly)
- **No fictional ports** или AI-hallucinated buttons. Если используете AI и видите weird connectors — flag, ask designer.

## 3.3. Параметры размеров/aspect ratio для разных use cases

| **Use case** | **Aspect ratio** | **Замечания** |
| --- | --- | --- |
| Hero shot (landing page) | 16:9 или 21:9 | Wide cinematic |
| Product detail (web) | 1:1 (square) | Instagram-friendly |
| Vertical mobile/Stories | 9:16 | Mobile-first |
| Editorial / lifestyle | 3:2 или 4:3 | Photography standard |
| Technical render | 4:3 или 16:9 | Engineering review |
| Print materials | Match print spec | Usually 2:3 or A4 |

# 4. Промпты для Midjourney v6

Midjourney v6 best for: highly stylized commercial photography, dramatic lighting, premium product aesthetics.

Syntax: append --ar X:Y --style raw --v 6 to all prompts. Use --s 50-150 для commercial look (lower stylization).

## 4.1. Hero Shot — Closed Notebook, Front View

```
Premium leather notebook in maritime logbook style, deep cognac brown full-grain Italian leather, embossed minimalist serif logo "NABU", brass clasps and waxed cotton tie cord, A5 size, slight patina, sitting on dark walnut desk, soft window light from left, professional product photography, hasselblad style, sharp focus on leather grain texture, shallow depth of field, museum quality, no text visible --ar 4:3 --style raw --v 6 --s 100
```

## 4.2. Hero Shot — Closed Notebook, 3/4 View, Dramatic

```
Closed premium leather journal, three-quarter angle view, deep midnight black full-grain leather with subtle visible texture, brass hinge details, slim e-ink screen edge visible on back cover, waxed black cord wrapped around device twice, dramatic chiaroscuro lighting on dark velvet surface, single warm light source from upper right, deep shadows, cinematic product photography, KeyShot render quality, ultra-realistic materials --ar 16:9 --style raw --v 6 --s 150
```

## 4.3. Open Notebook with E-ink Screen Visible

```
Premium leather notebook opened flat at 180 degrees, A5 size, cognac brown leather covers, left page is cream stone paper with handwriting marks, right side back cover features integrated e-ink display showing minimal interface with text columns, brushed bronze bezel around screen, soft natural daylight from above, top-down 45-degree angle view, sharp detail on screen and paper texture, product photography for technology magazine, no fake logos, no recognizable brands --ar 16:9 --style raw --v 6 --s 80
```

## 4.4. Detail Shot — Gooseneck Arm with Camera/LED

```
Macro product detail shot: flexible gooseneck arm wrapped in leather extending from top of premium notebook, terminating in oval head module with embedded camera lens and warm LED ring light, machined aluminum housing in dark bronze finish, capacitive touch surface on outer face, the arm curves elegantly above blank stone paper page, soft warm side lighting catching brass detail, extremely sharp focus on camera lens reflection, depth of field shallow background, cinematic product photography, Bang & Olufsen aesthetic --ar 3:2 --style raw --v 6 --s 120
```

## 4.5. Lifestyle — Person Writing

```
Lifestyle photography, person's hands writing with fountain pen in premium leather notebook, gooseneck camera arm with LED light positioned above paper from upper right, capturing handwriting, person wearing wool sweater, cozy library setting with bookshelves blurred background, late afternoon golden hour window light, editorial photography style for The New Yorker or Monocle magazine, no faces visible, focus on hands and device, deeply human moment, photography by Annie Leibovitz style --ar 3:2 --style raw --v 6 --s 100
```

## 4.6. Product on Desk — Contextual Scene

```
Premium leather notebook closed on minimalist wooden desk, deep cognac leather with brass clasps, accompanied by vintage fountain pen, antique brass paperweight, leather-bound classic books stacked nearby, soft morning light from window, marble coffee cup steaming gently, scholarly atmosphere, warm color palette, editorial photography for design magazine, shallow depth of field with notebook in sharp focus, slightly elevated viewing angle, museum-quality product staging --ar 16:9 --style raw --v 6 --s 100
```

## 4.7. Side Profile — Thickness View

```
Side profile view of closed premium leather notebook, showing thickness and binding details, cognac leather covers visible from edge, waxed cotton cord tied around middle, brass hinge mechanism visible, gooseneck arm tucked into integrated channel along spine, USB-C port subtly visible on bottom edge, photographed against clean white background with soft shadow, technical product photography, perfectly straight horizontal alignment, sharp throughout --ar 21:9 --style raw --v 6 --s 80
```

## 4.8. Exploded View — Technical Render

```
Exploded technical product diagram of premium leather notebook revealing internal components, components arranged vertically with thin connecting lines, showing: leather outer cover, internal frame structure, e-ink touch display module, circuit board with visible silicon chip, lithium battery, gooseneck arm assembly, stone paper insert, brass hardware components, photorealistic 3D render with soft studio lighting on white background, KeyShot render style, engineering documentation aesthetic, premium aerospace catalog quality --ar 4:3 --style raw --v 6 --s 60
```

## 4.9. Limited Edition Variant

```
Ultra-premium leather notebook limited edition, deep oxblood red full-grain leather with gold leaf embossed details, ornate brass hardware with subtle engraving, presentation case lined with crimson silk visible behind, dramatic museum-quality display lighting, single spotlight from above, deep velvet black background, jewel-like quality, advertising photography for Hermès or Cartier, ultra-luxurious presentation, no visible text or logos --ar 4:5 --style raw --v 6 --s 200
```

# 5. Промпты для DALL-E 3 (ChatGPT/Bing)

DALL-E 3 best for: natural language descriptions, scene composition, lifestyle scenarios. Better at following complex instructions than at premium aesthetic finish.

Tip: pre-pend 'Generate this without any text, logos, or branding visible:' to avoid hallucinated brand names.

## 5.1. Hero Shot — Closed Notebook

```
A premium A5-sized leather-bound notebook in deep cognac brown color, styled like a vintage maritime ship's logbook. The leather is full-grain Italian, slightly textured. Brass clasps secure it closed. A waxed cotton cord is tied around the middle. The notebook sits on a polished walnut desk surface. Soft natural light comes from the left side. Professional product photography style with shallow depth of field. The notebook is centered in the frame, photographed from a slightly elevated 30-degree angle. No text or logos should be visible. The image should evoke timeless craftsmanship and refined sophistication.
```

## 5.2. Open Notebook with E-ink Display

```
A premium leather notebook lying open flat at 180 degrees on a wooden desk. The left page is cream-colored stone paper with subtle texture. The right side, which is the inside of the back cover, contains an integrated electronic ink display showing a minimal interface with two columns of dark text on a paper-like background. The screen has a thin brushed bronze metal bezel around it. The notebook is in deep cognac brown leather. Photographed from above at a 45-degree angle. Natural daylight illuminates the scene. Professional technology product photography. Focus is sharp on both pages. No fake logos or brand names visible.
```

## 5.3. Detail Shot — Gooseneck Camera Arm

```
Close-up macro photograph of a flexible gooseneck arm extending from the top of a premium leather notebook. The arm is wrapped in matching cognac leather over a flexible metal core. At the end of the arm is an oval-shaped head module made of machined dark bronze aluminum. The head contains a camera lens and a ring of warm LED lights around the camera. The outer surface of the head has a subtle capacitive touch area. The arm curves gracefully over a blank page of cream stone paper. Warm side lighting catches the bronze metal. Extremely sharp focus on the camera lens with shallow depth of field. Premium industrial design photography style. No visible text or branding.
```

## 5.4. Lifestyle — Writing Session

```
A cozy library scene with warm afternoon light coming through tall windows. In the foreground, a person's hands are writing in a premium leather notebook with a fountain pen. The notebook is opened flat, and a leather-wrapped gooseneck arm extends from the top of the notebook, positioned above the writing area with a small LED light illuminating the paper. The arm has a small camera at its end. The person wears a cream wool sweater. Vintage leather-bound books fill the blurred background. No faces visible. Editorial photography style, like something from Monocle or Kinfolk magazine. Sharp focus on the hands and notebook. Cinematic warm golden hour lighting.
```

## 5.5. Multiple Color Editions Lineup

```
Three premium leather notebooks displayed in a row on a white marble surface, photographed from a slightly elevated angle. From left to right: a deep cognac brown notebook with brass details, a midnight black notebook with warm graphite details, and a forest green notebook with brass details. Each has matching cotton tie cords. The lighting is soft studio lighting with subtle shadows. Professional product catalog photography style. Even spacing between notebooks. The framing is symmetrical and clean. No text or logos visible. The mood evokes refined luxury, like a Smythson or Hermès display.
```

## 5.6. Closed Notebook on Linen Background

```
A single premium leather notebook in midnight black, lying closed on a textured natural linen fabric background. The notebook has visible high-quality leather grain. A waxed black cotton cord is wrapped around it once and tied with a simple knot at the side. The lighting is soft and directional from the upper right, creating a gentle shadow on the linen. Photographed from a top-down view at a slight angle. The composition is minimal with the notebook centered. Professional editorial photography style. Quiet, contemplative atmosphere. No visible text or branding.
```

# 6. Промпты для Flux / Stable Diffusion

Flux (specifically Flux.1 Pro) best for: photorealistic product shots, complex compositions, fine material details. Lower stylization than Midjourney, more photographic feel. Use both positive and negative prompts.

## 6.1. Hero Shot — Positive + Negative

Positive prompt:

```
Premium leather notebook, A5 size, deep cognac Italian full-grain leather, vintage maritime logbook style, brass clasps, waxed cotton tie cord, closed position, sitting on dark walnut wood desk, soft window light from left, professional commercial product photography, Hasselblad medium format quality, hyperrealistic leather texture details, subtle patina, shallow depth of field, museum exhibition lighting, warm color grading, slightly elevated 30-degree angle, photorealistic
```

Negative prompt:

```
text, logos, brand names, cartoonish, illustration, 3D render style obvious, plastic look, futuristic, neon, glowing, watermark, signature, fake brands, Apple, Google, Microsoft, ChatGPT, OpenAI, distorted proportions, blurry, low quality, oversaturated, HDR, multiple devices, hands, people, faces
```

## 6.2. Gooseneck Detail Shot

Positive:

```
Macro product detail, flexible leather-wrapped gooseneck arm with bronze aluminum head module, embedded small camera lens and warm LED ring light, capacitive touch surface visible, curved gracefully above blank cream stone paper page, sharp focus on camera lens with subtle reflections, soft warm directional lighting, shallow depth of field background bokeh, professional industrial design product photography, Bang Olufsen aesthetic quality, photorealistic
```

Negative:

```
text, brands, logos, plastic finish, toy-like, distorted optics, weird angles, hands, fingers, oversaturated, cartoonish, illustration style, hyperrealistic skin, fake reflections, lens flares excessive
```

## 6.3. Aesthetic Atmosphere — Lifestyle Scene

Positive:

```
Cozy private library, person writing in premium leather notebook with fountain pen, gooseneck arm with small LED light positioned over the page, late afternoon warm golden window light, vintage leather-bound books on shelves blurred background, wool sweater texture, hands only visible from wrist, editorial photography style, Kinfolk magazine aesthetic, slight film grain, warm color palette dominated by browns and golds, shallow depth of field, intimate quiet atmosphere
```

Negative:

```
face, full body, modern technology visible, neon lights, harsh shadows, oversaturated colors, plastic textures, cartoonish, 3D render style, watermarks, text overlays, multiple people, busy composition, cluttered background
```

# 7. Промпты для Ideogram

Ideogram best for: when you actually want text to render correctly on screen, or want to include hand-written elements with controlled typography.

## 7.1. Notebook with Readable E-ink Interface

```
Open premium leather notebook, the right page is an integrated e-ink display showing a minimal text interface with the heading "Today's Reflections" at top and two columns of small body text below in a serif font. The left page is cream stone paper with handwritten cursive notes visible. Cognac brown leather covers. Brushed bronze bezel around screen. Professional product photography, soft natural lighting, 45-degree top-down angle, sharp focus throughout, technology magazine aesthetic, photorealistic
```

## 7.2. Branded Packaging Hero

```
Premium product packaging box in soft-touch matte black, with the wordmark "NABU CODEX" embossed in clean serif typography in the center, slightly lighter than the surrounding box. The box sits closed on a marble surface. Soft museum lighting. The typography is elegant and refined, vintage scientific instrument aesthetic. Professional commercial photography for luxury brand, minimalist composition
```

# 8. Промпты для Recraft

Recraft best for: vector-like icon work, technical illustrations, packaging design mockups. Use for supplementary materials, не для primary hero shots.

## 8.1. Technical Line Drawing

```
Technical line drawing illustration of premium leather notebook with extended gooseneck arm, side profile view, fine ink line work on cream paper background, in the style of vintage technical patent illustrations or Da Vinci notebooks, all measurements and proportions accurate, no shading, just elegant linework, slightly hand-drawn feel
```

## 8.2. Marketing Iconography

```
Set of minimal line icons for product features: a notebook icon, a gooseneck arm with camera icon, a wifi/cloud connection icon, a fountain pen icon, an e-ink display icon, a privacy lock icon, all in single weight outline style 1.5pt stroke, monochromatic dark bronze color, simple geometric shapes, suitable for premium product website use, consistent visual language
```

# 9. Сценарии для PR / Marketing

## 9.1. Press Photo — Editorial

```
(Midjourney v6) Editorial press photography for premium technology product launch: A single Nabu Codex leather notebook displayed on minimalist gray concrete platform, dramatic single overhead spotlight creating geometric shadow, museum exhibition aesthetic, photographed by Massimo Vitali style, large format quality, contemplative atmosphere, --ar 3:2 --style raw --v 6
```

## 9.2. Launch Campaign — Cinematic

```
(Midjourney v6) Cinematic still from product launch campaign, premium leather notebook closed on weathered wooden desk in dimly lit study, single candle flickering nearby, fountain pen and worn book of poetry alongside, warm amber and brown color palette, atmospheric haze, deep shadows, mood of timeless craft and quiet contemplation, photographed by Roger Deakins cinematography style, anamorphic lens compression, ultra-cinematic, --ar 21:9 --style raw --v 6 --s 200
```

## 9.3. Social Media — Square Hero

```
(Midjourney v6) Top-down view of premium leather notebook in deep cognac brown on white marble surface, closed with brass clasps visible, waxed cotton cord tied with elegant simple knot, photographed from directly above, perfect symmetrical composition, single fountain pen placed parallel to right side of notebook, soft directional lighting from upper left, Instagram-worthy product photography, premium aesthetic, --ar 1:1 --style raw --v 6 --s 100
```

## 9.4. Crowdfunding Hero — Promise Shot

```
(DALL-E 3) A single premium leather notebook is held up against a dramatic dark green background, photographed slightly from below at an upward angle to make it look heroic and important. The notebook is opened to reveal both the cream stone paper page on the left and the integrated e-ink display on the right, which shows a minimal interface. The gooseneck arm extends gracefully from the top with a small LED light at its tip. The lighting is dramatic with a strong key light from the upper right creating beautiful highlights on the leather and a soft warm rim light from behind. The mood is aspirational and refined. Professional Kickstarter campaign hero image quality.
```

## 9.5. Lifestyle Mood — Quiet Morning

```
(Midjourney v6) Quiet morning scene, premium leather notebook open on white linen-covered table next to ceramic mug of black coffee, gentle steam rising, slice of bright sunlight from window creating gentle warmth, gooseneck arm with LED ring light positioned over the page, otherwise minimal scene, peaceful contemplative mood, photographed in style of Cereal magazine, soft natural light, restrained color palette of creams and warm browns, --ar 4:3 --style raw --v 6 --s 80
```

# 10. Сценарии для investor pitch deck

## 10.1. Hero Slide — Product Reveal

```
(Midjourney v6) Dramatic product reveal shot: Nabu Codex premium leather notebook materializes from soft darkness, single warm golden light catching brass details and rich leather grain, deep shadows surround, jewel-like quality, mysterious yet refined, photographed in style of luxury watch advertising, ultra-premium presentation, museum-quality lighting, --ar 16:9 --style raw --v 6 --s 200
```

## 10.2. Comparison Slide — Premium Positioning

```
(Midjourney v6) Side-by-side comparison composition: three notebooks shown — at left a basic spiral notebook (deemphasized in background), in center a standard premium leather notebook, at right the Nabu Codex with gooseneck arm extended and e-ink display visible (the hero). Each scaled to show progression. Clean white background. Professional product comparison photography. The Nabu Codex receives the strongest lighting. --ar 16:9 --style raw --v 6 --s 50
```

## 10.3. Manufacturing — Behind the Scenes

```
(Midjourney v6) Atmospheric workshop scene: skilled craftsman hands (no face visible) working on assembling premium leather notebook, leather tools visible on aged wooden workbench, partially assembled device showing internal components, warm overhead workshop lighting, traditional craftsmanship meets modern technology aesthetic, documentary photography style, --ar 3:2 --style raw --v 6 --s 100
```

# 11. Иконография и graphic elements

## 11.1. Logo Variations

```
(Recraft / Ideogram) Word mark "NABU CODEX" in elegant serif typography, multiple variations: 1) horizontal layout black on white, 2) stacked layout, 3) just the C from Codex as standalone symbol, classical Italian serif style like Bodoni or Garamond, refined and minimal, high contrast strokes, suitable for embossing on leather and printing on packaging
```

## 11.2. UI Mockups for E-ink Display

```
(Ideogram) Mockup of e-ink display interface on Nabu Codex device: minimal black text on cream paper-like background, showing "Today" header at top in serif typography, list of journal entries with timestamps below, navigation icons at bottom (home, write, search, settings), interface designed for E Ink Carta display aesthetic with no color, only black and white, refined typography reminiscent of book design, hierarchical information layout
```

# 12. Process и iteration guidance

## 12.1. Iteration workflow

1. **Start с basic prompt**, не over-specify в первом try
1. **Generate 4 variations**, выберите closest match
1. **Refine** через variation function (Midjourney) или edit (DALL-E)
1. **Add specificity gradually**: lighting → materials → details → style
1. **Mix generators**: Midjourney для hero shots, DALL-E 3 для complex scenes, Flux для technical accuracy
1. **Save successful prompts** — build library для consistent visual language

## 12.2. Quality checklist для каждого render

- Материалы выглядят premium (не toy-like)?
- Пропорции корректные (правильный thickness, размер screen)?
- Нет hallucinated buttons / weird ports?
- Нет fake brand logos?
- Освещение flattering к материалам (leather shine, brass warmth)?
- Композиция тонкая, не overcrowded?
- Mood соответствует target (premium calm vs energetic vs luxurious)?

## 12.3. Когда передавать human designer

AI-renders — это **starting point**, не final product. Для production-quality:

- Engineering renderings — KeyShot или V-Ray через 3D modeling из real CAD
- Marketing photography — actual product photography (когда есть prototype)
- Print materials — vector graphics, не AI-generated
- Packaging design — dedicated designer with experience в luxury goods
> AI-generated renders critically полезны на conceptual stage (concept validation, mood alignment, fundraising visuals). Они НЕ заменяют engineering CAD или real product photography. Используйте их strategically — не end-stage.

# 13. Сводный список deliverables для визуализации

Минимальный набор renders для investor pitch / community engagement:

1. **1× hero shot** (closed, dramatic) — для cover slide
1. **1× hero shot** (open, showing screen + paper) — для product reveal
1. **1× detail shot** (gooseneck arm) — для signature feature
1. **1× lifestyle shot** (writing scene) — для use case
1. **1× lineup shot** (3 color editions) — для product line
1. **1× context shot** (on desk with objects) — для aesthetic positioning
Recommended deliverables для full launch campaign:

1. Все из minimal набора
1. **2× cinematic moody** — для PR press kit
1. **1× side profile** — для technical specs
1. **1× exploded view** — для transparency/storytelling
1. **1× limited edition** (Phase 2.5) — для PR moment
1. **Multiple lifestyle** (different scenarios) — для marketing variety
1. **Packaging mockups** — для unboxing anticipation

## 13.1. Cost & time estimate для full deliverable set

| **Approach** | **Cost** | **Time** |
| --- | --- | --- |
| Pure AI-generated (Midjourney + DALL-E) | $50-200 в subscriptions | 5-15 hours iteration |
| AI + light post-processing (Photoshop) | $200-500 | 20-40 hours |
| Hire AI-savvy designer для full set | $2-5k | 1-2 weeks |
| Full 3D modeling + KeyShot renders (professional) | $10-30k | 4-8 weeks |
| Real product photography (after prototype) | $15-50k | 2-4 weeks (excludes prototype cost) |

**Рекомендация**: Phase 0 — pure AI generation (cheap, fast). Phase 1 (after companion product validation) — invest в professional 3D + KeyShot. Phase 2 (full Codex) — real product photography from prototype.

# 14. Application timeline

## 14.1. Когда использовать какие renders

| **Stage** | **Какие visuals нужны** |
| --- | --- |
| Phase 0 — Concept validation (now) | 5-8 AI-generated renders. Used in: internal alignment, founder presentations, early user research surveys, Discord teasers |
| Phase 0 — Investor outreach | 10-15 polished renders включая cinematic. Investor pitch decks need consistent visual language |
| Phase 0 — Community engagement | Hero shots + lifestyle для Twitter/Instagram teases ("future possibility") |
| Phase 1 — Companion launch | Real product photography of companion device + AI renders of future full Codex |
| Phase 2 — Full Codex marketing | Real photography of prototypes + professional 3D renders |

## 14.2. Что НЕ делать в Phase 0

- Не публиковать renders как fully committed product. Use phrasing типа "concept exploration" or "vision rendering"
- Не accepting pre-orders на основе только renders. Это recipe for legal trouble
- Не комитить себя к specific design details из renders (gooseneck angle, screen size, и т. д.) — это будет меняться в real engineering
- Не использовать renders для technical claims (battery life, weight, etc.) — они не accurate

# 15. Финальное резюме документа

Резюме deliverable этого документа:

1. **Industrial design brief**: материалы, цвета, эргономика, typography, packaging — все determining premium aesthetic
1. **Production-ready промпты** для 5 image generators (Midjourney v6, DALL-E 3, Flux/SD, Ideogram, Recraft)
1. **15+ specific промптов** для разных scenarios: hero shots, details, lifestyle, marketing, investor materials
1. **Negative prompts и guidance** что НЕ генерировать
1. **Workflow guidance** — iteration, quality checklist, когда передавать human designer
1. **Cost estimates** для разных visual deliverable approaches
1. **Application timeline** — когда какие visuals нужны на разных stages
> Эти промпты дадут вам стартовый набор для visualization Nabu Codex без необходимости hire industrial designer на Phase 0. Используйте strategically: первые renders — для validation демonstration, не для commitment. Будьте готовы итерировать 10-30 раз для достижения true premium aesthetic. AI-generated images — это inspiration, не final.

Связанный документ: 23 (Nabu Codex — концепция и стратегия) содержит business case, technical analysis, и roadmap. Документ 24 (этот) — visual / design layer. Together они дают complete picture: что мы строим (23), и как это выглядит (24).
