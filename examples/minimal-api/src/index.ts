import 'reflect-metadata'
import { Controller, Get } from '@forinda/kickjs'
import { bootstrap, RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import type { AppModule, Container, ModuleRoutes } from '@forinda/kickjs'

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

export const app = await bootstrap({ modules: [HelloModule] })
