// Импорт данных о здоровье из ФАЙЛОВЫХ ЭКСПОРТОВ вендоров (Apple Health / Google Fit /
// Health Connect / Fitbit / Garmin / Huawei через generic CSV). НИКАКИХ облачных API/OAuth:
// разбор 100% локальный, точки складываются в общие metric_series/metric_values.
// Философия и per-vendor инструкции — docs/HEALTH_IMPORT.md.

import type { Postgres } from "./db/postgres.js";

/** Одна точка метрики здоровья: имя ряда, число, опц. единица, момент (ISO-строка). */
export interface HealthPoint {
  metric: string;
  value: number;
  unit?: string;
  occurredAt: string;
}

// ── Apple Health ──────────────────────────────────────────────────────────────
// export.xml состоит из <Record type="HK..." startDate="..." value="..." .../>.
// Файлы бывают 100МБ+ — НЕ грузим в DOM, а стримингово идём глобальным regex по тегам Record.

/** Маппинг HKQuantityTypeIdentifier* → (имя ряда, единица). Неизвестные типы пропускаются. */
const APPLE_QUANTITY: Record<string, { metric: string; unit: string }> = {
  HKQuantityTypeIdentifierStepCount: { metric: "steps", unit: "count" },
  HKQuantityTypeIdentifierHeartRate: { metric: "heart_rate", unit: "count/min" },
  HKQuantityTypeIdentifierBodyMass: { metric: "weight", unit: "kg" },
  HKQuantityTypeIdentifierActiveEnergyBurned: { metric: "active_energy", unit: "kcal" },
  HKQuantityTypeIdentifierDistanceWalkingRunning: { metric: "distance", unit: "km" },
};

const APPLE_SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

const RECORD_RE = /<Record\b[^>]*>/g;

/** Достать значение атрибута из открывающего тега (атрибуты без '>' внутри кавычек). */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

/**
 * Нормализовать дату Apple "2026-07-01 08:00:00 +0300" → ISO "2026-07-01T08:00:00+03:00".
 * Смещение сохраняется (без конверсии в UTC), чтобы occurredAt был детерминированным для dedup.
 */
export function normalizeAppleDate(raw: string): string {
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{2}):?(\d{2}))?/);
  if (!m) return raw;
  const [, date, time, offH, offM] = m;
  // Без офсета — ЛОКАЛЬНОЕ время устройства (не приклеиваем Z: naive «08:00» — это не UTC).
  // Apple всегда пишет офсет; ветка — для generic-совместимости.
  const off = offH ? `${offH}:${offM}` : "";
  return `${date}T${time}${off}`;
}

/**
 * Разбор Apple Health export.xml. Возвращает точки и счётчик пропущенных (неизвестных) типов.
 * StepCount/HeartRate/BodyMass/ActiveEnergyBurned/DistanceWalkingRunning → соответствующие ряды.
 * SleepAnalysis (value=HKCategoryValueSleepAnalysisAsleep*) → sleep, value = часы (end - start).
 * occurredAt = startDate (нормализован). Сырые точки; агрегация (сумма за день) — не наша работа.
 */
export function parseAppleHealthStats(xml: string): { points: HealthPoint[]; skippedTypes: Record<string, number> } {
  const points: HealthPoint[] = [];
  const skippedTypes: Record<string, number> = {};
  for (const m of xml.matchAll(RECORD_RE)) {
    const tag = m[0];
    const type = attr(tag, "type");
    if (!type) continue;
    const start = attr(tag, "startDate");
    if (!start) continue;
    const occurredAt = normalizeAppleDate(start);

    const q = APPLE_QUANTITY[type];
    if (q) {
      const raw = attr(tag, "value");
      const value = raw === undefined ? NaN : Number(raw);
      if (Number.isFinite(value)) points.push({ metric: q.metric, value, unit: q.unit, occurredAt });
      continue;
    }

    if (type === APPLE_SLEEP_TYPE) {
      const cat = attr(tag, "value") ?? "";
      // Считаем только фазы сна (Asleep*), не InBed/Awake.
      if (!cat.startsWith("HKCategoryValueSleepAnalysisAsleep")) continue;
      const end = attr(tag, "endDate");
      if (!end) continue;
      const hours = (Date.parse(normalizeAppleDate(end)) - Date.parse(occurredAt)) / 3_600_000;
      if (Number.isFinite(hours) && hours > 0) points.push({ metric: "sleep", value: hours, unit: "h", occurredAt });
      continue;
    }

    // Неизвестный тип — тихо пропускаем, но считаем для честной статистики импорта.
    skippedTypes[type] = (skippedTypes[type] ?? 0) + 1;
  }
  return { points, skippedTypes };
}

/** Как parseAppleHealthStats, но отдаёт только точки (упрощённый API). */
export function parseAppleHealth(xml: string): HealthPoint[] {
  return parseAppleHealthStats(xml).points;
}

// ── CSV (Google Fit / generic / Fitbit / Garmin / Huawei) ───────────────────────

/** Корректный разбор одной CSV-строки: кавычки, запятые внутри кавычек, экранирование "". */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Разбить CSV на непустые строки (терпимо к \r\n и хвостовым пустым строкам). */
function csvLines(csv: string): string[] {
  return csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
}

/** Нормализовать дату CSV: ISO — как есть; голое YYYY-MM-DD — оставить (timestamptz разберёт). */
function normalizeCsvDate(raw: string): string {
  return raw.trim();
}

/**
 * Google Takeout → Fit → «Ежедневные показатели активности» (Daily activity metrics.csv).
 * Заголовки чуть варьируются между версиями — сопоставляем по подстроке без учёта регистра.
 * Distance приходит в метрах → переводим в км.
 */
export function parseGoogleFitDaily(csv: string): HealthPoint[] {
  const lines = csvLines(csv);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const find = (pred: (h: string) => boolean): number => header.findIndex(pred);

  const idxDate = find((h) => h.includes("date"));
  const idxSteps = find((h) => h.includes("step"));
  const idxDistance = find((h) => h.includes("distance"));
  // R7-E8: "heart" исключая Google Fit "Heart Points"/"Heart Minutes" (баллы активности, НЕ ЧСС) —
  // иначе баллы импортировались бы как удары/мин. Оставляем "Heart rate"/"Heart Rate (bpm)" и т.п.
  const idxHeart = find((h) => h.includes("heart") && !h.includes("point") && !h.includes("minute"));
  const idxCalories = find((h) => h.includes("calor"));

  const points: HealthPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const date = idxDate >= 0 ? normalizeCsvDate(cells[idxDate] ?? "") : "";
    if (!date) continue;
    const push = (idx: number, metric: string, unit: string, transform: (n: number) => number = (n) => n): void => {
      if (idx < 0) return;
      const raw = cells[idx];
      if (raw === undefined || raw === "") return;
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      points.push({ metric, value: transform(n), unit, occurredAt: date });
    };
    push(idxSteps, "steps", "count");
    push(idxDistance, "distance", "km", (n) => n / 1000);
    push(idxHeart, "heart_rate", "count/min");
    push(idxCalories, "active_energy", "kcal");
  }
  return points;
}

/**
 * Универсальный CSV: заголовок `date,metric,value[,unit]` (порядок колонок не важен — ищем по именам).
 * Для Huawei/Fitbit/Garmin: пользователь конвертирует свой экспорт в этот формат (docs/HEALTH_IMPORT.md).
 */
export function parseGenericCsv(csv: string): HealthPoint[] {
  const lines = csvLines(csv);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idxDate = header.indexOf("date");
  const idxMetric = header.indexOf("metric");
  const idxValue = header.indexOf("value");
  const idxUnit = header.indexOf("unit");
  if (idxDate < 0 || idxMetric < 0 || idxValue < 0) return [];

  const points: HealthPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const metric = cells[idxMetric]?.trim();
    const date = cells[idxDate]?.trim();
    const rawValue = cells[idxValue];
    if (!metric || !date || rawValue === undefined || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const unit = idxUnit >= 0 ? cells[idxUnit]?.trim() || undefined : undefined;
    points.push({ metric, value, unit, occurredAt: normalizeCsvDate(date) });
  }
  return points;
}

// ── Автоопределение формата ─────────────────────────────────────────────────────

/** Определить формат по маркерам содержимого (filename — вспомогательная подсказка). */
export function detectFormat(content: string, filename?: string): "apple" | "google-fit" | "generic" | null {
  const head = content.slice(0, 4096);
  if (/<!DOCTYPE\s+HealthData/i.test(head) || /HealthKit/i.test(head) || /HKQuantityTypeIdentifier/.test(head) || /HKCategoryTypeIdentifier/.test(head)) {
    return "apple";
  }
  const firstLine = csvLines(content)[0] ?? "";
  const lower = firstLine.toLowerCase();
  if (lower.includes("step count") || lower.includes("move minutes") || lower.includes("heart minutes")) {
    return "google-fit";
  }
  const cols = firstLine.includes(",") ? parseCsvLine(firstLine).map((h) => h.toLowerCase()) : [];
  if (cols.includes("date") && cols.includes("metric") && cols.includes("value")) {
    return "generic";
  }
  // filename как последняя подсказка (без содержательных маркеров не доверяем)
  if (filename && /\.xml$/i.test(filename) && /<Record\b/.test(head)) return "apple";
  return null;
}

// ── Запись в БД ─────────────────────────────────────────────────────────────────

const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Идемпотентный импорт точек в общие metric_series/metric_values.
 * Скоуп по пользователю (fail-closed как DomainRepository), домен рядов = 'health',
 * source = 'import:'+source. Повторный импорт того же файла ничего не дублирует.
 */
export class HealthImportRepository {
  private userId: string | null = null;

  constructor(
    private readonly pg: Postgres,
    private readonly configuredUserId?: string,
  ) {
    this.userId = configuredUserId ?? null;
  }

  private async user(): Promise<string> {
    if (this.userId) return this.userId;
    // FAIL-CLOSED: в общей многопользовательской БД без NABU_USER_ID нельзя угадывать владельца.
    const rows = await this.pg.query<{ id: string }>("select id from users order by created_at limit 2");
    if (rows.length === 0) throw new Error("Нет пользователей в БД");
    if (rows.length > 1) {
      throw new Error(
        "NABU_USER_ID не задан, а в общей БД несколько пользователей. Задайте NABU_USER_ID (uuid из public.users) для корректной изоляции — импорт здоровья заблокирован во избежание утечки.",
      );
    }
    this.userId = rows[0]!.id;
    return this.userId;
  }

  async importPoints(points: HealthPoint[], source: string): Promise<{ inserted: number; deduped: number; series: string[] }> {
    const u = await this.user();
    if (points.length === 0) return { inserted: 0, deduped: 0, series: [] };

    // Схлопнуть точные дубликаты внутри самого файла (metric|occurredAt|value) — тоже часть идемпотентности.
    const seen = new Set<string>();
    const unique: HealthPoint[] = [];
    for (const p of points) {
      // Ordinal-соли (как в finance) тут НЕТ осознанно: одинаковые показания метрики в один
      // момент — настоящие дубли (в отличие от «двух кофе»). Дедуп по тройке — корректен.
      const key = `${p.metric}\u0000${p.occurredAt}\u0000${p.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    const byMetric = new Map<string, HealthPoint[]>();
    for (const p of unique) {
      const list = byMetric.get(p.metric);
      if (list) list.push(p);
      else byMetric.set(p.metric, [p]);
    }

    const src = `import:${source}`;
    return this.pg.tx(async (t) => {
      let inserted = 0;
      let deduped = 0;
      const series: string[] = [];
      for (const [metric, pts] of byMetric) {
        let s = await t.queryOne<{ id: string }>(
          "select id from metric_series where user_id = $1 and name = $2 order by created_at limit 1",
          [u, metric],
        );
        if (!s) {
          const unit = pts.find((p) => p.unit)?.unit ?? null;
          s = await t.queryOne<{ id: string }>(
            "insert into metric_series(user_id, name, unit, domain) values ($1,$2,$3,'health') returning id",
            [u, metric, unit],
          );
        }
        series.push(metric);

        for (const part of chunk(pts, CHUNK)) {
          // Батч-вставка через анти-join: строки, которых ещё нет (series_id+occurred_at+value), вставляются;
          // RETURNING считает реально вставленные — остаток за вычетом ушёл в deduped.
          const values: string[] = [];
          const params: unknown[] = [];
          for (const p of part) {
            const b = params.length;
            values.push(`($${b + 1}::uuid,$${b + 2}::uuid,$${b + 3}::timestamptz,$${b + 4}::double precision,$${b + 5}::text)`);
            params.push(s!.id, u, p.occurredAt, p.value, src);
          }
          const rows = await t.query<{ ok: number }>(
            `insert into metric_values(series_id, user_id, occurred_at, value, source)
             select v.series_id, v.user_id, v.occurred_at, v.value, v.source
             from (values ${values.join(",")}) as v(series_id, user_id, occurred_at, value, source)
             where not exists (
               select 1 from metric_values m
               where m.series_id = v.series_id and m.occurred_at = v.occurred_at and m.value = v.value
             )
             returning 1 as ok`,
            params,
          );
          inserted += rows.length;
          deduped += part.length - rows.length;
        }
      }
      return { inserted, deduped, series };
    });
  }
}
