import type { AppModuleClass } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'

// Remove HelloModule and run: kick g module <name>
export const modules: AppModuleClass[] = [HelloModule]
