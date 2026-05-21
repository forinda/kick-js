---
'@forinda/kickjs': minor
---

feat(http): RFC 9457 — Problem Details for HTTP APIs

KickJS now ships first-class support for [RFC 9457](https://datatracker.ietf.org/doc/html/rfc9457) — the canonical shape for HTTP API error responses. Two entry points:

**`ctx.problem.*`** — response helpers on `RequestContext`:

```ts
ctx.problem({
  type: 'https://api.example.com/problems/out-of-credit',
  status: 403,
  detail: 'Your balance is 30, but that costs 50.',
  balance: 30, // extension per §3.2
})

ctx.problem.notFound({ detail: 'User abc not found' })
ctx.problem.validation(zodResult.error.issues)
```

Each call sets `Content-Type: application/problem+json` and fills in defaults (`type` → `about:blank` per §3.1.1, `title` → IANA reason phrase per §3.1.4). Shortcuts: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal`, plus the generic `ctx.problem({ status, ... })`.

**`ProblemException`** — throw-from-anywhere class:

```ts
throw ProblemException.forbidden({
  type: 'https://api.example.com/problems/out-of-credit',
  detail: 'Your balance is 30, but that costs 50.',
  balance: 30,
})
```

Extends `HttpException` so existing catches keep working. The framework error handler dispatches `ProblemException` first and emits `application/problem+json`. Plain `HttpException` keeps its existing `{ message }` JSON shape — backward compatible by detection (data-driven), not by config.

**Deprecated** (`@deprecated` JSDoc, no runtime change):

- `ctx.notFound()` → use `ctx.problem.notFound()`
- `ctx.badRequest()` → use `ctx.problem.badRequest()`

`ctx.json`, `ctx.created`, `ctx.noContent`, `ctx.html`, `ctx.download`, `ctx.render` are **not** deprecated — they're generic response helpers, orthogonal to the error-format question RFC 9457 answers.

**New exports** from `@forinda/kickjs`:

- `ProblemException` class
- `ProblemDetails` type
- `normalizeProblem(input)` helper (fills defaults — used internally, exposed for adopters writing their own response paths)
- `defaultProblemTitle(status)` helper (IANA reason phrase lookup)

**No bootstrap or kick.config.ts knob.** Adopters opt in per call site by reaching for the new helpers — no global flag, no migration deadline.

Docs: `docs/guide/error-handling.md` covers the new section with Zod-integration recipes and a comparison of the two entry points.
