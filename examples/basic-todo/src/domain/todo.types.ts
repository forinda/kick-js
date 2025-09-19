export const TODO_TYPES = {
  TodoService: Symbol.for('sample:TodoService')
} as const;

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}
