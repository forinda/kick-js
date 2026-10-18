import { ConfigService, Controller, Get } from '@forinda/kickjs'
import { robots, sitemap } from '@forinda/kickjs-inertia'

@Controller()
export class SeoController {
  constructor(private readonly config: ConfigService) {}

  // List every page search engines should find — add rows from your
  // repositories (`{ loc: `/posts/${id}`, lastmod: post.updatedAt }`).
  @Get('/sitemap.xml')
  sitemap() {
    return sitemap([{ loc: '/', changefreq: 'weekly', priority: 1 }, { loc: '/posts' }], {
      baseUrl: this.config.get('APP_URL'),
    })
  }

  @Get('/robots.txt')
  robots() {
    return robots({ sitemap: '/sitemap.xml', baseUrl: this.config.get('APP_URL') })
  }
}
