# Transactions

`transaction(fn)` commits when `fn` resolves and rolls back when it throws. Inside it, the plain client joins the transaction too, so services and repositories take part without being handed a transaction object.

## Basics

`transaction(fn)` passes `fn` a client bound to the transaction. It commits on success and rolls back on throw:

```ts
await this.db.transaction(async (tx) => {
  const user = await tx
    .insertInto('users')
    .values({ email })
    .returningAll()
    .executeTakeFirstOrThrow()

  await tx.insertInto('profiles').values({ userId: user.id }).execute()
})
```

Set an isolation level with the options form:

```ts
await this.db.transaction({ isolation: 'serializable' }, async (tx) => {
  // ...
})
```

## Savepoints

Inside a transaction, `savepoint(fn)` creates a nested rollback boundary — a throw inside rolls back only the savepoint:

```ts
await this.db.transaction(async (tx) => {
  await tx.insertInto('users').values({ email }).execute()

  await tx.savepoint(async (sp) => {
    await sp.insertInto('audit').values({ action: 'create' }).execute()
    // a throw here rolls back only the audit insert
  })
})
```

## Transactions follow the call chain

Inside `transaction(fn)`, the plain client joins the transaction too — a repository or service that only holds the injected `db` writes inside the transaction its caller opened, without being handed `tx`:

```ts
await this.db.transaction(async () => {
  const user = await this.users.create({ email }) // uses this.db internally
  await this.profiles.create({ userId: user.id }) // same transaction
})
```

`db.inTransaction` says whether the current call chain is inside one. Concurrent requests each get their own — the transaction follows the async call chain, not the client.

Calling `transaction()` while one is already open runs according to `nested`:

| `nested`            | Behaviour                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `'reuse'` (default) | runs inside the open transaction; the outer one commits or rolls back                                         |
| `'savepoint'`       | runs behind a savepoint, so a throw undoes only this part                                                     |
| `'separate'`        | opens an independent transaction on another connection — commits even if the outer rolls back (not on SQLite) |

```ts
await this.db.transaction({ nested: 'separate' }, async () => {
  await this.audit.record('login attempt') // kept even if the caller's transaction fails
})
```

## After commit

`afterCommit(fn)` runs `fn` once the transaction commits — send the email, publish the event — and drops it if the transaction (or the savepoint it was registered in) rolls back. Outside a transaction it runs right away. A hook that throws is reported to the error observers; the transaction stays committed.

```ts
await this.db.transaction(async () => {
  const order = await this.orders.place(cart)
  await this.db.afterCommit(() => this.mailer.sendReceipt(order))
})
```

## Retrying

Under `serializable` (and sometimes `repeatable read`) a transaction can fail because a concurrent one conflicted with it, and deadlocks cancel one side. Both are safe to run again — pass `retry`:

```ts
await this.db.transaction({ isolation: 'serializable', retry: true }, async () => {
  // runs again, from the start, on SerializationFailureError or DeadlockError
})
```

`retry: true` is three attempts; `retry: 5` sets the count, and `{ attempts, baseDelayMs, maxDelayMs }` the backoff (exponential with jitter, 20 ms up to 1 s by default). Only errors with `retryable: true` are retried; anything else throws at once. The callback runs once per attempt, so keep side effects outside the database in `afterCommit`. `retry` and `isolation` apply when a transaction starts — a nested `'reuse'` runs inside the outer one, and its failure retries the outer transaction if that one has `retry`. Each retry fires a `transactionRetry` event with the attempt, error and delay.

## Work that outlives the transaction

A promise started inside `transaction()` but not awaited can still be running after the commit. From then on it's no longer in the transaction: `db.inTransaction` is `false`, and a query it runs throws `TransactionFinishedError`. `await` every query inside the callback, and put work meant for after the commit in `afterCommit`.

## Related

- [Errors](./errors) — `SerializationFailureError`, `DeadlockError` and other retryable failures
- [Testing with kick/db](./testing#roll-back-after-every-test) — a transaction per test
- [Multi-tenancy → Row-level security](../multi-tenancy#row-level-security-with-kick-db-postgres) — a transaction per request
