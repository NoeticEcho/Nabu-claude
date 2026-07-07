# Nabu Public API v1

REST+JSON API для внешних клиентов (мобильное приложение, скрипты, интеграции). Токен-аутентификация
(bearer), строгая изоляция по пользователю, версионирование `/api/v1`. Работает и на много-тенантном
инстансе (`NABU_MULTITENANT=1`), и на локальном одно-пользовательском (через `NABU_API_TOKEN`).

> База URL — тот же хост, что и веб-чат, за HTTPS-прокси: `https://<ваш-домен>/api/v1/…`
> (см. [`DEPLOY_HTTPS.md`](DEPLOY_HTTPS.md)). Локально: `http://127.0.0.1:4517/api/v1/…`.

## Аутентификация

Все защищённые запросы шлют заголовок:

```
Authorization: Bearer <token>
```

**Токен** имеет вид `nabu_pat_…`, в БД хранится только его sha256-хеш, токен показывается **один раз**
при создании. Токены **отзываемы** и привязаны к пользователю (изоляция: токен даёт доступ только к
данным своего аккаунта).

### Много-тенантный инстанс
1. Получить токен по email+паролю (bootstrap):
   ```
   POST /api/v1/auth/token
   { "email": "...", "password": "...", "name": "iPhone" }
   → 200 { "token": "nabu_pat_…", "id": "...", "note": "..." }
   ```
   Либо получить/выпустить токен из веб-интерфейса (🛠 OlimpOS → API-токены).
2. Далее слать `Authorization: Bearer <token>` во все запросы.

### Локальный инстанс (одно-пользовательский, без `NABU_MULTITENANT`)
Задайте статический токен в `~/Nabu/.env`:
```dotenv
NABU_API_TOKEN=<любая длинная случайная строка>
```
и используйте его как bearer. Без `NABU_API_TOKEN` публичный API в локальном режиме отключён (503).

### Ошибки
Единый конверт: `{ "error": { "code": "...", "message": "..." } }`.
Коды HTTP: `400` (валидация), `401` (нет/невалиден токен), `403` (чужой ресурс), `404`, `413`
(слишком большой ввод), `429` (rate-limit), `500`, `503` (API не сконфигурирован).

Rate-limit: чат — 20 запросов/мин на пользователя; выдача токена — 8/мин на email+IP.

---

## Эндпоинты

### Служебные
| Метод | Путь | Auth | Описание |
|---|---|---|---|
| GET | `/api/v1/health` | — | `{ ok, api:"v1", version, multitenant }` |
| POST | `/api/v1/auth/token` | — | email+password → `{ token, id }` (много-тенант) |
| GET | `/api/v1/auth/tokens` | ✔ | список своих токенов (без секретов) |
| POST | `/api/v1/auth/tokens` | ✔ | выпустить ещё токен: `{ name? }` → `{ token, id }` |
| DELETE | `/api/v1/auth/tokens/:id` | ✔ | отозвать свой токен |
| GET | `/api/v1/me` | ✔ | `{ userId, namespace, multitenant }` |

### Память
| GET | `/api/v1/memory/recall?q=<текст>&limit=<n>` | ✔ | поиск по памяти → `{ hits:[{id,kind,text,score,visibility,occurredAt}] }`. **vault не отдаётся.** |

### Задачи и проекты
| GET | `/api/v1/tasks?projectId=&status=&open=1` | ✔ | `{ tasks:[…] }` |
| POST | `/api/v1/tasks` | ✔ | `{ title, projectId?, priority?, due? }` → `{ task:{id} }` |
| POST | `/api/v1/tasks/:id/status` | ✔ | `{ status }` → `{ updated, xp }` |
| GET | `/api/v1/projects?status=` | ✔ | `{ projects:[…] }` |
| POST | `/api/v1/projects` | ✔ | `{ name, goal? }` → `{ project:{id} }` |

### OlimpOS (доска/агенты)
| GET | `/api/v1/olimpos/board?projectId=&sprintId=` | ✔ | `{ board:{todo,doing,review,done} }` |
| GET | `/api/v1/olimpos/agents?market=1` | ✔ | `{ agents:[…] }` (рынок или свои) |

### Разговоры
| GET | `/api/v1/conversations` | ✔ | треды тенанта `{ conversations:[{id,title,role,updatedAt}] }` |
| GET | `/api/v1/conversations/:id/messages?limit=` | ✔ | `{ messages:[{role,text,costUsd,at}] }` |

### Чат с адъютантом
| POST | `/api/v1/chat` | ✔ | `{ message, conversationId? }` → `{ conversationId, text, sessionId, costUsd }` |
| POST | `/api/v1/chat/stream` | ✔ | то же, но ответ — **SSE-поток** (`text/event-stream`); события: token-дельты, затем `done` |

Разговор адъютанта делится с веб-чатом и Telegram (общая история/сессия для одного пользователя).
`conversationId` можно не передавать — используется основной разговор адъютанта.

---

## Примеры (curl)

```bash
# 1. получить токен (много-тенант)
curl -sX POST https://olimpos.example.com/api/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"email":"me@x.com","password":"secret123","name":"cli"}'
# → {"token":"nabu_pat_XX:contentReference[oaicite:0]{index=0}","id":"..."}

TOKEN=nabu_pat_XXXXXXXX

# 2. кто я
curl -s https://olimpos.example.com/api/v1/me -H "authorization: Bearer $TOKEN"

# 3. создать задачу
curl -sX POST https://olimpos.example.com/api/v1/tasks \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Купить билеты","priority":"high"}'

# 4. спросить Совет (sync)
curl -sX POST https://olimpos.example.com/api/v1/chat \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"message":"Составь план недели с учётом моих целей"}'

# 5. поиск по памяти
curl -s "https://olimpos.example.com/api/v1/memory/recall?q=цели%20на%20квартал" \
  -H "authorization: Bearer $TOKEN"
```

---

## Безопасность и приватность

- Токены хранятся хешированными (sha256), сверка constant-time, отзыв немедленный.
- Каждый запрос scoped по пользователю токена (fail-closed); один пользователь **не** видит данные другого.
- `private`/`vault` не покидают инстанс: `recall` не отдаёт `vault`; эмбеддинги считаются локально.
- API за HTTPS-прокси; bearer-эндпоинты освобождены от same-origin CSRF (токен не отправляется браузером автоматически).
- Публичный только `/s/<slug>` (сайты) и `/api/v1/health`; остальное требует токен.

## Задел на будущее (не в v1, но заложено)

- OAuth2 (access+refresh) поверх того же слоя токенов.
- Скоупы токенов (read-only / конкретные домены) — колонка задела в `api_token`.
- Вебхуки исходящие уже есть (`nabu-connect`, HMAC) для push-интеграций.
- Пагинация курсором, ETag/If-None-Match для кэширования.
