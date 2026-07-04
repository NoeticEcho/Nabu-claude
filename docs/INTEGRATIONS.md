# Интеграции Nabu — внешние API и автоматизации

Nabu не встраивает сотни API — **вы декларируете нужные** в `config/integrations.json`, и агенты
получают к ним узкий доступ: `list_connectors` / `call_connector` (только GET, путь обязан попадать
в allowlist) / `trigger_webhook` (внешнее действие — только через ваше одобрение, проверяемое по БД).
Секреты — **только в `.env`** (в конфиге — имена переменных). Каталог ниже — проверенные бесплатные
API по доменам Совета (середина 2026).

## Как подключить коннектор (1 минута)

```jsonc
// config/integrations.json → connectors
"exchange-rates": {
  "description": "Курсы валют ЕЦБ",
  "base_url": "https://api.frankfurter.dev",
  "auth": { "type": "none" },
  "allow": ["/v1/latest*"]
}
```
С ключом: `"auth": { "type": "header", "name": "X-Api-Key", "env": "NEWSAPI_KEY" }` + строка
`NEWSAPI_KEY=…` в `.env`. Дальше просто спросите адъютанта: «какой курс евро?» — он вызовет
`call_connector`.

## ⭐ ТОП-8 — подключайте первыми (без ключа, максимум пользы)

| # | API | Домен | Почему |
|---|---|---|---|
| 1 | Open-Meteo | инфра/lifestyle | Погода без ключа, 10k/день (предустановлен) |
| 2 | Frankfurter | инфра/finance | Курсы ЕЦБ, без ключа и лимитов |
| 3 | Nager.Date | admin | Праздники 100+ стран |
| 4 | Wikipedia REST | learning | Сводки статей |
| 5 | Free Dictionary | learning | Определения слов |
| 6 | Open Food Facts | health | Состав/нутриенты продуктов |
| 7 | CoinPaprika | finance | Крипто-цены без friction |
| 8 | MyHealthfinder | health | Гос. советы по здоровью |

## Каталог по доменам (все — read/GET, approval не нужен)

### health — здоровье
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| MyHealthfinder | Советы по возрасту/полу | нет | `https://odphp.health.gov/myhealthfinder/api/v4` | `/myhealthfinder.json?age=35&sex=male` |
| Open Food Facts | Состав и нутриенты | нет | `https://world.openfoodfacts.org` | `/api/v2/product/{barcode}.json` |
| USDA FoodData | Аналитика питания | ключ `USDA_FDC_KEY` | `https://api.nal.usda.gov/fdc/v1` | `/foods/search?query=apple` |
| wger | База 100+ упражнений | нет | `https://wger.de/api/v2` | `/exercise/search/?term=squat` |

### mind — ментальное
Сильных бесплатных API мало — ценность здесь даёт память Nabu. Вспомогательные: Advice Slip
(`https://api.adviceslip.com` → `/advice`), Affirmations (`https://www.affirmations.dev` → `/`).

### finance — финансы
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| Alpha Vantage | Акции, FX, крипто-ряды | ключ `ALPHAVANTAGE_KEY` | `https://www.alphavantage.co` | `/query?function=GLOBAL_QUOTE&symbol=AAPL` |
| Finnhub | Котировки и новости | ключ `FINNHUB_KEY` | `https://finnhub.io/api/v1` | `/quote?symbol=AAPL` |
| FRED | Макроэкономика США | ключ `FRED_KEY` | `https://api.stlouisfed.org/fred` | `/series/observations?series_id=GNPCA` |
| CoinPaprika | Крипто-цены | нет | `https://api.coinpaprika.com/v1` | `/tickers/btc-bitcoin` |

### work — работа
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| RemoteOK | Удалённые вакансии | нет | `https://remoteok.com` | `/api` |
| Arbeitnow | Вакансии ЕС/remote | нет | `https://www.arbeitnow.com/api` | `/job-board-api` |
| WakaTime | Статистика кодинга | ключ `WAKATIME_KEY` | `https://wakatime.com/api/v1` | `/users/current/stats` |

### learning — обучение
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| Wikipedia REST | Сводки статей | нет | `https://en.wikipedia.org/api/rest_v1` | `/page/summary/{title}` |
| Free Dictionary | Определения слов | нет | `https://api.dictionaryapi.dev/api/v2` | `/entries/en/{word}` |
| Open Library | Метаданные книг | нет | `https://openlibrary.org` | `/search.json?q=deep+work` |
| Gutendex | Книги Gutenberg | нет | `https://gutendex.com` | `/books?search=twain` |

### relationships — отношения
Подходящих публичных API практически нет (данные о людях приватны/OAuth). Опора — память Nabu;
напоминания о датах — Nager.Date/Calendarific (см. admin). Это честное «нет», а не пробел.

### growth — рост
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| ZenQuotes | Цитаты дня (нужна атрибуция; 5 req/30с — кэшировать) | нет | `https://zenquotes.io/api` | `/today` |
| Quotable | Цитаты по темам | нет | `https://api.quotable.io` | `/random?tags=wisdom` |
| Numbers API | Факт по числу/дате | нет | `http://numbersapi.com` | `/random/trivia` |

### lifestyle — быт и досуг
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| TheMealDB | Рецепты (dev-ключ `1`) | тест-ключ | `https://www.themealdb.com/api/json/v1/1` | `/search.php?s=pasta` |
| Spoonacular | Рецепты и меню | ключ `SPOONACULAR_KEY` | `https://api.spoonacular.com` | `/recipes/complexSearch?query=pasta` |
| TheCocktailDB | Коктейли (dev-ключ `1`) | тест-ключ | `https://www.thecocktaildb.com/api/json/v1/1` | `/search.php?s=margarita` |
| Open Brewery DB | Пивоварни рядом | нет | `https://api.openbrewerydb.org/v1` | `/breweries?by_city=berlin` |

### admin — логистика
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| Nager.Date | Гос. праздники | нет | `https://date.nager.at/api/v3` | `/PublicHolidays/2026/DE` |
| WorldTimeAPI | Время/таймзоны | нет | `https://worldtimeapi.org/api` | `/timezone/Europe/Berlin` |
| Calendarific | Праздники мира | ключ `CALENDARIFIC_KEY` | `https://calendarific.com/api/v2` | `/holidays?country=US&year=2026` |
| OCR.Space | Текст из изображений | ключ `OCRSPACE_KEY` | `https://api.ocr.space` | `/parse/imageurl?url=…` |

### 🚀 Предприниматель — рынок/SEO/компании/email
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| Open PageRank | Авторитет домена (SEO) | ключ `OPENPAGERANK_KEY` (загол. `API-OPR`) | `https://openpagerank.com/api/v1.0` | `/getPageRank?domains[]=example.com` |
| PageSpeed Insights | Core Web Vitals сайта | ключ опц. `PAGESPEED_KEY` | `https://www.googleapis.com/pagespeedonline/v5` | `/runPagespeed?url=https://site.com` |
| Clearbit Logo | Логотип по домену | нет | `https://logo.clearbit.com` | `/{domain}` |
| EVA | Валидация email | нет | `https://api.eva.pingutil.com` | `/email?email=test@x.com` |
| Hunter | B2B-почта: поиск/проверка | ключ `HUNTER_KEY` | `https://api.hunter.io/v2` | `/email-verifier?email=x` |
| Dev.to | Лента tech/startup | нет | `https://dev.to/api` | `/articles?tag=startup&top=7` |
| Domainsdb | Проверка доменных имён | нет | `https://api.domainsdb.info/v1` | `/domains/search?domain=nabu` |

Product Hunt — только OAuth (исключён); свежие продукты — Dev.to / HN `topstories.json`.

### Инфраструктура — кросс-доменные утилиты
| API | Что даёт | Auth | base_url | Пример GET |
|---|---|---|---|---|
| Open-Meteo | Погода | нет | `https://api.open-meteo.com/v1` | `/forecast?latitude=52.5&longitude=13.4&current=temperature_2m` |
| Open-Meteo Geocoding | Место → координаты | нет | `https://geocoding-api.open-meteo.com/v1` | `/search?name=Berlin&count=5` |
| Nominatim (OSM) | Геокодинг (1 req/с, нужен User-Agent) | нет | `https://nominatim.openstreetmap.org` | `/search?q=Berlin&format=json` |
| Frankfurter | Курсы валют ЕЦБ | нет | `https://api.frankfurter.dev/v1` | `/latest?base=USD&symbols=EUR` |
| REST Countries | Справочник стран | нет | `https://restcountries.com/v3.1` | `/name/germany` |
| rss2json | RSS → JSON | ключ опц. `RSS2JSON_KEY` | `https://api.rss2json.com/v1` | `/api.json?rss_url=…` |

---

# Автоматизации (n8n / Activepieces / Zapier)

Nabu говорит с платформами автоматизаций **generic-вебхуками** — привязки к вендору нет.

## Рекомендация: n8n (основная) · Activepieces (fallback)

| | n8n | Activepieces | Zapier |
|---|---|---|---|
| Лицензия | fair-code (для личного self-host — ок) | **MIT** | SaaS |
| Self-host | отлично (docker) | отлично, лёгкий (~1ГБ) | нет |
| Коннекторы | 400+ (+AI-ноды) | 200+ | 7000+ |
| Вебхуки | первоклассные | есть | **платно** (Professional) |

**Activepieces** — если нужна строго MIT-лицензия или проще UI. **Zapier** работает с Nabu без
доработок (Catch Hook → `/api/hooks/<name>`), но вебхуки там только на платном плане.

## Быстрый старт n8n

```bash
docker run -it --rm -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n
```
1. **Из мира в Nabu**: workflow → нода HTTP Request → `POST http://127.0.0.1:4517/api/hooks/capture?token=<токен>`
   (заголовки `X-Nabu-Timestamp`/`X-Nabu-Signature`, если настроен `secret_env`). Nabu создаст
   заметку или намерение.
2. **Из Nabu в мир**: workflow → нода Webhook (POST) → Production URL → в `.env`
   `N8N_NOTIFY_WEBHOOK_URL=<url>` → конфиг `webhooks.out`. Агент запускает через `trigger_webhook`
   **только после вашего одобрения** (кнопка в чате/TG; проверяется по БД).

## Контракт вебхуков (standard-webhooks-совместимый)

**Входящие** `POST /api/hooks/<name>`: токен (`?token=` или `X-Nabu-Token`) обязателен; при
`secret_env` — дополнительно HMAC-SHA256: `X-Nabu-Signature = hex(hmac(secret, "<ts>.<body>"))` +
`X-Nabu-Timestamp` (мс; окно ±5 мин против replay); `X-Nabu-Idempotency-Key` — повтор с тем же
ключом не создаёт дубль (TTL 1ч). Ответ мгновенный (`{ok, id, action}`).

**Исходящие** `trigger_webhook`: конверт `{id, type: "nabu.<name>", source: "nabu", timestamp,
data}`; заголовки `webhook-id` / `webhook-timestamp` / `webhook-signature: v1,<base64
hmac(secret, "id.ts.body")>` (при `secret_env`); ретраи 3×(backoff+джиттер) на сеть/5xx.
private/vault-данные в payload не включаются.

## Каверзы и гигиена

- **Rate limits**: кэшируйте «дневные» ответы (ZenQuotes 5/30с, Nominatim 1/с + User-Agent);
  не опрашивайте API в цикле.
- **Ключи только в env** — конфиг хранит имя переменной, значение никогда не попадает в
  конфиг/логи/git.
- **TOS/атрибуция**: ZenQuotes и Nominatim требуют атрибуцию; гос. API (FRED, USDA, Nager.Date,
  MyHealthfinder) — самые стабильные.
- **Приватность**: каталожные API — запросы о внешнем мире, не о пользователе. Личные данные
  (например, email в Hunter/EVA) — только с явного согласия: это внешняя публикация.

## Рецепт: почта → Входящие (n8n)

Пусть письма с определённой меткой сами становятся заметками в «Входящих» — а разберёт их
`/nabu-triage`.

1. **Триггер**: нода *Gmail Trigger* (или *IMAP Email*) — polling входящих.
2. **Фильтр**: нода *IF* — по отправителю/метке/теме (например, метка `nabu` или письма от себя),
   чтобы не тащить всю почту.
3. **Отправка в Nabu**: нода *HTTP Request* →
   `POST http://127.0.0.1:4517/api/hooks/capture?token=<токен>` c JSON-телом:

   ```json
   { "title": "{{$json.subject}}", "text": "{{$json.textPlain.slice(0,5000)}}" }
   ```

   Токен обязателен. При настроенном `secret_env` добавьте HMAC-заголовки
   `X-Nabu-Signature`/`X-Nabu-Timestamp` (+ опц. `X-Nabu-Idempotency-Key` = message-id письма,
   чтобы повтор polling'а не создал дубль) — полный контракт см. «Контракт вебхуков» выше.
   Nabu ответит `{ok, id, action}`; письмо станет заметкой (`fleeting`, private).

⚠️ **Приватность**: тело письма проходит транзитом через ваш n8n. Держите n8n **локально/self-host** —
облачный n8n = чужой сервер, куда уедет содержимое переписки. `vault`-чувствительное через почту
не заводите. Берите только `textPlain` (первые 5000) — не пересылайте вложения и HTML целиком.
