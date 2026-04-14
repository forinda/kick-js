import { Controller, Get, Autowired } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { PageService } from '../application/page.service'

@Controller()
export class HomeController {
  @Autowired()
  private pageService!: PageService

  @Get('/')
  async index(ctx: RequestContext) {
    const data = this.pageService.getHomePage()
    return ctx.inertia.render('Home', data)
  }
}
