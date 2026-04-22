import type { TaskEntity } from '../entities/task.entity';

export interface TaskFilter {
  projectId?: string;
  status?: string;
  priority?: string;
  assigneeId?: string;
  labelId?: string;
  q?: string;
}

export interface ITaskRepository {
  findById(id: string): Promise<TaskEntity | null>;
  findByProject(projectId: string): Promise<TaskEntity[]>;
  findByKey(key: string): Promise<TaskEntity | null>;
  create(data: Partial<TaskEntity>): Promise<TaskEntity>;
  update(id: string, data: Partial<TaskEntity>): Promise<TaskEntity | null>;
  delete(id: string): Promise<boolean>;
  findPaginated(parsed: any): Promise<{ data: TaskEntity[]; total: number }>;
  findOverdue(): Promise<TaskEntity[]>;
  countByStatus(projectId: string): Promise<Record<string, number>>;
  findSubtasks(parentTaskId: string): Promise<TaskEntity[]>;
  incrementCommentCount(taskId: string, amount: number): Promise<void>;
  incrementAttachmentCount(taskId: string, amount: number): Promise<void>;
}
