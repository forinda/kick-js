---
'@forinda/kickjs-cli': patch
---

`kick new` no longer commits `.env.test`. It is gitignored like `.env`, and a
committed `.env.test.example` carries the shared keys.

Test values differ per machine — database names, ports — so a tracked
`.env.test` turned each developer's local tweak into a diff and a merge
conflict for everyone else. Isolation is unchanged: under a test run KickJS
still reads `.env.test` instead of `.env`, a fresh clone has neither file, and
a machine with `.env` but no `.env.test` still gets the backfill warning and a
`kick doctor` warning, which now suggests `cp .env.test.example .env.test`.

Existing projects that want the same split:

```bash
git mv .env.test .env.test.example   # keep the shared keys as the template
cp .env.test.example .env.test
echo .env.test >> .gitignore
```
