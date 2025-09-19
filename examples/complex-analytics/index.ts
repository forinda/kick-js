import 'reflect-metadata';
import { bootstrap, configureApp } from '../../src';
import { Container } from 'inversify';
import { ANALYTICS_TYPES } from './src/domain/analytics.types';
import { ReactiveAnalyticsDatabase } from './src/db/reactive-db';
import { EventService } from './src/services/event.service';
import { EventController } from './src/controllers/event.controller';

configureApp({ prefix: '/api' });

function configureAnalyticsContainer(container: Container) {
  if (!container.isBound(ANALYTICS_TYPES.Database)) {
    container.bind(ANALYTICS_TYPES.Database).to(ReactiveAnalyticsDatabase).inSingletonScope();
  }

  if (!container.isBound(ANALYTICS_TYPES.EventService)) {
    container.bind(ANALYTICS_TYPES.EventService).to(EventService).inSingletonScope();
  }
}

export async function start() {
  const { app, shutdown } = await bootstrap({
    controllers: [EventController],
    configureContainer: configureAnalyticsContainer
  });

  return { app, shutdown };
}

if (require.main === module) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
