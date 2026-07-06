# P1 — Мультитенантный фундамент (спека)

> Фаза 1 OlimpOS-roadmap. Цель: инстанс обслуживает МНОГО пользователей с изоляцией личных данных и
> общим слоем агентов/скиллов/опыта. Аддитивно; однопользовательский локальный режим остаётся дефолтом
> (публичный/много-тенантный режим — за флагом `NABU_MULTITENANT=1`).

## 1. Модель тенантов

- **Пользователь** (`users`): личность аккаунта. Идентификаторы: `tg_user_id` (Telegram) и/или
  `email`+`pass_hash` (web). У каждого — **личный namespace** (`personal_namespace`) и `user_id`
  (совпадает с `users.id`, используется доменным слоем).
- **Личное пространство** = `namespace` (память/знания/чаты/личность-оверрайды/финансы/здоровье). НЕ
  пересекается между пользователями. `buildDeps({namespace: personal_ns, userId: users.id})`.
- **Общий слой (commons)** = well-known namespace `__commons__` (строка в `mem_namespace`). Здесь:
  определения агентов (реестр), общие скиллы, процедурная память банка, агрегаты опыта. Читается ВСЕМИ.
- **Проектное пространство** (P3+): отдельный namespace на совместный проект; участники — через
  `membership`. В P1 закладываем таблицы, полноценно используем в P3.

## 2. Схема (аддитивная миграция `019_multitenancy.sql`)

```sql
-- users уже есть (000_bootstrap); дополняем аддитивно
alter table users add column if not exists tg_user_id  bigint unique;
alter table users add column if not exists email        text unique;
alter table users add column if not exists pass_hash    text;         -- argon2id, только web
alter table users add column if not exists display_name text;
alter table users add column if not exists personal_namespace uuid references mem_namespace(id);
alter table users add column if not exists created_at   timestamptz not null default now();
alter table users add column if not exists status       text not null default 'active'
  check (status in ('active','suspended'));

-- членство пользователя в пространстве (личном/проектном/организации) с ролью — задел под P3
create table if not exists membership (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  namespace    uuid not null references mem_namespace(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner','member','viewer')),
  created_at   timestamptz not null default now(),
  unique(user_id, namespace)
);
create index if not exists ix_membership_user on membership(user_id);
create index if not exists ix_membership_ns   on membership(namespace);

-- реестр общих агентов (банк/рынок) — задел под P4; определения по-прежнему в файлах,
-- но метаданные/происхождение/видимость — в БД
create table if not exists agent_registry (
  slug         text primary key,
  origin_user  uuid references users(id) on delete set null,  -- кто создал (null = встроенный)
  visibility   text not null default 'builtin' check (visibility in ('builtin','shared','private')),
  spec_path    text,          -- путь к .md (или ссылка на blob)
  created_at   timestamptz not null default now(),
  usage_count  bigint not null default 0
);

-- well-known commons namespace
insert into mem_namespace (id, name) values ('00000000-0000-0000-0000-0000000c0m0s', '__commons__')
  on conflict (id) do nothing;   -- id-плейсхолдер; в миграции берём фиксированный UUID
```

(Реальный фиксированный UUID commons генерируем один раз и хардкодим как константу `COMMONS_NS`.)

## 3. Tenant-резолвер (`lib/src/tenancy.ts`, новый)

```
resolveTenantByTelegram(pg, tgUserId, {displayName}) -> { userId, namespace }
  1. select user by tg_user_id; если нет и разрешена авт#регистрация — создать:
     - создать mem_namespace (личный), users(tg_user_id, personal_namespace, display_name),
       membership(owner).
  2. вернуть { userId: users.id, namespace: personal_namespace }.

resolveTenantBySession(pg, sessionUserId) -> { userId, namespace }   // web
registerWebUser(pg, email, password) -> user     // argon2id хеш, личный namespace
linkTelegramToUser(pg, code, tgUserId)            // deep-link привязка TG к web-аккаунту (P2)

COMMONS_NS = '<фиксированный uuid>'   // общий слой
```

Резолвер — единственная точка создания тенанта; всё остальное получает готовые `{userId, namespace}`.

## 4. Shared-vs-private в репозиториях

- **Личное** (scope = personal namespace): episodic/semantic/working/autobiographical/associative/
  prospective память, personal knowledge (`kind=personal`), chat_history, домен (tasks/projects/…),
  финансы/здоровье, vault.
- **Общее** (scope = `COMMONS_NS`): агенты (agent_registry + файлы), процедурная память банка,
  библиотечное знание `kind=library` (по решению — общее справочное), агрегаты эффективности.
- Реализация: репозитории, которые читают общий слой, получают доп. параметр `commonsNs` и делают
  `namespace in (personal, COMMONS)` для чтения, а запись — в нужный по типу. Минимально-инвазивно:
  начинаем с процедурной памяти и реестра агентов; библиотека — по флагу.

## 5. Демон: много чатов, резолвинг на вход

- Убрать единый `boundChatId` как ЕДИНСТВЕННЫЙ допуск. В много-тенантном режиме:
  - Личка бота (private chat) `from.id` → `resolveTenantByTelegram` → личный тенант.
  - Каждое сообщение резолвит тенанта → `buildDeps(tenant)` (кэш deps по namespace, как в web).
- Однопользовательский режим (дефолт, `NABU_MULTITENANT` не задан): поведение как сейчас (boundChatId).
- Per-thread сериализация и session-lock — без изменений (уже есть).

## 6. Регистрация (Telegram, P1-объём)

- `/start` в личке бота → если tg_user_id неизвестен → создать тенанта, приветствие, краткий онбординг.
- Группы (P3) — отдельно; в P1 фокус на личку = личный тенант.

## 7. Обратная совместимость и безопасность

- Дефолт (без `NABU_MULTITENANT=1`) — текущий однопользовательский режим, ничего не меняется.
- В много-тенантном режиме web ТРЕБУЕТ auth (P2); до P2 много-тенантный web выключен, работает TG.
- Миграция аддитивна; существующий единственный пользователь мигрируется в «первого» тенанта.

## 8. Критерии готовности P1

1. Миграция 019 применяется идемпотентно; commons namespace создан.
2. `resolveTenantByTelegram` создаёт/находит тенанта; два разных tg_user_id → разные namespace, память
   не пересекается (тест: сохранить эпизод под user A, recall под user B не видит).
3. Общий слой: процедура/агент, помеченные commons, видны обоим пользователям.
4. Демон в `NABU_MULTITENANT=1` обслуживает 2+ пользователей в личке без смешения; в дефолте — как сейчас.
5. Юнит-тесты на резолвер + изоляцию; build+test зелёные.

## 9. Вне scope P1 (следующие фазы)

Web-auth/сессии (P2), группы/проекты (P3), рынок агентов (P4), песочницы/git (P5), spaces/сайты (P6),
agile (P7). P1 закладывает таблицы (`membership`, `agent_registry`) под них, но не реализует их логику.
