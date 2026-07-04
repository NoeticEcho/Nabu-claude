## Summary

What does this PR change, and why?

Closes #<issue-number> (if applicable).

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` — no behavior change
- [ ] `test` — tests only
- [ ] `chore` — tooling / maintenance

## How was this tested?

- [ ] `npm test` (unit) passes
- [ ] `npm run test:hooks` (guard hooks) passes
- [ ] `npm run test:db` passes (if DB-related; requires a live stack)
- [ ] `npm run typecheck` passes
- [ ] Manually verified (describe below)

Notes:

## Checklist (hard rules — see CONTRIBUTING.md)

- [ ] `cli/*` remains zero-dependency
- [ ] New MCP tools are narrow, Zod-validated, and return the
      `ok`/`degraded`/`fail` contract from `lib/mcp-result`
- [ ] Schema changes are additive only (`IF NOT EXISTS`), no changes to the
      shared Nabu schema
- [ ] Privacy invariants preserved (`private`/`vault` never leave for third-party
      APIs or logs; vault plaintext never enters model context via routine paths)
- [ ] Dark-theme-only and Russian UI strings respected
- [ ] New agent definitions follow the `agents/*.md` frontmatter canon
      (`name` / `model` / `disallowedTools`)
- [ ] Conventional-ish commit messages (`feat(scope): …`)
- [ ] `CHANGELOG.md` updated under `[Unreleased]` (for user-facing changes)

## Additional notes

Anything reviewers should know.
