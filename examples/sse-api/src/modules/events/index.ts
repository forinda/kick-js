import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { EventsController } from './controller'

export class EventsModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes {
    return {
      path: '/events',
      router: buildRoutes(EventsController),
      controller: EventsController,
    }
  }
}
