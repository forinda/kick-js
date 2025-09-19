import 'reflect-metadata';
import { bootstrap, configureApp } from '../../src';
import { Container } from 'inversify';
import { TODO_TYPES } from './src/domain/todo.types';
import { TodoService } from './src/services/todo.service';
import { TodoController } from './src/controllers/todo.controller';

configureApp({ prefix: '/api' });

function configureTodoContainer(container: Container) {
  if (!container.isBound(TODO_TYPES.TodoService)) {
    container.bind(TODO_TYPES.TodoService).to(TodoService).inSingletonScope();
  }
}

export async function start() {
  const { app, shutdown } = await bootstrap({
    controllers: [TodoController],
    configureContainer: configureTodoContainer
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
