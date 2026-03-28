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

| Method | Status | Default Message |
| --- | --- | --- |
| `HttpException.badRequest()` | 400 | Bad Request |
| `HttpException.unauthorized()` | 401 | Unauthorized |
| `HttpException.forbidden()` | 403 | Forbidden |
| `HttpException.notFound()` | 404 | Not Found |
| `HttpException.conflict()` | 409 | Conflict |
| `HttpException.unprocessable()` | 422 | Unprocessable Entity |
| `HttpException.tooManyRequests()` | 429 | Too Many Requests |
| `HttpException.internal()` | 500 | Internal Server Error |

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
