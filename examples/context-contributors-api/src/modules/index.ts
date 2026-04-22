import type { AppModuleClass } from '@forinda/kickjs'
import { ProjectsModule } from './projects/projects.module'

/**
 * Module registry — every feature module the app loads is listed here.
 *
 * The Vite plugin auto-discovers `*.module.ts` files inside `src/modules/`
 * for HMR purposes. Naming this file `<name>.module.ts` ensures it
 * participates in that discovery.
 */
export const modules: AppModuleClass[] = [ProjectsModule]
