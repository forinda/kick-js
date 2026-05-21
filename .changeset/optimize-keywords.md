---
'@forinda/kickjs': patch
'@forinda/kickjs-auth': patch
'@forinda/kickjs-drizzle': patch
'@forinda/kickjs-prisma': patch
'@forinda/kickjs-queue': patch
'@forinda/kickjs-ws': patch
'@forinda/kickjs-swagger': patch
'@forinda/kickjs-devtools': patch
'@forinda/kickjs-devtools-kit': patch
'@forinda/kickjs-testing': patch
'@forinda/kickjs-vite': patch
'@forinda/kickjs-ai': patch
'@forinda/kickjs-mcp': patch
'@forinda/kickjs-cli': patch
'@forinda/kickjs-lint': patch
'@forinda/kickjs-db': patch
'@forinda/kickjs-db-pg': patch
'@forinda/kickjs-db-mysql': patch
'@forinda/kickjs-db-sqlite': patch
---

chore(meta): focus npm keywords per-package, drop sibling self-references

Every published package's `keywords` array used to list the entire `@forinda/kickjs-*` family — `@forinda/kickjs-auth` had `@forinda/kickjs-drizzle`, `@forinda/kickjs-prisma`, `@forinda/kickjs-vite` etc. in its keywords, none of which describe what the auth package does. That's classic keyword stuffing: npm's search algorithm doesn't reward it, some implementations actively demote noisy packages, and it diluted the genuine signal for each package.

Rewrote the keywords on all 19 published packages so each array describes **that specific package** — what a developer would actually type into npm search to find it. A shared 4-keyword header (`kickjs`, `nodejs`, `typescript`, `decorator-driven`) stays on each package so the family is still discoverable as a family. Removed: every `@forinda/kickjs-*` sibling self-reference, irrelevant `vite` from non-vite packages, irrelevant `framework` / `backend` / `api` from leaf adapters, and generic `database` / `query-builder` from packages where it doesn't add signal.

No code change, no test impact. Metadata-only — npm search ranking will refresh on next publish.
