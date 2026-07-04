# NABU

*Operational Runbook*  
*Эксплуатационное руководство*  
*Развёртывание · Конфигурация · Бэкап · Мониторинг · Troubleshooting*  
*Версия 1.0*  

---

# 1. Назначение и аудитория

Документ — практическое руководство для администратора self-host инстанса Nabu. В типичном сценарии администратор — это сам пользователь. Документ предполагает базовые навыки работы с Linux и Docker, но не предполагает DevOps-экспертизы.

Покрытие: установка, обновление, рутинная эксплуатация, бэкап и восстановление, мониторинг, диагностика частых проблем, действия при инцидентах.

# 2. Требования и рекомендации к окружению

## 2.1. Минимальные требования (single-user, без локального Ollama)

| **Параметр** | **Значение** |
| --- | --- |
| CPU | 2 vCPU |
| RAM | 4 ГБ |
| Диск | 20 ГБ SSD |
| ОС | Ubuntu 22.04+, Debian 12+, любой дистрибутив с Docker Engine 24+ |
| Сеть | Публичный IP с открытыми портами 80/443 (если требуется TLS), или Tailscale/WireGuard для VPN-доступа |

## 2.2. Рекомендуемые требования (для комфортной работы)

| **Параметр** | **Значение** |
| --- | --- |
| CPU | 4 vCPU |
| RAM | 8 ГБ |
| Диск | 100 ГБ SSD (NVMe предпочтительно) |
| Доменное имя | С DNS A-записью на сервер (для автоматического Let's Encrypt) |
| Бэкап-хранилище | Внешний S3 (Backblaze B2, Cloudflare R2, AWS S3) — для off-site бэкапа |

## 2.3. Если планируете локальные модели (Ollama)

Локальные LLM модели запускаются НЕ на сервере — а на десктопе пользователя (требование Tauri-архитектуры). Сервер не должен иметь Ollama. Если хочется запускать LLM сервер-сайд для какого-то особого сценария — это отдельная конфигурация, не покрытая стандартным docker-compose.

Десктоп-требования для Ollama:

- RAM: 16 ГБ для модели 7B; 32 ГБ для 14B; 64 ГБ для 32B.
- GPU желателен (NVIDIA RTX 3060 / 4060 + или Apple Silicon M2+). Без GPU работает, но медленно.
- Диск: 10–50 ГБ под модели.

# 3. Первичная установка

## 3.1. Подготовка сервера

```
# Установка Docker и docker-compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker
```

```
# Установка системных утилит
sudo apt update
sudo apt install -y git curl make jq htop ufw
```

```
# Firewall
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (для Let's Encrypt)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
```

## 3.2. Клонирование и конфигурация

```
# Клонировать deployment-репозиторий
git clone https://github.com/<your-org>/nabu-deploy.git
cd nabu-deploy
```

```
# Скопировать пример конфигурации
cp .env.example .env
```

```
# Сгенерировать ключи (JWT, encryption, admin password)
./scripts/generate-keys.sh
```

```
# Открыть .env и заполнить:
# - DOMAIN — ваш домен (или localhost для локального тестирования)
# - ADMIN_EMAIL — для Let's Encrypt уведомлений
# - SMTP_* — для отправки писем подтверждения (можно использовать любой transactional-сервис)
# - S3_BACKUP_ENDPOINT, S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY, S3_BACKUP_SECRET — для off-site бэкапа
# - ANTHROPIC_API_KEY (если хотите cloud LLM для default-категории)
nano .env
```

## 3.3. Старт

```
# Поднять весь стек
make up
```

```
# Дождаться готовности (проверить healthcheck'и)
make status
```

```
# Применить миграции (если не применились автоматически)
make migrate
```

```
# Создать первого пользователя (admin)
make seed-admin
```

```
# Проверить — открыть в браузере
# https://<your-domain>/
# (если без TLS — http://<server-ip>:3000)
```

После make up должны подняться все контейнеры. Проверка состояния через docker compose ps — все health должны быть healthy в течение 2-3 минут.

# 4. Справочник конфигурации (.env)

Каждая переменная имеет осмысленное значение по умолчанию, кроме критичных (помечены REQ — required). Полный список — в .env.example.

## 4.1. Сетевое и TLS

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| DOMAIN | REQ | Доменное имя инстанса (для Caddy + Let's Encrypt) |
| ADMIN_EMAIL | REQ | Email для Let's Encrypt уведомлений |
| EXTERNAL_PORT_HTTP | 80 | Порт для HTTP (для Let's Encrypt challenge) |
| EXTERNAL_PORT_HTTPS | 443 | Порт для HTTPS |
| TLS_MODE | letsencrypt | letsencrypt \| self-signed \| manual |

## 4.2. База данных

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| POSTGRES_PASSWORD | REQ | Сгенерируется generate-keys.sh |
| POSTGRES_PORT | 5432 | Только internal |
| JWT_SECRET | REQ | Сгенерируется |
| ANON_KEY, SERVICE_ROLE_KEY | REQ | JWT-токены, сгенерируются generate-keys.sh |

## 4.3. Объектное хранилище (MinIO)

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| MINIO_ROOT_USER | minioadmin | Smena obyazatelna |
| MINIO_ROOT_PASSWORD | REQ | Сгенерируется |
| S3_BACKUP_ENDPOINT | (empty = off-site backup disabled) | Например, https://s3.us-west-002.backblazeb2.com |
| S3_BACKUP_BUCKET | — | Bucket для бэкапов на внешнем S3 |
| S3_BACKUP_ACCESS_KEY, S3_BACKUP_SECRET | — | Ключи внешнего S3 |

## 4.4. SMTP

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| SMTP_HOST | REQ | Например, smtp.fastmail.com или smtp.gmail.com |
| SMTP_PORT | 587 | STARTTLS |
| SMTP_USER, SMTP_PASS | REQ | Для аутентификации |
| SMTP_FROM | REQ | noreply@<your-domain> |

## 4.5. LLM-провайдеры

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| ANTHROPIC_API_KEY | (empty) | Включает Claude для default-категории |
| OPENAI_API_KEY | (empty) | Включает OpenAI для default-категории |
| VOYAGE_API_KEY | (empty) | Эмбеддинги (рекомендуется) |
| DEFAULT_PROVIDER | anthropic | anthropic \| openai \| local |
| LLM_BUDGET_USD_PER_DAY_PER_USER | 5 | Лимит расходов в день (предотвращает runaway-сценарии) |

## 4.6. Безопасность и приватность

| **Переменная** | **Default** | **Назначение** |
| --- | --- | --- |
| RATE_LIMIT_AUTH_PER_MIN | 10 | Лимит auth-эндпоинтов per IP |
| RATE_LIMIT_API_PER_MIN | 300 | Лимит чтения per user |
| RATE_LIMIT_WRITE_PER_MIN | 60 | Лимит записи per user |
| ENABLE_REGISTRATION | false | В self-host обычно false (только seed-admin создаёт пользователей) |
| MFA_REQUIRED | false | Принудительная MFA (полезно если public-deploy) |

# 5. Рутинные операции

## 5.1. Состояние и логи

```
make status                 # docker compose ps + healthchecks
make logs                   # вся группа сервисов tail -f
make logs SVC=nabu-api      # конкретный сервис
make logs SVC=nabu-worker --tail=200
docker compose logs --since=1h --grep="ERROR"
```

## 5.2. Старт / стоп / рестарт

```
make up                     # старт всех сервисов
make down                   # остановка
make restart SVC=nabu-api   # рестарт одного сервиса
make pull                   # подтянуть новые образы (для обновления)
```

## 5.3. Db-доступ

```
make psql                   # psql внутри контейнера postgres под admin
make pg-shell               # bash внутри контейнера postgres (для pg_dump и т. п.)
make typedb-shell           # TypeDB Console
```

# 6. Обновление

## 6.1. Стандартное обновление (minor / patch)

```
# 1. Прочитать CHANGELOG.md для новой версии
git pull
```

```
# 2. Сделать бэкап перед обновлением
make backup-now
```

```
# 3. Подтянуть новые образы
make pull
```

```
# 4. Применить миграции (если есть)
make migrate-dry-run        # посмотреть, что будет применено
make migrate
```

```
# 5. Рестарт всех сервисов с новыми образами
make up
```

```
# 6. Проверить
make status
make smoke-test             # автоматический smoke-suite
```

## 6.2. Мажорное обновление

Мажорные релизы (v2.0.0, v3.0.0) могут содержать breaking changes. Действия:

1. Внимательно прочитать UPGRADE.md новой версии.
1. Сделать полный backup и off-site copy.
1. По возможности — поднять staging-инстанс и протестировать.
1. Применить только когда есть время на rollback.
1. Для multi-tenant: rolling upgrade с graceful drain.

## 6.3. Rollback

```
# Если что-то пошло не так после обновления:
make down
```

```
# Откатить теги образов в .env (например, NABU_VERSION=v1.5.2 вместо v1.6.0)
nano .env
```

```
# Откатить миграции (если применили)
make migrate-rollback STEPS=N
```

```
# Поднять старую версию
make up
```

```
# Если миграции необратимы — восстановить из бэкапа
make restore BACKUP=<backup-id>
```

# 7. Бэкап и восстановление

## 7.1. Что бэкапим

1. Postgres dump (pg_dump --clean --if-exists --format=custom).
1. TypeDB export (typedb export).
1. MinIO bucket nabu-data (mc mirror).
1. Конфигурация (.env, custom configs) — отдельный шифрованный архив.

## 7.2. Расписание

По умолчанию (настройка через BACKUP_SCHEDULE в .env):

- Полный бэкап — каждые 24 часа.
- Инкрементальный (только MinIO-mirror) — каждые 6 часов.
- Off-site копия через mc mirror на внешний S3 — следует за каждым полным.
- Retention локально — 7 дней; на внешнем S3 — 30 дней.

## 7.3. Команды

```
make backup-now              # запустить полный бэкап немедленно
make backup-list             # список доступных бэкапов
make backup-verify           # проверить целостность последнего
```

```
# Восстановление
make restore BACKUP=2026-05-20T03:00:00Z
# или
make restore-latest
```

```
# Восстановление только одного компонента
make restore-pg BACKUP=2026-05-20T03:00:00Z
make restore-typedb BACKUP=2026-05-20T03:00:00Z
make restore-minio BACKUP=2026-05-20T03:00:00Z
```

## 7.4. Disaster recovery — учения

Раз в квартал обязательно: восстановите на тестовом сервере и убедитесь, что бэкап рабочий. Реальные DR-сценарии:

1. Сервер полностью утрачен. План: новый сервер → клонировать nabu-deploy → восстановить .env из шифрованной off-site копии → make restore-latest → проверить.
1. Только Postgres повреждён. План: docker compose stop postgres → восстановление volume из бэкапа → start → migrate → smoke-test.
1. Случайное удаление заметок (массовое). План: восстановление из soft-delete через UI (для < 30 дней); восстановление из бэкапа через make restore-pg на staging → ручной cherry-pick таблиц.

## 7.5. Шифрование бэкапов

Бэкапы шифруются AES-256-GCM с отдельным backup-master-key. Ключ сгенерирован при первой установке (./scripts/generate-keys.sh) и хранится в .env как BACKUP_ENCRYPTION_KEY.

Критически важно: BACKUP_ENCRYPTION_KEY должен быть сохранён ОТДЕЛЬНО от сервера (например, в password manager). Иначе бэкап бесполезен.

# 8. Мониторинг

## 8.1. Базовая (без дополнительных компонент)

- make status — quick check состояния.
- docker stats — потребление ресурсов.
- /v1/health/ready — http-эндпоинт. Возвращает 200/503.

## 8.2. Полная (включается через MONITORING_ENABLED=true)

При включении поднимаются: Prometheus, Grafana, node_exporter, postgres_exporter.

- Grafana доступна на /monitoring/ (за basic-auth, креды в .env).
- Pre-built dashboards: System, Postgres, NestJS (NestJS-prometheus), Agents (custom).

## 8.3. Ключевые метрики и alerts

| **Метрика** | **Порог alert** | **Действие** |
| --- | --- | --- |
| CPU host > 80% | ≥ 5 мин | Проверить логи; масштабировать worker'ы; возможно — миграция на более мощный VM |
| RAM host > 90% | ≥ 5 мин | Проверить утечки; restart worker'ов; добавить swap; масштабировать |
| Disk > 80% | — | Проверить ротацию логов; vacuum Postgres; lifecycle policy MinIO; почистить старые бэкапы |
| Postgres connections > 80% от max | ≥ 2 мин | Проверить медленные запросы; pgbouncer; увеличить max_connections |
| nabu-api 5xx rate > 1% | ≥ 5 мин | Логи; недоступность LLM-провайдеров; деградация БД |
| nabu-worker queue lag > 10 мин | ≥ 5 мин | Worker завис; масштабировать; проверить LLM-провайдеры |
| LLM budget превышен | Достигнут лимит | Уведомление пользователю; auto-throttle |
| Healthcheck любого сервиса = unhealthy | Однократно | Логи сервиса; рестарт; если повторяется — debug |
| TLS expires < 14 дней | — | Caddy должен ротировать автоматически; если не — проверить сетевую доступность Let's Encrypt |

# 9. Troubleshooting — частые проблемы

## 9.1. Контейнер не стартует

- docker compose logs <service> — посмотреть, на чём упал.
- Частые причины: занятый порт, неправильный .env, права на volume.
- Lock-file Postgres: при ungraceful shutdown нужно удалить /var/lib/postgresql/data/postmaster.pid.

## 9.2. Healthcheck сервиса остаётся unhealthy

- docker compose ps — посмотреть статус всех.
- docker compose exec <service> sh — войти внутрь.
- Проверить network: docker compose exec nabu-api ping postgres.
- Проверить migrations: иногда Postgres healthy, но миграции упали — make migrate.

## 9.3. Worker не обрабатывает заметки

1. Проверить логи worker'а: docker compose logs nabu-worker --tail=200.
1. Проверить размер очереди: make queue-stats.
1. Если очередь растёт: возможно, недоступен LLM-провайдер. Проверить ANTHROPIC_API_KEY валидность.
1. Если worker крутится в retry-loop: docker compose restart nabu-worker. Если повторяется — посмотреть failed-messages в pgmq.archive.
1. Massive backlog: масштабировать — WORKER_REPLICAS=3 в .env, make up.

## 9.4. Sync не работает

1. Проверить, что Realtime сервис здоров: curl https://<domain>/realtime/v1/api/tenants/<tenant>/channels.
1. В клиенте — Settings → Sync — увидите статус соединения.
1. Если Realtime недоступен — клиент переходит на pull-polling каждые 60с (fallback). Это работает, но медленнее.
1. Conflict-flood: пользователь видит много conflict-баннеров. Проверить, что часы устройств синхронизированы (NTP).

## 9.5. Ollama не обнаруживается на десктопе

1. Убедиться, что Ollama запущен: ollama serve в отдельном терминале.
1. Проверить: curl http://localhost:11434/api/tags. Если 200 — Ollama работает.
1. Если порт другой — в Nabu Desktop: Settings → Local LLM → задать URL.
1. В firewall: разрешить локальные соединения от Nabu-Tauri к 11434.

## 9.6. TLS сертификат не выпускается

1. Caddy логи: docker compose logs caddy.
1. Частые причины: DNS A-запись не указывает на сервер; порт 80 закрыт фаерволом; Let's Encrypt rate limit (5 неудач в час).
1. Workaround: использовать ZeroSSL или self-signed на время дебага.

## 9.7. Postgres медленный

1. Включить slow query log: ALTER SYSTEM SET log_min_duration_statement = 500;.
1. VACUUM ANALYZE — раз в неделю в cron.
1. Размеры таблиц: SELECT * FROM pg_size_pretty(pg_total_relation_size('notes'));.
1. Если note_embeddings разрослась — переиндексация HNSW: REINDEX INDEX CONCURRENTLY note_embeddings_hnsw_idx;.

## 9.8. Out of memory

1. docker stats — кто потребляет больше всех.
1. Частые виновники: postgres (shared_buffers слишком большой), typedb (Java-heap), worker (зависший LLM-вызов).
1. Тюнинг postgres.conf: shared_buffers ≤ 25% RAM, effective_cache_size ≤ 75%, work_mem умеренный.
1. Для typedb: JAVA_OPTS="-Xmx2g" в .env.

# 10. Security: рутинные действия администратора

1. Раз в месяц: make security-audit — запускает trivy на образы, npm audit на зависимости, выводит отчёт.
1. Раз в квартал: проверить актуальность образов docker compose pull && docker image prune.
1. Раз в квартал: учения восстановления из бэкапа.
1. При появлении CVE high/critical в зависимостях — обновить в течение 7 дней.
1. Логи Caddy на подозрительные паттерны (множественные 401 с одного IP) — fail2ban опционально.
1. Если получили security disclosure (через security@<your-domain>) — действовать по §11 документа Security & Privacy Architecture.

# 11. Действия при инциденте

Полная процедура — в документе 11 (Security & Privacy Architecture §11). Здесь — quick-reference для self-host admin.

## 11.1. Подозрение на компрометацию пользователя

1. Зайти в админку: https://<domain>/admin/users.
1. Найти пользователя, нажать «Revoke all sessions» — все access/refresh-токены инвалидированы.
1. Уведомить пользователя по email о возможном инциденте, рекомендовать сменить пароль и включить MFA.
1. Проверить /v1/audit/security-events для подозрительной активности.

## 11.2. Подозрение на компрометацию сервера

1. Немедленно: make down — остановить сервис, чтобы предотвратить дальнейшую утечку.
1. Создать изолированную копию текущего состояния для forensics: tar cvf forensics-snapshot-<date>.tar /var/lib/docker/volumes/.
1. На чистом сервере: восстановить из последнего trusted бэкапа (до момента компрометации).
1. Поменять все ключи: ./scripts/regenerate-keys.sh.
1. Уведомить пользователей в течение 72 часов согласно GDPR (если применимо к multi-tenant).

## 11.3. Потеря данных

1. Если случайное удаление пользователем — soft-delete window 30 дней (UI восстановление).
1. Если массовая потеря — make restore-latest на staging, ручная проверка целостности, затем на prod.
1. Если бэкапы тоже повреждены — пытаться восстановление с off-site копии.

# 12. Приложение: справочник команд

```
# Базовое управление
make up                       # старт всех сервисов
make down                     # остановка
make restart SVC=<name>       # рестарт сервиса
make pull                     # подтянуть новые образы
make status                   # docker compose ps
make logs [SVC=<name>] [--tail=N]
```

```
# База данных
make psql                     # psql shell
make pg-shell                 # bash в postgres контейнере
make migrate                  # применить миграции
make migrate-rollback STEPS=N
```

```
# TypeDB
make typedb-shell             # console
make typedb-backup
make typedb-restore FILE=<file>
```

```
# Бэкапы
make backup-now
make backup-list
make backup-verify
make restore BACKUP=<id>
make restore-latest
```

```
# Очереди
make queue-stats
make queue-archive            # просмотр failed
make queue-replay ID=<msg_id> # повторить failed-сообщение
```

```
# Безопасность
make security-audit           # trivy + npm audit
make regenerate-keys          # пересоздать все ключи (требует rolling restart)
make smoke-test               # быстрый health-check
```

```
# Пользователи
make seed-admin               # создать первого admin
make user-list
make user-revoke-sessions EMAIL=<email>
make user-purge EMAIL=<email> # полный purge по запросу пользователя
make user-export EMAIL=<email> # GDPR-экспорт
```
