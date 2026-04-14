import { Controller, Get, Autowired, type RequestContext } from '@forinda/kickjs'
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
