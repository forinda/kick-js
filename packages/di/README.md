# @forinda/kickjs-di

The dependency injection container behind [KickJS](https://kickjs.app/): typed tokens, decorators, a REQUEST scope, `@PostConstruct` / `@PreDestroy`, and registrations that survive HMR.

KickJS apps already have it: `@forinda/kickjs` depends on it and re-exports everything. Import from `@forinda/kickjs` and don't install this package next to it, because two copies would each keep their own container.

```ts
import 'reflect-metadata'
import { Container, Service, Inject, createToken } from '@forinda/kickjs-di'

const GREETING = createToken<string>('greeting')

@Service()
class Greeter {
  constructor(@Inject(GREETING) private readonly greeting: string) {}
  hi(name: string) {
    return `${this.greeting}, ${name}`
  }
}

const container = Container.getInstance()
container.registerInstance(GREETING, 'Hello')
container.resolve(Greeter).hi('Ada') // 'Hello, Ada'
```

It uses legacy decorators: set `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json`.

Full reference: [kickjs.app/api/di](https://kickjs.app/api/di).
