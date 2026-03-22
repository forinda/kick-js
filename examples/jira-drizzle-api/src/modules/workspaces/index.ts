import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { WORKSPACE_REPOSITORY } from './domain/repositories/workspace.repository'
import { DrizzleWorkspaceRepository } from './infrastructure/repositories/drizzle-workspace.repository'
import { DrizzleWorkspaceMemberRepository } from './infrastructure/repositories/drizzle-workspace-member.repository'
import { WorkspaceController } from './presentation/workspace.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class WorkspaceModule implements AppModule {
  register(container: Container): void {
    const workspaceFactory = () => container.resolve(DrizzleWorkspaceRepository)
    container.registerFactory(WORKSPACE_REPOSITORY, workspaceFactory)
    container.registerFactory(TOKENS.WORKSPACE_REPOSITORY, workspaceFactory)

    const memberFactory = () => container.resolve(DrizzleWorkspaceMemberRepository)
    container.registerFactory(TOKENS.WORKSPACE_MEMBER_REPOSITORY, memberFactory)
  }

  routes(): ModuleRoutes {
    return {
      path: '/workspaces',
      router: buildRoutes(WorkspaceController),
      controller: WorkspaceController,
    }
  }
}
