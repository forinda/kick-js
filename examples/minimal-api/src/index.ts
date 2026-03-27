import 'reflect-metadata'
import { Controller, Get } from '@forinda/kickjs-core'
import { bootstrap, RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import type { AppModule, Container, ModuleRoutes } from '@forinda/kickjs-core'

@Controller()
class HelloController {
  @Get('/')
  async hello(ctx: RequestContext) {
    ctx.json({ message: 'Hello from KickJS minimal template' })
  }
}

class HelloModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(HelloController),
      controller: HelloController,
    }
  }
}

bootstrap({ modules: [HelloModule] })
