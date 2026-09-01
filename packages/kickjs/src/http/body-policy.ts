/**
 * How a request body is interpreted, decided in ONE place for every runtime.
 *
 * Before this, each engine brought its own library's opinion: Express parsed
 * only exact `application/json` and silently left everything else `undefined`,
 * Fastify answered 415 for anything it had no parser for, and h3 routed
 * unrecognised types through `destr` — so the same request produced a parsed
 * object, an empty body, or a 415 depending on which engine the app was
 * configured with. The runtime is meant to be swappable; that made it not
 * swappable for any app accepting a body outside `application/json` (#590).
 *
 * @module @forinda/kickjs/http/body-policy
 */

/** What the framework does with a body of a given media type. */
export type BodyKind =
  /** Parse as JSON, strictly. */
  | 'json'
  /** Parse as `application/x-www-form-urlencoded` into an object. */
  | 'urlencoded'
  /** Hand the handler the raw string. Never JSON — see `classifyMediaType`. */
  | 'text'
  /** Left to the upload path, which consumes the stream itself. */
  | 'multipart'
  /** Not parsed. `ctx.body` stays undefined. */
  | 'unsupported'

/**
 * Strip parameters and normalise: `Application/JSON; charset=utf-8` →
 * `application/json`. h3's own check is `===` against the bare type, which is
 * why `application/json; charset=utf-8` — what most clients actually send —
 * missed it and fell to a non-strict branch.
 */
export function normalizeMediaType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * `application/*+json` is JSON, and this is not a judgement call: RFC 6838
 * §4.2.8 says a media type "MUST NOT be given names incorporating suffixes for
 * structured syntaxes they do not actually employ", and RFC 6839 §2 exists so
 * receivers can "do generic processing of the underlying representation".
 * Spring, ASP.NET Core and Hono's validator all match the suffix by default.
 *
 * So `application/merge-patch+json` (RFC 7396) and `application/problem+json`
 * (RFC 9457) parse as JSON — which the framework already emits for every
 * problem response, and previously could not read back.
 */
function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || /^application\/[\w.+-]+\+json$/.test(mediaType)
}

/**
 * Decide how to treat a body, from its declared media type alone.
 *
 * `text/*` deliberately yields the raw string and is NEVER JSON-parsed.
 * `text/plain` is one of three CORS-safelisted content types, so it crosses
 * origins without a preflight; JSON-parsing it would re-open the simple-request
 * CSRF that requiring `application/json` closes. h3's own source carries this
 * warning, and h3 v2 pulled back from `destr` partly because of it.
 */
export function classifyMediaType(contentType: string | undefined): BodyKind {
  const mediaType = normalizeMediaType(contentType)
  if (!mediaType) return 'unsupported'
  if (isJsonMediaType(mediaType)) return 'json'
  if (mediaType === 'application/x-www-form-urlencoded') return 'urlencoded'
  if (mediaType.startsWith('multipart/')) return 'multipart'
  if (mediaType.startsWith('text/')) return 'text'
  return 'unsupported'
}

/**
 * Media types Express should hand to its JSON body parser. `express.json()`
 * defaults to the exact string `application/json`, and `type-is` will not match
 * `application/json` against a bare wildcard-plus-json pattern (a length guard rejects
 * it), so BOTH entries are required — passing only the wildcard silently stops
 * parsing ordinary JSON.
 */
export const EXPRESS_JSON_TYPES = ['application/json', 'application/*+json'] as const

/** Media types the framework claims to parse, for diagnostics and docs. */
export const SUPPORTED_BODY_TYPES = [
  'application/json',
  'application/*+json',
  'application/x-www-form-urlencoded',
  'text/*',
  'multipart/form-data',
] as const
