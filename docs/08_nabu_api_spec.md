# NABU

*API Specification*  
*REST · SSE · Realtime · MCP*  
*Контракты публичных интерфейсов сервера Nabu*  
*Версия 1.0*  

---

# 1. Назначение

Документ фиксирует контракты публичных API сервера Nabu. Полные машиночитаемые OpenAPI 3.1 описания автоматически генерируются из NestJS-декораторов и публикуются в /v1/openapi.json. Этот документ — нормативная база и обзор для разработчиков и AI-команды.

Покрытие: REST endpoints, SSE-стриминг, Realtime-каналы, MCP-эндпоинты. Не покрывает: внутренние сервис-сервис вызовы (документированы в SAD §4.6).

# 2. Общие соглашения

## 2.1. Версионирование

- Префикс пути: /v1/. Мажорная версия — в URL. Минорные — обратно совместимые.
- Заголовок X-API-Deprecation в ответах удаляемых эндпоинтов: дата планируемого удаления + ссылка на замену.
- Брейкинг-чейнджи — только в /v2/. Старая версия живёт ≥ 12 месяцев параллельно.

## 2.2. Аутентификация

- Все non-public эндпоинты требуют Authorization: Bearer <jwt>.
- JWT валидируется через Supabase GoTrue public key (cached, ротация 24ч).
- Refresh — отдельный эндпоинт POST /v1/auth/refresh; access-token TTL 1 час, refresh-token TTL 30 дней.
- Service-role JWT (для worker'ов) — отдельный issuer, права расширенные, не выдаётся клиентам.

## 2.3. Формат запроса и ответа

- Content-Type: application/json для всех тел, кроме file uploads (multipart/form-data) и streams (text/event-stream).
- Все поля в snake_case. Даты — ISO 8601 с timezone.
- UUID — для всех id (v7 — time-sortable).

## 2.4. Стандартный формат ошибки

```
{
  "error": {
    "code": "validation_failed",
    "message": "Title must not be empty",
    "trace_id": "01h93k2a...",
    "details": [
      { "path": "title", "issue": "required" }
    ]
  }
}
```

## 2.5. Каталог кодов ошибок

| **Код** | **HTTP** | **Описание** |
| --- | --- | --- |
| validation_failed | 400 | Невалидный запрос. details содержит поля. |
| unauthorized | 401 | JWT отсутствует или невалиден. |
| forbidden | 403 | JWT валиден, но прав не хватает (RLS отклонил). |
| not_found | 404 | Ресурс не существует или скрыт RLS. |
| conflict | 409 | Optimistic-lock конфликт по version_number или дубликат уникального ключа. |
| rate_limited | 429 | Превышен rate limit. Retry-After в заголовке. |
| payload_too_large | 413 | Содержимое заметки или файла больше лимита (по умолчанию 5 МБ). |
| llm_unavailable | 503 | Внешний LLM-провайдер недоступен; задача поставлена в retry. |
| agent_failed | 500 | Агент упал; ошибка записана в audit_log; задача в retry. |
| internal_error | 500 | Непредвиденная ошибка; trace_id обязателен. |

## 2.6. Pagination и фильтры

- Cursor-based: ?cursor=<opaque>&limit=20. limit ≤ 100.
- Ответ списка: { items: [...], next_cursor: "..."|null }.
- Никаких offset-based страниц (плохо ведут себя при больших корпусах).
- Фильтры — query-параметры в snake_case: ?status=evergreen&domain=health&updated_since=2026-01-01.

## 2.7. Rate limiting

| **Класс эндпоинтов** | **Лимит** | **Бакет** |
| --- | --- | --- |
| Auth (login, register, reset) | 10/мин на IP | По IP |
| Запись (POST/PATCH/PUT/DELETE) | 60/мин на user | По user_id |
| Чтение (GET) | 300/мин на user | По user_id |
| Агентский запрос (sync) | 20/мин на user | По user_id |
| Sync push/pull | 120/мин на device | По device_id |
| Streaming (SSE) | 10 одновременных | По user_id |

# 3. REST endpoints (нормативный обзор)

Полный schema — в /v1/openapi.json. Здесь — функциональный обзор групп.

## 3.1. Auth (/v1/auth/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/auth/register | POST | Регистрация email+password. Тело: { email, password }. Возврат: { user_id, requires_email_confirmation }. |
| /v1/auth/login | POST | Вход. Тело: { email, password } или { email, otp }. Возврат: { access_token, refresh_token, expires_at, user }. |
| /v1/auth/magic-link | POST | Запрос magic-link на email. Тело: { email }. |
| /v1/auth/refresh | POST | Обновление access-token. Тело: { refresh_token }. |
| /v1/auth/logout | POST | Отзыв refresh-token. |
| /v1/auth/me | GET | Текущий пользователь. JWT обязателен. |
| /v1/auth/mfa/totp/setup | POST | Запуск настройки TOTP. Возврат: { qr_code, secret }. |
| /v1/auth/mfa/totp/verify | POST | Подтверждение TOTP. Тело: { code }. |
| /v1/auth/oauth/{provider}/init | GET | Редирект на провайдер (google, apple, github). |
| /v1/auth/oauth/{provider}/callback | GET | Обработка callback от провайдера. |
| /v1/auth/account | DELETE | Запрос удаления аккаунта. 24ч окно отмены. |
| /v1/auth/account/export | POST | Запуск экспорта данных. Возврат: { job_id }. Готовый zip — через job-status. |

## 3.2. Заметки (/v1/notes/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/notes | POST | Создать заметку. Тело: { title, content_md, frontmatter, parent_id? }. Возврат: { id, version, created_at, ... }. |
| /v1/notes | GET | Список заметок. Фильтры: status, domain, type, visibility, tag, updated_since. |
| /v1/notes/{id} | GET | Получить заметку. Возврат: { id, title, content_md, frontmatter, version, links, backlinks, ... }. |
| /v1/notes/{id} | PATCH | Обновить заметку. Тело: { content_md, frontmatter, base_version }. base_version обязателен для optimistic-lock. |
| /v1/notes/{id} | DELETE | Soft-delete. 30-дневное окно восстановления. |
| /v1/notes/{id}/restore | POST | Восстановление из soft-delete. |
| /v1/notes/{id}/versions | GET | Список версий. |
| /v1/notes/{id}/versions/{n} | GET | Получить конкретную версию. |
| /v1/notes/{id}/restore-version | POST | Откат к версии. Тело: { version_number }. Создаёт новую версию = указанной. |
| /v1/notes/{id}/visibility | PATCH | Изменить visibility. Тело: { visibility: 'default'\|'private'\|'vault' }. Для vault — обязателен encrypted_payload. |
| /v1/notes/{id}/links | GET | Backlinks + forward links. |
| /v1/notes/{id}/similar | GET | Семантически близкие через pgvector. Возврат: { items: [{ note_id, score, snippet }] }. |
| /v1/notes/search | GET | Гибридный поиск (BM25 + vector). ?q=...&mode=hybrid\|bm25\|vector. |

## 3.3. Агенты и конвейер (/v1/agents/*, /v1/pipeline/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/agents | GET | Список доступных агентов с их конфигурациями. |
| /v1/agents/{name}/invoke | POST | Синхронный вызов агента. Тело: { input, context? }. Для тяжёлых — используется stream. |
| /v1/agents/{name}/stream | POST | SSE-стриминг ответа. См. §4. |
| /v1/agents/{name}/config | PATCH | Изменить модель/параметры агента. Тело: { model, temperature, max_tokens, ... }. |
| /v1/pipeline/runs/{note_id} | GET | Статус конвейера обработки конкретной заметки. Возврат: { stages: [{ agent, status, duration_ms, output_summary }] }. |
| /v1/pipeline/replay | POST | Перезапуск конвейера для заметки (например, после изменения промпта). Тело: { note_id, from_stage? }. |

## 3.4. Граф знаний (/v1/graph/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/graph/entities | GET | Сущности из TypeDB. Фильтры: ?type=person\|project\|...&q=... |
| /v1/graph/entities/{id} | GET | Сущность с атрибутами и связями. |
| /v1/graph/entities/{id}/related | GET | Связанные сущности (1 hop, 2 hop). ?depth=1..3. |
| /v1/graph/query | POST | TQL-запрос (для продвинутых пользователей и интеграций). Возврат: { results, schema_info }. |
| /v1/graph/snapshot | GET | Снимок графа для визуализации. Параметры: ?center={id}&radius=2&limit=200. |

## 3.5. Жизненный слой (/v1/life/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/life/habits | GET, POST | Привычки: список, создание. |
| /v1/life/habits/{id}/log | POST | Зафиксировать выполнение. Тело: { date, status: 'done'\|'partial'\|'skipped'\|'planned-skip' }. |
| /v1/life/tasks | GET, POST | Задачи. |
| /v1/life/projects | GET, POST | Проекты. |
| /v1/life/projects/{id}/synthesize-passport | POST | Запустить Document Synthesizer для генерации паспорта проекта. Async — возвращает { job_id }. |
| /v1/life/quests | GET | Quest log. |
| /v1/life/metrics | GET | Метрики (временные ряды). ?series=mood&from=...&to=... |
| /v1/life/metrics | POST | Добавить значение метрики. |
| /v1/life/character | GET | Character sheet. Возврат: { level, class, attributes, xp_history }. |

## 3.6. Журналы и терапия (/v1/journals/*, /v1/therapy/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/journals/templates | GET | Список шаблонов журналов. |
| /v1/journals/templates/{id} | GET, PATCH | Получить/изменить шаблон (пользовательские). |
| /v1/therapy/sessions | POST | Открыть терапевтическую сессию. Тело: { protocol: 'cbt'\|'gestalt'\|'dbt'\|'act'\|'ifs' }. Возврат: { session_id }. |
| /v1/therapy/sessions/{id}/messages | POST | Отправить сообщение в сессии. SSE-стрим ответа. |
| /v1/therapy/sessions/{id}/close | POST | Закрыть сессию с итогом и сохранением. |

## 3.7. Sync (/v1/sync/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/sync/push | POST | Отправка outbox-батча. См. §6.1. |
| /v1/sync/pull | GET | Pull новых событий (fallback при недоступности Realtime). ?since={lamport_ts}&device_id=... |
| /v1/sync/devices | GET | Список зарегистрированных устройств пользователя. |
| /v1/sync/devices/{id} | DELETE | Отозвать устройство (выход из аккаунта на нём). |
| /v1/sync/conflicts | GET | Список conflict-suspended версий. |
| /v1/sync/conflicts/{version_id}/resolve | POST | Решить конфликт. Тело: { resolution: 'keep_winner'\|'keep_loser'\|'merge', merged_content? }. |

## 3.8. Импорт и экспорт (/v1/import/*, /v1/export/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/import/upload | POST | Загрузка zip с MD-vault. multipart/form-data. |
| /v1/import/jobs/{id} | GET | Статус импорта: { status, processed, total, errors }. |
| /v1/import/jobs/{id}/cancel | POST | Отмена импорта. |
| /v1/export/full | POST | Полный экспорт всех данных пользователя. Возврат: { job_id }. |
| /v1/export/jobs/{id} | GET | Статус. По завершении — download_url. |

## 3.9. Audit и observability (/v1/audit/*, /v1/health/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/audit/llm-calls | GET | Журнал LLM-вызовов. Фильтры: agent, model, date_range. |
| /v1/audit/security-events | GET | Security-события (login, password-change, exports, deletes). |
| /v1/health/ready | GET | Readiness — все зависимости доступны. 200/503. |
| /v1/health/live | GET | Liveness — процесс жив. 200. |
| /v1/metrics | GET | Prometheus-формат метрики. Только service-role JWT. |

## 3.10. MCP (/v1/mcp/*)

| **Endpoint** | **Метод** | **Назначение** |
| --- | --- | --- |
| /v1/mcp/servers | GET | Список подключённых MCP-серверов пользователя. |
| /v1/mcp/servers | POST | Подключить MCP-сервер. Тело: { transport: 'sse'\|'stdio'\|'http', url, name, auth? }. |
| /v1/mcp/servers/{id} | DELETE | Отключить MCP-сервер. |
| /v1/mcp/servers/{id}/tools | GET | Доступные инструменты сервера. |

# 4. SSE Streaming

Для агентских ответов и долгих синтезов используется text/event-stream. Каждое событие имеет event: и data: (JSON-стрингифицированный).

## 4.1. Типы событий

| **event:** | **data: (схема)** |
| --- | --- |
| start | { run_id, agent, model, started_at } |
| delta | { text: "..." } — инкрементальный фрагмент ответа |
| tool_call | { tool, args } — агент вызвал инструмент |
| tool_result | { tool, result_summary } |
| sub_agent_start | { sub_agent, purpose } |
| sub_agent_finish | { sub_agent, duration_ms } |
| error | { code, message, retriable } |
| finish | { run_id, finished_at, input_tokens, output_tokens, cost_estimate, audit_id } |

## 4.2. Поведение клиента

- Клиент держит EventSource (для веб) или нативный stream (для Tauri).
- На delta — incremental rendering.
- На abort пользователя — клиент закрывает поток; сервер ловит ECONNRESET, передаёт abort signal в Mastra runtime context.
- При обрыве соединения — клиент НЕ переподключается автоматически (агентский ран не идемпотентен на середине).

## 4.3. Пример потока

```
POST /v1/agents/document-synthesizer/stream
Authorization: Bearer ...
Content-Type: application/json
```

```
{ "template": "project_passport", "subject_id": "<project_uuid>" }
```

```
--- Response ---
event: start
data: {"run_id":"r_01h...","agent":"document-synthesizer","model":"claude-opus-4-7"}
```

```
event: tool_call
data: {"tool":"context-retriever","args":{"subject_id":"..."}}
```

```
event: tool_result
data: {"tool":"context-retriever","result_summary":"24 notes, 8 entities"}
```

```
event: delta
data: {"text":"## Проект Phoenix\n\nЦель: ..."}
```

```
event: delta
data: {"text":" перенести..."}
```

```
event: finish
data: {"run_id":"r_01h...","input_tokens":18420,"output_tokens":1240,"audit_id":"a_..."}
```

# 5. Realtime каналы

Сервер использует Supabase Realtime (Phoenix Channels). Аутентификация — JWT, тот же что для REST.

## 5.1. Каналы

| **Канал** | **События** |
| --- | --- |
| user:{user_id} | Личные события: notes.updated, insights.new, audit.new, sync.event |
| user:{user_id}:presence | Presence: кто из устройств онлайн ({device_id, platform, last_seen}) |
| note:{note_id} | Только если включён collaborative-режим: CRDT-обновления, presence в редакторе |
| system | Только service-role: системные события, для мониторинга |

## 5.2. Формат событий

```
Channel: user:{user_id}
Event: notes.updated
Payload:
{
  "note_id": "n_01h...",
  "version": 5,
  "updated_by_device": "d_01h...",
  "timestamp": "2026-05-20T08:12:33.123Z",
  "change_kind": "content"|"frontmatter"|"visibility"|"deleted"
}
```

## 5.3. Подписка из клиента

```
const channel = supabase
  .channel(`user:${userId}`, { config: { broadcast: { self: false } } })
  .on('broadcast', { event: 'notes.updated' }, handleNoteUpdate)
  .on('broadcast', { event: 'insights.new' }, handleInsight)
  .subscribe();
```

self: false — собственные изменения этого клиента не возвращаются эхом (он их уже обработал локально).

# 6. Sync protocol (детали)

## 6.1. POST /v1/sync/push

```
POST /v1/sync/push
Authorization: Bearer ...
Content-Type: application/json
```

```
{
  "device_id": "d_01h...",
  "batch": [
    {
      "op_id": "op_01h...",     // идемпотентный UUID, генерируется клиентом
      "op_type": "upsert",       // upsert | delete | visibility_change
      "note_id": "n_01h...",
      "base_version": 4,         // для optimistic lock
      "content_md": "...",       // полное содержимое (для upsert)
      "frontmatter": { ... },
      "content_hash": "sha256:...",
      "lamport_ts": "1716000000.42.d_01h...",
      "client_updated_at": "2026-05-20T08:12:33.123Z"
    }
  ]
}
```

Ответ:

```
200 OK
{
  "results": [
    { "op_id": "op_01h...", "status": "accepted", "new_version": 5 },
    { "op_id": "op_02h...", "status": "conflict_loser", "winner_version": 6, "loser_kept_as": "v5_conflict_suspended" },
    { "op_id": "op_03h...", "status": "error", "code": "validation_failed", "message": "..." }
  ]
}
```

## 6.2. GET /v1/sync/pull

Используется как fallback, когда Realtime недоступен. Также при первом старте устройства — для загрузки delta с момента последней синхронизации.

```
GET /v1/sync/pull?since=1716000000.0&device_id=d_01h...&limit=200
```

```
200 OK
{
  "events": [
    {
      "event_id": "e_01h...",
      "kind": "notes.updated",
      "note_id": "n_01h...",
      "version": 5,
      "timestamp": "2026-05-20T08:12:33.123Z",
      "lamport_ts": "1716000000.45.server"
    }
  ],
  "next_since": "1716000000.45",
  "has_more": false
}
```

## 6.3. Идемпотентность

- Каждый op_id уникален в системе. При повторе той же операции (например, после ретрая) — сервер возвращает тот же результат, без повторного применения.
- Сервер хранит op_id в таблице sync_ops_log с TTL 30 дней.
- Клиент дедуплицирует входящие events по event_id (TTL 30 дней).

## 6.4. Lamport timestamp

Формат: <wall_ms>.<counter>.<device_id|server>. При сравнении — лексикографический порядок:

- wall_ms — wall-clock в миллисекундах (для интуитивной упорядоченности).
- counter — монотонный счётчик внутри устройства/сервера в пределах того же wall_ms.
- device_id — для tie-breaking между устройствами с одним wall_ms.counter.
В алгоритме LWW побеждает версия с большим lamport_ts.

# 7. MCP (Model Context Protocol)

Nabu выступает в двух ролях:

1. MCP host: подключает внешние MCP-серверы пользователя (Google Calendar, Apple Health, bank export и т. д.). Доступ к их инструментам — через агентов, в первую очередь MCP Bridge Agent (#44).
1. MCP server: публикует свои данные и инструменты для внешних клиентов (другие AI-ассистенты пользователя). По умолчанию выключено; включается явно с указанием scope.

## 7.1. Подключение внешнего MCP-сервера

```
POST /v1/mcp/servers
{
  "name": "Google Calendar",
  "transport": "sse",
  "url": "https://calendar-mcp.example.com/sse",
  "auth": { "type": "oauth2", "client_id": "...", "scopes": ["calendar.readonly"] }
}
```

При первом подключении сервер запускает OAuth-flow и сохраняет refresh-token зашифрованным.

## 7.2. Nabu как MCP-сервер

Эндпоинт: /v1/mcp/server/sse (по умолчанию выключен). Активация — в настройках безопасности с генерацией отдельного MCP-токена и выбором scopes (notes.read, notes.write, agents.invoke). Каждый scope требует явного подтверждения пользователем.
