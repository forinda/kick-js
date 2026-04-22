import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoAttachmentRepository } from './infrastructure/repositories/mongo-attachment.repository';
import { AttachmentsController } from './presentation/attachments.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class AttachmentsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.ATTACHMENT_REPOSITORY, () =>
      container.resolve(MongoAttachmentRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(AttachmentsController),
      controller: AttachmentsController,
    };
  }
}
