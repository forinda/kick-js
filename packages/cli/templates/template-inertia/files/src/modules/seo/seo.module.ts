import { defineModule } from '@forinda/kickjs'
import { SeoController } from './seo.controller'

export const SeoModule = defineModule({
  name: 'SeoModule',
  build: () => ({
    routes() {
      // /sitemap.xml and /robots.txt live at the site root.
      return { path: '/', prefix: false, version: false, controller: SeoController }
    },
  }),
})
