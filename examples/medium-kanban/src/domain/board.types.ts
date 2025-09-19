export type TaskStatus = 'backlog' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanMetrics {
  backlog: number;
  in_progress: number;
  done: number;
}

export const KANBAN_TYPES = {
  BoardService: Symbol.for('sample:BoardService')
} as const;
