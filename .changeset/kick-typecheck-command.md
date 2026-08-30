---
'@forinda/kickjs-cli': minor
---

`kick typecheck`: one type-check command, whatever the package manager

Generated projects had to spell type-checking in whichever dialect their
manager speaks — `pnpm -r exec tsc --noEmit` against
`cd server && npx tsc --noEmit` — and the fullstack template branched on the
manager to write them. `kick typecheck` is the same command everywhere, takes
`--cwd <dir>`, and exits non-zero on errors so it works as a gate.

It resolves the project's own checker, preferring **`vue-tsc`** when installed.
That preference matters: plain `tsc` does not understand `.vue`, so in a Vue
project it matches no inputs and reports `TS18003: No inputs were found` while
real errors sit unchecked in the SFCs. vue-tsc checks plain `.ts` too, so
preferring it costs nothing.

`kick dev --typecheck` picks up the same preference.
