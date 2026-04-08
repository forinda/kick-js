import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export class HelloModule implements AppModule {
  // `register(container)` is optional — only implement it when you need
  // to bind a token to a concrete implementation, e.g.
  //   register(container) {
  //     container.registerFactory(USER_REPOSITORY, () => container.resolve(InMemoryUserRepository))
  //   }
  // The HelloService uses @Service() so the decorator handles registration.

  routes(): ModuleRoutes {
    return {
      path: '/hello',
      router: buildRoutes(HelloController),
      controller: HelloController,
    }
  }
}
