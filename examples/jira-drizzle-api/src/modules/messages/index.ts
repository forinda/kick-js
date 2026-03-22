import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { DrizzleMessageRepository } from './infrastructure/repositories/drizzle-message.repository'
import { MessageController } from './presentation/message.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class MessageModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.MESSAGE_REPOSITORY, () =>
      container.resolve(DrizzleMessageRepository),
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
