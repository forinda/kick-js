// The DI core without kickjs: no hooks installed, so the container's own
// errors and its silent logger. (Importing anything from kickjs installs them.)
import 'reflect-metadata'
import { expect, it } from 'vitest'
import { Container } from '../src/container'
import { Inject, Service, Value } from '../src/decorators'
import { createToken } from '../src/token'
import { DiError } from '../src/errors'

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
