// Юнит-тесты парсеров импорта финансов (без БД). Фикстуры — инлайн template-строками.
// Проверяем: РФ-выписка (';' + десятичная запятая), EN-выписка (',' + точка), DD.MM.YYYY,
// описание с разделителем внутри кавычек, категоризацию (hits + fallback + зарплата), warnings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankCsv, parseAmount, normalizeDate, categorize } from "../dist/finance-import.js";

// Тинькофф-подобная выписка: ';' разделитель, десятичная запятая, DD.MM.YYYY.
const TINKOFF_CSV = `Дата операции;Сумма операции;Описание;Валюта
01.07.2026;-1 234,56;Пятерочка;RUB
02.07.2026;-450,00;Яндекс Такси;RUB
05.07.2026;85 000,00;Зарплата за июнь;RUB`;

test("parseBankCsv: РФ-выписка ';' + десятичная запятая + DD.MM.YYYY", () => {
  const { txs, warnings } = parseBankCsv(TINKOFF_CSV);
  assert.equal(warnings.length, 0);
  assert.equal(txs.length, 3);

  assert.equal(txs[0].occurredOn, "2026-07-01");
  assert.equal(txs[0].amount, -1234.56); // «1 234,56» с пробелом-тысячником и запятой
  assert.equal(txs[0].description, "Пятерочка");
  assert.equal(txs[0].currency, "RUB");

  assert.equal(txs[2].amount, 85000); // приход положительный
  assert.equal(txs[2].occurredOn, "2026-07-05");
});

// EN-выписка: ',' разделитель, точка десятичная, ISO-дата, колонка Category от банка.
const EN_CSV = `Date,Amount,Description,Currency,Category
2026-07-01,-12.50,Starbucks Coffee,USD,cafe
2026-07-03,-1200.00,Monthly Rent,USD,housing
2026-07-04,3000.00,Salary,USD,income`;

test("parseBankCsv: EN-выписка ',' + точка + ISO + банк-категория", () => {
  const { txs, warnings } = parseBankCsv(EN_CSV);
  assert.equal(warnings.length, 0);
  assert.equal(txs.length, 3);
  assert.equal(txs[0].occurredOn, "2026-07-01");
  assert.equal(txs[0].amount, -12.5);
  assert.equal(txs[0].currency, "USD");
  // Банк дал категорию — она сохранена в tx.category (приоритет над авто-категоризацией).
  assert.equal(txs[0].category, "cafe");
  assert.equal(txs[1].category, "housing");
});

// Описание с разделителем ';' внутри кавычек — не должно сдвинуть колонки.
const QUOTED_CSV = `Дата операции;Сумма операции;Описание;Валюта
10.07.2026;-2 000,00;"Кафе ""Уют""; ужин на двоих";RUB`;

test("parseBankCsv: разделитель внутри кавычек не ломает разбор", () => {
  const { txs } = parseBankCsv(QUOTED_CSV);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].description, 'Кафе "Уют"; ужин на двоих');
  assert.equal(txs[0].amount, -2000);
  assert.equal(txs[0].currency, "RUB");
});

test("parseBankCsv: warnings на кривой строке, а не throw", () => {
  const csv = `Дата операции;Сумма операции;Описание;Валюта
01.07.2026;-100,00;Магнит;RUB
непонятно;абвгд;мусор;RUB
03.07.2026;-50,00;Кофе;RUB`;
  const { txs, warnings } = parseBankCsv(csv);
  assert.equal(txs.length, 2); // валидные строки прошли
  assert.equal(warnings.length, 1); // одна кривая строка отмечена
  assert.ok(warnings[0].includes("1"), "warning должен содержать счётчик пропущенных");
});

test("parseBankCsv: нет обязательных колонок → warning, пустой результат", () => {
  const { txs, warnings } = parseBankCsv("Foo;Bar;Baz\n1;2;3");
  assert.equal(txs.length, 0);
  assert.equal(warnings.length, 1);
});

test("parseAmount: пробелы/nbsp тысячники, запятая и точка десятичные", () => {
  assert.equal(parseAmount("1 234,56"), 1234.56);
  assert.equal(parseAmount("1\u00A0234,56"), 1234.56); // nbsp-тысячник как разделитель
  assert.equal(parseAmount("-1 000,00"), -1000);
  assert.equal(parseAmount("1234.56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56); // EN-формат: запятая тысячник, точка десятичная
  assert.equal(parseAmount("500"), 500);
});

test("normalizeDate: DD.MM.YYYY и YYYY-MM-DD → ISO", () => {
  assert.equal(normalizeDate("01.07.2026"), "2026-07-01");
  assert.equal(normalizeDate("2026-07-01"), "2026-07-01");
  assert.equal(normalizeDate("2026-07-01 12:34:56"), "2026-07-01"); // время отбрасывается
  assert.equal(normalizeDate("мусор"), "");
});

test("categorize: RU/EN hits + fallback", () => {
  assert.equal(categorize("Пятерочка на Тверской"), "продукты");
  assert.equal(categorize("Яндекс Такси"), "транспорт");
  assert.equal(categorize("Netflix subscription"), "подписки");
  assert.equal(categorize("Spotify"), "подписки");
  assert.equal(categorize("Зарплата за июнь"), "зарплата"); // положительный приход по ключу описания
  assert.equal(categorize("Кофе Point"), "кафе");
  assert.equal(categorize("Нечто неведомое ООО"), "другое"); // fallback
});
