# Error Handling

KickJS provides a structured error-handling pipeline built on the `HttpException` class and a global error handler middleware. Errors are logged through Pino and serialized into consistent JSON responses.

## HttpException

The `HttpException` class carries an HTTP status code, a message, and optional validation details. Import it from `@forinda/kickjs`.

```ts
import { HttpException } from '@forinda/kickjs'

throw new HttpException(400, 'Invalid input')
```

### Static Factory Methods

Every common HTTP error has a factory method with a sensible default message:

| Method                            | Status | Default Message       |
| --------------------------------- | ------ | --------------------- |
| `HttpException.badRequest()`      | 400    | Bad Request           |
| `HttpException.unauthorized()`    | 401    | Unauthorized          |
| `HttpException.forbidden()`       | 403    | Forbidden             |
| `HttpException.notFound()`        | 404    | Not Found             |
| `HttpException.conflict()`        | 409    | Conflict              |
| `HttpException.unprocessable()`   | 422    | Unprocessable Entity  |
| `HttpException.tooManyRequests()` | 429    | Too Many Requests     |
| `HttpException.internal()`        | 500    | Internal Server Error |

Each accepts an optional custom message. `unprocessable` also accepts a `ValidationError[]` array as a second argument:

```ts
throw HttpException.notFound('User not found')

throw HttpException.unprocessable('Validation failed', [
  { field: 'email', message: 'Invalid email format', code: 'invalid_string' },
])
```

### Converting Zod Errors

`HttpException.fromZodError()` transforms a Zod error into a 422 response with structured field-level details:

```ts
import { z } from 'zod'
import { HttpException } from '@forinda/kickjs'

const schema = z.object({ name: z.string().min(1) })
const result = schema.safeParse(req.body)

if (!result.success) {
  throw HttpException.fromZodError(result.error)
}
```

## Global Error Handler

The `errorHandler()` middleware is registered automatically by the bootstrap process as the last middleware in the stack. It handles three categories of errors in order:

### 1. Zod Validation Errors

Any error with `name === 'ZodError'` is caught and returned as a **422** response containing the issue array:

```json
{ "message": "Expected string, received number", "errors": [ ... ] }
```

### 2. HttpException Instances

The handler reads `err.status` and returns the appropriate status code. If validation `details` are present, they are included as `errors`. Server errors (status >= 500) are logged at the `error` level via Pino.

### 3. Unexpected Errors

Anything else falls through to a generic handler that reads `err.status` or `err.statusCode`, defaulting to **500**. For 500 errors, the original message is hidden from the client and replaced with `"Internal Server Error"`. All unexpected errors are logged with the request method and URL.

### Headers-Sent Guard

If Express has already started streaming the response (`res.headersSent === true`), the error handler logs a warning and returns early without attempting to write a second response. This prevents the "Cannot set headers after they are sent" crash.

## Logging

Errors are logged using the `@forinda/kickjs` Pino logger tagged with `ErrorHandler`:

- **500+ HttpException** and **unexpected errors** are logged at `error` level with full stack traces.
- **Headers-already-sent** conditions are logged at `warn` level.
- **Client errors** (4xx) are not logged by default to reduce noise.

## Not-Found Handler

The `notFoundHandler()` middleware is placed before the error handler to catch unmatched routes and return a clean 404 JSON response:

```json
{ "message": "Not Found" }
```

## Framework errors with fix hints

Framework-thrown errors (DI resolution failures, missing env vars, malformed module setup, etc.) use the `KickError` class — a structured error type with a stable `code`, a one-line `summary`, a `cause` explanation, an actionable `fix` block, and a `docsUrl`. The result is multi-line, scannable, and points at the exact change to apply:

```
KICK001: No provider for UserService

  Cause:
    `UserService` was requested from the DI container but no binding
    is registered.
    This usually means one of:
      • The class is decorated with @Service() / @Repository() / @Controller(),
        but its enclosing module isn't passed to bootstrap({ modules: [...] }).
      • The class isn't decorated at all (decorators register the binding).
      • You're injecting a token (created with createToken()) that nothing
        provides — add a Container.register(TOKEN, ...) call or a module that
        binds it.

  Fix:
    If `UserService` lives in a module, add the module to bootstrap:

      bootstrap({
        modules: [
          UsersModule,        // add this
          OtherModule,
        ],
      })

    If it's a custom token, register it explicitly:

      const TENANT_REPO = createToken<TenantRepo>('TENANT_REPO')
      Container.getInstance().register(TENANT_REPO, { useClass: PrismaTenantRepo })

  Docs:
    https://forinda.github.io/kick-js/guide/dependency-injection#registering-services
```

### Catalog (current set)

| Code      | When it fires                                                                |
| --------- | ---------------------------------------------------------------------------- |
| `KICK001` | DI: no provider registered for the requested token                           |
| `KICK002` | DI: REQUEST-scoped binding resolved without request-scope middleware mounted |
| `KICK003` | DI: REQUEST-scoped binding resolved outside an HTTP request                  |
| `KICK004` | Config: `@Value('X')` resolved but env var not set and no default given      |
| `KICK005` | Module: `routes()` declared a path without `controller` or `router`          |

More framework errors will migrate to `KickError` over time. Each new entry gets the next free code; codes are stable and never reused.

### Anatomy

```ts
import { KickError } from '@forinda/kickjs'

throw new KickError({
  code: 'APP001',
  summary: 'My one-line headline',
  cause: 'Multi-line\nexplanation of why this happened.',
  fix: 'Actionable multi-line steps, with example code.',
  docsUrl: 'https://example.com/docs/my-error',
  context: { foo: 'bar' }, // structured fields for log consumers
})
```

`KickError` extends `Error`, so `instanceof Error` catches still see it. The `.message` field carries the full multi-line plain-text body — Node's default `Error.toString()` and unhandled-exception printing surface the helpful version automatically. No setup required.

### Colorized output

Call `formatKickError(err, { color: true })` to get the ANSI-colored version for terminal logging:

```ts
import { formatKickError, KickError } from '@forinda/kickjs'

try {
  // ...
} catch (err) {
  if (err instanceof KickError) {
    console.error(formatKickError(err, { color: process.stderr.isTTY }))
    process.exit(1)
  }
  throw err
}
```

Color detection honors [`NO_COLOR`](https://no-color.org) and `FORCE_COLOR` automatically when the `color` option is omitted.

### Catching by code

The stable `code` field is the right way to handle framework errors programmatically — never match on `.message` substrings (those evolve with rewording):

```ts
import { KickError } from '@forinda/kickjs'

try {
  container.resolve(SomeService)
} catch (err) {
  if (err instanceof KickError && err.code === 'KICK001') {
    // No provider — handle the bootstrap-error path
  } else {
    throw err
  }
}
```

The `context` field carries structured data (the token name, the env key, the mount path, etc.) so log aggregators can filter or alert without parsing prose.

## RFC 9457 — Problem Details

KickJS ships first-class support for [RFC 9457 — Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc9457) (the successor to RFC 7807). It's the canonical answer to "what shape should our error JSON have?" — five standard fields, a known content type (`application/problem+json`), and arbitrary extensions per §3.2.

Two entry points: `ctx.problem.*` for the response-side flow, and `ProblemException` for throwing from services where `ctx` isn't in scope.

### `ctx.problem` — response helpers

```ts
@Get('/projects/:id')
async getProject(ctx: RequestContext) {
  const project = await this.repo.find(ctx.params.id)
  if (!project) {
    return ctx.problem.notFound({
      detail: `Project ${ctx.params.id} does not exist`,
      instance: ctx.req.url,
    })
  }
  if (project.tenantId !== ctx.tenantId) {
    return ctx.problem.forbidden({
      type: 'https://api.example.com/problems/tenant-mismatch',
      detail: 'This project belongs to a different tenant.',
    })
  }
  ctx.json(project)
}
```

Each `ctx.problem.*` call sets `Content-Type: application/problem+json` and fills in defaults:

- `type` → `'about:blank'` (RFC 9457 §3.1.1)
- `title` → IANA reason phrase for `status` (§3.1.4)
- Extension members per §3.2 pass through unchanged

Available shortcuts: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `tooManyRequests`, `internal`, plus the generic `ctx.problem({ status, ... })` for any status code.

For Zod validation errors, `ctx.problem.validation(issues)` serializes them into the RFC 9457 §3.2 `errors` array:

```ts
const parsed = userSchema.safeParse(ctx.body)
if (!parsed.success) {
  return ctx.problem.validation(parsed.error.issues)
}
```

Emits:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Invalid email",
  "errors": [
    { "field": "email", "message": "Invalid email", "code": "invalid_string" },
    { "field": "name", "message": "Required", "code": "invalid_type" }
  ]
}
```

### `ProblemException` — throw-from-anywhere

When you're inside a service and don't have `ctx`, throw `ProblemException`. The global error handler catches it and emits the same `application/problem+json` response:

```ts
import { ProblemException } from '@forinda/kickjs'

@Service()
class AccountService {
  charge(account: Account, amount: number) {
    if (account.balance < amount) {
      throw new ProblemException({
        type: 'https://api.example.com/problems/out-of-credit',
        status: 403,
        title: 'You do not have enough credit',
        detail: `Your balance is ${account.balance}, but that costs ${amount}.`,
        instance: `/account/${account.id}`,
        balance: account.balance,
      })
    }
    // ...
  }
}
```

The `Problems` namespace object exports convenience factories that pre-fill `status` + `title` for the common codes — same shortcut set as `ctx.problem.*`:

```ts
import { Problems } from '@forinda/kickjs'

throw Problems.notFound({ detail: 'User abc not found' })
throw Problems.conflict({ detail: 'Email already in use' })
throw Problems.tooManyRequests({}, 60) // sets Retry-After: 60
throw Problems.fromZodError(zodResult.error)
```

`ProblemException` extends `HttpException`, so existing `instanceof HttpException` catches keep working. Spec-mandated headers (`Retry-After`, `WWW-Authenticate`, `Allow`) are forwarded from the exception to the response.

The factories live on `Problems` rather than as `ProblemException.notFound()` statics because shadowing `HttpException`'s same-named statics with incompatible signatures (object vs string) would be a TypeScript variance conflict. Naming them `Problems.notFound(...)` reads well, autocompletes cleanly, and sidesteps the inheritance issue.

### Why both APIs

`ctx.problem.*` is the right choice when you're in a controller and want to short-circuit the response inline. `ProblemException` is the right choice when you're deeper in the call stack — services, repositories, helpers — and don't have a `RequestContext` to write to. Both emit the same wire format, so an adopter calling either way produces identical RFC-compliant responses.

### Coexistence with the old helpers

The pre-existing `ctx.notFound()` and `ctx.badRequest()` helpers still work; they're marked `@deprecated` in JSDoc with a pointer at the `ctx.problem.*` equivalent. IDEs surface a strikethrough — nothing breaks at runtime, no behavior change for existing endpoints, no migration deadline. Adopters move per call site when they next touch the file.

Plain `HttpException` (thrown without the problem fields) keeps its existing `{ message }` JSON shape. Only `ProblemException` triggers `application/problem+json`. The framework infers behavior from the exception type, not from a config flag — backward compatible by detection, not by configuration.

### Defaults explained

| Field      | Default when omitted                                                        |
| ---------- | --------------------------------------------------------------------------- |
| `type`     | `'about:blank'` per RFC 9457 §3.1.1                                         |
| `title`    | IANA reason phrase for `status` (e.g., `'Not Found'` for 404) per §3.1.4    |
| `detail`   | Falls back to `title` if neither is provided                                |
| `instance` | Not auto-populated; set explicitly per occurrence (typically `ctx.req.url`) |

The framework does not auto-populate `instance` from the request URL — the RFC leaves this an application decision and over-eager auto-population can leak unexpected URL structure. Set it explicitly when you want it.

### Open: validate() middleware integration

The `validate()` Zod middleware currently emits a 422 with the existing `{ message, errors }` shape, not problem+json. Switching it to problem+json is a follow-up; for now, call `ctx.problem.validation(parsed.error.issues)` explicitly when you want the RFC 9457 shape, or throw `ProblemException.fromZodError(...)` from a controller.
