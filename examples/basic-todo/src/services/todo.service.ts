import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '../../../../src/utils/injection';
import { createReactive, type Reactive, type ReactiveRegistry } from '../../../../src/utils/reactive';
import { TYPES } from '../../../../src/shared/types';
import type { Todo } from '../domain/todo.types';

interface TodoState extends Record<string, unknown> {
  todos: Todo[];
}

@Injectable()
export class TodoService {
  private readonly store: Reactive<TodoState>;

  constructor(@Inject(TYPES.StateRegistry) registry: ReactiveRegistry) {
    this.store = createReactive<TodoState>(
      { todos: [] },
      {
        id: 'sample:todos',
        label: 'sample:todos',
        registry,
        trackHistory: true,
        maxHistory: 100
      }
    );

    this.store.watch((_state, change) => {
      if (change.property === 'todos') {
        // eslint-disable-next-line no-console
        console.debug('[TodoService] Todos updated. Count:', this.store.state.todos.length);
      }
    });
  }

  list() {
    return [...this.store.state.todos];
  }

  create(title: string) {
    const todo: Todo = {
      id: randomUUID(),
      title,
      completed: false,
      createdAt: Date.now()
    };
    this.store.state.todos = [...this.store.state.todos, todo];
    return todo;
  }

  toggle(id: string) {
    let updated: Todo | undefined;
    this.store.state.todos = this.store.state.todos.map((todo) => {
      if (todo.id === id) {
        updated = { ...todo, completed: !todo.completed };
        return updated;
      }
      return todo;
    });
    return updated;
  }

  remove(id: string) {
    const before = this.store.state.todos.length;
    this.store.state.todos = this.store.state.todos.filter((todo) => todo.id !== id);
    return this.store.state.todos.length < before;
  }
}
