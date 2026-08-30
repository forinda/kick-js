---
'@forinda/kickjs-cli': minor
---

`kick new`: oxc by default, and no `npx` in anything generated

Generated scripts and `kick.config.ts` commands invoked their tools through
`npx`, which resolves a missing binary by fetching whatever the registry has
under that name. For a binary whose package is named differently that is a
stranger's code: the CLI's binary is `kick`, its package is
`@forinda/kickjs-cli`, and `kick` on npm is an unrelated AngularJS scaffolder.
Run from a workspace root where the local binary was not visible, it installed
that package, printed its help, and exited 0 — so a root `typecheck` script
passed without type-checking anything.

Generated steps now name tools plainly. `kick`'s custom-command runner puts the
project's `node_modules/.bin` on PATH, so a step resolves the project's own
binary and a missing one fails as "command not found" rather than downloading
something. The fullstack root gains the CLI as a dependency so the bare `kick`
in its scripts resolves there too.

`oxfmt` and `oxlint` ship as scaffold dependencies, with `lint`, `format`,
`format:check` and `ci:check` commands wired to them.

Two fixes fell out of the same pass:

- The fullstack root's `typecheck` ran `pnpm -r run typecheck`, which skips
  packages lacking that script — after the script trim, that silently narrowed
  it to the frontend.
- A scaffolded pnpm workspace could not run any script. The non-interactive
  install left `allowBuilds: '@swc/core': set this to true or false` in
  `pnpm-workspace.yaml`, and pnpm then refuses every script with
  `ERR_PNPM_IGNORED_BUILDS`. The generator answers it now — both are build
  tools this template chose.
