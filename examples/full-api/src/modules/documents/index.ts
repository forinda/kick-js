import { Container, type AppModule, type ModuleRoutes } from '@kickjs/core'
import { buildRoutes } from '@kickjs/http'
import { DOCUMENTS_REPOSITORY } from './domain/repositories/documents.repository'
import { InMemoryDocumentsRepository } from './infrastructure/repositories/in-memory-documents.repository'
import { DocumentsController } from './presentation/documents.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class DocumentsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(DOCUMENTS_REPOSITORY, () =>
      container.resolve(InMemoryDocumentsRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/documents',
      router: buildRoutes(DocumentsController),
      controller: DocumentsController,
    }
  }
}
