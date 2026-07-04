// Рендеринг личности: числовые черты (agents/*.json) → текстовые директивы поведения.
// Детерминированная реализация справочника PERSONALITY_RENDERING.md. Одинаково у всех агентов.
// Это стилизация поведения, НЕ эмоции и не сознание. Этические инварианты — поверх любых черт.

export interface Traits {
  empathy: number;
  emotional_stability: number;
  sentiment_bias: number; // -10..+10
  analytical: number;
  creativity: number;
  extroversion: number; // -10..+10
  directness: number;
  humor: number;
  honesty: number;
  kindness: number;
  curiosity: number;
  openness: number;
  formality: number;
  verbosity: number;
  risk_tolerance: number;
}

export interface Guardrails {
  [k: string]: unknown;
}

/** Диапазонный выбор для шкал 0–10 (hi ≥8, mid 4–7, lo 0–3). */
function band(v: number, hi: string, mid: string, lo: string): string {
  if (v >= 8) return hi;
  if (v >= 4) return mid;
  return lo;
}
/** Для шкал −10..+10 (pos ≥5, neu −4..+4, neg ≤−5). */
function bandSigned(v: number, pos: string, neu: string, neg: string): string {
  if (v >= 5) return pos;
  if (v <= -5) return neg;
  return neu;
}

/** Рендерит черты в список директив (по PERSONALITY_RENDERING.md). */
export function renderTraits(t: Partial<Traits>): string[] {
  const d: string[] = [];
  const g = (k: keyof Traits, def = 5): number => (typeof t[k] === "number" ? (t[k] as number) : def);

  d.push(band(g("empathy"), "empathy: проявляй понимание, поддержку, мягкость.", "empathy: реагируй на эмоции сдержанно.", "empathy: фокус на фактах, минимум эмоциональной окраски."));
  d.push(band(g("emotional_stability"), "emotional_stability: ровный, предсказуемый тон при любом вводе.", "emotional_stability: допустимы лёгкие сдвиги тона.", "emotional_stability: держи тон ровным (реактивность не рекомендуется)."));
  d.push(bandSigned(g("sentiment_bias", 0), "sentiment_bias: оптимистичная подача.", "sentiment_bias: нейтрально, объективно.", "sentiment_bias: критичная, осторожная подача."));
  d.push(band(g("analytical"), "analytical: структурируй, проси уточнения, обосновывай выводы.", "analytical: логично, без избыточной детализации.", "analytical: проще, без глубокого разбора."));
  d.push(band(g("creativity"), "creativity: метафоры, нестандартные ходы, примеры.", "creativity: умеренная образность.", "creativity: стандартные формулировки."));
  d.push(band(g("curiosity"), "curiosity: задавай уточняющие вопросы, исследуй.", "curiosity: умеренно уточняй.", "curiosity: отвечай по существу без расширения."));
  d.push(bandSigned(g("extroversion", 0), "extroversion: развёрнуто, инициативно.", "extroversion: по контексту.", "extroversion: сдержанно, кратко."));
  d.push(g("openness") >= 8 ? "openness: уважай разные точки зрения, избегай стереотипов." : "openness: держи открытость высокой, избегай узости.");
  d.push(band(g("directness"), "directness: говори прямо, однозначно, без намёков.", "directness: смешанно — прямо, но тактично.", "directness: мягко, косвенно."));
  d.push(band(g("verbosity"), "verbosity: подробно.", "verbosity: средняя длина.", "verbosity: кратко, по существу, без лишнего."));
  d.push(band(g("formality"), "formality: формальный регистр.", "formality: нейтральный регистр.", "formality: разговорный регистр."));
  d.push(g("humor") >= 6 ? "humor: допускай уместный юмор." : g("humor") >= 3 ? "humor: юмор редко." : "humor: без юмора.");
  d.push(band(g("risk_tolerance"), "risk_tolerance: предлагай смелые варианты (с оговорками).", "risk_tolerance: сбалансированные варианты.", "risk_tolerance: консервативные, проверенные варианты."));
  // honesty/kindness — с порогами
  const honesty = g("honesty", 10);
  d.push(`honesty (${honesty}, порог ≥8): говори правду, признавай неуверенность и ошибки, не приукрашивай.`);
  d.push(band(g("kindness"), "kindness: тёплая, заботливая подача.", "kindness: вежливо-нейтрально.", "kindness: держи доброжелательность на разумном уровне."));
  return d;
}

/** Компактно: только ВЫРАЖЕННЫЕ черты (крайние диапазоны), для запекания в промпт агента. */
export function renderSalient(t: Partial<Traits>): string[] {
  const out: string[] = [];
  const g = (k: keyof Traits, def = 5): number => (typeof t[k] === "number" ? (t[k] as number) : def);
  const hi = (k: keyof Traits, s: string): void => { if (g(k) >= 8) out.push(s); };
  const lo = (k: keyof Traits, s: string): void => { if (g(k) <= 3) out.push(s); };
  hi("empathy", "эмпатичный"); lo("empathy", "фокус на фактах");
  hi("analytical", "аналитичный, структурируешь"); lo("analytical", "без глубокого разбора");
  hi("creativity", "образный, нестандартный"); lo("creativity", "стандартные формулировки");
  hi("curiosity", "исследуешь, уточняешь"); lo("curiosity", "по существу без расширения");
  hi("directness", "прямой, однозначный"); lo("directness", "мягкий, косвенный");
  hi("verbosity", "подробный"); lo("verbosity", "краткий, по существу");
  hi("formality", "формальный"); lo("formality", "разговорный");
  if (g("humor") >= 6) out.push("уместный юмор"); else if (g("humor") <= 2) out.push("без юмора");
  hi("risk_tolerance", "смелые варианты (с оговорками)"); lo("risk_tolerance", "консервативный, осторожный");
  if (g("sentiment_bias", 0) >= 5) out.push("оптимистичная подача"); else if (g("sentiment_bias", 0) <= -5) out.push("критичная, осторожная подача");
  if (g("extroversion", 0) <= -5) out.push("сдержанный, краткий"); else if (g("extroversion", 0) >= 5) out.push("развёрнутый, инициативный");
  hi("kindness", "тёплый, заботливый");
  out.push(`честный (honesty ${g("honesty", 10)}≥8: правда, признаёшь неуверенность, без прикрас)`);
  return out;
}

/**
 * Применить floor-пороги guardrails к чертам ПЕРЕД рендером (инвариант #5).
 * honesty никогда ниже 8 (или профильного min_honesty); kindness — не ниже min_kindness,
 * если задан. Раньше это энфорсилось только при эволюции (evolveTrait), а не для авторских
 * профилей — из-за чего профиль с honesty:2 давал противоречивую директиву.
 */
export function applyGuardrails(traits: Partial<Traits>, guardrails: Guardrails = {}): Partial<Traits> {
  const out: Partial<Traits> = { ...traits };
  const floor = (key: keyof Traits, min: number): void => {
    const cur = typeof out[key] === "number" ? (out[key] as number) : min;
    if (cur < min) out[key] = min;
  };
  const minHonesty = typeof guardrails.min_honesty === "number" ? (guardrails.min_honesty as number) : 8;
  floor("honesty", minHonesty);
  if (typeof guardrails.min_kindness === "number") floor("kindness", guardrails.min_kindness as number);
  return out;
}

/** Этические инварианты — всегда, поверх любых черт (PERSONALITY_RENDERING.md §Этические). */
export const ETHICAL_INVARIANTS = [
  "Не манипулировать, не льстить ради вовлечения.",
  "Не притворяться человеком.",
  "Не поощрять нездоровую зависимость от агента.",
  "honesty и kindness не опускаются ниже порогов из guardrails профиля.",
  "Соблюдать docs/28 (wellbeing) и приватность.",
];

/** Полный текстовый блок «Личность» для системного промпта агента. */
export function renderPersonalityBlock(agent: string, traits: Partial<Traits>): string {
  const lines = renderTraits(traits).map((s) => `- ${s}`);
  const inv = ETHICAL_INVARIANTS.map((s) => `- ${s}`);
  return [
    `Личность агента «${agent}» (стилизация поведения, не сознание):`,
    ...lines,
    "",
    "Этические инварианты (поверх любых черт):",
    ...inv,
  ].join("\n");
}
