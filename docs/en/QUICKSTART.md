# Nabu — Quick Start

Nabu installs and runs with **a single command** — no manual database, key, or model
setup. This is the English onboarding guide; deeper topics live in the Russian docs and
are linked where relevant.

## Install

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.ps1 | iex
```

Requirements: git, Node ≥22, npm, Docker (+ compose v2), and the Claude Code CLI
(Max subscription). From a checkout you can run `bash scripts/install.sh` directly.
After install, the **`nabu`** command is on your `PATH`.

## What `nabu init` does

`nabu init` is zero-config and idempotent — run it any time. It:

- generates `.env` with random passwords (existing keys are never overwritten) and a
  machine-local `NABU_VAULT_KEY`;
- picks **free ports** so the stack never collides with your own Postgres/TypeDB/Ollama;
- starts the Docker stack — **pgvector (pg17) + TypeDB 3.4 + Ollama** (Ollama only if no
  local binary exists); everything binds to `127.0.0.1` only;
- applies Postgres schemas `000–008` idempotently and loads the full TypeDB ontology;
- pulls the embedding model `nomic-embed-text-v2-moe` via Ollama;
- runs a final smoke test (Postgres + Ollama + memory + TypeDB).

Two modes: **standalone** (no `.env` yet, or `nabu init --local`) brings up and manages
the local Docker stack — Nabu is standalone-only (v1.0.0 decision).

## Daemon, chat, Telegram

```bash
nabu start      # background: scheduler + TTL purge + update check + web chat
nabu status     # daemon, docker services, ollama, updates, schedule
nabu logs       # tail the daemon log
nabu stop       # stop the daemon (--infra also stops the docker stack)
nabu install-service  # autostart via systemd user unit (Linux)
```

**Web chat** — `nabu chat` opens `http://127.0.0.1:4517` (starting the daemon if needed).
It is a dependency-free, dark-only, streaming UI installable as a PWA. Every reply is a
real headless Claude Code session (`claude -p --output-format stream-json --resume`), so
you get the full adjutant/Council/memory pipeline with context carried between messages.
It binds to `127.0.0.1` only and uses a narrow tool allowlist (no file writes).

**Telegram client** (optional) — a second client for daily phone use:

1. Create a bot via @BotFather → put the token in `.env` as `TELEGRAM_BOT_TOKEN=...`
   (optional `TELEGRAM_CHAT_ID=` pins it to one chat). Restart: `nabu stop && nabu start`.
2. Create a **private forum group** (a supergroup with topics), add the bot as an
   **administrator** (with topic-management rights), send `/start`, then `/setup`. The bot
   creates the topics itself: **📥 Inbox (Входящие)** for dumping notes (saved to `notes`,
   private), **🎖 Adjutant** for the main dialogue, and one topic per minister.
3. Single-user binding: the bot only answers in the bound chat; others are ignored.

Voice messages are transcribed **locally** (Whisper) and routed as text. Message content
transits Telegram's servers — a deliberate channel choice; do not send `vault` content there.

## Scheduler and morning briefing

Scheduled jobs run as headless `claude -p` sessions with a narrow allowlist. Agent jobs
are **off by default** (they consume your Claude quota) — enable them deliberately:

```bash
nabu schedule                # list
nabu schedule enable digest  # weekly digest at 09:00
```

The **morning briefing** is an `internal` job — deterministic, **no Claude, no quota**:
it gathers weather, the day's tasks and habits, pending intentions and calendar (ICS)
events, and pushes one Telegram message. Enable it:

```json
{ "name": "briefing", "internal": "briefing", "at": "08:00", "everyDays": 1, "enabled": false, "push": true }
```

```bash
nabu schedule enable briefing
```

Job semantics are honest: a run is recorded **before** execution (anti-poison), so jobs are
*at-most-once* — a run lost to a daemon restart retries in the next window. Results are
pushed to Telegram (if configured) and saved to `.nabu/job-results.json`.

## Importing your data

**Health** — `nabu import-health <file> [--source <name>]` parses vendor file exports
**locally** (no OAuth, no cloud): Apple Health `export.xml`, Google Fit / Health Connect
CSV, or a generic `date,metric,value,unit` CSV. Import is idempotent (dedupe on
series + time + value) and feeds the metric series the health minister reads. Details and
per-vendor export steps: [docs/HEALTH_IMPORT.md](../HEALTH_IMPORT.md) *(Russian)*.

**Finance** — `nabu import-finance <file.csv> [--source bank]` parses bank CSV statements
**locally**: it auto-detects the `,`/`;` separator, decimal comma and date format,
maps columns in RU/EN, categorizes spending with ~15 built-in rules (a bank-supplied
category always wins), and dedupes on re-import via `sha256(date|amount|description)`.
Details: [docs/FINANCE_IMPORT.md](../FINANCE_IMPORT.md) *(Russian)*.

## Backup, reset, uninstall

```bash
nabu backup [--out=dir]   # Postgres dump + TypeDB volume + workspace, retention 7
```

Schedulable via `nabu schedule enable backup`. Restore: Postgres `gunzip | psql`; TypeDB
untar into the volume; workspace `tar -xzf`.

```bash
nabu reset [--hard] [--dry-run] [--yes]
```

Wipes **data and state** (docker volumes → all memory/vault/history; `~/nabu/.nabu`) but
keeps the install, workspace content, `.backups` and `.env` (your keys). `--hard` also
deletes `.env` — losing `NABU_VAULT_KEY` makes vault entries in backups undecryptable.

```bash
nabu uninstall [--purge-workspace] [--images] [--dry-run] [--yes]
```

Full removal: daemon, autostart, docker stack + volumes, CLI wrapper, state. Keeps the
`~/nabu` workspace and `.env` unless `--purge-workspace`. Both commands show a plan and
require confirmation (`--yes` for scripts, `--dry-run` for plan-only).

## Multiple devices

Nabu is standalone: memory lives in one machine's Docker volumes. Phones connect to the home
daemon (Telegram bot, or the web-chat PWA over Tailscale/WireGuard). Moving to a new computer:
`nabu backup [--encrypt]` → transfer archives → restore; copy `NABU_VAULT_KEY` from the old `.env`.

## Troubleshooting (top 5)

1. **`nabu doctor`** — checks node/docker/claude/`.env`/build/ollama/model/smoke and exits
   with a status code. Add `--deep` for a fuller run. Start here for any problem.
2. **Read the logs.** Daemon: `nabu logs` (`~/nabu/.nabu/daemon.log`). Web chat:
   `nabu logs --chat` (`chat.jsonl` — timings and cost only, never message text).
   A scheduled job: `nabu logs --job <name>`. Use `--n=200` for more lines.
3. **Docker stack not up** — `nabu status` shows the docker services; `nabu start` (or
   `nabu init`) brings the stack back. Ports are chosen free, so collisions are rare.
4. **Embedding model missing** — `nabu init` re-pulls `nomic-embed-text-v2-moe`; check
   Ollama is reachable in `nabu status`.
5. **Update problems** — `nabu update` runs `git pull --ff-only → npm install → build →
   restart`; if a pull can't fast-forward, resolve the git state first.

For the full zero-config reference (dashboard, connectors/webhooks, PDF/OCR indexing,
local-LLM extraction, TTS voice replies), see [docs/ZERO_CONFIG.md](../ZERO_CONFIG.md)
*(Russian)*.
