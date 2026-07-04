// Юнит-тесты парсеров импорта здоровья (без БД). Фикстуры — инлайн template-строками.
// Проверяем: Apple XML (quantity + sleep + unknown), Google Fit CSV (кавычки с запятой),
// generic CSV, detectFormat (4 исхода), нормализацию даты Apple (+0300).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAppleHealth,
  parseAppleHealthStats,
  parseGoogleFitDaily,
  parseGenericCsv,
  parseCsvLine,
  normalizeAppleDate,
  detectFormat,
} from "../dist/health-import.js";

// 5 записей: 2 steps, 1 heart rate, 1 sleep (start/end 8ч), 1 неизвестный тип.
const APPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [<!ELEMENT HealthData (Record)*>]>
<HealthData locale="en_US">
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-01 07:00:00 +0300" endDate="2026-07-01 08:00:00 +0300" value="512"/>
 <Record type="HKQuantityTypeIdentifierStepCount" unit="count" startDate="2026-07-01 09:00:00 +0300" endDate="2026-07-01 10:00:00 +0300" value="333"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" unit="count/min" startDate="2026-07-01 07:30:00 +0300" endDate="2026-07-01 07:30:00 +0300" value="68"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-07-01 00:00:00 +0300" endDate="2026-07-01 08:00:00 +0300"/>
 <Record type="HKQuantityTypeIdentifierDietaryWater" unit="mL" startDate="2026-07-01 12:00:00 +0300" endDate="2026-07-01 12:00:00 +0300" value="250"/>
</HealthData>`;

test("parseAppleHealth: quantity + sleep + skip unknown", () => {
  const { points, skippedTypes } = parseAppleHealthStats(APPLE_XML);
  const steps = points.filter((p) => p.metric === "steps");
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((p) => p.value),
    [512, 333],
  );
  assert.equal(steps[0].unit, "count");

  const hr = points.filter((p) => p.metric === "heart_rate");
  assert.equal(hr.length, 1);
  assert.equal(hr[0].value, 68);
  assert.equal(hr[0].unit, "count/min");

  const sleep = points.filter((p) => p.metric === "sleep");
  assert.equal(sleep.length, 1);
  assert.equal(sleep[0].value, 8); // 00:00 → 08:00 = 8ч
  assert.equal(sleep[0].unit, "h");

  // Неизвестный тип (DietaryWater) — пропущен и посчитан.
  assert.equal(skippedTypes["HKQuantityTypeIdentifierDietaryWater"], 1);
  assert.equal(points.some((p) => p.value === 250), false);

  // Упрощённый API возвращает те же точки.
  assert.equal(parseAppleHealth(APPLE_XML).length, points.length);
});

test("normalizeAppleDate: '+0300' offset → ISO with colon", () => {
  assert.equal(normalizeAppleDate("2026-07-01 07:00:00 +0300"), "2026-07-01T07:00:00+03:00");
  assert.equal(normalizeAppleDate("2026-12-31 23:59:59 -0500"), "2026-12-31T23:59:59-05:00");
});

test("parseAppleHealth: occurredAt = normalized startDate", () => {
  const p = parseAppleHealth(APPLE_XML)[0];
  assert.equal(p.occurredAt, "2026-07-01T07:00:00+03:00");
});

// Google Fit: 3 дня. Поле Source с запятой внутри кавычек стоит ПЕРЕД читаемыми колонками —
// наивный split сместил бы индексы; корректный parseCsvLine сохраняет выравнивание.
const GOOGLE_CSV = `Date,Source,Step count,Distance (m),Average heart rate (bpm),Calories (kcal)
2026-07-01,"Pixel Watch, Fit",5120,4200.5,66,310
2026-07-02,Phone,8000,6100,70,455
2026-07-03,Phone,3000,2500,,180`;

test("parseGoogleFitDaily: maps columns, m→km, handles quoted comma field", () => {
  const pts = parseGoogleFitDaily(GOOGLE_CSV);
  const day1 = pts.filter((p) => p.occurredAt === "2026-07-01");
  // Запятая внутри кавычек в Source не должна сдвинуть колонку Step count.
  const steps1 = day1.find((p) => p.metric === "steps");
  assert.equal(steps1?.value, 5120);
  const dist1 = day1.find((p) => p.metric === "distance");
  assert.equal(dist1?.value, 4.2005); // 4200.5м → км
  assert.equal(dist1?.unit, "km");

  // День 3: пустой heart rate → нет точки heart_rate.
  const day3 = pts.filter((p) => p.occurredAt === "2026-07-03");
  assert.equal(day3.some((p) => p.metric === "heart_rate"), false);
  assert.ok(day3.some((p) => p.metric === "steps" && p.value === 3000));

  // Все три дня дали точки.
  assert.equal(new Set(pts.map((p) => p.occurredAt)).size, 3);
});

test("parseCsvLine: quotes, embedded comma, escaped double-quote", () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
  assert.deepEqual(parseCsvLine('"he said ""hi""",x'), ['he said "hi"', "x"]);
  assert.deepEqual(parseCsvLine("1,2,3"), ["1", "2", "3"]);
});

const GENERIC_CSV = `metric,date,value,unit
weight,2026-07-01,81.5,kg
steps,2026-07-01,9000,count
weight,2026-07-02,81.2,kg`;

test("parseGenericCsv: order-insensitive header, optional unit", () => {
  const pts = parseGenericCsv(GENERIC_CSV);
  assert.equal(pts.length, 3);
  const w = pts.filter((p) => p.metric === "weight");
  assert.equal(w.length, 2);
  assert.equal(w[0].value, 81.5);
  assert.equal(w[0].unit, "kg");
  assert.equal(w[0].occurredAt, "2026-07-01");
});

test("parseGenericCsv: without unit column", () => {
  const pts = parseGenericCsv("date,metric,value\n2026-07-01,mood,7");
  assert.equal(pts.length, 1);
  assert.equal(pts[0].unit, undefined);
  assert.equal(pts[0].value, 7);
});

test("detectFormat: all four outcomes", () => {
  assert.equal(detectFormat(APPLE_XML, "export.xml"), "apple");
  assert.equal(detectFormat(GOOGLE_CSV, "Daily activity metrics.csv"), "google-fit");
  assert.equal(detectFormat(GENERIC_CSV, "my.csv"), "generic");
  assert.equal(detectFormat("just some text\nno markers here"), null);
});
