# Развёртывание OlimpOS на VPS за HTTPS

Гайд по запуску много-тенантного инстанса Nabu/OlimpOS на публичном сервере: reverse-proxy с
автоматическим TLS, изоляция веб-сервера на localhost, переменные окружения много-тенантного
режима, требования к docker-песочнице проектов.

> **Модель безопасности.** `chat-server` слушает только `127.0.0.1` и **никогда** не выставляется
> в интернет напрямую. Наружу смотрит reverse-proxy (Caddy/nginx), терминирует TLS и проксирует на
> локальный порт. Сессии подписываются HMAC (`NABU_SESSION_SECRET`), cookie — `HttpOnly; SameSite=Lax`.

## 0. Предпосылки

- VPS с Linux, публичным IP и доменом (`A`/`AAAA`-записи на IP).
- Docker + docker compose (для стека Postgres/TypeDB/Ollama **и** для песочниц проектов).
- Открытые порты `80`/`443` (для proxy и ACME-челленджа). Порт приложения (`4517`) — **закрыт** снаружи.
- Telegram-бот (токен от @BotFather) — для входа через Telegram и группового режима.

## 1. Установка и стек

```bash
# как обычно (см. README): установка nabu + docker-стек
nabu init            # поднимает pg(5433)/typedb/ollama, применяет схемы к БД `nabu`, генерит ~/Nabu/.env
```

`nabu init` создаёт `~/Nabu/.env` c `DATABASE_URL`, `NABU_PG_PASSWORD`, `NABU_VAULT_KEY` и пр.
Все OlimpOS-миграции (`019…023`) применяются автоматически (идемпотентно).

## 2. Переменные окружения много-тенантного режима

Добавьте в `~/Nabu/.env` (файл `chmod 600`, в git не попадает):

```dotenv
# ── Много-тенантность (ОБЯЗАТЕЛЬНО для публичного инстанса) ──
NABU_MULTITENANT=1                     # включает веб-авторизацию (сессии/тенант) и групповой режим
NABU_SESSION_SECRET=<64+ hex>          # openssl rand -hex 32 — подпись сессий, стабильна между рестартами
TELEGRAM_BOT_TOKEN=<токен @BotFather>  # вход через TG + групповые чаты; НИКОГДА не коммитить
NABU_BOT_USERNAME=<имя_бота_без @>     # для deep-link t.me/<bot>?start=… (иначе резолвится через getMe)

# ── Приватность/эмбеддинги — только локально (инвариант) ──
OLLAMA_BASE_URL=http://127.0.0.1:11434

# ── Опционально: allowlist групповых чатов (csv chat.id) ──
# По умолчанию групповой проект создаётся, только если автор реплики — уже зарегистрированный
# пользователь (делал /start в личке) или чат уже имеет проект. Явный allowlist разрешает
# конкретные chat.id безусловно. Оставьте пустым, если хватает поведения по умолчанию.
# NABU_GROUP_ALLOWLIST=-1001234567890,-1009876543210
```

> **Безопасность по умолчанию (аудит R8):** при `NABU_MULTITENANT=1` сессионная cookie получает
> атрибут `Secure`, включён rate-limit на логин/регистрацию, а сбой резолвинга тенанта **отклоняет
> обмен** (fail-closed, без утечки в чужой скоуп). Если `NABU_SESSION_SECRET`/`NABU_VAULT_KEY` не
> заданы — сервер громко предупреждает при старте (задайте секрет **до** публичного запуска).

> Без `NABU_MULTITENANT=1` веб остаётся в одно-пользовательском режиме localhost-trust
> (форма логина не показывается) — это правильно для локальной машины, но **не** для VPS.

Перегенерировать секрет сессий (разлогинит всех):

```bash
printf 'NABU_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> ~/Nabu/.env
```

## 3. Запуск демона (systemd + linger)

```bash
nabu install-service         # ставит user-unit автозапуска (systemd на Linux) и включает linger
nabu start                   # запустить демон сейчас
nabu status                  # проверить состояние
```

Демон = chat-server (`127.0.0.1:4517`) + telegram-bot (long-poll) + scheduler в одном процессе.
Проверьте, что порт приложения слушает **только** локально:

```bash
ss -ltnp | grep 4517         # ожидается 127.0.0.1:4517, НЕ 0.0.0.0
```

## 4. Reverse-proxy с автоматическим HTTPS

### Вариант A — Caddy (рекомендуется: авто-TLS из коробки)

`/etc/caddy/Caddyfile`:

```caddy
olimpos.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:4517 {
        # SSE-стрим ответов адъютанта — не буферизировать, длинные таймауты
        flush_interval -1
        transport http {
            read_timeout  1h
            write_timeout 1h
        }
    }
}
```

```bash
sudo systemctl reload caddy   # Caddy сам получит и продлит сертификат Let's Encrypt
```

Публичные сайты spaces (`/s/<slug>/…`) и вход по deep-link работают через тот же хост автоматически.

### Вариант B — nginx + certbot

```nginx
server {
    listen 443 ssl http2;
    server_name olimpos.example.com;

    ssl_certificate     /etc/letsencrypt/live/olimpos.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/olimpos.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4517;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE (стрим ответов) — отключить буферизацию, длинные таймауты
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
server {                       # редирект 80 → 443
    listen 80;
    server_name olimpos.example.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo certbot --nginx -d olimpos.example.com   # выпуск + авто-обновление сертификата
sudo systemctl reload nginx
```

## 5. Firewall

```bash
sudo ufw allow 80,443/tcp
sudo ufw deny 4517/tcp        # приложение — только через proxy
sudo ufw deny 5433/tcp        # Postgres — только локально
sudo ufw enable
```

Docker-стек уже привязывает порты к `127.0.0.1` (`127.0.0.1:5433:5432` и т.д.) — наружу не торчат.

## 6. Регистрация пользователей

После HTTPS-развёртывания на `https://olimpos.example.com`:

- **Веб**: форма логина показывается автоматически (`NABU_MULTITENANT=1`). Регистрация по
  email+паролю (scrypt) **или** кнопка «Войти через Telegram» (deep-link, одноразовый код, TTL 10 мин).
- **Telegram**: `/start` у бота автоматически заводит личное пространство пользователя.
- **Группы**: добавьте бота в групповой чат — создаётся проектное пространство `g:<chatId>`;
  реплики атрибутируются по автору, общая память/задачи проекта изолированы от личных пространств.

Изоляция: у каждого пользователя своё пространство `u:<userId>`; личная память/знания **никогда** не
смешиваются между пользователями. Общий слой (агенты/скиллы/опыт) — namespace `__commons__`.

## 7. Песочницы проектов (git push и код)

Программирование проектов (`sandbox_run`, `sandbox_git_*`) требует доступного docker на сервере
(тот же демон, что и стек). Ограничения контейнеров: `--network none` по умолчанию, лимиты
memory/cpu/pids, `no-new-privileges`, жёсткий таймаут+SIGKILL, монтируется только папка проекта.

**`git push` — высокорисковое действие (external write) и проходит через approval:**

1. Агент вызывает `nabu-memory.request_approval({riskClass:"external", action:"git_push:<namespace>", summary})`.
2. Пользователь подтверждает кнопкой (веб/Telegram) — `decided_by='user'` (модель себя не одобряет).
3. Агент передаёт `approvalId` в `sandbox_git_push`. Approval **одноразовый**, привязан к пространству
   проекта и `action`, уважает `expires_at`. Токены в удалённом URL маскируются в выводе и аудит-логе.

Приватные репозитории: URL с токеном формирует пользователь при `git clone`/через approved-approval;
токен не логируется.

## 8. Резервное копирование и обновления

```bash
nabu backup            # дамп Postgres (pg-<ts>.sql.gz) + конфиги
nabu update            # обновить код; ~/Nabu/.env и конфиги пользователя сохраняются
```

После `nabu update` перезапустите демон: `nabu stop && nabu start` (или `systemctl --user restart nabu`).

## Чеклист перед публичным запуском

- [ ] `NABU_MULTITENANT=1`, `NABU_SESSION_SECRET` (64 hex), `TELEGRAM_BOT_TOKEN` заданы в `~/Nabu/.env` (0600)
- [ ] `chat-server` слушает `127.0.0.1:4517` (проверено `ss -ltnp`)
- [ ] Reverse-proxy отдаёт HTTPS, SSE не буферизуется (стрим ответов работает)
- [ ] Firewall: наружу только `80/443`; `4517`, `5433` закрыты
- [ ] Вход через email и через Telegram проверены; личные пространства изолированы
- [ ] Docker доступен для песочниц; `git push` требует approval (проверено)
- [ ] Настроен `nabu backup` (cron/таймер)
