import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { STATS_REPOSITORY } from './domain/repositories/stat.repository'
import { DrizzleStatsRepository } from './infrastructure/repositories/drizzle-stat.repository'
import { StatController } from './presentation/stat.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class StatModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(STATS_REPOSITORY, () => container.resolve(DrizzleStatsRepository))
  }

  routes(): ModuleRoutes {
    return {
      path: '/stats',
      router: buildRoutes(StatController),
      controller: StatController,
    }
  }
}
