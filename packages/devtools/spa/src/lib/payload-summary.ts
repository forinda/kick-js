// One-line summarisation of an arbitrary event payload for the
// activity-log row. Lives outside the tab component so it's directly
// testable — the cycle / BigInt / Error / truncation paths each have
// regression coverage in __tests__/payload-summary.test.ts.
//
// Hot-path-friendly: short-circuits primitives before reaching the
// JSON.stringify replacer. The replacer instantiates a per-call
// WeakSet for cycle detection so cross-call references never bleed
// (each row's summary is independent).

const PAYLOAD_TRUNCATE = 200

export function summarisePayload(payload: unknown): string {
  if (payload == null) return String(payload)
  // Top-level BigInt — JSON.stringify can't serialise it (throws), so
  // we'd fall through to '[unserialisable]'. Render it inline with
  // the `n` suffix the JSON replacer applies to nested BigInts.
  if (typeof payload === 'bigint') return `${payload.toString()}n`
  if (typeof payload !== 'object') return String(payload)

  const seen = new WeakSet<object>()
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') return `${value.toString()}n`
    if (value instanceof Error) return { name: value.name, message: value.message }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }

  let str: string | undefined
  try {
    str = JSON.stringify(payload, replacer)
  } catch {
    str = '[unserialisable]'
  }
  // JSON.stringify returns undefined when the top-level value is a
  // function or symbol, or when the object's toJSON() returns
  // undefined. Coalesce so the truncate path can't crash on
  // `str.length`.
  if (str === undefined) str = String(payload)
  if (str.length > PAYLOAD_TRUNCATE) {
    return `${str.slice(0, PAYLOAD_TRUNCATE)}… (+${str.length - PAYLOAD_TRUNCATE} chars)`
  }
  return str
}

/** HH:MM:SS.mmm — easier to scan than ISO timestamps. */
export function formatActivityTs(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}
