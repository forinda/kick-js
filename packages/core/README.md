# @forinda/kickjs-core

Core DI container, decorators, module system, logger, and error types for KickJS.

## Install

```bash
# Using the KickJS CLI (included by default with kick new)
kick add core

# Manual install
pnpm add @forinda/kickjs-core
```

## Features

- Custom lightweight IoC container (no Inversify)
- 20+ decorators: `@Service`, `@Controller`, `@Autowired`, `@Inject`, `@Value`, `@Get`, `@Post`, `@Middleware`, `@Bean`, `@PostConstruct`, and more
- Module system with `AppModule` interface
- Adapter pattern for lifecycle hooks
- Pino-based structured logger
- `HttpException` with static factories for all HTTP status codes
- Circular dependency detection with full resolution chain

## Quick Example

```typescript
import { Service, Controller, Get, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'

@Service()
class UserService {
  findAll() {
    return [{ id: '1', name: 'Alice' }]
  }
}

@Controller('/users')
class UserController {
  @Autowired() private userService!: UserService

  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json(this.userService.findAll())
  }
}
```

## Sub-path Imports

```typescript
import { Container } from '@forinda/kickjs-core/container'
import { Service, Controller, Get } from '@forinda/kickjs-core/decorators'
import type { AppModule } from '@forinda/kickjs-core/module'
import { HttpException } from '@forinda/kickjs-core/errors'
import { Logger } from '@forinda/kickjs-core/logger'
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
