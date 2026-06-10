---
title: Decorators & DI
subtitle: The container that wires everything
number: '01'
tag: Core
accent: '#3b82f6'
---

# Decorators & Dependency Injection

KickJS is decorator-driven. You annotate classes, and a DI container wires them together at boot — no manual `new`, no factory boilerplate.

## The container in one minute

```ts
import { Service, Autowired } from '@forinda/kickjs'

@Service()
class Clock {
  now() {
    return new Date().toISOString()
  }
}

@Service()
class Greeter {
  // Property injection — the container resolves Clock for you.
  @Autowired() private readonly clock!: Clock

  greet(name: string) {
    return `Hello ${name}, it's ${this.clock.now()}`
  }
}
```

`@Service()` registers a class as a **singleton** in the container. `@Autowired()` asks the container to inject it. When KickJS resolves `Greeter`, it builds the whole graph.

## Token injection

When you don't want to depend on a concrete class — inject by token:

```ts
import { Inject, Service } from '@forinda/kickjs'

@Service()
class UserService {
  // Resolve whatever is bound to 'app/Cache/redis'.
  @Inject('app/Cache/redis') private readonly cache!: CacheLike
}
```

Tokens follow `<scope>/<PascalKey>[/<suffix>]` — `app/Users/repository`, `mycorp/Cache/redis`. First-party framework bindings use the reserved `kick/` prefix.

## Why it matters

- **Testability** — swap a real `Clock` for a fake in tests by rebinding the token. `Container.create()` gives each test an isolated container.
- **No wiring code** — the graph is declared where it's used, not assembled in a 200-line `main.ts`.
- **One source of truth** — every service is a singleton, so shared state (a pool, a cache) is genuinely shared.

> Decorators fire at **class definition time**. In tests, call `Container.reset()` (or `Container.create()`) before each case so stale registrations don't leak between tests.

## Next

[Modules, Controllers & Routes →](./02-modules-and-controllers.md)
