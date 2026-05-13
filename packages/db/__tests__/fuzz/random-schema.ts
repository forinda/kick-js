import type {
  ColumnSnapshot,
  EnumSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from '@forinda/kickjs-db'

// Architecture spec §13 — diff-engine fuzz harness. Generates random
// SchemaSnapshot fixtures from a seeded RNG so the same seed always
// produces the same pair, and a failing case can be reproduced
// exactly by re-running with the seed printed in the assertion.
//
// Scope (intentionally narrow for first cut):
// - PostgreSQL dialect only — keeps the generator + applier shapes
//   focused. Other dialects share the same diff path; their emitters
//   live in separate test scopes.
// - No renameTable / renameColumn — the diff engine doesn't infer
//   renames (it sees a drop+add), so generating them would only
//   exercise the drop+add path; the rename-specific code path has
//   its own coverage in `diff-rename.test.ts`.
// - No enum value additions/removals — those are flagged as
//   ambiguous-reverse and the round-trip property doesn't hold by
//   design (operator-reviewed advisories). Locked in
//   `pg-enum-pipeline.test.ts` separately.
// - Defaults stay simple ('0', "'x'", 'true') — avoids the
//   pgEnum-cast-bracket dance that M5.A.1 handles. Enum-typed
//   columns get no default for the same reason.

/** Deterministic xorshift32 — small, fast, reproducible. */
export class Rng {
  private state: number

  constructor(seed: number) {
    // Seed must be non-zero; xorshift on 0 stays at 0 forever.
    this.state = seed === 0 ? 0xdeadbeef : seed >>> 0
  }

  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state
  }

  int(maxExclusive: number): number {
    return this.next() % maxExclusive
  }

  intRange(minInclusive: number, maxInclusive: number): number {
    return minInclusive + this.int(maxInclusive - minInclusive + 1)
  }

  bool(probabilityTrue = 0.5): boolean {
    return this.next() / 0xffffffff < probabilityTrue
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T
  }

  /** Pick `count` distinct items from `arr`. Returns at most `arr.length`. */
  sample<T>(arr: readonly T[], count: number): T[] {
    const pool = [...arr]
    const out: T[] = []
    while (pool.length > 0 && out.length < count) {
      const idx = this.int(pool.length)
      out.push(pool[idx] as T)
      pool.splice(idx, 1)
    }
    return out
  }
}

const PG_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'varchar(255)',
  'text',
  'boolean',
  'timestamp',
  'date',
  'numeric',
  'uuid',
  'jsonb',
] as const

const FK_ACTIONS = ['cascade', 'restrict', 'set_null', 'set_default', 'no_action'] as const

function defaultForType(type: string, rng: Rng): string | null {
  if (!rng.bool(0.35)) return null
  switch (true) {
    case type.startsWith('integer') || type.startsWith('bigint') || type.startsWith('smallint'):
      return String(rng.intRange(0, 100))
    case type.startsWith('numeric'):
      return String(rng.intRange(0, 100))
    case type === 'boolean':
      return rng.bool() ? 'true' : 'false'
    case type === 'timestamp' || type === 'date':
      return 'CURRENT_TIMESTAMP'
    case type === 'uuid':
      return 'gen_random_uuid()'
    case type === 'jsonb':
      return `'{}'`
    case type.startsWith('varchar') || type === 'text':
      return `'v${rng.intRange(0, 999)}'`
    default:
      return null
  }
}

function genColumn(name: string, rng: Rng): ColumnSnapshot {
  const type = rng.pick(PG_TYPES)
  // Avoid FK-incompatible defaults — keep the generator simple by
  // refusing defaults on PK columns (the PK constraint is what's
  // doing the "non-null + unique" work and SET DEFAULT for serial-ish
  // columns interacts with sequence ownership we don't want to model).
  const nullable = rng.bool(0.55)
  return {
    name,
    type,
    nullable,
    default: nullable ? defaultForType(type, rng) : defaultForType(type, rng),
    primaryKey: false, // PK assignment happens at table level so we can pick a single column
  }
}

function genTable(name: string, rng: Rng): TableSnapshot {
  const columnCount = rng.intRange(1, 6)
  const columns: Record<string, ColumnSnapshot> = {}
  const columnNames: string[] = []
  for (let i = 0; i < columnCount; i++) {
    const colName = `c${i}_${rng.intRange(0, 99)}`
    if (columns[colName]) continue
    columnNames.push(colName)
    columns[colName] = genColumn(colName, rng)
  }
  // 70% chance of a single-column PK on the first column.
  if (columnNames.length > 0 && rng.bool(0.7)) {
    const pkCol = columnNames[0] as string
    const existing = columns[pkCol] as ColumnSnapshot
    columns[pkCol] = { ...existing, primaryKey: true, nullable: false, default: null }
  }
  // 0-2 indexes, single-column.
  const indexCount = rng.intRange(0, 2)
  const indexes: IndexSnapshot[] = []
  for (let i = 0; i < indexCount; i++) {
    if (columnNames.length === 0) break
    const col = rng.pick(columnNames)
    indexes.push({
      name: `${name}_${col}_idx${i}`,
      columns: [col],
      unique: rng.bool(0.3),
    })
  }
  return {
    name,
    columns,
    indexes,
    foreignKeys: [],
    checks: [],
  }
}

function maybeAddForeignKeys(snapshot: SchemaSnapshot, rng: Rng): void {
  const tableNames = Object.keys(snapshot.tables)
  for (const tableName of tableNames) {
    if (!rng.bool(0.3)) continue
    const table = snapshot.tables[tableName] as TableSnapshot
    const otherTables = tableNames.filter((t) => t !== tableName)
    if (otherTables.length === 0) continue
    const refTableName = rng.pick(otherTables)
    const refTable = snapshot.tables[refTableName] as TableSnapshot
    const refPkCols = Object.values(refTable.columns).filter((c) => c.primaryKey)
    if (refPkCols.length === 0) continue
    const localCols = Object.values(table.columns).filter((c) => !c.primaryKey)
    if (localCols.length === 0) continue
    const localCol = rng.pick(localCols)
    const refCol = refPkCols[0] as ColumnSnapshot
    const fk: ForeignKeySnapshot = {
      name: `fk_${tableName}_${localCol.name}_${refTableName}`,
      columns: [localCol.name],
      refTable: refTableName,
      refColumns: [refCol.name],
      onDelete: rng.pick(FK_ACTIONS),
      onUpdate: rng.pick(FK_ACTIONS),
    }
    table.foreignKeys.push(fk)
  }
}

export interface GeneratorOptions {
  /** Average number of tables. Final count is intRange(0, 2*meanTables). */
  meanTables?: number
  /** Whether to include enum declarations. Default false (keeps fuzz simple). */
  withEnums?: boolean
}

export function generateSnapshot(seed: number, opts: GeneratorOptions = {}): SchemaSnapshot {
  const meanTables = opts.meanTables ?? 4
  const rng = new Rng(seed)
  const tableCount = rng.intRange(0, meanTables * 2)
  const tables: Record<string, TableSnapshot> = {}
  for (let i = 0; i < tableCount; i++) {
    const name = `t${i}_${rng.intRange(0, 99)}`
    if (tables[name]) continue
    tables[name] = genTable(name, rng)
  }

  const snapshot: SchemaSnapshot = {
    version: 1,
    dialect: 'postgres',
    tables,
  }

  if (opts.withEnums && rng.bool(0.5)) {
    const enums: Record<string, EnumSnapshot> = {}
    const enumCount = rng.intRange(1, 3)
    for (let i = 0; i < enumCount; i++) {
      const name = `e${i}_${rng.intRange(0, 99)}`
      const valueCount = rng.intRange(2, 5)
      const values: string[] = []
      for (let j = 0; j < valueCount; j++) values.push(`v${j}`)
      enums[name] = { name, values }
    }
    snapshot.enums = enums
  }

  maybeAddForeignKeys(snapshot, rng)

  return snapshot
}
