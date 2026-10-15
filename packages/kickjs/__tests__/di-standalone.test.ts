// The DI core without kickjs: no hooks installed, so the container's own
// errors and its silent logger. (Importing anything from kickjs installs them.)
import 'reflect-metadata'
import { expect, it } from 'vitest'
import { Container } from '../src/core/di/container'
import { Service, Value } from '../src/core/di/decorators'
import { DiError } from '../src/core/di/errors'

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
