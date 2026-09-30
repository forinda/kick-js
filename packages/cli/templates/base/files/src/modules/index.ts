import { defineModules } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

// Remove HelloModule and run: kick g module <name>
// `defineModules()` returns a chainable list — `kick g module` appends
// `.mount(NewModule())` to the chain on every generation.
export const modules = defineModules().mount(HelloModule())
