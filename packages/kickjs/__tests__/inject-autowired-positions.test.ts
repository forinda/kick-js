import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Autowired, Container, Inject, Service, createToken } from '../src'

// forinda/kick-js#235 §2 — `@Autowired` and `@Inject` previously diverged at
// the type level: one was property-only, the other parameter-only.
// Adopters who picked the wrong name for the position got a cryptic
// TS1240 error. Both now accept either position and route to the
// correct metadata bucket at runtime — locked here so a regression
// surfaces.

interface Greeter {
  hello(): string
}

const GREETER = createToken<Greeter>('test/greeter')
const SECOND = createToken<Greeter>('test/greeter-2')

beforeEach(() => {
  Container.reset()
})

afterEach(() => {
  Container.reset()
})

describe('forinda/kick-js#235 §2 — Autowired + Inject both work in property and parameter positions', () => {
  it('Autowired works as a constructor-parameter decorator (the previously-rejected position)', () => {
    @Service()
    class UsesAutowiredInCtor {
      constructor(@Autowired(GREETER) private readonly g: Greeter) {}
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    container.registerInstance(GREETER, { hello: () => 'hi' })

    expect(container.resolve(UsesAutowiredInCtor).sayHi()).toBe('hi')
  })

  it('Inject works as a property decorator (the previously-rejected position)', () => {
    @Service()
    class UsesInjectOnProperty {
      @Inject(GREETER) private readonly g!: Greeter
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    container.registerInstance(GREETER, { hello: () => 'hi' })

    expect(container.resolve(UsesInjectOnProperty).sayHi()).toBe('hi')
  })

  it('Autowired in its traditional property position still works', () => {
    @Service()
    class UsesAutowiredOnProperty {
      @Autowired(GREETER) private readonly g!: Greeter
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    container.registerInstance(GREETER, { hello: () => 'hi' })

    expect(container.resolve(UsesAutowiredOnProperty).sayHi()).toBe('hi')
  })

  it('Inject in its traditional constructor-parameter position still works', () => {
    @Service()
    class UsesInjectInCtor {
      constructor(@Inject(GREETER) private readonly g: Greeter) {}
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    container.registerInstance(GREETER, { hello: () => 'hi' })

    expect(container.resolve(UsesInjectInCtor).sayHi()).toBe('hi')
  })

  it('no-token Autowired() on a property resolves via reflected design:type', () => {
    @Service()
    class GreeterImpl {
      hello() {
        return 'reflected-hi'
      }
    }

    @Service()
    class UsesNoTokenProperty {
      @Autowired() private readonly g!: GreeterImpl
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    expect(container.resolve(UsesNoTokenProperty).sayHi()).toBe('reflected-hi')
  })

  it('no-token Inject() on a constructor parameter resolves via reflected design:paramtypes', () => {
    @Service()
    class AnotherGreeterImpl {
      hello() {
        return 'param-hi'
      }
    }

    @Service()
    class UsesNoTokenCtor {
      // True no-token form — relies on TypeScript's emitted
      // `design:paramtypes` reflection to find `AnotherGreeterImpl`.
      // Symmetric with `@Autowired()` on a typed property.
      constructor(@Inject() private readonly g: AnotherGreeterImpl) {}
      sayHi() {
        return this.g.hello()
      }
    }

    const container = Container.getInstance()
    expect(container.resolve(UsesNoTokenCtor).sayHi()).toBe('param-hi')
  })

  it('mixing both names within one class works — they share the runtime', () => {
    @Service()
    class Mixed {
      @Inject(GREETER) private readonly g1!: Greeter
      constructor(@Autowired(SECOND) private readonly g2: Greeter) {}
      both() {
        return `${this.g1.hello()}-${this.g2.hello()}`
      }
    }

    const container = Container.getInstance()
    container.registerInstance(GREETER, { hello: () => 'hi' })
    container.registerInstance(SECOND, { hello: () => 'hola' })

    expect(container.resolve(Mixed).both()).toBe('hi-hola')
  })
})
