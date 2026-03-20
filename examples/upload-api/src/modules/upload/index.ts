import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { UploadController } from './presentation/upload.controller'

export class UploadModule implements AppModule {
  register(_container: Container): void {
    // No additional bindings needed for this example
  }

  routes(): ModuleRoutes {
    return {
      path: '/uploads',
      router: buildRoutes(UploadController),
      controller: UploadController,
    }
  }
}
