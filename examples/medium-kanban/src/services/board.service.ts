import { randomUUID } from 'node:crypto';
import { KickInjectable } from "@forinda/kickjs";
import type { KanbanMetrics, Task, TaskStatus } from '../domain/board.types';

@KickInjectable()
export class BoardService {
  private tasks: Task[] = [
    {
      id: randomUUID(),
      title: 'Sample Task',
      description: 'This is a sample task',
      status: 'backlog',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ];

  list() {
    return {
      tasks: [...this.tasks],
      metrics: this.calculateMetrics()
    };
  }

  create(input: { title: string; description?: string }): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: 'backlog',
      createdAt: now,
      updatedAt: now
    };

    this.tasks.push(task);
    return task;
  }

  advance(id: string): Task | null {
    return this.updateStatus(id, (current) => {
      const transitions: TaskStatus[] = ['backlog', 'in_progress', 'done'];
      const nextIndex = Math.min(transitions.indexOf(current) + 1, transitions.length - 1);
      return transitions[nextIndex];
    });
  }

  revert(id: string): Task | null {
    return this.updateStatus(id, (current) => {
      const transitions: TaskStatus[] = ['backlog', 'in_progress', 'done'];
      const prevIndex = Math.max(transitions.indexOf(current) - 1, 0);
      return transitions[prevIndex];
    });
  }

  remove(id: string): boolean {
    const initialLength = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);
    return this.tasks.length < initialLength;
  }

  private updateStatus(id: string, computeStatus: (current: TaskStatus) => TaskStatus): Task | null {
    const taskIndex = this.tasks.findIndex(task => task.id === id);
    if (taskIndex === -1) return null;

    const task = this.tasks[taskIndex];
    const nextStatus = computeStatus(task.status);
    
    if (nextStatus !== task.status) {
      this.tasks[taskIndex] = {
        ...task,
        status: nextStatus,
        updatedAt: Date.now()
      };
      return this.tasks[taskIndex];
    }
    
    return task;
  }

  private calculateMetrics(): KanbanMetrics {
    const metrics: KanbanMetrics = { backlog: 0, in_progress: 0, done: 0 };
    this.tasks.forEach((task) => {
      metrics[task.status] += 1;
    });
    return metrics;
  }
}
