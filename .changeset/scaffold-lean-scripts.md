---
'@forinda/kickjs-cli': minor
---

`kick new`: four scripts instead of ten, and oxfmt instead of prettier

Generated projects shipped ten npm scripts, one of which could not run:
`lint: 'eslint src/'`, with eslint in no dependency list, so `pnpm lint` failed
with "command not found" in every scaffolded project.

The set is now `dev`, `build`, `start`, `test`. Everything dropped stays one
command away — `kick dev:debug`, `kick typegen`, `pnpm exec vitest`,
`pnpm exec tsc --noEmit` — and a scaffold that opens with a wall of aliases
teaches less than one that shows the binary.

Formatting moves from prettier to **oxfmt**: same options, same output for
these settings, one binary instead of a package plus plugins — and it is what
the framework itself is formatted with, so a generated project no longer
arrives holding a different toolchain than the repo it came from. `.prettierrc`
becomes `.oxfmtrc.json`, and the `format` / `format:check` / `ci:check`
commands in the generated `kick.config.ts` follow.

Existing projects are unaffected; this changes only what new ones are created
with.
