// Юнит-тесты ICS-парсера (node:test, без сети/БД). Фикстуры — инлайн, время «сейчас» фиксируем
// через opts.now, чтобы окно и раскрытие повторов были детерминированы независимо от даты запуска.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIcs } from "../dist/ics.js";

// Локальный полдень 3 июля 2026. Окно фильтра: [2 июля 12:00, 17 июля 12:00].
const NOW = new Date(2026, 6, 3, 12, 0, 0);

function vcal(...lines: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
}

test("свёрнутые строки разворачиваются (продолжение с пробела)", () => {
  const text = vcal(
    "BEGIN:VEVENT",
    "DTSTART:20260705T090000",
    "SUMMARY:This is a very long summ",
    " ary text",
    "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs.length, 1);
  assert.equal(evs[0].summary, "This is a very long summary text");
});

test("all-day vs timed vs Z: allDay-флаг и формат start", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260705", "SUMMARY:allday", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20260705T090000", "SUMMARY:timed", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20260705T090000Z", "SUMMARY:zulu", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  const by = Object.fromEntries(evs.map((e) => [e.summary, e]));
  assert.equal(by.allday.allDay, true);
  assert.equal(by.allday.start, "2026-07-05");
  assert.equal(by.timed.allDay, false);
  assert.equal(by.timed.start, "2026-07-05T09:00:00");
  assert.equal(by.zulu.allDay, false);
  assert.match(by.zulu.start, /Z$/); // UTC-инстант отдаётся в ISO с Z
});

test("экранирование в SUMMARY снимается", () => {
  const text = vcal(
    "BEGIN:VEVENT",
    "DTSTART:20260705T090000",
    "SUMMARY:Meeting\\, lunch\\; and \\\\ end\\nline2",
    "LOCATION:Room 5\\, floor 2",
    "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs[0].summary, "Meeting, lunch; and \\ end\nline2");
  assert.equal(evs[0].location, "Room 5, floor 2");
});

test("RRULE FREQ=DAILY;COUNT=3 раскрывается в 3 события", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART:20260703T090000", "SUMMARY:daily", "RRULE:FREQ=DAILY;COUNT=3", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs.length, 3);
  assert.deepEqual(evs.map((e) => e.start), [
    "2026-07-03T09:00:00", "2026-07-04T09:00:00", "2026-07-05T09:00:00",
  ]);
});

test("RRULE FREQ=WEEKLY;BYDAY=MO,WE,FR раскрывается в горизонте", () => {
  const text = vcal(
    // 6 июля 2026 — понедельник
    "BEGIN:VEVENT", "DTSTART:20260706T090000", "SUMMARY:weekly", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  // Пн6, Ср8, Пт10, Пн13, Ср15, Пт17 (17-е 09:00 ≤ конца окна 17-е 12:00)
  assert.equal(evs.length, 6);
  assert.deepEqual(evs.map((e) => e.start), [
    "2026-07-06T09:00:00", "2026-07-08T09:00:00", "2026-07-10T09:00:00",
    "2026-07-13T09:00:00", "2026-07-15T09:00:00", "2026-07-17T09:00:00",
  ]);
});

test("RRULE UNTIL ограничивает раскрытие", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART:20260703T090000", "SUMMARY:until", "RRULE:FREQ=DAILY;UNTIL=20260705T120000", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs.length, 3); // 3,4,5 — 6-е уже за UNTIL
});

test("EXDATE исключает конкретное вхождение", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART:20260703T090000", "SUMMARY:exd",
    "RRULE:FREQ=DAILY;COUNT=5", "EXDATE:20260704T090000", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs.length, 4); // из 5 набора исключён 4 июля
  assert.ok(!evs.some((e) => e.start.startsWith("2026-07-04")), "4 июля исключено");
});

test("неподдерживаемый FREQ=MONTHLY → одно базовое событие с суффиксом (повтор)", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART:20260703T090000", "SUMMARY:monthly", "RRULE:FREQ=MONTHLY", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.equal(evs.length, 1);
  assert.ok(evs[0].summary.endsWith(" (повтор)"), "суффикс честной деградации");
});

test("сортировка по началу и фильтр по горизонту", () => {
  const text = vcal(
    "BEGIN:VEVENT", "DTSTART:20260710T090000", "SUMMARY:later", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20260705T090000", "SUMMARY:earlier", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART:20260801T090000", "SUMMARY:outside", "END:VEVENT",
  );
  const evs = parseIcs(text, { now: NOW });
  assert.deepEqual(evs.map((e) => e.summary), ["earlier", "later"]);
  assert.ok(!evs.some((e) => e.summary === "outside"), "событие за горизонтом отброшено");
});

test("текст без VEVENT → пустой список", () => {
  assert.deepEqual(parseIcs("just some text\r\nno events here", { now: NOW }), []);
});
