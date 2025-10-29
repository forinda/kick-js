import { randomUUID } from 'node:crypto';
import { KickInjectable } from "@forinda/kickjs";
import type { Todo } from '../domain/todo.types';

@KickInjectable()
export class TodoService {
  private todos: Todo[] = [
    {
      id: randomUUID(),
      title: "Sample Todo",
      completed: false,
      createdAt: Date.now()
    }
  ];

  list(): Todo[] {
    return this.todos;
  }

  create(title: string): Todo {
    const todo: Todo = {
      id: randomUUID(),
      title,
      completed: false,
      createdAt: Date.now()
    };
    this.todos.push(todo);
    return todo;
  }

  toggle(id: string): Todo | null {
    const todo = this.todos.find(t => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
      return todo;
    }
    return null;
  }

  remove(id: string): boolean {
    const initialLength = this.todos.length;
    this.todos = this.todos.filter(todo => todo.id !== id);
    return this.todos.length < initialLength;
  }
}
