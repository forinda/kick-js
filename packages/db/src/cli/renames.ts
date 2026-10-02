import { createInterface } from 'node:readline/promises'
import type { RenameCandidates, RenameHints } from '../diff/engine'

/**
 * Parse `--rename-table old=new` / `--rename-column table.old=new` values.
 * A column's table is everything before its last dot, so a schema-qualified
 * table (`billing.invoices.total=amount`) works.
 */
export function parseRenameFlags(tables: string[] = [], columns: string[] = []): RenameHints {
  const pairs = (values: string[], flag: string) =>
    values.map((v) => {
      const eq = v.indexOf('=')
      if (eq <= 0 || eq === v.length - 1) {
        throw new Error(`kickjs-db: ${flag} expects old=new, got '${v}'`)
      }
      return [v.slice(0, eq), v.slice(eq + 1)] as const
    })
  for (const [from] of pairs(columns, '--rename-column')) {
    if (!from.includes('.')) {
      throw new Error(`kickjs-db: --rename-column expects table.old=new, got '${from}'`)
    }
  }
  return {
    tables: Object.fromEntries(pairs(tables, '--rename-table')),
    columns: Object.fromEntries(pairs(columns, '--rename-column')),
  }
}

/**
 * Ask in the terminal which drops are renames. Each candidate lists what it
 * could have become; the default (Enter) is to drop it — nothing is renamed
 * that someone didn't pick.
 */
export async function askRenamesInTerminal(
  candidates: RenameCandidates,
  io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Promise<RenameHints> {
  const rl = createInterface({ input: io.input, output: io.output })
  const hints: Required<RenameHints> = { tables: {}, columns: {} }
  try {
    const ask = async (what: string, options: string[]): Promise<string | undefined> => {
      const free = options.filter(
        (o) =>
          !Object.values(hints.tables).includes(o) && !Object.values(hints.columns).includes(o),
      )
      if (free.length === 0) return undefined
      const list = free.map((o, i) => `  ${i + 1}) renamed to ${o}`).join('\n')
      for (;;) {
        const answer = (
          await rl.question(`${what} is gone. Was it renamed?\n  0) no, drop it\n${list}\n> `)
        ).trim()
        const n = answer === '' ? 0 : Number(answer)
        if (Number.isInteger(n) && n >= 0 && n <= free.length)
          return n === 0 ? undefined : free[n - 1]
      }
    }
    for (const c of candidates.tables) {
      const to = await ask(`Table ${c.from}`, c.to)
      if (to) hints.tables[c.from] = to
    }
    for (const c of candidates.columns) {
      const to = await ask(`Column ${c.table}.${c.from}`, c.to)
      if (to) hints.columns[`${c.table}.${c.from}`] = to
    }
  } finally {
    rl.close()
  }
  return hints
}
