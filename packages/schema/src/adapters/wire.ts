/**
 * Request schemas JSON can't satisfy. A body arrives as parsed JSON — strings,
 * numbers — so a schema that only accepts a `Date` or a `bigint` rejects every
 * client, whatever the docs say. Said once per kind, when it's described.
 */
const warned = new Set<string>()

export function warnUnsatisfiableInput(kind: 'date' | 'bigint', library: 'zod' | 'valibot'): void {
  if (warned.has(`${library}:${kind}`)) return
  warned.add(`${library}:${kind}`)
  const fix =
    library === 'zod'
      ? kind === 'date'
        ? 'z.coerce.date() or z.iso.datetime()'
        : 'z.coerce.bigint()'
      : kind === 'date'
        ? 'v.pipe(v.string(), v.isoTimestamp())'
        : 'v.pipe(v.string(), v.transform(BigInt))'
  console.warn(
    `[kickjs-schema] a request schema has a ${kind} field that JSON can't send — it rejects every request. Use ${fix}.`,
  )
}
