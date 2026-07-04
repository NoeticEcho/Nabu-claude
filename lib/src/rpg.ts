// RPG/XP — чистые детерминированные функции геймификации Nabu (без БД, без LLM).
// Единый источник правды для: списка 8 атрибутов, маппинга сфер жизни → атрибут, формул уровней,
// сумм начислений и сборки «листа персонажа». Правила прозрачны и объяснимы (инвариант #5, SAFETY.md):
// геймификация — поддержка, не давление; каждое начисление имеет понятную причину и величину.

/** 8 XP-атрибутов (колонки character_sheet.<attr>_xp). Единый источник — здесь. */
export const XP_ATTRS = [
  "intellect",
  "wisdom",
  "creativity",
  "discipline",
  "vitality",
  "resilience",
  "sociality",
  "wealth",
] as const;
export type XpAttr = (typeof XP_ATTRS)[number];

// ── Формулы уровней ──────────────────────────────────────────────────────────
// Уровень растёт по квадратному корню (замедляющийся прогресс — честно, без бесконечной эскалации):
//   уровень_атрибута = floor(sqrt(attr_xp / 50));   общий = floor(sqrt(total_xp / 100)).
// Границы: 0→0, 50→1, 200→2, 450→3 (для атрибута); 0→0, 100→1, 400→2 (общий).
export const ATTR_DIVISOR = 50;
export const OVERALL_DIVISOR = 100;
export type LevelFormula = "attribute" | "overall";

function divisorFor(formula: LevelFormula): number {
  return formula === "overall" ? OVERALL_DIVISOR : ATTR_DIVISOR;
}

function levelFor(xp: number, divisor: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / divisor));
}

/** Уровень отдельного атрибута по его xp. */
export function attrLevel(xp: number): number {
  return levelFor(xp, ATTR_DIVISOR);
}

/** Общий уровень персонажа по суммарному xp. */
export function overallLevel(totalXp: number): number {
  return levelFor(totalXp, OVERALL_DIVISOR);
}

/** Сколько xp осталось до следующего уровня по выбранной формуле (attribute|overall). */
export function xpToNext(xp: number, formula: LevelFormula = "attribute"): number {
  const divisor = divisorFor(formula);
  const lvl = levelFor(xp, divisor);
  const nextThreshold = divisor * (lvl + 1) ** 2; // xp, нужный для уровня lvl+1
  return nextThreshold - Math.max(0, xp);
}

// ── Маппинг сфер жизни → атрибут ──────────────────────────────────────────────
// Домены задач/привычек/целей и министров Совета сводятся к атрибуту персонажа.
// Неизвестный/пустой домен → discipline («просто довести дело до конца»).
const DOMAIN_TO_ATTR: Record<string, XpAttr> = {
  health: "vitality",
  vitality: "vitality",
  lifestyle: "vitality", // быт/самочувствие
  work: "discipline",
  admin: "discipline", // порядок/организованность
  learning: "intellect",
  intellect: "intellect",
  finance: "wealth",
  wealth: "wealth",
  relationships: "sociality",
  social: "sociality",
  sociality: "sociality",
  growth: "resilience",
  resilience: "resilience",
  mind: "wisdom",
  wisdom: "wisdom",
  creative: "creativity",
  creativity: "creativity",
};

/** Сфера жизни → атрибут персонажа. Нет домена → discipline (базовое «сделал дело»). */
export function domainToAttribute(domain?: string | null): XpAttr {
  if (!domain) return "discipline";
  return DOMAIN_TO_ATTR[domain.toLowerCase().trim()] ?? "discipline";
}

// ── Детерминированные суммы начислений ────────────────────────────────────────
/** XP за закрытую задачу по приоритету (high=15, normal=10, low=5). Идёт в discipline. */
export function taskXp(priority?: string | null): number {
  switch ((priority ?? "normal").toLowerCase()) {
    case "high":
      return 15;
    case "low":
      return 5;
    default:
      return 10; // normal и любое неизвестное значение
  }
}

/** Бонус за задачу, закрытую в срок (была due_date и закрыта не позже неё). */
export const ONTIME_BONUS = 5;
/** Отметка привычки (done): базовый XP в discipline. */
export const HABIT_DISCIPLINE_XP = 5;
/** Отметка привычки (done): XP в атрибут её домена. */
export const HABIT_DOMAIN_XP = 3;
/** Достижение цели: XP в атрибут её домена. */
export const GOAL_XP = 50;
/**
 * Мягкий, объяснимый штраф за сорванную серию привычки: −5 к discipline.
 * НИКОГДА не уводит атрибут в минус (пол 0 обеспечивается на уровне записи).
 * Бросить цель — честное решение, штрафа НЕТ.
 */
export const HABIT_MISS_PENALTY = -5;
/** Потолок разового качественного начисления (agent-judged) — против инфляции наград. */
export const QUALITATIVE_CAP = 25;

// ── Лист персонажа ────────────────────────────────────────────────────────────
export interface AttrSummary {
  name: XpAttr;
  xp: number;
  level: number;
  toNext: number;
}
export interface CharacterSummary {
  level: number; // общий уровень
  total: number; // суммарный xp по всем атрибутам
  toNext: number; // xp до следующего общего уровня
  attrs: AttrSummary[];
}

/** Строка character_sheet: важны поля `<attr>_xp` (число). Прочее игнорируется. */
export type CharacterSheetRow = Record<string, unknown> | null | undefined;

/** Собрать богатый лист персонажа (уровни, не только сырой xp) из строки character_sheet. */
export function characterSummary(sheet: CharacterSheetRow): CharacterSummary {
  const attrs: AttrSummary[] = XP_ATTRS.map((name) => {
    const xp = Number((sheet as Record<string, unknown> | null)?.[`${name}_xp`] ?? 0) || 0;
    return { name, xp, level: attrLevel(xp), toNext: xpToNext(xp, "attribute") };
  });
  const total = attrs.reduce((sum, a) => sum + a.xp, 0);
  return { level: overallLevel(total), total, toNext: xpToNext(total, "overall"), attrs };
}
