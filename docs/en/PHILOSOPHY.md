# Nabu — Philosophy

> **North Star:** a person with Nabu makes better decisions, remembers their life as a
> whole, and stays its author. The AI is a council, not a regent.

## The Council

Nabu is not a single chatbot. You talk to an **adjutant**; it triages each request.
Simple, single-domain questions get a direct answer. Multi-domain questions convene the
**Council** — the relevant domain ministers debate as a team, and a facilitator synthesises
one answer **with the trade-offs exposed**, not averaged away. A critic checks safety
boundaries before you see the result. The Council advises; the final decision is always
yours.

The ministers cover nine domains of life: health, mind, finance, work, learning,
relationships, growth, lifestyle, and admin. Narrow specialists are spawned on demand when
a question needs competence the standing Council lacks — never stockpiled in advance.

**The brain is Claude Code.** The reasoning is done by the Claude subscription you already
have; there are no extra API keys or per-token bills. Anything heavy — embeddings,
transcription, entity extraction for private notes — runs on local models.

## Seven kinds of memory

Nabu remembers what you choose to tell it, across seven memory types: **episodic,
semantic, working, procedural, prospective, autobiographical, and associative**. They live
in Postgres/pgvector plus a TypeDB knowledge graph. From those points of memory the
reflector periodically writes chapters of your autobiography — a story, not just a log.

## Privacy invariants

These are non-negotiable, enforced by architecture rather than by asking the model nicely:

- **Local-first.** All memory lives in your own Docker volumes; ports bind to `127.0.0.1`
  only, and no private content is sent to the cloud.
- **Vault is end-to-end encrypted.** `visibility: vault` content is AES-256-GCM encrypted
  with a machine-local key **before** it reaches the database, gets **no embeddings at all**
  (not even local ones), and never enters the model context through routine paths.
- **Approval outside the model.** Any external, financial, or destructive action waits for
  a **human button press** (web ✅/❌ or a Telegram inline keyboard). The model cannot
  approve itself.
- **Honesty and honest degradation.** Facts about you are never invented — no data means
  Nabu says so. When a capability is missing (an OCR binary, a parser), it degrades openly
  and says why. Logs record timings and cost, never message content.
- **Boundaries, not doctors.** Domain agents give information and structure; they route you
  to a licensed professional for medical, legal, financial, or therapeutic decisions. AI
  supports professionals and living relationships — it does not replace them.

## Commons

Instances of Nabu can improve the project together. With the user's opt-in, an instance
notices problems locally, proposes changes as **aggregates only — never personal data**,
and the network votes with 👍 and evidence. Developers implement prioritized proposals; a
**human maintainer** is the only one who reviews and merges — instances never self-approve.
The whole loop is **off by default**.
