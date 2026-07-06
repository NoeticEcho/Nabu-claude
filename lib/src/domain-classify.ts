// domain-classify.ts — автоопределение домена фрагмента знаний (zero-shot через эмбеддинги).
// Один источник (напр. энциклопедия) может покрывать много тем; вместо одного домена на весь
// источник классифицируем КАЖДЫЙ чанк по ближайшему домену таксономии. Быстро и локально:
// сравниваем уже посчитанный эмбеддинг чанка с (кэшированными) эмбеддингами описаний доменов.

import type { Embedder } from "./embeddings.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Курируемая таксономия доменов знаний (RU+EN ключевые слова в описании — для эмбеддинга).
 *  Расширяется по мере надобности; NABU_DOMAINS (csv "domain:описание;…") добавляет свои. */
export const DOMAIN_TAXONOMY: Array<{ domain: string; desc: string }> = [
  { domain: "psychology", desc: "психология, когнитивно-поведенческая терапия, эмоции, поведение, ментальное здоровье, самооценка, тревога, мотивация; psychology, CBT, emotions, mental health" },
  { domain: "law", desc: "право, законы, юриспруденция, кодексы, законопроекты, судебные решения, регулирование, договоры, права; law, legislation, legal, court, regulation, contracts" },
  { domain: "ai", desc: "искусственный интеллект, машинное обучение, нейросети, большие языковые модели, данные, алгоритмы, обучение моделей; AI, machine learning, neural networks, LLM, data" },
  { domain: "software", desc: "программирование, разработка ПО, код, архитектура систем, языки программирования, базы данных, API; software, programming, code, systems, databases" },
  { domain: "design", desc: "дизайн, UI/UX, интерфейсы, юзабилити, типографика, визуальный дизайн, продуктовый дизайн; design, UI, UX, usability, product design" },
  { domain: "business", desc: "бизнес, предпринимательство, стратегия, стартапы, маркетинг, продажи, менеджмент, экономика фирмы; business, entrepreneurship, strategy, startups, marketing, sales" },
  { domain: "finance", desc: "финансы, инвестиции, деньги, бюджет, налоги, банки, рынки, бухгалтерия; finance, investing, money, budget, taxes, markets, accounting" },
  { domain: "health", desc: "здоровье, медицина, тело, питание, сон, физическая активность, профилактика, болезни; health, medicine, nutrition, sleep, fitness, disease" },
  { domain: "science", desc: "наука, физика, химия, биология, математика, исследования, эксперименты, теории; science, physics, chemistry, biology, mathematics, research" },
  { domain: "history", desc: "история, исторические события, эпохи, цивилизации, войны, культура прошлого; history, historical events, civilizations, wars, culture" },
  { domain: "philosophy", desc: "философия, этика, логика, метафизика, сознание, смысл, мыслители; philosophy, ethics, logic, metaphysics, consciousness, meaning" },
  { domain: "education", desc: "образование, обучение, педагогика, методики преподавания, навыки, курсы; education, learning, pedagogy, teaching, skills" },
  { domain: "language", desc: "язык, лингвистика, грамматика, изучение языков, письмо, риторика, перевод; language, linguistics, grammar, writing, rhetoric, translation" },
  { domain: "productivity", desc: "продуктивность, тайм-менеджмент, привычки, планирование, организация дел, фокус; productivity, time management, habits, planning, focus" },
  { domain: "relationships", desc: "отношения, коммуникация, семья, дружба, конфликты, эмпатия, социальные навыки; relationships, communication, family, conflict, empathy" },
  { domain: "arts", desc: "искусство, музыка, литература, живопись, кино, творчество, эстетика; arts, music, literature, painting, film, creativity, aesthetics" },
  { domain: "engineering", desc: "инженерия, техника, механика, электроника, строительство, производство; engineering, mechanics, electronics, construction, manufacturing" },
  { domain: "geography", desc: "география, страны, города, природа, климат, карты, путешествия; geography, countries, cities, nature, climate, travel" },
  { domain: "politics", desc: "политика, государство, управление, выборы, международные отношения, идеологии; politics, government, elections, international relations, ideology" },
];

function loadCustom(): Array<{ domain: string; desc: string }> {
  const env = process.env.NABU_DOMAINS;
  if (!env) return [];
  return env.split(";").map((p) => { const [d, ...rest] = p.split(":"); return { domain: (d || "").trim(), desc: rest.join(":").trim() || (d || "").trim() }; }).filter((x) => x.domain);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const x = a[i] as number, y = b[i] as number; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Классификатор домена по эмбеддингу чанка. Описания доменов эмбеддятся один раз (кэш). */
export class DomainClassifier {
  private domainVecs: Array<{ domain: string; vec: number[] }> | null = null;
  private readonly threshold: number;

  constructor(private readonly embedder: Embedder) {
    this.threshold = Number(process.env.NABU_DOMAIN_THRESHOLD) || 0.34;
  }

  private async ensure(): Promise<void> {
    if (this.domainVecs) return;
    const tax = [...DOMAIN_TAXONOMY, ...loadCustom()];
    // R7-E6: ключ кэша включает МОДЕЛЬ/dim/провайдер эмбеддинга, не только таксономию. Иначе смена
    // OLLAMA_EMBED_MODEL/OPENAI_EMBED_MODEL/NABU_EMBED_DIM оставляла старые векторы доменов в другом
    // пространстве → cosine по префиксу давал мусор, почти всё падало в 'general'.
    const embedSig = [
      process.env.NABU_EMBED_PROVIDER || "ollama",
      process.env.OPENAI_EMBED_MODEL || process.env.OLLAMA_EMBED_MODEL || "",
      this.embedder.dim,
    ].join("|");
    const hash = createHash("sha1")
      .update(embedSig + "\n" + tax.map((t) => t.domain + "|" + t.desc).join("\n"))
      .digest("hex").slice(0, 12);
    // Кэш векторов доменов в файле: 19 эмбеддингов считаются ОДИН раз навсегда (на слабом CPU дорого),
    // дальше все процессы (CLI+демон) читают из файла. Инвалидация — по хэшу таксономии.
    const home = process.env.NABU_HOME || join(process.env.HOME || process.env.USERPROFILE || ".", "nabu");
    const cacheFile = join(home, ".nabu", "domain-vecs.json");
    try {
      const c = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (c.hash === hash && Array.isArray(c.vecs)) { this.domainVecs = c.vecs; return; }
    } catch { /* нет кэша/устарел — считаем */ }
    const vecs: Array<{ domain: string; vec: number[] }> = [];
    for (const t of tax) vecs.push({ domain: t.domain, vec: await this.embedder.embed(t.desc, "default") });
    this.domainVecs = vecs;
    try { mkdirSync(join(home, ".nabu"), { recursive: true }); writeFileSync(cacheFile, JSON.stringify({ hash, vecs })); } catch { /* кэш best-effort */ }
  }

  /** Ближайший домен к эмбеддингу чанка; ниже порога → 'general'. Возвращает {domain, score}. */
  async classifyVec(vec: number[]): Promise<{ domain: string; score: number }> {
    await this.ensure();
    let best = { domain: "general", score: 0 };
    for (const d of this.domainVecs!) {
      const s = cosine(vec, d.vec);
      if (s > best.score) best = { domain: d.domain, score: s };
    }
    return best.score >= this.threshold ? best : { domain: "general", score: best.score };
  }
}
