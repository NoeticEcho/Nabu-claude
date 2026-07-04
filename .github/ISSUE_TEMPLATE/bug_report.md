---
name: Bug report
about: Report something that isn't working as expected
title: "[bug] "
labels: bug
assignees: ''
---

## Description

A clear and concise description of the bug.

## Steps to reproduce

1. …
2. …
3. …

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include error messages or log excerpts if any.
Remember: **do not paste `private`/`vault` content or secrets** (tokens,
passwords, `NABU_VAULT_KEY`, `DATABASE_URL`).

## Environment

Please paste the output of `nabu doctor` (redact any secrets):

```
<nabu doctor output>
```

- Nabu commit: `git rev-parse --short HEAD`
- Mode: standalone (local Docker stack) / shared (external Nabu DB)
- OS: Linux / macOS / Windows
- Node version: `node -v`
- Docker version: `docker --version`
- Client: web chat / Telegram bot / CLI / slash command

## Logs (optional)

Relevant lines from `nabu logs`, `nabu logs --chat`, or a job log. Redact
message text and secrets.

## Additional context

Anything else that helps.
