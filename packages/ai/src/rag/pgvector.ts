import type { VectorDocument, VectorQueryOptions, VectorSearchHit, VectorStore } from './types'

/**
 * Minimal SQL executor contract.
 *
 * Covers everything `PgVectorStore` needs from a Postgres client: a
 * single `query(text, params)` call that returns rows. The shape is
 * deliberately narrower than node-postgres's `Pool.query` so it can
 * be satisfied by any of:
 *
 *   - `pg.Pool` / `pg.Client` (node-postgres)
 *   - `drizzle.$client` (the underlying pool on the Drizzle adapter)
 *   - `postgres.js` (by @porsager, via a small adapter)
 *   - A unit-test fake that records calls
 *
 * Users who already have a Postgres connection somewhere in their
 * app can hand it to the store without installing `pg` twice.
 */
export interface SqlExecutor {
  query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
}

/**
 * Options for `PgVectorStore`.
 *
 * Exactly one of `client` or `connectionString` must be provided. If
 * `connectionString` is set, the store dynamically imports `pg` on
 * first use and creates its own pool; `pg` must be installed as a
 * peer dep in that case. If `client` is set, the store uses the
 * supplied executor and never touches `pg` directly.
 */
export interface PgVectorStoreOptions {
  /** Pre-made SQL executor — any object with a `query(text, params)` method. */
  client?: SqlExecutor
  /** Connection string used to create a pg.Pool if `client` is not provided. */
  connectionString?: string
  /** Vector dimensionality. Must match the embedding model. Required. */
  dimensions: number
  /** Postgres schema. Defaults to `'public'`. */
  schema?: string
  /** Table name. Defaults to `'kickjs_embeddings'`. */
  table?: string
  /**
   * Skip the first-use schema bootstrap (`CREATE EXTENSION IF NOT
   * EXISTS vector; CREATE TABLE IF NOT EXISTS ...`). Set this to true
   * if you manage migrations manually or run in a read-only role.
   */
  skipSetup?: boolean
  /**
   * Provider name to expose on `store.name`. Defaults to `'pgvector'`
   * but can be overridden to label a Postgres-compatible backend
   * (e.g. `'timescale'`, `'cockroach-vector'`).
   */
  name?: string
}

/**
 * pgvector-backed `VectorStore` implementation.
 *
 * Stores documents in a single table with a `vector` column indexed
 * via pgvector's native operators. Cosine similarity is the scoring
 * metric — computed as `1 - (vector <=> query_vector)` because the
 * `<=>` operator returns cosine DISTANCE, not similarity.
 *
 * ### Lazy initialization
 *
 * The Postgres pool and schema are set up on first use, not in the
 * constructor. That keeps the constructor synchronous, matches the
 * rest of the `VectorStore` implementations, and lets users construct
 * the store inside a module's `register(container)` method without
 * awaiting inside DI resolution.
 *
 * ### Schema
 *
 * The default schema is:
 *
 * ```sql
 * CREATE EXTENSION IF NOT EXISTS vector;
 * CREATE TABLE IF NOT EXISTS <schema>.<table> (
 *   id TEXT PRIMARY KEY,
 *   content TEXT NOT NULL,
 *   vector vector(<dimensions>) NOT NULL,
 *   metadata JSONB
 * );
 * ```
 *
 * No index is created by default — pgvector's IVFFlat and HNSW
 * indexes benefit from being created AFTER data is loaded, and the
 * right choice depends on corpus size. Users should add an index
 * themselves in a real migration when they're ready:
 *
 * ```sql
 * CREATE INDEX ON kickjs_embeddings
 *   USING hnsw (vector vector_cosine_ops);
 * ```
 *
 * ### Metadata filtering
 *
 * Filters are translated to JSONB WHERE clauses:
 *   - Scalar: `metadata->>'key' = $N` (coerced to text)
 *   - Array:  `metadata->>'key' = ANY($N::text[])`
 *
 * Keys are validated against `[a-zA-Z0-9_.-]+` before being
 * interpolated into SQL — anything else throws. Values go through
 * parameter binding, so SQL injection via values is not possible.
 *
 * @example
 * ```ts
 * import { Pool } from 'pg'
 * import { getEnv } from '@forinda/kickjs'
 * import { AiAdapter, PgVectorStore, VECTOR_STORE } from '@forinda/kickjs-ai'
 *
 * const pool = new Pool({ connectionString: getEnv('DATABASE_URL') })
 * const store = new PgVectorStore({ client: pool, dimensions: 1536 })
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [AiAdapter({ provider })],
 *   plugins: [
 *     {
 *       name: 'pgvector',
 *       register: (container) => {
 *         container.registerInstance(VECTOR_STORE, store)
 *       },
 *     },
 *   ],
 * })
 * ```
 */
export class PgVectorStore<
  M extends Record<string, unknown> = Record<string, unknown>,
> implements VectorStore<M> {
  readonly name: string

  private readonly dimensions: number
  private readonly schema: string
  private readonly table: string
  private readonly fullyQualified: string
  private readonly skipSetup: boolean

  private client: SqlExecutor | null
  private readonly connectionString: string | null
  private setupPromise: Promise<void> | null = null

  constructor(options: PgVectorStoreOptions) {
    if (!options.client && !options.connectionString) {
      throw new Error('PgVectorStore: either `client` or `connectionString` must be provided')
    }
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error('PgVectorStore: `dimensions` must be a positive integer')
    }

    this.dimensions = options.dimensions
    this.schema = options.schema ?? 'public'
    this.table = options.table ?? 'kickjs_embeddings'
    this.fullyQualified = `${quoteIdent(this.schema)}.${quoteIdent(this.table)}`
    this.skipSetup = options.skipSetup ?? false
    this.name = options.name ?? 'pgvector'

    this.client = options.client ?? null
    this.connectionString = options.connectionString ?? null
  }

  async upsert(doc: VectorDocument<M> | VectorDocument<M>[]): Promise<void> {
    const list = Array.isArray(doc) ? doc : [doc]
    if (list.length === 0) return

    for (const d of list) {
      if (!d.id) throw new Error('PgVectorStore.upsert: document id is required')
      if (!Array.isArray(d.vector)) {
        throw new Error(`PgVectorStore.upsert: vector must be an array (id=${d.id})`)
      }
      if (d.vector.length !== this.dimensions) {
        throw new Error(
          `PgVectorStore.upsert: vector length ${d.vector.length} does not match ` +
            `configured dimensions ${this.dimensions} (id=${d.id})`,
        )
      }
    }

    const client = await this.ensureReady()

    // Batched insert: one INSERT per call with every document's row.
    // A single round-trip is substantially faster than per-doc inserts
    // when embedding thousands of documents in one pass.
    const values: string[] = []
    const params: unknown[] = []
    let p = 1
    for (const d of list) {
      values.push(`($${p++}, $${p++}, $${p++}::vector, $${p++}::jsonb)`)
      params.push(d.id, d.content, toPgVector(d.vector), JSON.stringify(d.metadata ?? {}))
    }

    const sql =
      `INSERT INTO ${this.fullyQualified} (id, content, vector, metadata) VALUES ` +
      values.join(', ') +
      ' ON CONFLICT (id) DO UPDATE SET ' +
      'content = EXCLUDED.content, ' +
      'vector = EXCLUDED.vector, ' +
      'metadata = EXCLUDED.metadata'

    await client.query(sql, params)
  }

  async query(options: VectorQueryOptions): Promise<VectorSearchHit<M>[]> {
    if (!Array.isArray(options.vector) || options.vector.length === 0) {
      throw new Error('PgVectorStore.query: vector is required')
    }
    if (options.vector.length !== this.dimensions) {
      throw new Error(
        `PgVectorStore.query: vector length ${options.vector.length} does not match ` +
          `configured dimensions ${this.dimensions}`,
      )
    }

    const client = await this.ensureReady()
    const topK = options.topK ?? 5
    const minScore = options.minScore ?? -Infinity

    const { whereSql, whereParams } = buildWhereClause(options.filter, /* startAt */ 2)
    // Param positions:
    //   $1 — the query vector (vector type)
    //   $2..$N — metadata filter params
    //   $(N+1) — topK
    const limitParamIdx = whereParams.length + 2
    const sql =
      `SELECT id, content, metadata, ` +
      `(1 - (vector <=> $1::vector)) AS score ` +
      `FROM ${this.fullyQualified} ` +
      whereSql +
      ` ORDER BY vector <=> $1::vector ` +
      `LIMIT $${limitParamIdx}`

    const params: unknown[] = [toPgVector(options.vector), ...whereParams, topK]
    const { rows } = await client.query<PgVectorRow>(sql, params)

    const hits: VectorSearchHit<M>[] = []
    for (const row of rows) {
      if (row.score < minScore) continue
      hits.push({
        id: row.id,
        content: row.content,
        score: row.score,
        metadata: (row.metadata as M | undefined) ?? undefined,
      })
    }
    return hits
  }

  async delete(id: string | string[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return

    const client = await this.ensureReady()
    await client.query(`DELETE FROM ${this.fullyQualified} WHERE id = ANY($1::text[])`, [ids])
  }

  async deleteAll(): Promise<void> {
    const client = await this.ensureReady()
    // TRUNCATE is faster than DELETE FROM for a full wipe and is still
    // transactional on Postgres, so callers that open a transaction
    // around deleteAll() stay consistent.
    await client.query(`TRUNCATE ${this.fullyQualified}`)
  }

  async count(): Promise<number> {
    const client = await this.ensureReady()
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${this.fullyQualified}`,
    )
    const raw = rows[0]?.count ?? '0'
    return Number.parseInt(raw, 10)
  }

  /**
   * Release the internal connection pool, if the store created one.
   *
   * If the caller supplied their own `client`, this is a no-op —
   * lifecycle of a user-owned pool stays with the user. This method
   * is intentionally not on the `VectorStore` interface because most
   * backends don't need explicit teardown; services that want to
   * clean up call it via an adapter.shutdown hook.
   */
  async close(): Promise<void> {
    if (this.connectionString && this.client) {
      // Only close pools we created ourselves. Detect via the presence
      // of an `end` method — both pg.Pool and pg.Client expose it.
      const withEnd = this.client as { end?: () => Promise<void> }
      if (typeof withEnd.end === 'function') {
        await withEnd.end()
      }
      this.client = null
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /**
   * Ensure the pool exists and the schema is set up. Called by every
   * public method before running any SQL. The setup migration runs
   * at most once per store instance — subsequent calls reuse the
   * cached promise.
   */
  private async ensureReady(): Promise<SqlExecutor> {
    if (!this.client) {
      this.client = await this.createPoolFromConnectionString()
    }
    if (!this.skipSetup) {
      if (!this.setupPromise) {
        this.setupPromise = this.runSchemaSetup(this.client)
      }
      await this.setupPromise
    }
    return this.client
  }

  /**
   * Dynamically import `pg` and create a Pool from the configured
   * connection string. Imported lazily so users who supply their own
   * `client` never force `pg` to be installed.
   *
   * Throws a friendly error if `pg` is not installed — the same
   * graceful-degradation pattern the CLI uses for optional packages.
   */
  private async createPoolFromConnectionString(): Promise<SqlExecutor> {
    if (!this.connectionString) {
      throw new Error(
        'PgVectorStore: no client or connectionString configured (this should never happen)',
      )
    }
    // Indirect import specifier so TypeScript skips static type
    // resolution — `pg` is an optional peer and we don't want the
    // AI package to carry @types/pg just for this one call site.
    // Runtime behavior is unchanged; Node resolves 'pg' via normal
    // module lookup against the user's node_modules.
    const pgSpec = 'pg'
    let pgModule: {
      Pool: new (opts: { connectionString: string }) => SqlExecutor
      default?: { Pool: new (opts: { connectionString: string }) => SqlExecutor }
    }
    try {
      pgModule = (await import(pgSpec)) as unknown as typeof pgModule
    } catch {
      throw new Error(
        'PgVectorStore: the `pg` package is not installed. Run `pnpm add pg` (or ' +
          'pass a pre-made executor via the `client` option) to use the pgvector store.',
      )
    }
    // Some CJS builds expose the exports on .default — handle both.
    const Pool = pgModule.default?.Pool ?? pgModule.Pool
    if (!Pool) {
      throw new Error(
        'PgVectorStore: the `pg` module did not export a `Pool` class (unexpected version).',
      )
    }
    return new Pool({ connectionString: this.connectionString })
  }

  /**
   * Run the schema bootstrap: enable the pgvector extension, create
   * the embeddings table if it doesn't exist, and nothing else.
   *
   * Indexes are deliberately not created here — pgvector's IVFFlat
   * and HNSW indexes perform best when created after data is loaded,
   * and the right choice depends on corpus size. Users should add
   * their index in a real migration when they're ready.
   */
  private async runSchemaSetup(client: SqlExecutor): Promise<void> {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${this.fullyQualified} (` +
        `id TEXT PRIMARY KEY, ` +
        `content TEXT NOT NULL, ` +
        `vector vector(${this.dimensions}) NOT NULL, ` +
        `metadata JSONB ` +
        `)`,
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface PgVectorRow {
  id: string
  content: string
  metadata: unknown
  score: number
}

/**
 * Serialize a JS number array to pgvector's wire format: a string
 * like `'[0.1,0.2,0.3]'`. The `pg` driver doesn't know about vectors
 * so we have to stringify ourselves and cast with `::vector` in the
 * SQL. Non-finite values become `0` rather than `null` or `NaN` —
 * pgvector rejects non-finite values in inserts.
 */
export function toPgVector(vector: number[]): string {
  const safe = vector.map((n) => (Number.isFinite(n) ? n : 0))
  return `[${safe.join(',')}]`
}

/**
 * Double-quote a Postgres identifier and escape any embedded quotes.
 * Used for schema and table names so users can pass lowercase
 * identifiers without worrying about reserved words.
 */
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`
}

/**
 * Translate a metadata filter into a WHERE clause + bound parameters.
 *
 * - Scalar values become `metadata->>'key' = $N`
 * - Array values become `metadata->>'key' = ANY($N::text[])`
 *
 * Keys must match `[a-zA-Z0-9_.-]+` — anything else is rejected. All
 * values are coerced to string before binding, because `->>` returns
 * text. Callers that need numeric range queries should issue raw SQL
 * via their own executor; this helper covers the equality-case 90%.
 *
 * Exported for unit testing.
 */
export function buildWhereClause(
  filter: Record<string, unknown> | undefined,
  startAt: number,
): { whereSql: string; whereParams: unknown[] } {
  if (!filter || Object.keys(filter).length === 0) {
    return { whereSql: '', whereParams: [] }
  }

  const keyPattern = /^[a-zA-Z0-9_.\-]+$/
  const clauses: string[] = []
  const params: unknown[] = []
  let p = startAt

  for (const [key, value] of Object.entries(filter)) {
    if (!keyPattern.test(key)) {
      throw new Error(
        `PgVectorStore: metadata filter key "${key}" contains unsupported characters ` +
          `(allowed: letters, digits, underscore, dot, dash)`,
      )
    }
    if (Array.isArray(value)) {
      clauses.push(`metadata->>'${key}' = ANY($${p}::text[])`)
      params.push(value.map(String))
    } else {
      clauses.push(`metadata->>'${key}' = $${p}`)
      params.push(value === null || value === undefined ? '' : String(value))
    }
    p++
  }

  return {
    whereSql: 'WHERE ' + clauses.join(' AND '),
    whereParams: params,
  }
}
