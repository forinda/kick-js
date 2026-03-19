import type { AppModuleClass } from '@kickjs/core'
import { UserModule } from './users'
import { PostModule } from './posts'

export const modules: AppModuleClass[] = [UserModule, PostModule]
