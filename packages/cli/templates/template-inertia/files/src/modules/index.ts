import { defineModules } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'
import { PagesModule } from './pages/pages.module'
import { SeoModule } from './seo/seo.module'

// Every module the app mounts. `kick g module <name>` appends a `.mount(...)`
// line here; `kick rm module <name>` takes one out.
export const modules = defineModules().mount(HelloModule()).mount(PagesModule()).mount(SeoModule())
