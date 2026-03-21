import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import {
  Container,
  Scope,
  PostConstruct,
  Value,
  Inject,
  Autowired,
  Configuration,
  Bean,
} from '@forinda/kickjs-core'

/**
 * Note: @Service/@Injectable decorators fire at class-definition time and
 * register on the container that exists at that moment. After Container.reset()
 * those registrations are lost. So we register classes manually in tests to
 * have full control over the container lifecycle.
 */

describe('Container', () => {
  beforeEach(() => {
    Container.reset()
  })

  // ── Registration & Resolution ─────────────────────────────────────

  it('registers and resolves a class by token', () => {
    class Foo {
      value = 42
    }
    const container = Container.getInstance()
    container.register(Foo, Foo)

    const instance = container.resolve<Foo>(Foo)
    expect(instance).toBeInstanceOf(Foo)
    expect(instance.value).toBe(42)
  })

  it('returns the same instance for singletons', () => {
    class MySingleton {}
    const container = Container.getInstance()
    container.register(MySingleton, MySingleton, Scope.SINGLETON)

    const a = container.resolve(MySingleton)
    const b = container.resolve(MySingleton)
    expect(a).toBe(b)
  })

  it('returns different instances for transient scope', () => {
    class MyTransient {}
    const container = Container.getInstance()
    container.register(MyTransient, MyTransient, Scope.TRANSIENT)

    const a = container.resolve(MyTransient)
    const b = container.resolve(MyTransient)
    expect(a).not.toBe(b)
  })

  it('throws on unregistered token', () => {
    const container = Container.getInstance()
    expect(() => container.resolve(Symbol('nope'))).toThrow('No binding found')
  })

  // ── registerFactory ───────────────────────────────────────────────

  it('resolves from a factory function', () => {
    const TOKEN = Symbol('config')
    const container = Container.getInstance()
    container.registerFactory(TOKEN, () => ({ db: 'postgres://localhost' }))

    const config = container.resolve(TOKEN)
    expect(config.db).toBe('postgres://localhost')
  })

  it('caches factory result for singletons', () => {
    const TOKEN = Symbol('counter')
    let calls = 0
    const container = Container.getInstance()
    container.registerFactory(TOKEN, () => ++calls, Scope.SINGLETON)

    container.resolve(TOKEN)
    container.resolve(TOKEN)
    expect(calls).toBe(1)
  })

  it('calls factory every time for transient scope', () => {
    const TOKEN = Symbol('counter')
    let calls = 0
    const container = Container.getInstance()
    container.registerFactory(TOKEN, () => ++calls, Scope.TRANSIENT)

    container.resolve(TOKEN)
    container.resolve(TOKEN)
    expect(calls).toBe(2)
  })

  // ── registerInstance ──────────────────────────────────────────────

  it('resolves a pre-constructed instance', () => {
    const TOKEN = Symbol('redis')
    const fakeClient = { get: () => 'cached' }
    const container = Container.getInstance()
    container.registerInstance(TOKEN, fakeClient)

    expect(container.resolve(TOKEN)).toBe(fakeClient)
  })

  // ── has() ─────────────────────────────────────────────────────────

  it('reports whether a token is registered', () => {
    class A {}
    const container = Container.getInstance()
    expect(container.has(A)).toBe(false)
    container.register(A, A)
    expect(container.has(A)).toBe(true)
  })

  // ── Circular dependency detection ─────────────────────────────────

  it('throws on circular dependencies with chain info', () => {
    class CycleA {}
    class CycleB {}

    // Simulate constructor injection: A depends on B, B depends on A
    Reflect.defineMetadata('design:paramtypes', [CycleB], CycleA)
    Reflect.defineMetadata('design:paramtypes', [CycleA], CycleB)

    const container = Container.getInstance()
    container.register(CycleA, CycleA)
    container.register(CycleB, CycleB)

    expect(() => container.resolve(CycleA)).toThrow('Circular dependency detected')
  })

  // ── Constructor injection ─────────────────────────────────────────

  it('resolves constructor parameters via design:paramtypes', () => {
    class Logger {
      log(msg: string) {
        return msg
      }
    }

    class AppService {
      constructor(public logger: Logger) {}
    }

    Reflect.defineMetadata('design:paramtypes', [Logger], AppService)

    const container = Container.getInstance()
    container.register(Logger, Logger)
    container.register(AppService, AppService)

    const svc = container.resolve(AppService)
    expect(svc.logger).toBeInstanceOf(Logger)
  })

  // ── @Inject (constructor parameter override) ──────────────────────

  it('@Inject resolves by explicit token', () => {
    const DB_TOKEN = Symbol('DB')

    class FakeDb {
      query() {
        return 'result'
      }
    }

    class DataService {
      constructor(@Inject(DB_TOKEN) public db: FakeDb) {}
    }

    const container = Container.getInstance()
    container.registerInstance(DB_TOKEN, new FakeDb())
    container.register(DataService, DataService)

    const svc = container.resolve(DataService)
    expect(svc.db.query()).toBe('result')
  })

  // ── @Autowired (property injection) ──────────────────────────────

  it('@Autowired injects lazily resolved dependency', () => {
    class Logger {
      log(msg: string) {
        return msg
      }
    }

    class AppService {
      @Autowired() logger!: Logger
    }

    // Set up design:type metadata manually (normally TypeScript emits this)
    Reflect.defineMetadata('design:type', Logger, AppService.prototype, 'logger')

    const container = Container.getInstance()
    container.register(Logger, Logger)
    container.register(AppService, AppService)

    const svc = container.resolve(AppService)
    expect(svc.logger).toBeInstanceOf(Logger)
    expect(svc.logger.log('hello')).toBe('hello')
  })

  // ── @PostConstruct ────────────────────────────────────────────────

  it('@PostConstruct is called after instantiation', () => {
    let initialized = false

    class StartupService {
      @PostConstruct()
      init() {
        initialized = true
      }
    }

    const container = Container.getInstance()
    container.register(StartupService, StartupService)
    container.resolve(StartupService)
    expect(initialized).toBe(true)
  })

  // ── @Value ────────────────────────────────────────────────────────

  it('@Value reads from process.env', () => {
    process.env.TEST_PORT_CONTAINER = '8080'

    class EnvService {
      @Value('TEST_PORT_CONTAINER') port!: string
    }

    const container = Container.getInstance()
    container.register(EnvService, EnvService)
    const svc = container.resolve(EnvService)
    expect(svc.port).toBe('8080')

    delete process.env.TEST_PORT_CONTAINER
  })

  it('@Value uses default when env var missing', () => {
    class DefaultService {
      @Value('NONEXISTENT_VAR_XYZ', 'fallback') val!: string
    }

    const container = Container.getInstance()
    container.register(DefaultService, DefaultService)
    const svc = container.resolve(DefaultService)
    expect(svc.val).toBe('fallback')
  })

  it('@Value throws when env var missing and no default', () => {
    class StrictService {
      @Value('TOTALLY_MISSING_VAR_ABC') val!: string
    }

    const container = Container.getInstance()
    container.register(StrictService, StrictService)
    const svc = container.resolve(StrictService)
    expect(() => svc.val).toThrow('TOTALLY_MISSING_VAR_ABC')
  })

  // ── Container.reset() ────────────────────────────────────────────

  it('reset() creates a clean container', () => {
    class Ephemeral {}
    const container = Container.getInstance()
    container.register(Ephemeral, Ephemeral)
    expect(container.has(Ephemeral)).toBe(true)

    Container.reset()
    const fresh = Container.getInstance()
    expect(fresh.has(Ephemeral)).toBe(false)
  })

  // ── Complex DI graph ──────────────────────────────────────────────

  it('resolves a multi-level dependency graph', () => {
    class Database {
      query() {
        return 'data'
      }
    }
    class Repository {
      constructor(public db: Database) {}
      findAll() {
        return this.db.query()
      }
    }
    class Service {
      constructor(public repo: Repository) {}
      getData() {
        return this.repo.findAll()
      }
    }

    Reflect.defineMetadata('design:paramtypes', [Database], Repository)
    Reflect.defineMetadata('design:paramtypes', [Repository], Service)

    const container = Container.getInstance()
    container.register(Database, Database)
    container.register(Repository, Repository)
    container.register(Service, Service)

    const svc = container.resolve(Service)
    expect(svc.getData()).toBe('data')
  })
})
