---
description: Unit-testing KickJS services, use cases and domain logic — constructing classes with fakes, resolving through the DI container, property injection, config values, time and in-memory repositories.
---

# Unit Tests

A unit test checks one class or function with its collaborators replaced, so it runs in milliseconds and fails for one reason. In a KickJS app that's mostly services, use cases and domain logic: the code that decides things. Leave HTTP out; [integration tests](./http.md) cover the wiring.

## Construct the class yourself

Constructor injection is what makes a service easy to test: pass fakes to the constructor and call it.

```ts
@Service()
export class InvoiceService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly repo: InvoiceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pay(id: string) {
    const invoice = await this.repo.find(id)
    if (!invoice) throw new Error(`No invoice ${id}`)
    if (invoice.paidAt) return invoice
    const paid = { ...invoice, paidAt: this.clock.now() }
    await this.repo.save(paid)
    return paid
  }
}
```

```ts
it('stamps the payment time once', async () => {
  const repo = new InMemoryInvoices([{ id: 'i1', total: 10, paidAt: null }])
  const service = new InvoiceService(repo, { now: () => new Date('2026-10-03T12:00:00Z') })

  const paid = await service.pay('i1')
  expect(paid.paidAt).toEqual(new Date('2026-10-03T12:00:00Z'))
  expect(repo.saved).toHaveLength(1)
})
```

No container, no decorators involved: the decorators only describe how the container builds the class. This is the fastest kind of test, and the one most worth having for business rules.

## Through the container

When a class has many dependencies, or uses property injection, let the container build it and bind fakes to the tokens it needs:

```ts
import { Container } from '@forinda/kickjs'

beforeEach(() => Container.reset())

it('pays through the container', async () => {
  const container = Container.getInstance()
  container.registerInstance(INVOICE_REPOSITORY, new InMemoryInvoices([invoice]))
  container.registerInstance(CLOCK, { now: () => new Date('2026-01-01T00:00:00Z') })

  const service = container.resolve(InvoiceService)
  expect((await service.pay('i1')).paidAt?.getUTCFullYear()).toBe(2026)
})
```

- **`Container.reset()` in `beforeEach`** gives each test an empty container. `@Service()` classes register themselves when their module is imported, so they're still resolvable after a reset; instances and fakes from the last test are gone. `kick g test` writes this line for you.
- **`Container.create()`** returns a separate container, for tests that run concurrently.
- **Singletons are per container.** Two `resolve()` calls in one test return the same instance, which is what lets a test spy on it.

::: warning Declare a class before a class that injects it
`emitDecoratorMetadata` writes the constructor and property types out when the class is defined. If `Greeter` injects `ClockHolder` and is declared first in the same file, you get `Cannot access 'ClockHolder' before initialization`. Declare dependencies first, or keep them in their own modules (the usual layout).
:::

## Property injection and config values

`@Autowired()` properties and `@Value()` config are filled in when the container builds the class, so build it with the container:

```ts
@Service()
class Greeter {
  @Value('GREETING') greeting!: string
  @Autowired() audit!: AuditLog

  greet(name: string) {
    this.audit.record('greeted', name)
    return `${this.greeting}, ${name}`
  }
}

it('greets with the configured word', async () => {
  const greeter = Container.getInstance().resolve(Greeter)
  const text = await withEnv({ GREETING: 'Habari' }, () => greeter.greet('Ada'))
  expect(text).toBe('Habari, Ada')
})
```

`withEnv(overrides, fn)` from `@forinda/kickjs` makes `@Value()`, `getEnv()` and `ConfigService` read the given values while `fn` runs, then puts the real ones back. For values every test shares, use `.env.test` ([Environment](./environment.md)).

## Time

A rule that depends on the date ("overdue after 30 days") is a rule you want to test on many dates. Inject a clock, as `InvoiceService` does, and pass a fixed one. Faking timers (`vi.useFakeTimers()`) is the fallback for code that calls `Date.now()` or `setTimeout` directly. It affects everything in the test, the HTTP stack and database drivers included, so keep it to unit tests.

## Repositories: in memory or a real database

A repository interface lets a service be tested with an array-backed fake:

```ts
class InMemoryInvoices implements InvoiceRepository {
  readonly saved: Invoice[] = []
  constructor(private rows: Invoice[]) {}

  async find(id: string) {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async save(invoice: Invoice) {
    this.saved.push(invoice)
  }
}
```

That tests the service, not the repository. The repository's queries are tested against a real database: an in-memory SQLite one per file, or Postgres with each test rolled back. See [Testing with kick/db](../database/testing.md).

`kick g module` generates a repository backed by a `Map` and a test for it, so a new module has passing tests before it has a database. When the factory moves to real queries, point its test at a test database.

## Fakes over mocks

A fake is a small working implementation (the in-memory repository, a mailer that records). A mock (`vi.fn()`) answers one call the test scripted. Prefer fakes for collaborators with state, so a test reads as "pay, then the invoice is saved", not "`save` was called with...". Use `vi.fn()` / `vi.spyOn()` for one-off checks: that a callback ran, or that an error was logged.
