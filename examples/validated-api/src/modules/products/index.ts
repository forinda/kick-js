import { Container, type AppModule, type ModuleRoutes } from '@kickjs/core'
import { buildRoutes } from '@kickjs/http'
import { PRODUCTS_REPOSITORY } from './domain/repositories/products.repository'
import { InMemoryProductsRepository } from './infrastructure/repositories/in-memory-products.repository'
import { ProductsController } from './presentation/products.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class ProductsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(PRODUCTS_REPOSITORY, () =>
      container.resolve(InMemoryProductsRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/products',
      router: buildRoutes(ProductsController),
      controller: ProductsController,
    }
  }
}
