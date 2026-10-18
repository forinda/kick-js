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

`ctn` is a short alias of `createToken`: `const GREETING = ctn<string>('greeting')`.

Configure the container once at startup with `Container.setLogger()`, `setErrorFactory()`, `setEnvResolver()` (for `@Value`) and `setRequestStoreProvider()` (for `Scope.REQUEST`); each has a getter to read it back, and `null` restores the default.

`container.createChild()` gives a container that resolves its own bindings first and falls back to its parent: overrides for one tenant, job or test without touching the parent.

It uses legacy decorators: set `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json`.

Full reference: [kickjs.app/api/di](https://kickjs.app/api/di).
