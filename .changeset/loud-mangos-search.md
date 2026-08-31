---
'@forinda/kickjs-cli': patch
---

`kick g module`: generated controller tests assert something.

Every case in the generated controller test was `expect(true).toBe(true)`, so a
new module reported a full green suite while asserting nothing — and kept
reporting it after every route it named had been deleted. A suite that passes
unconditionally is worse than no suite: it survives review, and it makes
`pnpm test` stop carrying information.

In a project with `@forinda/kickjs-testing` and `supertest` — which `kick new`
installs — the list endpoint is now exercised for real: the module is booted
through `createTestApp` and the response asserted. The remaining CRUD cases are
`it.todo`, which the reporter lists as outstanding and which can never be
counted as coverage.

Without those packages the same scaffold is emitted with every case as a todo
and no extra imports, since emitting an import for a package that is not
installed produces a file that cannot compile — the same rule that gates
`@ApiTags` on `swagger`.

Two details the generated test gets right that are easy to get wrong by hand:

- It passes the module in the shape its declaration style requires —
  `Module()` for `define`, `Module` for `class`. The other way round is
  `TypeError: entry is not a constructor`.
- It drives `app.handle` rather than an Express app, so the generated suite
  runs on whichever runtime the project is configured with.

The mount path it assumes is stated as a `BASE` constant with the reason:
`createTestApp` builds its own Application with the framework defaults
(`apiPrefix: '/api'`, `defaultVersion: 1`) whatever `bootstrap()` uses, so it is
correct as generated — and the comment shows what to change for an app that
configures them differently, including `defaultVersion: false`.
