# Nabu — your personal AI council

> A council of AI ministers for every domain of your life — health, money, work,
> relationships, growth — with **lifelong memory**, running **on your machine**,
> powered by the Claude subscription you already have.

[![CI](https://github.com/noeticecho/nabu-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/noeticecho/nabu-claude/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Русская версия →](README.ru.md) · [Лендинг (RU) →](docs/LANDING.md) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Privacy](#privacy-by-architecture) · [Docs](docs/ZERO_CONFIG.md)

Nabu is not another chatbot that forgets you after one message. It is a **team of
specialised AI agents** — 9 domain "ministers", entrepreneur specialists and a 70+ agent processing pipeline —
that see your life as a whole, remember everything you choose to tell them, debate
hard questions collegially, and answer with honest trade-offs instead of averages.

- 🧠 **Brain = Claude Code.** Your existing Claude subscription does the reasoning.
  No extra API keys, no per-token bills.
- 🏠 **Your data stays home.** Postgres + pgvector + TypeDB run in local Docker;
  embeddings are computed by a local model (Ollama). One command sets it all up.
- 🎖 **An adjutant, not an app.** Chat in the browser or in Telegram (text & voice);
  complex questions convene the Council; every risky action waits for **your** button press.

> **Note:** the product UI and agent personas are currently **Russian-first**.
> English UI is on the roadmap — contributions welcome. English docs:
> [Quick Start](docs/en/QUICKSTART.md) · [Philosophy](docs/en/PHILOSOPHY.md).

## Quick start

```bash
# Requirements: Node ≥22, Docker, Claude Code CLI (Max subscription), ~5 min
curl -fsSL https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.sh | bash

nabu start   # daemon: scheduler + web chat + (optional) Telegram bot
nabu chat    # open http://127.0.0.1:4517
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/noeticecho/nabu-claude/master/scripts/install.ps1 | iex
```

`nabu init` is zero-config: it generates `.env` with random passwords, picks free
ports, starts the Docker stack (pgvector + TypeDB + Ollama if absent), applies all
schemas, pulls the embedding model and runs a smoke test. Idempotent — run it any time.

## What you get

| | |
|---|---|
| 💬 **Web chat** | Dark-only, zero-dependency, streaming; installable as a PWA. Every reply is a real Claude Code session with full memory and tools. |
| 📱 **Telegram client** | Optional. A forum group with topics: **📥 Inbox** (dump thoughts — they become notes), **🎖 Adjutant** (main dialogue), one topic per minister. Voice messages are transcribed **locally** (Whisper). Answers stream live. |
| 🏛 **The Council** | Multi-domain questions convene relevant ministers; they debate (Agent Teams), a facilitator synthesises the answer **with trade-offs exposed**, a critic checks safety boundaries. |
| 🧠 **7 kinds of memory** | Episodic, semantic, working, procedural, prospective, autobiographical, associative — in Postgres/pgvector + a TypeDB knowledge graph. |
| 📊 **Dashboard** | Notes, memories, graph, council activity, life domains, RPG-style XP, 14-day dynamics, metric forecasts — in chat (`📊`) and terminal (`nabu stats`). |
| ⏰ **Scheduler** | Daily inbox triage, weekly digests, feedback follow-ups — headless agent runs whose results are **pushed to you** in Telegram. |
| 💾 **Backups** | `nabu backup`: Postgres dump + TypeDB volume + workspace, retention 7, schedulable. |
| 🔄 **Self-updating** | `nabu update` (git → build → restart); daily check, auto-apply opt-in. |
| 🩺 **Health import** | `nabu import-health` parses Apple Health / Google Fit / generic CSV exports **locally** (no OAuth, no cloud) into metric series — trends, forecasts and the health minister see your real dynamics. |
| 💳 **Finance import** | `nabu import-finance` parses bank CSV statements locally: auto-detects RU/EN formats, categorizes spending (~15 rules), dedupes on re-import. The finance minister finally sees real numbers. |
| 🔌 **Integrations** | Declare external APIs as **connectors** (GET-only, path allowlist) — 34 curated free APIs in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md); webhooks in/out (HMAC, replay-protected) connect n8n / Activepieces / Zapier. Outbound automations fire only after **your** approval. |

## How it works

```
you ──► web chat / telegram ──► nabu daemon ──► claude -p (headless Claude Code)
                                                  │  nabu-orchestrator skill (adjutant)
                                                  │  73 subagents · Council protocol
                                                  ▼
              8 MCP servers (memory · pipeline · council · domain · analytics · improve · voice · connect)
                                                  ▼
                 local Docker: Postgres + pgvector · TypeDB graph · Ollama embeddings
```

Everything heavy (embeddings, transcription, entity extraction for private notes)
runs on local models. Claude does the thinking; your machine does the remembering.

## Privacy by architecture

- **Local-first storage.** All memory lives in your Docker volumes. `sslmode` and
  ports bind to `127.0.0.1` only; the web server rejects DNS-rebinding.
- **Three visibility levels.** `default` · `private` (default for health/money/
  relationships) · `vault`.
- **Vault is E2E-encrypted.** AES-256-GCM with a machine-local key before it ever
  reaches the database. Vault entries get **no embeddings at all** — not even local
  ones — and never enter the model context through routine paths. Local-LLM
  extraction (`extract_entities_local`) processes vault notes without Claude seeing the text.
- **You approve risk.** Any external/financial/destructive action creates an approval
  request that only a **human button press** (web ✅/❌ or Telegram inline keyboard)
  can resolve — the model cannot approve itself.
- **Honest logging.** JSONL logs record timings and costs, never message content.
- **Boundaries, not doctors.** Domain agents give information and structure; they
  route you to licensed professionals for medical/legal/financial decisions.

## Commands

`nabu init` · `nabu start|stop|status|logs` · `nabu chat` · `nabu stats` ·
`nabu backup` · `nabu schedule` · `nabu update` · `nabu doctor` · `nabu install-service` ·
`nabu reset` · `nabu uninstall`

Inside chat: 26 slash commands (`/nabu-ask`, `/nabu-council`, `/nabu-triage`,
`/nabu-index`, `/nabu-recall`, `/nabu-decide`, …) — see [docs/ZERO_CONFIG.md](docs/ZERO_CONFIG.md).

## Project layout

```
cli/        zero-dependency CLI, daemon, web chat, telegram bot
lib/        TypeScript core: repositories, vault crypto, stats, personality engine
mcp/        8 MCP servers (narrow, typed tools)
agents/     73 Claude Code subagents (ministers, pipeline, memory, creators, specialists)
skills/     adjutant-orchestrator + domain packs (nabu-marketing)
schema/     additive Postgres SQL + TypeDB TQL (local standalone stack)
commands/   26 slash commands
docs/       product docs (Russian) · ZERO_CONFIG.md · ROADMAP.md
```

## 🌱 Nabu Commons

Instances of Nabu improve the project together. With the user's opt-in, an instance
notices problems locally, proposes changes (aggregates only — never personal data),
and the network votes with 👍 and evidence comments. Developers pick up prioritized
proposals; a **human maintainer** is the only one who reviews and merges — instances
never self-approve. The whole loop is **off by default** (`commons.enabled=false`).
Protocol, safety rules, and maintainer checklist: [docs/COMMONS.md](docs/COMMONS.md).

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Ground rules in short:
`cli/` stays zero-dependency; MCP tools stay narrow and typed; schemas stay
additive; privacy invariants are non-negotiable; tests stay green
(`npm test` — 34 unit, `npm run test:hooks` — 47 guard cases).

## License

[MIT](LICENSE).
