import { Controller, Get, Autowired } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { PageService } from '../application/page.service'

@Controller()
export class AboutController {
  @Autowired()
  private pageService!: PageService

  @Get('/')
  async index(ctx: RequestContext) {
    const data = this.pageService.getAboutPage()
    return ctx.inertia.render('About', data)
  }
}
