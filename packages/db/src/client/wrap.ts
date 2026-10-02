// Wraps a Kysely<DB> + InternalContext into a KickDbClient<DB>.
//
// Lives in its own module so consumers that need to rebuild the
// client around a new Kysely instance — `$extends({ result })` adds a
// result-extension Kysely plugin, then wraps the result back into a
// client — can do so without an import cycle through `client/create.ts`.
// Both `create.ts` and `extend/apply.ts` import from here.
//
// `InternalContext` carries everything the wrap needs that lives
// outside the Kysely instance itself: the lifecycle event emitter,
// the cached dialect tag, the savepoint counter, and the transaction
// that's open on the current call chain. Sharing the same ctx across
// re-wraps keeps the event listener identity stable — adopters who
// attached `db.on('slowQuery', ...)` continue receiving events from the
// rebuilt-after-`$extends` client.
//
// Transactions follow the call chain: `transaction()` runs its callback
// inside an AsyncLocalStorage frame, and a ROOT client (the one
// `createDbClient` returned, or `$extends` of it) sends its queries to the
// frame's transaction. A repository holding the plain `db` therefore joins
// a transaction its caller opened, without being handed `tx`.

import { AsyncLocalStorage } from 'node:async_hooks'
import { Kysely, sql, type KyselyPlugin } from 'kysely'
// Namespace import: `reportError` exists from @forinda/kickjs 8.7; the peer
// range starts earlier, so read it if present instead of importing it by name.
import * as kick from '@forinda/kickjs'

import type { KickDbClient, TransactionOptions } from './types'
import { applyExtensions } from '../extend/apply'
import { findOrCreate, upsert, type FindOrCreateOptions, type UpsertOptions } from './upsert'
import type { KickDbEventEmitter } from './events'
import type { CompileFn } from '../query/builder'
import { buildQueryNamespace } from '../query/builder'
import { KickDbError } from '../errors'
import type { ResolvedRelations } from '../query/relations'
import type { TableSnapshot } from '../snapshot/types'

/** The transaction open on a call chain, and what waits for its commit. */
export interface TxFrame {
  trx: Kysely<any>
  afterCommit: Array<() => unknown>
  /**
   * Set once the transaction (or savepoint) has committed or rolled back.
   * Async work started inside it can outlive it and still see the frame;
   * a finished frame no longer counts as an open transaction.
   */
  done?: boolean
}

/**
 * A query ran on a call chain whose transaction had already finished —
 * typically a promise started inside `transaction()` that wasn't awaited.
 */
export class TransactionFinishedError extends KickDbError {
  constructor() {
    super(
      'transaction_finished',
      'Query ran after its transaction had finished — await every query inside transaction(), ' +
        'or move work meant for after the commit into afterCommit().',
    )
  }
}

export interface InternalContext {
  events: KickDbEventEmitter | null
  dialect: KickDbClient['dialect']
  /** Increments per savepoint open inside this client; used for SP_<n> names. */
  savepointCounter: { value: number }
  /** The client's own Kysely, without `$extends` plugins — transactions start here. */
  root: Kysely<any>
  /** The transaction open on the current call chain, if any. */
  transactions: AsyncLocalStorage<TxFrame>
  /**
   * Resolved relation graph + per-table column metadata + dialect-
   * specific compiler for the relational-query namespace. Always
   * present after `createDbClient` runs — the compiler may be a
   * throw-stub for unsupported dialects (MySQL until M4.A.3).
   */
  query: {
    relations: ResolvedRelations
    tables: Record<string, TableSnapshot>
    compile: CompileFn
  }
}

/** How a client was built — `$extends` rebuilds from this. */
interface ClientShape {
  /** The Kysely this client was built on (root or transaction), plugins included. */
  qb: Kysely<any>
  /** Root clients route into the call chain's transaction; transaction clients are bound to theirs. */
  root: boolean
  /** `$extends` result plugins, re-applied to a transaction the client routes into. */
  plugins: KyselyPlugin[]
}
const shapes = new WeakMap<object, ClientShape>()

/** Retry settings from `transaction({ retry })`. */
export function retryPlan(retry: TransactionOptions['retry']): {
  attempts: number
  baseDelayMs: number
  maxDelayMs: number
} {
  const base = { attempts: 1, baseDelayMs: 20, maxDelayMs: 1000 }
  if (retry === true) return { ...base, attempts: 3 }
  if (typeof retry === 'number') return { ...base, attempts: Math.max(1, retry) }
  if (retry && typeof retry === 'object') return { ...base, ...retry }
  return base
}

/** Full-jitter exponential backoff: a random wait up to base × 2^(n−1), capped. */
export function retryDelay(plan: ReturnType<typeof retryPlan>, failedAttempt: number): number {
  const ceiling = Math.min(plan.maxDelayMs, plan.baseDelayMs * 2 ** (failedAttempt - 1))
  return Math.round(Math.random() * ceiling)
}

const withPlugins = <DB>(qb: Kysely<any>, plugins: KyselyPlugin[]): Kysely<DB> =>
  plugins.reduce((q, p) => q.withPlugin(p), qb) as Kysely<DB>

export function wrap<DB>(
  qb: Kysely<DB>,
  ctx: InternalContext,
  shape: { root?: boolean; plugins?: KyselyPlugin[] } = {},
): KickDbClient<DB> {
  const root = shape.root ?? false
  const plugins = shape.plugins ?? []

  /** Where this client's queries go now: the open transaction for a root client, else its own. */
  const active = (): Kysely<DB> => {
    const frame = root ? ctx.transactions.getStore() : undefined
    if (frame?.done) throw new TransactionFinishedError()
    return frame ? withPlugins<DB>(frame.trx, plugins) : qb
  }
  /** The open transaction on this call chain, ignoring one that has finished. */
  const openFrame = (): TxFrame | undefined => {
    const frame = ctx.transactions.getStore()
    return frame && !frame.done ? frame : undefined
  }
  const childFor = (trx: Kysely<any>): KickDbClient<DB> =>
    wrap<DB>(withPlugins<DB>(trx, plugins), ctx, { plugins })
  /** The frame to run in — a transaction client used outside the callback still has its own. */
  const currentFrame = (): TxFrame | undefined =>
    openFrame() ?? (root ? undefined : { trx: qb, afterCommit: [] })

  const ownQuery = buildQueryNamespace<DB>(
    qb,
    ctx.query.relations,
    ctx.query.tables,
    ctx.query.compile,
  )

  const savepointIn = async <T>(frame: TxFrame, fn: (sp: KickDbClient<DB>) => Promise<T>) => {
    const name = `sp_${++ctx.savepointCounter.value}`
    await sql.raw(`SAVEPOINT ${name}`).execute(frame.trx)
    // Hooks registered behind the savepoint wait on it: dropped if it rolls back.
    const inner: TxFrame = { trx: frame.trx, afterCommit: [] }
    try {
      const result = await ctx.transactions.run(inner, () => fn(childFor(frame.trx)))
      await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(frame.trx)
      frame.afterCommit.push(...inner.afterCommit)
      return result
    } catch (err) {
      await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(frame.trx)
      throw err
    } finally {
      inner.done = true
    }
  }

  const startTransaction = async <T>(
    opts: TransactionOptions,
    fn: (tx: KickDbClient<DB>) => Promise<T>,
  ): Promise<T> => {
    const isolation = opts.isolation
    const plan = retryPlan(opts.retry)
    for (let attempt = 1; ; attempt++) {
      const frame: TxFrame = { trx: ctx.root, afterCommit: [] }
      ctx.events?.emit('transactionStart', { isolation })
      let result: T
      try {
        result = await ctx.root.transaction().execute(async (trx) => {
          if (isolation) {
            await sql.raw(`SET TRANSACTION ISOLATION LEVEL ${isolation.toUpperCase()}`).execute(trx)
          }
          frame.trx = trx
          return ctx.transactions.run(frame, () => fn(childFor(trx)))
        })
        frame.done = true
      } catch (err) {
        frame.done = true
        ctx.events?.emit('transactionRollback', { isolation, error: err })
        if (attempt < plan.attempts && (err as { retryable?: unknown })?.retryable === true) {
          const delayMs = retryDelay(plan, attempt)
          ctx.events?.emit('transactionRetry', {
            isolation,
            attempt: attempt + 1,
            error: err,
            delayMs,
          })
          await new Promise((r) => setTimeout(r, delayMs))
          continue
        }
        throw err
      }
      ctx.events?.emit('transactionCommit', { isolation })
      for (const hook of frame.afterCommit) {
        try {
          await hook()
        } catch (err) {
          // Committed is committed: report the hook's failure, don't fail the transaction.
          const report = (kick as { reportError?: (e: unknown, info: object) => void }).reportError
          if (report) report(err, { source: 'db', context: { phase: 'afterCommit' } })
          else console.error('[kick/db] afterCommit hook failed', err)
        }
      }
      return result
    }
  }

  const client: KickDbClient<DB> = {
    get qb() {
      return active()
    },
    dialect: ctx.dialect,
    get query() {
      const frame = root ? ctx.transactions.getStore() : undefined
      if (frame?.done) throw new TransactionFinishedError()
      return frame
        ? buildQueryNamespace<DB>(
            withPlugins<DB>(frame.trx, plugins),
            ctx.query.relations,
            ctx.query.tables,
            ctx.query.compile,
          )
        : ownQuery
    },
    get inTransaction() {
      return !root || openFrame() !== undefined
    },

    selectFrom: ((...args: unknown[]) =>
      (active().selectFrom as (...a: unknown[]) => unknown)(
        ...args,
      )) as KickDbClient<DB>['selectFrom'],
    insertInto: ((...args: unknown[]) =>
      (active().insertInto as (...a: unknown[]) => unknown)(
        ...args,
      )) as KickDbClient<DB>['insertInto'],
    updateTable: ((...args: unknown[]) =>
      (active().updateTable as (...a: unknown[]) => unknown)(
        ...args,
      )) as KickDbClient<DB>['updateTable'],
    deleteFrom: ((...args: unknown[]) =>
      (active().deleteFrom as (...a: unknown[]) => unknown)(
        ...args,
      )) as KickDbClient<DB>['deleteFrom'],

    on(event, listener) {
      ctx.events?.on(event, listener)
      return client
    },
    off(event, listener) {
      ctx.events?.off(event, listener)
      return client
    },

    transaction: ((
      a: TransactionOptions | ((tx: KickDbClient<DB>) => Promise<unknown>),
      b?: (tx: KickDbClient<DB>) => Promise<unknown>,
    ) => {
      const opts = typeof a === 'function' ? {} : a
      const fn = (typeof a === 'function' ? a : b) as (tx: KickDbClient<DB>) => Promise<unknown>
      const frame = currentFrame()
      const nested = opts.nested ?? 'reuse'
      if (frame && nested === 'reuse') return fn(childFor(frame.trx))
      if (frame && nested === 'savepoint') return savepointIn(frame, fn)
      if (frame && ctx.dialect === 'sqlite') {
        // One connection: a second transaction would wait for the first forever.
        return Promise.reject(
          new Error(
            "transaction({ nested: 'separate' }) needs a second connection, which SQLite doesn't have — use 'reuse' or 'savepoint'",
          ),
        )
      }
      return startTransaction(opts, fn)
    }) as KickDbClient<DB>['transaction'],

    upsert: (async (table: string, opts: UpsertOptions<DB, any>) => {
      const rows = await upsert(client, table as never, opts)
      return Array.isArray(opts.values) ? rows : rows[0]
    }) as KickDbClient<DB>['upsert'],

    findOrCreate: ((table: string, opts: FindOrCreateOptions<DB, any>) =>
      findOrCreate(client, table as never, opts)) as KickDbClient<DB>['findOrCreate'],

    $extends(ext) {
      return applyExtensions(client, ctx, ext)
    },

    async savepoint(fn) {
      const frame = currentFrame()
      if (!frame)
        throw new Error('savepoint() needs an open transaction — call it inside transaction()')
      return savepointIn(frame, fn)
    },

    async afterCommit(fn) {
      const frame = currentFrame()
      if (frame && openFrame()) frame.afterCommit.push(fn)
      else await fn()
    },

    async destroy() {
      await qb.destroy()
    },
  }
  shapes.set(client, { qb, root, plugins })
  return client
}

/** `client` rebuilt with one more Kysely plugin — how `$extends({ result })` adds its plugin. */
export function rewrap<DB>(
  client: KickDbClient<DB>,
  ctx: InternalContext,
  plugin: KyselyPlugin,
): KickDbClient<DB> {
  const shape = shapes.get(client)
  if (!shape) return wrap<DB>(client.qb.withPlugin(plugin), ctx)
  return wrap<DB>(shape.qb.withPlugin(plugin) as Kysely<DB>, ctx, {
    root: shape.root,
    plugins: [...shape.plugins, plugin],
  })
}
