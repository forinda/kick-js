import type { AppModuleClass } from '@forinda/kickjs'
import { UsersModule } from './users/users.module'
import { WorkspacesModule } from './workspaces/workspaces.module'
import { TasksModule } from './tasks/tasks.module'

export const modules: AppModuleClass[] = [UsersModule, WorkspacesModule, TasksModule]
