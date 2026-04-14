import type { AppModuleClass } from '@forinda/kickjs'
import { HelloModule } from './hello/hello.module'
import { ProjectModule } from './projects/project.module'

export const modules: AppModuleClass[] = [HelloModule, ProjectModule]
