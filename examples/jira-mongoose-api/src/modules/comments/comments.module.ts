import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoCommentRepository } from './infrastructure/repositories/mongo-comment.repository';
import { CommentsController } from './presentation/comments.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./application/use-cases/**/*.ts', './infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class CommentsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.COMMENT_REPOSITORY, () =>
      container.resolve(MongoCommentRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(CommentsController),
      controller: CommentsController,
    };
  }
}
