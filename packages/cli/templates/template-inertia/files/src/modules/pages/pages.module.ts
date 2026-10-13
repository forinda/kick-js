import { defineModule } from '@forinda/kickjs'
import { PagesController } from './pages.controller'

export const PagesModule = defineModule({
  name: 'PagesModule',
  build: () => ({
    routes() {
      // Pages live at the site root, outside the /api/v1 prefix.
      return { path: '/', prefix: false, version: false, controller: PagesController }
    },
  }),
})
