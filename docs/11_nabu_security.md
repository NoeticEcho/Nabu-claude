# NABU

*Security & Privacy Architecture*  
*Архитектура безопасности и приватности*  
*Threat model · Controls · DPIA · OWASP ASVS L2*  
*Версия 1.0*  

---

# 1. Назначение и область

Документ описывает архитектуру безопасности и приватности Nabu. Покрывает: классификацию данных, threat model по STRIDE, границы доверия, контроли по OWASP ASVS L2, шифрование и управление ключами, аудит, готовность к GDPR (включая DPIA-структуру), процедуры incident response.

Документ — нормативный. Каждое архитектурное решение и каждое требование SRS из группы NFR-30xx и NFR-90xx должно отображаться на конкретный control здесь.

# 2. Профиль безопасности Nabu

Nabu имеет необычно высокий профиль чувствительности для приложения для одного пользователя:

- Хранит психотерапевтический материал (КПТ-журналы, IFS-части, эмоциональные дневники).
- Хранит медицинские данные (трекинг здоровья, симптомы, лекарства).
- Хранит финансовую информацию (личный бюджет, трекинг расходов).
- Хранит исследовательские артефакты (могут попадать под NDA, intellectual property).
- Поддерживает self-host. Это снижает доверительный риск к разработчику Nabu, но увеличивает ответственность пользователя.
Целевой уровень: OWASP ASVS 4.0 Level 2 (подходит для большинства приложений, обрабатывающих чувствительные данные).

# 3. Классификация данных

| **Класс** | **Маркер в системе** | **Примеры и обязательства** |
| --- | --- | --- |
| Public | PUB | Публичные шаблоны журналов, дизайн-токены, опубликованные пользователем заметки. Хранение в открытом виде допустимо. |
| Personal | PER (visibility=default) | Обычные заметки, проекты, привычки, метрики. Шифрование at-rest, RLS, разрешено отправлять на cloud LLM. |
| Sensitive | SEN (visibility=private) | Терапия, медицина, финансы. Только локальный Ollama. В Postgres — только метаданные без content_summary. |
| Highly sensitive | HSE (visibility=vault) | Самое чувствительное: подавленный материал, исповедальные заметки, особо приватные финансы. E2E-шифрование ключом, известным только пользователю. Сервер не имеет доступа. |

## 3.1. Правила обработки по классам

| **Класс** | **Cloud LLM** | **Local LLM** | **Audit content** | **Аналитика** | **Export** |
| --- | --- | --- | --- | --- | --- |
| PUB | OK | OK | Полный | OK | OK |
| PER | OK (по конфигу агента) | OK | Метаданные + краткий summary (≤ 200 симв.) | Аггрегаты | OK |
| SEN | Запрещено | Только локальный | Только метаданные | Только аггрегаты | OK |
| HSE | Запрещено | Только локальный, на клиенте | Только id и timestamp | Запрещено | OK с ключом пользователя |

# 4. Threat model (STRIDE)

Анализ выполнен покомпонентно по методологии STRIDE. Для каждого компонента — основные угрозы, оценка риска (L=Likelihood × I=Impact в шкале 1-5), контроли. Полная матрица — в приложении А.

## 4.1. Сводная карта угроз

| **Угроза** | **Риск (L×I)** | **Ключевые контроли** |
| --- | --- | --- |
| Spoofing — подмена пользователя через украденный пароль | 3×5 = 15 | Argon2id для паролей; rate limit на login; MFA опционально; уведомление о входе с нового устройства |
| Spoofing — украденный JWT | 2×4 = 8 | Короткий TTL access-token (1 час); refresh-rotation; binding refresh к device fingerprint; revoke на logout |
| Tampering — модификация .md на S3 в обход API | 2×4 = 8 | Server-side encryption; контентный хеш в Postgres; периодическая верификация; audit access logs MinIO |
| Tampering — SQL injection через query params | 1×5 = 5 | Parameterized queries (PostgREST + NestJS Prisma/sqlx); валидация Zod; SAST |
| Repudiation — отрицание действий | 2×3 = 6 | Audit log append-only; security-события с IP/UA; периодический бэкап аудита |
| Information disclosure — утечка private/vault на cloud LLM | 3×5 = 15 | Маршрутизация по visibility; запрет внешних API для private/vault; автоматический тест в CI; Critic-агент |
| Information disclosure — компрометация Postgres | 2×5 = 10 | RLS; шифрование at-rest (filesystem); vault = шифротекст; KMS для ключей |
| Information disclosure — компрометация S3 | 2×4 = 8 | SSE-S3 / SSE-KMS; vault-объекты — клиентский шифротекст; bucket policy запрещает public |
| Information disclosure — компрометация бэкапа | 2×5 = 10 | Encryption-at-rest бэкапов; отдельный KMS-ключ; off-site копия — encrypted |
| Denial of service — flood агентских запросов | 3×3 = 9 | Rate limit per user; budget на LLM-стоимость в день; circuit breaker на внешние LLM |
| Denial of service — массовое чтение через RLS | 2×3 = 6 | Pagination обязательна; query timeout; max page size |
| Elevation of privilege — bypass RLS через service-role JWT | 2×5 = 10 | Service-role JWT генерируется только для worker'ов; ротация еженедельная; ограничен IP внутренней сети |
| Elevation of privilege — компрометация worker'а | 2×4 = 8 | Worker запущен от непривилегированного пользователя; ограничен capabilities; read-only filesystem кроме /tmp |

# 5. Границы доверия (refresher из SAD)

Полное описание — в документе 05 (SAD §4.5.1). Здесь — приоритизация для применения контролей.

1. Граница 1 (клиент ↔ сервер) — критичная. JWT, TLS 1.3, CSRF/SameSite, CORS allowlist.
1. Граница 2 (сервер ↔ внешние LLM) — критичная. API-ключи в KMS; egress firewall с allowlist; rate-limit; audit.
1. Граница 3 (клиент ↔ локальный Ollama) — внутренняя. IPC через localhost. Stronghold для конфигурации.
1. Граница 4 (vault) — критичная для HSE. Сервер не доверенная сторона; клиентское шифрование.
1. Граница 5 (продакшен ↔ бэкап) — высокая. Бэкапы зашифрованы независимым ключом.

# 6. Аутентификация и авторизация

## 6.1. Аутентификация

| **Метод** | **Реализация** |
| --- | --- |
| Email + password | Supabase GoTrue. Хеш: Argon2id (m=64M, t=3, p=4). Минимум 12 символов, проверка через haveibeenpwned k-anon API (опционально). |
| Magic-link | GoTrue. Single-use, TTL 15 мин. |
| OAuth (Google, Apple, GitHub) | Supabase Auth providers. PKCE flow. |
| MFA — TOTP | GoTrue MFA module. RFC 6238. Включается опционально пользователем. |
| MFA — Hardware key (WebAuthn) | Phase Ph6 (опционально, для пользователей с повышенными требованиями). |
| Locked account | После 5 неверных попыток за 15 мин — блокировка на 15 мин; уведомление пользователю по email. |

## 6.2. Сессии и токены

- Access-token JWT: подпись Ed25519, claims (sub, role, exp, iat, aud, iss), TTL 1 час.
- Refresh-token: opaque, хранится в Postgres (auth.refresh_tokens), TTL 30 дней, rotation на каждое использование.
- Bound к device_id (для Tauri и mobile). При попытке использования refresh с другого device — invalidate.
- При logout — refresh-token немедленно отзывается.
- Пользователь видит список активных сессий в /settings/sessions, может отозвать любую.

## 6.3. Авторизация (RLS)

1. Все пользовательские таблицы имеют RLS-политики на основе auth.uid().
1. Standard policy: USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid()).
1. Therapy-таблицы — дополнительная политика: only authenticated session + visibility check.
1. Тесты RLS — в integration test suite. Каждая таблица — обязательный тест попытки доступа от лица другого пользователя.
1. Service-role bypass — только в worker-процессах, не в API.

# 7. Шифрование и управление ключами

## 7.1. Слои шифрования

| **Слой** | **Алгоритм** | **Управление ключами** |
| --- | --- | --- |
| TLS | TLS 1.3 (X25519+AES-256-GCM или ChaCha20-Poly1305) | Let's Encrypt через Caddy; ротация 60 дней; HSTS preload |
| At-rest, Postgres (filesystem) | LUKS / dm-crypt (host-level) | Управляется ОС, ключ на хосте; для managed-DB — KMS managed |
| At-rest, S3/MinIO | AES-256 SSE | MinIO KES-managed или KMS |
| At-rest, TypeDB | LUKS (host-level) | Аналогично Postgres |
| At-rest, local SQLite (desktop) | SQLCipher AES-256-CBC + HMAC-SHA512 | Ключ в Tauri Stronghold (Argon2id-derived от passcode устройства или биометрии) |
| JWT signing | EdDSA (Ed25519) | Public/private пара; ротация 90 дней; previous-key validity 24 ч для grace |
| Vault content (E2E) | AES-256-GCM + Argon2id KDF | Master key из пароля пользователя через Argon2id (m=64M, t=3, p=4). Envelope: на каждый объект — data key, зашифрованный master-ключом. Соль — public, хранится в users.salt |
| Бэкапы | AES-256-GCM | Отдельный backup-master-ключ; rotation 365 дней |
| MCP-токены, API-keys внешних сервисов | AES-256-GCM в Postgres | В Tauri — Stronghold; на сервере — pg_sodium (libsodium) |

## 7.2. Vault: детальный flow

1. Пользователь устанавливает vault-пароль (отличный от логин-пароля).
1. Клиент генерирует случайную salt (16 байт, salt_v) и сохраняет в Postgres users.vault_salt (это не секрет).
1. Master key = Argon2id(password, salt_v, m=64M, t=3, p=4, length=32).
1. Master key хранится ТОЛЬКО в памяти процесса клиента (Tauri или браузер). Никогда не уходит на сервер.
1. Создание vault-заметки: генерируется случайный data_key (32 байта), контент шифруется data_key (AES-256-GCM). data_key шифруется master-ключом (AES-256-GCM). На сервер отправляются: encrypted_content (binary), encrypted_data_key (binary), nonce_content, nonce_dk, content_hash_aad.
1. Чтение: сервер возвращает encrypted_content + encrypted_data_key. Клиент дешифрует data_key мастер-ключом, потом контент.
1. Смена пароля: клиент дешифрует все encrypted_data_key старым мастер-ключом, перешифровывает новым. Контент НЕ перешифровывается (это и есть смысл envelope-схемы). Операция занимает секунды даже на больших vault.
1. Утеря пароля: vault безвозвратно потерян. Это в UX явно: 'Vault password cannot be recovered. We cannot help you regain access if you forget it'.

## 7.3. Ротация ключей

| **Ключ** | **Период** | **Процедура** |
| --- | --- | --- |
| JWT signing | 90 дней | Автоматическая. Old key валиден ещё 24 ч для grace. |
| TLS сертификаты | 60 дней | Автоматическая через Caddy + Let's Encrypt. |
| MinIO master encryption | 180 дней | Manual. Перешифровка через MinIO cli mc admin kms key rotate. |
| Vault master (per user) | По запросу пользователя | Пользователь меняет пароль; envelope-схема позволяет быстро. |
| Backup master | 365 дней | Manual. Старые бэкапы остаются с прежним ключом. |
| API keys внешних LLM провайдеров | По компрометации или 180 дней | Manual. Replace в .env, rolling restart NestJS-инстансов. |

# 8. Аудит и наблюдаемость безопасности

## 8.1. Содержимое audit_log

Append-only таблица audit_log с partition по месяцам. Категории:

| **Категория** | **Поля и retention** |
| --- | --- |
| llm_call | agent_name, model_provider, model_name, prompt_hash, visibility_category, tokens_in, tokens_out, cost_estimate, latency_ms, trace_id, input_summary (≤ 200 симв.), purpose. Retention 365 дней. |
| security_event | event_kind (login\|logout\|password_change\|mfa_setup\|...), user_id, ip, ua, success, fail_reason?. Retention 365 дней. |
| data_access | kind (export\|delete\|visibility_change), target_id, by_device. Retention 365 дней (для GDPR-аудита). |
| admin_action | kind, target, before, after. Только в self-host где есть admin. Retention 730 дней. |

## 8.2. Что НЕ логируется

- Полные payload запросов к LLM (только summary до 200 символов).
- Расшифрованное содержимое vault-заметок (никогда не покидает клиент).
- Полные значения refresh-токенов (только hash).
- Пароли в любом виде.

## 8.3. Доступ к audit

- Пользователь — к своему audit log через /v1/audit/* (см. API spec §3.9).
- Self-host admin — к admin_action и security_event на уровне инстанса (не персональным).
- Audit log сам аудируется: попытки чтения audit_log — пишутся в meta_audit_log.

## 8.4. Метрики безопасности (Prometheus)

- auth_login_attempts{success=true|false}
- auth_locked_accounts (gauge)
- llm_calls_total{provider, visibility} — для контроля что private/vault идут только на ollama
- rls_denied_total{table} — высокие значения могут указывать на attempted breach или баг
- audit_log_writes_total
- vault_decrypt_failures_total (неверный пароль)

# 9. OWASP ASVS L2 — маппинг покрытия

Полная checklist ASVS — в /docs/security/asvs-l2-checklist.md. Здесь — обзор по доменам.

| **ASVS domain** | **Покрытие** | **Ключевые элементы реализации** |
| --- | --- | --- |
| V1 Architecture | Full | SAD, ADR, threat model, классификация данных. Регулярный review. |
| V2 Authentication | Full | Argon2id, MFA опционально, rate limit, account lockout, secure session management. |
| V3 Session management | Full | Short-lived JWT, refresh-rotation, device binding, server-side session list, secure logout. |
| V4 Access control | Full | RLS на каждой таблице, тесты RLS, principle of least privilege для service-role. |
| V5 Validation, sanitization | Full | Zod-схемы на каждом API-эндпоинте, контентные ограничения, output encoding. |
| V6 Stored cryptography | Full | Шифрование at-rest, KMS, envelope для vault, ротация. |
| V7 Error handling, logging | Full | Унифицированный error response без утечки stack-trace; audit_log; нет логирования секретов. |
| V8 Data protection | Full | Минимизация в audit, GDPR-готовность, право удаления, право экспорта. |
| V9 Communications | Full | TLS 1.3, HSTS, secure cookie attrs, allow-list CORS. |
| V10 Malicious code | Partial | SAST (CodeQL, Semgrep), dependency scanning. Penetration testing — для production deployments. |
| V11 Business logic | Partial | Тесты на race conditions в sync; rate-limiting; abuse detection — Phase Ph7. |
| V12 Files, resources | Full | Валидация file uploads (type, size, malware-scan через clamav для self-host опционально); файлы в S3 не serv'ятся как HTML напрямую. |
| V13 API, web service | Full | OpenAPI 3.1, JWT, rate limit, валидация input. |
| V14 Configuration | Full | Secrets в .env (никогда в git), production-режимы документированы в Runbook, минимальные сервисы exposed. |

# 10. GDPR-готовность и DPIA

## 10.1. Применимость

Nabu обрабатывает специальные категории данных (art. 9 GDPR): данные о здоровье (психотерапия), биометрию (потенциально, через интеграции health-трекеров), возможно политические/религиозные взгляды (в свободном тексте). Это требует DPIA в случае коммерческого предоставления услуги.

Для self-host scenario пользователь сам себе controller. Для multi-tenant SaaS — оператор Nabu = controller.

## 10.2. Права субъекта данных

| **Право** | **Реализация в Nabu** |
| --- | --- |
| Access (art. 15) | /v1/auth/account/export — полный экспорт всех данных пользователя в zip с .md, frontmatter, графом, метриками, audit log. |
| Rectification (art. 16) | Через стандартное редактирование заметок и профиля. |
| Erasure / RTBF (art. 17) | /v1/auth/account DELETE. 24ч grace period. Затем purge всех таблиц по user_id, S3-объектов, TypeDB-сущностей, бэкапов в течение 90 дней (ограничение из-за retention бэкапов). |
| Restriction (art. 18) | Через временную деактивацию аккаунта (заморозка). |
| Portability (art. 20) | Экспорт в .md (стандартный, machine-readable) + JSON-метаданные. См. право Access. |
| Objection (art. 21) | Применяется к маркетинговым уведомлениям; их в Nabu нет вообще. |
| Automated decision (art. 22) | Агентские выходы НЕ являются автоматическими решениями с правовыми последствиями. Терапевтические агенты явно не делают диагностических заключений. |

## 10.3. Структура DPIA

Полный DPIA — отдельный документ /docs/legal/dpia-template.md, заполняемый перед production deployment. Здесь — структура (по WP248 рекомендации EDPB):

1. Systematic description of processing — что, кем, как.
1. Necessity and proportionality assessment — почему необходимо собирать каждый класс данных, минимизирована ли обработка.
1. Risks to rights and freedoms — оценка по 8 критериям GDPR; для Nabu высокие риски: специальные категории, оценка персонального поведения, систематический мониторинг.
1. Measures envisaged to address risks — что делается для митигации (этот документ + Runbook + Test Strategy).
1. Consultation — с DPO (если применимо), при необходимости — с надзорным органом.

## 10.4. Data retention

| **Категория** | **Retention** | **После** |
| --- | --- | --- |
| Активные заметки и связанные данные | Бессрочно (пока аккаунт активен) | Удаление по запросу пользователя |
| Soft-deleted заметки | 30 дней | Hard delete |
| Conflict-suspended версии | 90 дней | Hard delete |
| Audit log — llm_call | 365 дней | Анонимизация (без user_id) + retention 7 лет для совокупной статистики (опционально, opt-in) |
| Audit log — security_event | 365 дней | Hard delete |
| Backups | 30 дней | Перезапись на newer; удаление по RTBF — в течение 90 дней |
| Закрытые аккаунты (tombstone) | 7 дней (отмена возможна) | Полный purge |

# 11. Incident response

## 11.1. Классификация инцидентов

| **Severity** | **Критерий** | **Reaction time (SLA для multi-tenant SaaS)** |
| --- | --- | --- |
| P0 — Critical | Утечка персональных данных; компрометация ключей шифрования; недоступность системы > 4 часов | ≤ 1 час |
| P1 — High | Уязвимость с активной эксплуатацией; деградация >50% latency; компрометация одного пользователя | ≤ 4 часа |
| P2 — Medium | Выявленная уязвимость без эксплуатации; периодические сбои; некритичная функция недоступна | ≤ 24 часа |
| P3 — Low | Низкорисковая уязвимость; UX-проблема | ≤ 5 рабочих дней |

## 11.2. Процедура (P0/P1)

1. Детектирование: alert из мониторинга, отчёт пользователя, security disclosure.
1. Триаж: дежурный (или владелец инстанса) подтверждает severity, открывает incident-ticket.
1. Containment: ограничить ущерб. Для утечки — отзыв скомпрометированных ключей, инвалидация затронутых сессий, временная блокировка соответствующих эндпоинтов.
1. Eradication: устранить root cause.
1. Recovery: восстановить нормальную работу.
1. Уведомления: для multi-tenant SaaS — пользователи в течение 72 часов согласно GDPR (art. 33); надзорный орган — в течение 72 часов.
1. Post-mortem: blameless, в течение 5 рабочих дней после resolution. Документируется в /docs/incidents/.

## 11.3. Disclosure

- security@<your-domain> — public email для security disclosures.
- Поддерживается responsible disclosure: 90 дней coordinated disclosure window.
- PGP-ключ публикуется в /security.txt согласно RFC 9116.

# 12. Secrets management

- Все секреты — в .env-файлах, никогда не в git.
- gitleaks pre-commit hook предотвращает случайные коммиты.
- В production — секреты подаются через переменные окружения от orchestrator'а (docker-compose --env-file, Kubernetes secrets, HashiCorp Vault и т. п.). В рекомендованном self-host — Docker Secrets.
- Внутрипроцессно — секреты не логируются (audit-log запрещает; ESLint-правило no-process-env-in-log).
- API-ключи внешних LLM-провайдеров — отдельная категория. В Postgres хранятся encrypted via pg_sodium. Rotation — see §7.3.

# 13. Compliance reference checklist

Сводная checklist реализации, которую AI-команда обязана пройти при подготовке к production release. Полная версия — в /docs/security/compliance-checklist.md.

- Все таблицы имеют RLS-политики и автоматические тесты их корректности.
- Все эндпоинты non-public покрыты AuthGuard.
- Все Zod-схемы покрывают валидируемые поля; нет 'any' в публичных контрактах.
- TLS 1.3 — обязательно. Понижение версии в config — запрещено.
- HSTS включён с max-age ≥ 6 месяцев и preload.
- Audit log — обязательная запись для каждого LLM-вызова и каждого security-события.
- Маршрутизация private/vault → Ollama — покрыта автоматическим тестом, проверяющим audit_log.
- Удаление аккаунта — покрыто автоматическим тестом, проверяющим полный purge.
- Зависимости — без known critical CVE.
- Backup-восстановление — учения раз в квартал.
- Incident response runbook — актуален и repetiruyemyy.
