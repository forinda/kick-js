import type { AppModuleClass } from '@forinda/kickjs-core'
import { UserModule } from './users'
import { PostModule } from './posts'

export const modules: AppModuleClass[] = [UserModule, PostModule]
