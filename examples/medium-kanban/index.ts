import 'reflect-metadata';
import { bootstrap, configureApp } from '../../src';
import { Container } from 'inversify';
import { BoardService } from './src/services/board.service';
import { BoardController } from './src/controllers/board.controller';
import { KANBAN_TYPES } from './src/domain/board.types';

configureApp({ prefix: '/api' });

function configureBoardContainer(container: Container) {
  if (!container.isBound(KANBAN_TYPES.BoardService)) {
    container.bind(KANBAN_TYPES.BoardService).to(BoardService).inSingletonScope();
  }
}

export async function start() {
  const { app, shutdown } = await bootstrap({
    controllers: [BoardController],
    configureContainer: configureBoardContainer
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
