// The DI core without kickjs: no hooks installed, so the container's own
// errors and its silent logger. (Importing anything from kickjs installs them.)
import 'reflect-metadata'
import { expect, it, vi } from 'vitest'
import { Container } from '../src/container'
import { Autowired, Inject, PostConstruct, Service, Value } from '../src/decorators'
import { createToken } from '../src/token'
import { DiError } from '../src/errors'
import { Scope } from '../src/interfaces'

it('throws a DiError with a stable code when nothing provides the token', () => {
  const err = (() => {
    try {
      Container.create().resolve('Missing')
    } catch (e) {
      return e
    }
  })()
  expect(err).toBeInstanceOf(DiError)
  expect(err).toMatchObject({ code: 'KICK001', subject: 'Missing' })
})

it('resolves decorated services and @Value without the framework', () => {
  @Service()
  class Greeter {
    @Value('DI_STANDALONE_NAME', 'world') name!: string
    hi() {
      return `hi ${this.name}`
    }
  }
  expect(Container.create().resolve(Greeter).hi()).toBe('hi world')
})

it('runs the README example', () => {
  const GREETING = createToken<string>('greeting')
  @Service()
  class Greeter {
    constructor(@Inject(GREETING) private readonly greeting: string) {}
    hi(name: string) {
      return `${this.greeting}, ${name}`
    }
  }
  const container = Container.create()
  container.registerInstance(GREETING, 'Hello')
  expect(container.resolve(Greeter).hi('Ada')).toBe('Hello, Ada')
})

it('runs the request-scope example from the docs', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  type Store = { instances: Map<unknown, unknown>; values: Map<unknown, unknown> }
  const scope = new AsyncLocalStorage<Store>()
  const previous = Container._requestStoreProvider
  Container._requestStoreProvider = () => scope.getStore() ?? null
  try {
    @Service({ scope: Scope.REQUEST })
    class JobContext {}
    const container = Container.create()
    const runJob = <T>(work: () => T) =>
      scope.run({ instances: new Map(), values: new Map() }, work)

    const [a, b] = runJob(() => [container.resolve(JobContext), container.resolve(JobContext)])
    const c = runJob(() => container.resolve(JobContext))
    expect(a).toBe(b)
    expect(c).not.toBe(a)
    expect(() => container.resolve(JobContext)).toThrow(
      expect.objectContaining({ code: 'KICK003' }),
    )
  } finally {
    Container._requestStoreProvider = previous
  }
})

it('types resolve() from an augmented KickJsRegistry', () => {
  const container = Container.create()
  container.registerInstance('Answer', 42)
  const answer: number = container.resolve('Answer')
  expect(answer).toBe(42)
})

declare module '../src/container' {
  interface KickJsRegistry {
    Answer: number
  }
}

it('invalidates two classes that @Autowired each other without looping', () => {
  @Service()
  class Ping {
    @Autowired() pong!: unknown
  }
  @Service()
  class Pong {
    @Autowired() ping!: Ping
  }
  Reflect.defineMetadata('design:type', Pong, Ping.prototype, 'pong')
  const container = Container.create()
  const ping = container.resolve(Ping)
  container.resolve(Pong)
  expect(() => container.invalidate(Ping)).not.toThrow()
  expect(container.resolve(Ping)).not.toBe(ping)
})

it('reports a @PostConstruct that threw on console.error by default', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  @Service()
  class Broken {
    @PostConstruct() init() {
      throw new Error('boom')
    }
  }
  Container.create().resolve(Broken)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Broken.init()'), expect.any(Error))
  error.mockRestore()
})
