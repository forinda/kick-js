# Generators

The `kick generate` command (alias `kick g`) scaffolds code following KickJS conventions. Generators produce files with proper imports, decorators, and DI registration.

## kick g module

Generate a full DDD module with all layers:

```bash
kick g module product
```

This creates the following structure inside `src/modules/products/`:

```
products/
  index.ts                                          # Module class (register + routes)
  presentation/
    product.controller.ts                           # @Controller with CRUD routes
  application/
    dtos/
      create-product.dto.ts                         # Zod schema for POST
      update-product.dto.ts                         # Zod schema for PUT
      product-response.dto.ts                       # Response interface
    use-cases/
      create-product.use-case.ts                    # @Service use case
      get-product.use-case.ts
      list-products.use-case.ts
      update-product.use-case.ts
      delete-product.use-case.ts
  domain/
    entities/
      product.entity.ts                             # Entity with factory methods
    value-objects/
      product-id.vo.ts                              # Typed ID value object
    repositories/
      product.repository.ts                         # Interface + Symbol token
    services/
      product-domain.service.ts                     # Domain logic
  infrastructure/
    repositories/
      in-memory-product.repository.ts               # @Repository implementation
```

### Module Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--no-entity` | Skip entity and value object generation | false |
| `--no-tests` | Skip test file generation | false |
| `--repo <type>` | Repository implementation: `inmemory` or `drizzle` | `inmemory` |
| `--minimal` | Only generate `index.ts` and controller | false |
| `--modules-dir <dir>` | Modules directory | `src/modules` |

### Auto-Registration

When you generate a module, the generator automatically updates `src/modules/index.ts`. If the file does not exist, it creates one:

```ts
import type { AppModuleClass } from '@kickjs/core'
import { ProductModule } from './products'

export const modules: AppModuleClass[] = [ProductModule]
```

If `index.ts` already exists, it appends the import and adds the module to the array:

```ts
import type { AppModuleClass } from '@kickjs/core'
import { UserModule } from './users'
import { ProductModule } from './products'

export const modules: AppModuleClass[] = [UserModule, ProductModule]
```

### Generated Module Index

The module `index.ts` registers the repository binding in the DI container and declares routes:

```ts
import { Container, type AppModule, type ModuleRoutes } from '@kickjs/core'
import { buildRoutes } from '@kickjs/http'
import { PRODUCT_REPOSITORY } from './domain/repositories/product.repository'
import { InMemoryProductRepository } from './infrastructure/repositories/in-memory-product.repository'
import { ProductController } from './presentation/product.controller'

export class ProductModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(PRODUCT_REPOSITORY, () =>
      container.resolve(InMemoryProductRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/products',
      router: buildRoutes(ProductController),
      controller: ProductController,
    }
  }
}
```

## Standalone Generators

Each generator creates a single file in the specified output directory.

### kick g controller

```bash
kick g controller auth
kick g controller auth -o src/modules/auth/presentation
```

Generates a `@Controller()` class with basic `@Get('/')` route. Default output: `src/controllers/`.

### kick g service

```bash
kick g service payment
```

Generates a `@Service()` class. Default output: `src/services/`.

### kick g middleware

```bash
kick g middleware logger
```

Generates an Express middleware function. Default output: `src/middleware/`.

### kick g guard

```bash
kick g guard admin
```

Generates a route guard function. Default output: `src/guards/`.

### kick g adapter

```bash
kick g adapter websocket
```

Generates an `AppAdapter` class with all lifecycle hooks stubbed out. Default output: `src/adapters/`.

### kick g dto

```bash
kick g dto create-user
```

Generates a Zod schema with inferred TypeScript type. Default output: `src/dtos/`.

## Common Options

All standalone generators accept:

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --out <dir>` | Output directory | Varies by type |

Names are automatically converted: `kick g module user-profile` produces `UserProfile` (PascalCase) for classes and `user-profile` (kebab-case) for file names. Module names are pluralized for the directory (`user-profiles/`).
