import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import { PrismaMessageRepository } from './infrastructure/repositories/prisma-message.repository'
import { MessageController } from './presentation/message.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class MessageModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.MESSAGE_REPOSITORY, () =>
      container.resolve(PrismaMessageRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/messages',
      router: buildRoutes(MessageController),
      controller: MessageController,
    }
  }
}
