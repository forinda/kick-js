import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { DrizzleChannelRepository } from './infrastructure/repositories/drizzle-channel.repository'
import { DrizzleChannelMemberRepository } from './infrastructure/repositories/drizzle-channel-member.repository'
import { ChannelController } from './presentation/channel.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class ChannelModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.CHANNEL_REPOSITORY, () =>
      container.resolve(DrizzleChannelRepository),
    )
    container.registerFactory(TOKENS.CHANNEL_MEMBER_REPOSITORY, () =>
      container.resolve(DrizzleChannelMemberRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/channels',
      router: buildRoutes(ChannelController),
      controller: ChannelController,
    }
  }
}
