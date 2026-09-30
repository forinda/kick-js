import { defineModule } from '@forinda/kickjs'
import { HelloController } from './hello.controller'

export const HelloModule = defineModule({
  name: 'HelloModule',
  build: () => ({
    // `register(container)` is optional — only implement it when you need
    // to bind a token to a concrete implementation, e.g.
    //   register(container) {
    //     container.registerFactory(USER_REPOSITORY, () => container.resolve(InMemoryUserRepository))
    //   }
    // The HelloService uses @Service() so the decorator handles registration.

    routes() {
      return {
        path: '/hello',
        controller: HelloController,
      }
    },
  }),
})
