import { type AppModule, type ModuleRoutes, type Container } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { ProductsController } from './products.controller'
import './products.service'

export class ProductsModule implements AppModule {
  register(_container: Container): void {
    // ProductsService auto-registered via @Service() decorator
  }

  routes(): ModuleRoutes {
    return {
      path: '/products',
      router: buildRoutes(ProductsController),
      controller: ProductsController,
    }
  }
}
