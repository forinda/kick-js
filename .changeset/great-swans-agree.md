---
'@forinda/kickjs': major
'@forinda/kickjs-testing': patch
---

Request bodies parse the same way on every runtime.

Each engine brought its own library's opinion about content types, so the same
request produced three different results (#590):

| body sent                           | Express     | Fastify   | h3             |
| ----------------------------------- | ----------- | --------- | -------------- |
| `application/x-www-form-urlencoded` | `undefined` | **415**   | parsed         |
| `application/merge-patch+json`      | `undefined` | **415**   | parsed         |
| malformed `+json`                   | `undefined` | 415       | **raw string** |
| `text/plain`                        | `undefined` | `'hello'` | `'hello'`      |

`bootstrap({ runtime })` is meant to be swappable. It was not, for any app
accepting a body outside `application/json`: Express → Fastify turned every
form post into a 415, and Express → h3 started parsing bodies that previously
did not, silently changing handlers that guarded on `!ctx.body`.

One policy now decides, in `http/body-policy.ts`, and all four runtimes follow
it — including the web entry for edge, Bun and Deno:

- `application/json` and `application/*+json` — strict JSON; malformed is 400
- `application/x-www-form-urlencoded` — parsed to an object
- `text/*` — the raw string
- `multipart/*` — unchanged, the upload path consumes the stream itself

**`+json` is JSON by specification, not by liberty.** RFC 6838 §4.2.8: a media
type "MUST NOT be given names incorporating suffixes for structured syntaxes
they do not actually employ"; RFC 6839 §2 exists so receivers can do "generic
processing of the underlying representation". Spring, ASP.NET Core and Hono all
match the suffix by default. It also means the framework can read back the
`application/problem+json` it emits for every problem response.

**`text/*` is never JSON-parsed, deliberately.** `text/plain` is one of three
CORS-safelisted content types, so it crosses origins with no preflight;
JSON-parsing it would re-open the simple-request CSRF that requiring
`application/json` closes. h3's own source carries that warning.

Per engine: Express's default chain gains `urlencoded` and `text`, and its JSON
parser is given both `application/json` and `application/*+json` (`type-is`
will not match plain JSON against the wildcard alone, so both are required).
Fastify gains content-type parsers for the same set — deliberately not a `'*'`
catch-all, which would swallow multipart, since `@fastify/multipart` is itself
the multipart parser. h3 reads raw and applies the policy instead of calling
`readBody`, whose own dispatch is where its divergence came from.

`createTestApp` no longer names a middleware list, so the Application applies
its own defaults. Naming one put it on the user-declared branch, so a test app
parsed only `application/json` while the same app in production parsed the full
set — the harness quietly exercised a different pipeline from the one deployed.

**An unsupported type is rejected, not ignored.** A body the framework cannot
read answers **415** with an `Accept` header naming what it accepts, so the
sender learns the request was not understood — where previously Express handed
the handler `undefined` and let it fail somewhere less obvious.

The rejection is for a body that cannot be read, never for the absence of one.
A bodyless `POST` succeeds whatever its declared type, matching what Spring's
`readWithMessageConverters` and ASP.NET's `BodyModelBinder` both do. Fastify
needed this explicitly: it invokes a content-type parser even for an empty
payload, so without the guard a bodyless POST carrying an unrelated type was
rejected.

**This is the breaking part.** An Express app that accepted, say,
`application/xml` and ignored the body now answers 415 to those requests. If you
were relying on silent ignoring, either handle the type or strip the header
client-side.

Pinned by a runtime matrix over all three engines: JSON, `+json`, malformed
`+json`, form-urlencoded, `text/plain` as a string, malformed JSON, a POST with
no body, 415 for an unsupported type, 415 for a body with no `Content-Type`,
the `Accept` header on a 415, and no 415 for a bodyless request.

Closes #590
