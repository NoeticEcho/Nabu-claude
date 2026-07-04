// Импорт банковских транзакций из ФАЙЛОВЫХ ВЫПИСОК (CSV из личного кабинета банка).
// НИКАКИХ банковских API/OAuth: разбор 100% локальный, точки складываются в общую
// finance_transaction. Данные приватны по умолчанию, никуда не уходят.
// Философия, форматы выписок и категоризация — docs/FINANCE_IMPORT.md.

import { createHash } from "node:crypto";
import type { Postgres } from "./db/postgres.js";

/** Одна финансовая транзакция: дата (ISO YYYY-MM-DD), сумма (расход < 0), описание, опц. валюта/категория. */
export interface FinanceTx {
  occurredOn: string;
  amount: number;
  currency?: string;
  description: string;
  category?: string;
}

// ── Разбор CSV-строки ─────────────────────────────────────────────────────────

/**
 * Корректный разбор одной CSV-строки с заданным разделителем: кавычки, разделитель внутри
 * кавычек, экранирование "". Подход скопирован из health-import parseCsvLine, но делимитер
 * параметризован (банки РФ часто используют ';').
 */
export function parseCsvLine(line: string, delim = ","): string[] {
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
    } else if (ch === delim) {
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

/** Определить разделитель по заголовку: у РФ-банков ';', у EN обычно ','. Больше вхождений — тот и есть. */
function detectDelimiter(header: string): "," | ";" {
  const semi = (header.match(/;/g) ?? []).length;
  const comma = (header.match(/,/g) ?? []).length;
  return semi > comma ? ";" : ",";
}

/**
 * Разобрать денежную сумму: терпимо к пробелам/nbsp как разделителю тысяч и запятой как
 * десятичной точке. «1 234,56» → 1234.56, «-1 000,00» → -1000, «1234.56» → 1234.56.
 * Знак сохраняется. NaN, если после чистки не число.
 */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[\s  ]/g, "");
  // Есть и запятая, и точка → определяем десятичный по последнему разделителю.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      // запятая десятичная: точки — разделители тысяч
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // точка десятичная: запятые — разделители тысяч
      s = s.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // только запятая → десятичная
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return n;
}

/**
 * Нормализовать дату: принимаем DD.MM.YYYY (РФ-банки) и YYYY-MM-DD (ISO), отдаём YYYY-MM-DD.
 * Хвост (время) игнорируется — храним по дню. Пустая/нераспознанная → пустая строка.
 */
export function normalizeDate(raw: string): string {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

// ── Сопоставление колонок по заголовку (RU/EN, по подстроке без учёта регистра) ──

/** Найти индекс колонки по любой из подстрок заголовка (первое совпадение). -1 если нет. */
function findCol(header: string[], needles: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = header[i]!;
    if (needles.some((n) => h.includes(n))) return i;
  }
  return -1;
}

/**
 * Разбор банковской CSV-выписки с автоопределением: разделитель (',' vs ';'), десятичная
 * запятая, сопоставление колонок по подстрокам заголовка (RU/EN). Строки, которые не удалось
 * распарсить (нет даты/суммы), идут в warnings (счётчиком), а не роняют импорт.
 */
export function parseBankCsv(csv: string): { txs: FinanceTx[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = csvLines(csv);
  if (lines.length < 2) {
    if (lines.length <= 1) warnings.push("Пустая выписка или только заголовок — 0 транзакций");
    return { txs: [], warnings };
  }

  const delim = detectDelimiter(lines[0]!);
  const header = parseCsvLine(lines[0]!, delim).map((h) => h.toLowerCase());

  const idxDate = findCol(header, ["дата операции", "operation date", "дата", "date"]);
  const idxAmount = findCol(header, ["сумма операции", "сумма", "amount"]);
  const idxDesc = findCol(header, ["описание", "назначение", "description", "merchant", "категория банка"]);
  const idxCurrency = findCol(header, ["валюта", "currency"]);
  const idxCategory = findCol(header, ["категория", "category"]);

  if (idxDate < 0 || idxAmount < 0) {
    warnings.push(
      `Не найдены обязательные колонки (дата/сумма) в заголовке — проверьте формат выписки. Заголовок: ${header.join(delim)}`,
    );
    return { txs: [], warnings };
  }

  const txs: FinanceTx[] = [];
  let bad = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!, delim);
    const occurredOn = normalizeDate(cells[idxDate] ?? "");
    const amount = parseAmount(cells[idxAmount] ?? "");
    if (!occurredOn || !Number.isFinite(amount)) {
      bad++;
      continue;
    }
    const description = (idxDesc >= 0 ? cells[idxDesc] : "")?.trim() || "(без описания)";
    const currency = idxCurrency >= 0 ? cells[idxCurrency]?.trim() || undefined : undefined;
    // Категория банка (если он её дал и это не та же колонка, что описание) — приоритетна.
    const bankCat = idxCategory >= 0 && idxCategory !== idxDesc ? cells[idxCategory]?.trim() || undefined : undefined;
    txs.push({ occurredOn, amount, currency, description, category: bankCat });
  }
  if (bad > 0) warnings.push(`Пропущено строк (не удалось разобрать дату/сумму): ${bad}`);
  return { txs, warnings };
}

// ── Встроенная категоризация (RU/EN, первое совпадение по подстроке) ─────────────

/** Правила категоризации: категория → ключевые подстроки (нижний регистр). Порядок = приоритет. */
const CATEGORY_RULES: Array<[string, string[]]> = [
  ["зарплата", ["зарплата", "salary", "аванс", "выплата зп"]],
  ["продукты", ["пятерочка", "пятёрочка", "магнит", "перекресток", "перекрёсток", "лента", "ашан", "дикси", "вкусвилл", "grocery", "supermarket"]],
  ["кафе", ["кафе", "ресторан", "кофе", "coffee", "restaurant", "bar", "бар", "макдоналдс", "мак ", "kfc", "бургер", "burger", "вкусно и точка", "столовая"]],
  ["транспорт", ["метро", "такси", "uber", "яндекс.так", "яндекс такси", "транспорт", "fuel", "азс", "бензин", "заправка", "тройка", "каршеринг"]],
  ["жильё", ["жкх", "аренда", "rent", "квартплата", "электроэнерг", "коммунальн", "управляющая компания"]],
  ["связь", ["мтс", "билайн", "мегафон", "tele2", "теле2", "интернет", "ростелеком"]],
  ["здоровье", ["аптека", "клиника", "врач", "pharmacy", "медицин", "стоматолог", "больница", "анализы"]],
  ["подписки", ["spotify", "netflix", "яндекс.плюс", "яндекс плюс", "subscription", "подписка", "apple.com", "itunes", "google", "youtube premium", "ivi", "okko"]],
  ["одежда", ["одежда", "zara", "h&m", "uniqlo", "обувь", "wildberries", "ozon", "спортмастер", "clothing"]],
  ["техника", ["днс", "dns", "мвидео", "м.видео", "эльдорадо", "техника", "electronics", "citilink", "ситилинк"]],
  ["развлечения", ["кино", "cinema", "театр", "концерт", "боулинг", "игры", "steam", "playstation", "развлеч"]],
  ["путешествия", ["авиабилет", "aviasales", "отель", "hotel", "booking", "airbnb", "ржд", "поезд", "flight", "travel", "туризм"]],
  ["образование", ["курс", "course", "udemy", "coursera", "школа", "обучение", "education", "университет", "репетитор"]],
  ["переводы", ["перевод", "transfer", "сбп", "c2c", "p2p"]],
];

/**
 * Определить категорию по описанию транзакции: подстрочное совпадение без учёта регистра,
 * первое совпавшее правило выигрывает. Ничего не совпало → «другое».
 * Не различает знак суммы — «зарплата» ловится по ключу описания (вызывающий может уточнить).
 */
export function categorize(description: string): string {
  const d = description.toLowerCase();
  for (const [cat, needles] of CATEGORY_RULES) {
    if (needles.some((n) => d.includes(n))) return cat;
  }
  return "другое";
}

/** Список встроенных категорий (для документации/CLI). */
export const CATEGORIES: string[] = [...CATEGORY_RULES.map(([c]) => c), "другое"];

// ── Запись в БД ─────────────────────────────────────────────────────────────────

const CHUNK = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Хэш строки выписки для дедупа: sha256(occurredOn|amount|description) hex. */
function txHash(tx: FinanceTx): string {
  return createHash("sha256").update(`${tx.occurredOn}|${tx.amount}|${tx.description}`).digest("hex");
}

/** Итог импорта: сколько вставлено, сколько отсеяно дедупом, суммы (abs) по категориям для вставленных. */
export interface ImportResult {
  inserted: number;
  deduped: number;
  byCategory: Record<string, number>;
}

/** Сводка за период: расход (abs отрицательных), доход (сумма положительных), топ-категории, число транзакций. */
export interface FinanceSummary {
  days: number;
  spent: number;
  income: number;
  topCategories: Array<{ category: string; spent: number }>;
  txCount: number;
  currency: string;
}

/**
 * Идемпотентный импорт транзакций в общую finance_transaction.
 * Скоуп по пользователю (fail-closed как DomainRepository). category = tx.category ?? categorize(description).
 * Повторный импорт того же файла ничего не дублирует (unique по user_id+tx_hash).
 */
export class FinanceImportRepository {
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
        "NABU_USER_ID не задан, а в общей БД несколько пользователей. Задайте NABU_USER_ID (uuid из public.users) для корректной изоляции — импорт финансов заблокирован во избежание утечки.",
      );
    }
    this.userId = rows[0]!.id;
    return this.userId;
  }

  async importTransactions(txs: FinanceTx[], source: string): Promise<ImportResult> {
    const u = await this.user();
    if (txs.length === 0) return { inserted: 0, deduped: 0, byCategory: {} };

    // Схлопнуть точные дубликаты внутри самого файла (по хэшу) — часть идемпотентности.
    const seen = new Set<string>();
    const rows: Array<{ tx: FinanceTx; hash: string; category: string }> = [];
    for (const tx of txs) {
      const hash = txHash(tx);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const category = tx.category?.trim() || categorize(tx.description);
      rows.push({ tx, hash, category });
    }

    return this.pg.tx(async (t) => {
      let inserted = 0;
      const byCategory: Record<string, number> = {};
      for (const part of chunk(rows, CHUNK)) {
        const values: string[] = [];
        const params: unknown[] = [];
        for (const r of part) {
          const b = params.length;
          values.push(
            `($${b + 1}::uuid,$${b + 2}::date,$${b + 3}::numeric,$${b + 4}::text,$${b + 5}::text,$${b + 6}::text,$${b + 7}::text,$${b + 8}::text)`,
          );
          params.push(u, r.tx.occurredOn, r.tx.amount, r.tx.currency ?? "RUB", r.tx.description, r.category, source, r.hash);
        }
        // on conflict (user_id, tx_hash) do nothing — реимпорт не дублирует; RETURNING даёт реально вставленные.
        const ins = await t.query<{ amount: string; category: string }>(
          `insert into finance_transaction(user_id, occurred_on, amount, currency, description, category, source, tx_hash)
           values ${values.join(",")}
           on conflict (user_id, tx_hash) do nothing
           returning amount, category`,
          params,
        );
        inserted += ins.length;
        for (const row of ins) {
          const cat = row.category;
          byCategory[cat] = (byCategory[cat] ?? 0) + Math.abs(Number(row.amount));
        }
      }
      for (const k of Object.keys(byCategory)) byCategory[k] = round2(byCategory[k]!);
      return { inserted, deduped: rows.length - inserted, byCategory };
    });
  }

  /** Сводка за последние `days` дней: для CLI-вывода и будущего министра finance. */
  async summary(days = 30): Promise<FinanceSummary> {
    const u = await this.user();
    const spentRows = await this.pg.query<{ category: string; spent: string }>(
      `select category, sum(abs(amount)) as spent from finance_transaction
       where user_id = $1 and amount < 0 and occurred_on >= (current_date - $2::int)
       group by category order by spent desc`,
      [u, days],
    );
    const totals = await this.pg.queryOne<{ spent: string | null; income: string | null; cnt: string }>(
      `select
         coalesce(sum(case when amount < 0 then abs(amount) else 0 end),0) as spent,
         coalesce(sum(case when amount > 0 then amount else 0 end),0) as income,
         count(*) as cnt
       from finance_transaction
       where user_id = $1 and occurred_on >= (current_date - $2::int)`,
      [u, days],
    );
    const cur = await this.pg.queryOne<{ currency: string }>(
      `select currency from finance_transaction where user_id = $1
       group by currency order by count(*) desc limit 1`,
      [u],
    );
    return {
      days,
      spent: round2(Number(totals?.spent ?? 0)),
      income: round2(Number(totals?.income ?? 0)),
      topCategories: spentRows.slice(0, 5).map((r) => ({ category: r.category, spent: round2(Number(r.spent)) })),
      txCount: Number(totals?.cnt ?? 0),
      currency: cur?.currency ?? "RUB",
    };
  }
}
