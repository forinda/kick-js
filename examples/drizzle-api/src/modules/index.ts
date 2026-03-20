import type { AppModuleClass } from '@forinda/kickjs-core'
import { UsersModule } from './users'
import { ProductsModule } from './products'
import { OrdersModule } from './orders'

export const modules: AppModuleClass[] = [UsersModule, ProductsModule, OrdersModule]
