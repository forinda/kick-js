---
'@forinda/kickjs-cli': patch
---

A fullstack workspace root gets `test` (the server's tests) and `format` (the server's `kick format`) scripts. Its `CLAUDE.md`, `AGENTS.md` and README list `run test`, `run typecheck` and `run format` from the root, rather than `kick typecheck` / `kick format`, which have no `kick.config.ts` at the root to run against.
