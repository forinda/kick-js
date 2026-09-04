import { createHash } from 'node:crypto'

/**
 * Qualified name for a table snapshot — `billing.invoices` when the table
 * declares a schema, the bare name otherwise.
 *
 * This is the form used as the `SchemaSnapshot.tables` key and as every
 * `table: string` field on a diff `Change`, so anything holding a whole
 * `TableSnapshot` must run it through here before comparing against one of
 * those. `quoteIdent` splits on `.`, so the result also renders correctly as
 * an identifier without further work.
 */
export function snapshotTableName(t: { name: string; schema?: string }): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name
}

/**
 * Postgres' identifier limit. `NAMEDATALEN - 1`, counted in **bytes**, not
 * characters — a name is truncated at the byte boundary, so a multi-byte
 * identifier runs out sooner than its length suggests.
 */
const MAX_IDENTIFIER_BYTES = 63

/** Length of the disambiguating hash. 6 hex chars = 24 bits. */
const HASH_LENGTH = 6

/**
 * Shorten an identifier to fit Postgres' limit, deterministically.
 *
 * Postgres does not reject an over-long constraint name — it truncates it
 * silently, so two long names that share a prefix become the same name and the
 * migration fails on the second one:
 *
 * ```
 * ERROR: constraint "finance_vote_head_account_reference_ledgers_fin…" already exists
 * ```
 *
 * A schema with 1,326 foreign keys had 38 names over the limit and two
 * colliding pairs (#647). The migration stops at the first collision, so
 * everything after it goes unapplied.
 *
 * Shortening keeps three things: a readable head, the `_fk` / `_unique` suffix
 * that says what the constraint IS, and a hash of the **full** name in between
 * so two names that differ anywhere still differ here. The hash is taken over
 * the untruncated input, which is what makes the result stable across
 * regenerations — the same schema always produces the same name.
 *
 * Names within the limit are returned untouched, so existing schemas keep
 * every constraint name they already have.
 */
export function fitIdentifier(name: string): string {
  if (Buffer.byteLength(name) <= MAX_IDENTIFIER_BYTES) return name

  const hash = createHash('sha256').update(name).digest('hex').slice(0, HASH_LENGTH)
  // Preserve the trailing `_<kind>` marker: it is how a reader (and the
  // renderer's own matching) tells a foreign key from a unique constraint.
  const kindMatch = name.match(/_([a-z]+)$/)
  const kind = kindMatch ? kindMatch[1] : ''
  const tail = kind ? `_${hash}_${kind}` : `_${hash}`
  const head = name.slice(0, kind ? -(kind.length + 1) : undefined)

  return truncateToBytes(head, MAX_IDENTIFIER_BYTES - Buffer.byteLength(tail)) + tail
}

/**
 * Cut a string to at most `max` bytes without splitting a character in half.
 */
function truncateToBytes(s: string, max: number): string {
  if (max <= 0) return ''
  if (Buffer.byteLength(s) <= max) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const size = Buffer.byteLength(ch)
    if (used + size > max) break
    out += ch
    used += size
  }
  return out
}

/** The constraint name derived for a single-column foreign key. */
export function derivedFkName(table: string, column: string): string {
  return fitIdentifier(`${table}_${column}_fk`)
}

/** The constraint name derived for a single-column unique index. */
export function derivedUniqueName(table: string, column: string): string {
  return fitIdentifier(`${table}_${column}_unique`)
}
