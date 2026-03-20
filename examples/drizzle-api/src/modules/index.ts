import type { AppModuleClass } from '@forinda/kickjs-core'
import { UsersModule } from './users'
import { ProductsModule } from './products'

export const modules: AppModuleClass[] = [UsersModule, ProductsModule]
