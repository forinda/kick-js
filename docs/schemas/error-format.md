# Validation errors

Every schema library reports failures its own way. `@forinda/kickjs-schema` maps them all onto one `SchemaIssue` shape, and request validation turns those into one HTTP response — whichever library the schema came from.

## `SchemaIssue`

```ts
interface SchemaIssue {
  path: string[] // ['address', 'zip']
  message: string // the library's message
  code: string // the library's own code — passed through, not renamed
  expected?: string // e.g. 'string', '>=18' — when the library reports one
  received?: string // e.g. '12' — when the library reports one
}
```

`safeParse()` on any `KickSchema` returns `{ success: false, issues: SchemaIssue[] }` on failure. `code`, `expected` and `received` come from the library: the same mistake can carry a different `code` under Zod, Valibot and Yup (see [Codes are the library's](#codes-are-the-library-s)).

## The HTTP response (422)

When a route's `body`, `query` or `params` schema rejects a request, the response is an RFC 9457 problem with the issues in `errors`:

```json
{
  "status": 422,
  "title": "Unprocessable Entity",
  "type": "about:blank",
  "detail": "Too small: expected string to have >=2 characters",
  "errors": [
    { "field": "name", "message": "Too small: expected string to have >=2 characters" },
    { "field": "email", "message": "Invalid email address" }
  ]
}
```

- `field` is the issue's `path` joined with dots — `address.zip` for a nested field, `''` for the value itself.
- `detail` is the first issue's message for a body. A query or params failure says `Invalid query parameters` / `Invalid path parameters` instead.
- Only `field` and `message` reach the response. `code`, `expected` and `received` stay on the `SchemaIssue`.
- With `NODE_ENV=production` the default handler leaves `errors` out — the details can reveal the shape of the request. The response keeps `status`, `title`, `type` and `detail`; an `onError` handler (below) still sees the full list on `err.details`.
- The body is checked first, then the query, then the params; the first that fails answers the request.

## Changing the response

The 422 is an `HttpException` with status `422` whose `details` are the `[{ field, message }]` list. To answer in another shape, handle it in `bootstrap({ onError })` and pass every other error to the default handler — `onError` replaces the default handler for all errors:

```ts
import { bootstrap, errorHandler, HttpException } from '@forinda/kickjs'

const defaultHandler = errorHandler()

export const app = await bootstrap({
  modules,
  onError(err, req, res, next) {
    if (err instanceof HttpException && err.status === 422) {
      const fields = (err.details ?? []) as { field: string; message: string }[]
      res.status(422).json({
        ok: false,
        fields: Object.fromEntries(fields.map((f) => [f.field, f.message])),
      })
      return
    }
    defaultHandler(err, req, res, next)
  },
})
```

There is no per-route hook for validation errors; branch on `req.url` inside `onError` if one route needs a different shape.

## How each library maps

What each built-in adapter produces for `age: 12` against a minimum of 18:

| Library         | `code`                              | `expected` | `received`                  | `message` (default)                            |
| --------------- | ----------------------------------- | ---------- | --------------------------- | ---------------------------------------------- |
| Zod 4           | `too_small`                         | `>=18`     | — (Zod 4 doesn't report it) | `Too small: expected number to be >=18`        |
| Valibot         | `min_value`                         | `>=18`     | `12`                        | `Invalid value: Expected >=18 but received 12` |
| Yup             | `min`                               | `>=18`     | —                           | `age must be greater than or equal to 18`      |
| Standard Schema | `validation` (the spec has no code) | —          | —                           | the library's message                          |

- **Zod** — `code`, `path` and `message` from each issue; `expected` / `received` when the issue has them. For `too_small` / `too_big`, `expected` becomes `>=min` / `<=max`.
- **Valibot** — `code` is the issue's `type`; `path` the keys of its path items; `expected` / `received` when Valibot sets them (it reports `null` for checks such as `email`, which is left out).
- **Yup** — `code` is the error's `type`; the path is split on `.` (an array index stays attached: `items[0].a` → `['items[0]', 'a']`); `expected` from `min` / `max` / `regex` params.
- **Standard Schema** — `message` and `path` from the issue, `code: 'validation'`.
- **A custom adapter** (Joi, or anything via [`registerAdapter`](adapters.md)) returns whatever its `safeParse` builds.

## Codes are the library's

`code` is passed through, not normalised to a shared set. Write code that branches on it against the library you use:

| Situation      | Zod 4            | Valibot                                  | Yup             |
| -------------- | ---------------- | ---------------------------------------- | --------------- |
| Missing field  | `invalid_type`   | `object` (the missing key in `expected`) | `optionality`   |
| Wrong type     | `invalid_type`   | the expected type, e.g. `string`         | `typeError`     |
| Below minimum  | `too_small`      | `min_value` / `min_length`               | `min`           |
| Above maximum  | `too_big`        | `max_value` / `max_length`               | `max`           |
| Regex mismatch | `invalid_format` | `regex`                                  | `matches`       |
| Invalid email  | `invalid_format` | `email`                                  | `email`         |
| Not in an enum | `invalid_value`  | `picklist`                               | `oneOf`         |
| Custom check   | `custom`         | `check`                                  | the test's name |
