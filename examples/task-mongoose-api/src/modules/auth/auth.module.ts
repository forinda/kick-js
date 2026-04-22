import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoRefreshTokenRepository } from './infrastructure/repositories/mongo-refresh-token.repository';
import { AuthController } from './presentation/auth.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./application/use-cases/**/*.ts', './infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class AuthModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.REFRESH_TOKEN_REPOSITORY, () =>
      container.resolve(MongoRefreshTokenRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/auth',
      router: buildRoutes(AuthController),
      controller: AuthController,
    };
  }
}
