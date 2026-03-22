import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoChannelRepository } from './infrastructure/repositories/mongo-channel.repository';
import { ChannelsController } from './presentation/channels.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class ChannelsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.CHANNEL_REPOSITORY, () =>
      container.resolve(MongoChannelRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(ChannelsController),
      controller: ChannelsController,
    };
  }
}
