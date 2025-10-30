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

  private listeners: ((todos: Todo[]) => void)[] = [];

  constructor() {
    console.log('📝 TodoService initialized with', this.todos.length, 'todos');
  }

  public onChange(listener: (todos: Todo[]) => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.todos]));
  }

  list(): Todo[] {
    return [...this.todos];
  }

  create(title: string): Todo {
    const todo: Todo = {
      id: randomUUID(),
      title,
      completed: false,
      createdAt: Date.now()
    };
    this.todos.push(todo);
    console.log('✅ Todo created:', todo.title);
    this.notifyListeners();
    return todo;
  }

  toggle(id: string): Todo | null {
    const todo = this.todos.find(t => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
      console.log('🔄 Todo toggled:', todo.title, '->', todo.completed ? 'completed' : 'pending');
      this.notifyListeners();
      return todo;
    }
    return null;
  }

  remove(id: string): boolean {
    const todo = this.todos.find(t => t.id === id);
    const initialLength = this.todos.length;
    this.todos = this.todos.filter(todo => todo.id !== id);
    const removed = this.todos.length < initialLength;
    
    if (removed && todo) {
      console.log('🗑️ Todo removed:', todo.title);
      this.notifyListeners();
    }
    
    return removed;
  }

  getStats() {
    const completed = this.todos.filter(t => t.completed).length;
    const pending = this.todos.length - completed;
    
    return {
      total: this.todos.length,
      completed,
      pending,
      completionRate: this.todos.length > 0 ? (completed / this.todos.length) * 100 : 0
    };
  }
}
