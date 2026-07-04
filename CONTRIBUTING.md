# Contributing to Nabu

Thanks for your interest in Nabu — a personal AI council that runs inside
[Claude Code](https://claude.com/claude-code). This guide covers how to set up a
development environment, run the test suites, and the hard rules that keep the
project coherent.

Nabu's UI is **Russian-first**; this document (and the rest of the contributor
tooling) is in English so the project is approachable to outside contributors.

## Ground rules first

Before writing code, read:

- `CLAUDE.md` — the invariants (privacy, safety, harness discipline). These are
  not suggestions; a change that violates them will not be merged.
- `ARCHITECTURE.md` — the council protocol and MCP server layout.
- `SAFETY.md` — competence boundaries and wellbeing rules.
- `ROADMAP.md` — what is planned and what has been consciously deferred.

## Prerequisites

- **Node.js ≥ 22** (see `engines` in `package.json`)
- **Docker** + Compose v2 (for the local stack: pgvector, TypeDB, Ollama)
- **Claude Code** CLI (the reasoning "brain"; a Max subscription is assumed — no
  separate model API keys are used)
- **Ollama** for local embeddings (`nomic-embed-text-v2-moe`, 768-dim)
- Optional: `pip install faster-whisper` for local voice transcription

## Setup

```bash
git clone https://github.com/noeticecho/nabu-claude.git
cd nabu-claude
npm install
npm run build        # tsc -b: compiles lib/ + all 7 MCP servers
```

For a full local stack (Docker + schemas + embedding model + smoke test) the
fastest path is the zero-config installer — see `docs/ZERO_CONFIG.md`:

```bash
bash scripts/install.sh
```

## Running the tests

Keep the tree green. CI-relevant commands:

| Command | What it checks | Needs a live stack? |
|---|---|---|
| `npm test` | 34 unit tests (stats, personality, postgres helpers, lib units, vault) | no |
| `npm run test:hooks` | 47 guard-hook cases (destructive-command protection) | no |
| `npm run test:db` | integration tests against a running DB | **yes** (`.env` + Docker stack) |
| `npm run eval` | agent/behavior evals (`evals/runner.mjs`) | no (add `--mode live --judge` for live) |
| `npm run typecheck` | `tsc -b` type check | no |
| `npm run smoke` | connection smoke test (Postgres + Ollama + memory + TypeDB) | **yes** |

`npm test` and `npm run test:hooks` must pass for any PR. Run `npm run test:db`
locally when you touch repositories, schemas, or MCP data paths.

## Project layout

| Path | What lives there |
|---|---|
| `lib/` | TypeScript core: repositories, embeddings, personality engine, DB helpers |
| `mcp/` | 7 narrow MCP servers (memory, pipeline, council, voice, analytics, domain, improve) |
| `cli/` | Zero-dependency `nabu` CLI, web chat server + UI, optional Telegram bot |
| `agents/` | 68 subagent definitions (`*.md` with frontmatter) + `registry.json` |
| `skills/` | The `nabu-orchestrator` skill (adjutant / dispatcher) |
| `schema/` | Additive SQL (`schema/postgres/*.sql`) and TypeQL (`schema/typedb/*.tql`) |
| `commands/` | 20 slash commands (`/nabu-*`) |
| `docs/` | Extended docs (zero-config, teams, scheduling, safety research) |
| `evals/` | Eval runner and cases |
| `scripts/` | Installer, hooks, transcription helper |

## Hard rules

These are enforced in review. A PR that breaks one of them will be asked to
change before anything else is discussed.

1. **`cli/*` stays zero-dependency.** No npm packages, no build step, no CDN
   assets. The whole value of zero-config is "clone and run". If you need a
   library in the CLI, you almost certainly want it in `lib/` instead.
2. **MCP tools are narrow and typed.** Every tool validates input with Zod and
   returns the shared `ok` / `degraded` / `fail` result contract from
   `lib/mcp-result`. No broad "do anything" tools.
3. **Schemas are additive only.** New SQL/TQL uses `IF NOT EXISTS` (or the
   equivalent guarded form) and never alters or drops columns from the shared
   Nabu schema. Nabu shares a database with the main Nabu app — do not break it.
4. **Privacy invariants (from `CLAUDE.md`) are non-negotiable.**
   - `private` / `vault` data never leaves for a third-party API or into logs.
   - `vault` is AES-256-GCM encrypted at rest with a machine-local key, gets no
     embeddings, and its plaintext must never enter model context through
     routine paths.
   - High-risk actions go through **out-of-model human approval**, never
     model self-approval.
5. **Dark theme only.** `color-scheme: dark` is fixed; there is no light variant.
6. **Russian UI strings.** User-facing text in the chat, bot, and CLI is Russian.
7. **Heavy operations run locally**, not through Claude (embeddings,
   transcription, private/vault entity extraction).
8. **New agents follow the `agents/*.md` canon** — frontmatter with `name`,
   `model`, `disallowedTools`. Do not create agents "just in case"; the
   `agent-creator` spawns specialists on demand.

## Commit and PR conventions

- Commits are conventional-ish: `feat(scope): …`, `fix(scope): …`,
  `docs: …`, `chore: …`, `refactor(scope): …`, `test: …`.
- Keep changes focused; one logical change per PR.
- Tests stay green. Update `CHANGELOG.md` under `[Unreleased]` for user-facing
  changes.
- Fill in the pull request template.

## Reporting bugs and requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. For anything
security-sensitive, do **not** open a public issue — follow `SECURITY.md`.
