/**
 * Decimals on SQLite. SQLite has no exact decimal type: a `NUMERIC` column
 * stores a float and better-sqlite3 returns a `number`, while `decimal()` /
 * `numeric()` / `money()` are typed `string` — exact, as Postgres and MySQL
 * return them. These decoders read the number back as that string, at the
 * column's scale, so `decimal(12, 2)` gives `'0.10'` on every dialect.
 * Values stay exact up to 15 significant digits — a float's limit.
 */

const decoders = new Map<number | undefined, (v: unknown) => unknown>()

function decoderFor(scale: number | undefined): (v: unknown) => unknown {
  let fn = decoders.get(scale)
  if (!fn) {
    fn = (v) => {
      if (typeof v === 'bigint') return String(v)
      if (typeof v !== 'number') return v
      return scale === undefined ? String(v) : v.toFixed(scale)
    }
    decoders.set(scale, fn)
  }
  return fn
}

/** The decoder for a decimal column type (`decimal(12, 2)`, `numeric`, `money`), or `undefined`. */
export function sqliteDecimalDecoder(type: string): ((v: unknown) => unknown) | undefined {
  if (type === 'money') return decoderFor(2)
  const m = /^(?:decimal|numeric)(?:\(\s*\d+\s*(?:,\s*(\d+)\s*)?\))?$/.exec(type)
  if (!m) return undefined
  // `numeric(10)` has scale 0; a bare `numeric` has none.
  return decoderFor(m[1] !== undefined ? Number(m[1]) : type.includes('(') ? 0 : undefined)
}
