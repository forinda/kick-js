import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '../../../../src/utils/injection';
import { createReactive, type Reactive, type ReactiveRegistry } from '../../../../src/utils/reactive';
import { TYPES } from '../../../../src/shared/types';
import type { KanbanMetrics, Task, TaskStatus } from '../domain/board.types';

interface KanbanState extends Record<string, unknown> {
  tasks: Task[];
  metrics: KanbanMetrics;
}

@Injectable()
export class BoardService {
  private readonly store: Reactive<KanbanState>;

  constructor(@Inject(TYPES.StateRegistry) registry: ReactiveRegistry) {
    this.store = createReactive<KanbanState>(
      {
        tasks: [],
        metrics: { backlog: 0, in_progress: 0, done: 0 }
      },
      {
        id: 'sample:kanban',
        label: 'sample:kanban',
        registry,
        trackHistory: true,
        maxHistory: 200
      }
    );

    this.store.watch((_state, change) => {
      if (change.property === 'tasks') {
        this.recalculateMetrics();
      }
    });
  }

  list() {
    return {
      tasks: [...this.store.state.tasks],
      metrics: { ...this.store.state.metrics }
    };
  }

  create(input: { title: string; description?: string }) {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: 'backlog',
      createdAt: now,
      updatedAt: now
    };

    this.store.state.tasks = [...this.store.state.tasks, task];
    return task;
  }

  advance(id: string) {
    return this.updateStatus(id, (current) => {
      const transitions: TaskStatus[] = ['backlog', 'in_progress', 'done'];
      const nextIndex = Math.min(transitions.indexOf(current) + 1, transitions.length - 1);
      return transitions[nextIndex];
    });
  }

  revert(id: string) {
    return this.updateStatus(id, (current) => {
      const transitions: TaskStatus[] = ['backlog', 'in_progress', 'done'];
      const prevIndex = Math.max(transitions.indexOf(current) - 1, 0);
      return transitions[prevIndex];
    });
  }

  remove(id: string) {
    const before = this.store.state.tasks.length;
    this.store.state.tasks = this.store.state.tasks.filter((task) => task.id !== id);
    return this.store.state.tasks.length < before;
  }

  private updateStatus(id: string, computeStatus: (current: TaskStatus) => TaskStatus) {
    let updated: Task | undefined;
    this.store.state.tasks = this.store.state.tasks.map((task) => {
      if (task.id === id) {
        const nextStatus = computeStatus(task.status);
        updated = {
          ...task,
          status: nextStatus,
          updatedAt: Date.now()
        };
        return updated;
      }
      return task;
    });
    return updated;
  }

  private recalculateMetrics() {
    const metrics: KanbanMetrics = { backlog: 0, in_progress: 0, done: 0 };
    this.store.state.tasks.forEach((task) => {
      metrics[task.status] += 1;
    });
    this.store.state.metrics = metrics;
  }
}
