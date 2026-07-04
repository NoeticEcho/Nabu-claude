// Разбор ICS-календарей (RFC 5545) без OAuth: локальные .ics-файлы или подписки-URL
// (Google/Apple/Outlook умеют экспортировать .ics). Ноль новых зависимостей.
// Ограничения честно помечаются: TZID трактуется как локальное время; из повторов
// раскрываются только FREQ=DAILY и FREQ=WEEKLY, прочие FREQ дают лишь базовое событие
// с суффиксом " (повтор)". Тяжёлого ничего — чистый парсинг строк.

import { readFileSync } from "node:fs";

export interface CalEvent {
  summary: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  calendar?: string;
}

export interface IcsOptions {
  horizonDays?: number;
  now?: Date;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const MAX_ITER = 10_000; // страховка от рантайм-циклов на повреждённых RRULE

type DateKind = "date" | "local" | "utc";

interface ParsedDate {
  date: Date;
  kind: DateKind;
}

interface RRule {
  freq?: string;
  interval?: number;
  count?: number;
  until?: Date;
  byday?: string[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Развернуть свёрнутые строки (RFC 5545 §3.1): продолжение начинается с пробела/таба. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** Снять экранирование текстовых значений (\\n \\, \\; \\\\), RFC 5545 §3.3.11. */
function unescapeText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const next = s[++i];
      if (next === "n" || next === "N") out += "\n";
      else out += next; // , ; \ и неизвестные — просто следующий символ
    } else {
      out += c;
    }
  }
  return out;
}

/** DTSTART/DTEND/EXDATE/UNTIL: формы 20260703, ...T090000, ...T090000Z, ;TZID=...(→ локально). */
function parseDateValue(value: string, params: string): ParsedDate {
  const isDate = /(?:^|;)VALUE=DATE(?:;|$)/i.test(params);
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) throw new Error(`Некорректная дата ICS: ${value}`);
  const y = +m[1]!, mo = +m[2]! - 1, d = +m[3]!;
  if (!m[4] || isDate) return { date: new Date(y, mo, d), kind: "date" };
  const hh = +m[4], mi = +m[5]!, ss = +m[6]!;
  if (m[7]) return { date: new Date(Date.UTC(y, mo, d, hh, mi, ss)), kind: "utc" };
  // Без Z и с TZID — трактуем как локальное время (ограничение: без реального пересчёта TZ).
  return { date: new Date(y, mo, d, hh, mi, ss), kind: "local" };
}

function formatDate(date: Date, kind: DateKind): string {
  if (kind === "utc") return date.toISOString();
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (kind === "date") return ymd;
  return `${ymd}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseRRule(v: string): RRule {
  const r: RRule = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).toUpperCase();
    const val = part.slice(eq + 1);
    if (!val) continue;
    if (key === "FREQ") r.freq = val.toUpperCase();
    else if (key === "INTERVAL") r.interval = parseInt(val, 10);
    else if (key === "COUNT") r.count = parseInt(val, 10);
    else if (key === "UNTIL") r.until = parseDateValue(val, "").date;
    else if (key === "BYDAY") r.byday = val.split(",").map((s) => s.trim().toUpperCase().replace(/^[+-]?\d+/, ""));
  }
  return r;
}

function addDays(d: Date, n: number, utc: boolean): Date {
  const r = new Date(d);
  if (utc) r.setUTCDate(r.getUTCDate() + n);
  else r.setDate(r.getDate() + n);
  return r;
}

/** Понедельник недели данной даты (сохраняя время суток). */
function startOfWeekMonday(d: Date, utc: boolean): Date {
  const day = utc ? d.getUTCDay() : d.getDay(); // 0=Вс..6=Сб
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff, utc);
}

function weekdayCode(d: Date, utc: boolean): string {
  const day = utc ? d.getUTCDay() : d.getDay();
  return WEEKDAYS[(day + 6) % 7]!;
}

/**
 * Раскрыть DAILY/WEEKLY-повтор в окне [windowStart, windowEnd], учитывая COUNT/UNTIL/EXDATE.
 * COUNT считает вхождения от DTSTART (до вычета EXDATE); окно — лишь отсечка для эффективности.
 */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function expand(base: Date, kind: DateKind, rr: RRule, exdates: Set<number>, exdays: Set<string>, windowStart: Date, windowEnd: Date): Date[] {
  const utc = kind === "utc";
  const interval = rr.interval && rr.interval > 0 ? rr.interval : 1;
  const out: Date[] = [];
  let n = 0; // сколько вхождений набора уже перечислено (для COUNT)

  // true → продолжать, false → полностью остановиться
  const consider = (occ: Date): boolean => {
    if (rr.until && occ.getTime() > rr.until.getTime()) return false;
    if (occ.getTime() > windowEnd.getTime()) return false;
    if (rr.count != null && n >= rr.count) return false;
    n++;
    if (occ.getTime() >= windowStart.getTime() && !exdates.has(occ.getTime()) && !exdays.has(localDayKey(occ))) out.push(new Date(occ));
    return true;
  };

  if (rr.freq === "DAILY") {
    let cur = new Date(base);
    for (let i = 0; i < MAX_ITER; i++) {
      if (!consider(cur)) break;
      cur = addDays(cur, interval, utc);
    }
  } else if (rr.freq === "WEEKLY") {
    const byday = rr.byday && rr.byday.length ? rr.byday : [weekdayCode(base, utc)];
    let anchor = startOfWeekMonday(base, utc); // понедельник недели base со временем base
    for (let w = 0; w < MAX_ITER; w++) {
      if (w % interval === 0) {
        for (let idx = 0; idx < WEEKDAYS.length; idx++) {
          if (!byday.includes(WEEKDAYS[idx]!)) continue;
          const occ = addDays(anchor, idx, utc);
          if (occ.getTime() < base.getTime()) continue; // до DTSTART в наборе нет
          if (!consider(occ)) return out;
        }
      }
      anchor = addDays(anchor, 7, utc);
      if (anchor.getTime() > windowEnd.getTime() + 7 * DAY_MS) break;
    }
  }
  return out;
}

/**
 * Разобрать ICS-текст в список событий, отсортированных по началу и отфильтрованных в окне
 * [now-1d, now+horizonDays] (по умолчанию horizon=14). Поле calendar не заполняется —
 * его проставляет loadCalendars по имени источника.
 */
export function parseIcs(text: string, opts?: IcsOptions): CalEvent[] {
  const now = opts?.now ?? new Date();
  const horizonDays = opts?.horizonDays ?? 14;
  const windowStart = new Date(now.getTime() - DAY_MS);
  const windowEnd = new Date(now.getTime() + horizonDays * DAY_MS);

  const collected: Array<{ ev: CalEvent; startDate: Date }> = [];
  let cur: { props: Map<string, { value: string; params: string }>; exdates: string[] } | null = null;

  const finalize = (rec: NonNullable<typeof cur>): void => {
    const dtstart = rec.props.get("DTSTART");
    if (!dtstart) return; // без начала событие невалидно
    const startParsed = parseDateValue(dtstart.value, dtstart.params);
    const kind = startParsed.kind;
    const allDay = kind === "date";

    const dtend = rec.props.get("DTEND");
    let endKind: DateKind = kind;
    let durationMs: number | undefined;
    if (dtend) {
      const ep = parseDateValue(dtend.value, dtend.params);
      endKind = ep.kind;
      durationMs = ep.date.getTime() - startParsed.date.getTime();
    }

    const summaryRaw = rec.props.get("SUMMARY");
    const locationRaw = rec.props.get("LOCATION");
    const summary = summaryRaw ? unescapeText(summaryRaw.value) : "";
    const location = locationRaw ? unescapeText(locationRaw.value) : undefined;

    // r3-M8: EXDATE может быть date-формой против datetime-DTSTART (и наоборот) — реальные
    // календари формы смешивают. Храним точные времена И календарные дни date-формных EXDATE:
    // вхождение исключается по точному совпадению ИЛИ по дню, когда EXDATE дневной.
    const exdates = new Set<number>();
    const exdays = new Set<string>();
    for (const ex of rec.exdates) {
      try {
        const parsed = parseDateValue(ex, "");
        exdates.add(parsed.date.getTime());
        if (parsed.kind === "date" || !/T/.test(ex)) exdays.add(localDayKey(parsed.date));
      } catch {
        /* игнорируем некорректный EXDATE */
      }
    }

    let starts: Date[];
    let suffix = "";
    const rruleRaw = rec.props.get("RRULE");
    if (rruleRaw) {
      const rr = parseRRule(rruleRaw.value);
      if (rr.freq === "DAILY" || rr.freq === "WEEKLY") {
        starts = expand(startParsed.date, kind, rr, exdates, exdays, windowStart, windowEnd);
      } else {
        starts = [startParsed.date]; // прочие FREQ не раскрываем — честная деградация
        suffix = " (повтор)";
      }
    } else {
      starts = [startParsed.date];
    }

    for (const s of starts) {
      const ev: CalEvent = { summary: summary + suffix, start: formatDate(s, kind), allDay };
      if (durationMs != null) ev.end = formatDate(new Date(s.getTime() + durationMs), endKind);
      if (location) ev.location = location;
      collected.push({ ev, startDate: s });
    }
  };

  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = { props: new Map(), exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) finalize(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = namePart.indexOf(";");
    const name = (semi === -1 ? namePart : namePart.slice(0, semi)).toUpperCase();
    const params = semi === -1 ? "" : namePart.slice(semi + 1);
    if (name === "EXDATE") {
      for (const v of value.split(",")) cur.exdates.push(v.trim());
    } else if (!cur.props.has(name)) {
      cur.props.set(name, { value, params });
    }
  }

  return collected
    .filter((c) => c.startDate.getTime() >= windowStart.getTime() && c.startDate.getTime() <= windowEnd.getTime())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .map((c) => c.ev);
}

/**
 * Загрузить и разобрать несколько ICS-источников (path → файл, url → fetch с таймаутом 15с).
 * Ошибки по каждому источнику собираются, а не бросаются. Поле calendar = имя источника.
 */
export async function loadCalendars(
  sources: Array<{ name?: string; url?: string; path?: string }>,
  opts?: IcsOptions,
): Promise<{ events: CalEvent[]; errors: string[] }> {
  const events: CalEvent[] = [];
  const errors: string[] = [];
  for (const src of sources) {
    const label = src.name ?? src.url ?? src.path ?? "источник";
    try {
      let text: string;
      if (src.path) {
        text = readFileSync(src.path, "utf8");
      } else if (src.url) {
        const res = await fetch(src.url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } else {
        throw new Error("источник без path/url");
      }
      for (const ev of parseIcs(text, opts)) {
        events.push(src.name ? { ...ev, calendar: src.name } : ev);
      }
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
    }
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { events, errors };
}
